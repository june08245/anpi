"""気象庁の警報・地震情報と、ニュースの見出しを集めて data/info.json に保存する。
GitHub Actions から30分ごとに実行される（このファイルを変更して送った時にも実行される）。標準ライブラリだけで動く。
どれか1つの取得に失敗しても、前回の内容を残して他は更新する。
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

JST = timezone(timedelta(hours=9))
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "info.json")
UA = {"User-Agent": "futari-anpi/1.0 (+https://github.com/june08245/anpi)"}

OSAKA_PREF = "270000"     # 大阪府（気象庁の府県予報区）
OSAKA_CITY = "2710000"    # 大阪市（市町村等をまとめた地域）
OSAKA_PREF_INT = "27"     # 地震の震度で使う都道府県コード

WARN_URLS = [
    f"https://www.jma.go.jp/bosai/warning/data/r8/{OSAKA_PREF}.json",       # 2026年からの形式
    f"https://www.jma.go.jp/bosai/warning/data/warning/{OSAKA_PREF}.json",  # 以前の形式
]
QUAKE_URL = "https://www.jma.go.jp/bosai/quake/data/list.json"

# 警報コード → (名前, レベル)  レベル: 5特別警報 4危険警報 3警報 2注意報
WARN_CODES = {
    "32": ("暴風雪特別警報", 5), "33": ("大雨特別警報", 5), "34": ("氾濫特別警報", 5),
    "35": ("暴風特別警報", 5), "36": ("大雪特別警報", 5), "37": ("波浪特別警報", 5),
    "38": ("高潮特別警報", 5), "39": ("土砂災害特別警報", 5),
    "43": ("大雨危険警報", 4), "44": ("氾濫危険警報", 4), "48": ("高潮危険警報", 4), "49": ("土砂災害危険警報", 4),
    "02": ("暴風雪警報", 3), "03": ("大雨警報", 3), "04": ("氾濫警報", 3), "05": ("暴風警報", 3),
    "06": ("大雪警報", 3), "07": ("波浪警報", 3), "08": ("高潮警報", 3), "09": ("土砂災害警報", 3),
    "10": ("大雨注意報", 2), "12": ("大雪注意報", 2), "13": ("風雪注意報", 2), "14": ("雷注意報", 2),
    "15": ("強風注意報", 2), "16": ("波浪注意報", 2), "17": ("融雪注意報", 2), "18": ("氾濫注意報", 2),
    "19": ("高潮注意報", 2), "20": ("濃霧注意報", 2), "21": ("乾燥注意報", 2), "22": ("なだれ注意報", 2),
    "23": ("低温注意報", 2), "24": ("霜注意報", 2), "25": ("着氷注意報", 2), "26": ("着雪注意報", 2),
    "27": ("その他の注意報", 2), "29": ("土砂災害注意報", 2),
}
INACTIVE = {"解除", "発表警報・注意報はなし"}

# 国際ニュースを話題ごとに分けて集める（key, 表示名, 検索, 見出しに必要な言葉）
NHK_WORLD = "https://www3.nhk.or.jp/rss/news/cat6.xml"
WORLD_TOPICS = [
    ("iran", "イラン・アメリカ", ["イラン アメリカ when:3d", "イラン 米軍 when:3d"], ["イラン"]),
    ("china", "中国・台湾", ["中国軍 台湾 when:3d", "台湾海峡 when:3d", "中国 軍事 日本 when:3d"], ["台湾", "中国軍", "中国海警", "習近平", "中国"]),
    ("nk", "北朝鮮", ["北朝鮮 when:3d"], ["北朝鮮", "金正恩"]),
    ("russia", "ロシア", ["ロシア ウクライナ when:3d", "ロシア軍 when:3d"], ["ロシア", "プーチン"]),
]
WORLD_NEWS_WORDS = ["攻撃", "空爆", "爆撃", "ミサイル", "軍", "侵攻", "停戦", "核", "演習", "封鎖", "衝突", "交戦",
                    "戦争", "制裁", "首脳", "会談", "協議", "大統領", "発射", "領海", "領空", "防衛", "緊張", "威嚇"]
# 南海トラフ（臨時情報などは大阪にも直接関わる）
NANKAI_FEEDS = ["https://news.google.com/rss/search?q=" + urllib.parse.quote("南海トラフ when:7d") + "&hl=ja&gl=JP&ceid=JP:ja"]

OUTAGE_FEEDS = [
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("停電 大阪 when:2d") + "&hl=ja&gl=JP&ceid=JP:ja",
]
OUTAGE_KEYWORDS = ["停電"]
OUTAGE_PLACES = ["大阪", "関西", "近畿", "関電", "生野", "旭区"]  # 見出しにどれかを含むものだけ
BLOCK_SOURCES = ["Vietnam.vn", "YouTube", "ニコニコ"]  # ニュースではない動画サイトなど
JAPAN_FEEDS = [
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("Jアラート when:1d") + "&hl=ja&gl=JP&ceid=JP:ja",
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("弾道ミサイル 日本 when:1d") + "&hl=ja&gl=JP&ceid=JP:ja",
]
JAPAN_KEYWORDS = ["Jアラート", "弾道ミサイル", "国民保護"]
JAPAN_MISSILE_PLACES = ["北朝鮮", "日本", "EEZ", "ＥＥＺ", "排他的経済水域", "防衛省", "官房長官", "日本海"]  # 日本に関係する弾道ミサイルの報道だけ数える
# 大阪市：避難指示・断水・大きな火災などの報道（見出しに大阪市内の地名を含むもの）
OSAKA_FEEDS = [
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("大阪市 避難指示 OR 断水 OR 大規模火災 OR 爆発 OR テロ when:1d") + "&hl=ja&gl=JP&ceid=JP:ja",
]
OSAKA_PLACES = ["大阪市", "生野", "旭区", "大阪・", "大阪の", "大阪で", "大阪市内"]
OSAKA_RED = ["避難指示", "緊急安全確保", "テロ", "爆発"]
OSAKA_YELLOW = ["断水", "大規模火災", "延焼", "高齢者等避難"]

# サイバー攻撃・通信障害（通信障害は安否連絡に直接響くので一緒に見る）
CYBER_FEEDS = [
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("サイバー攻撃 when:2d") + "&hl=ja&gl=JP&ceid=JP:ja",
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("ランサムウェア OR 不正アクセス when:2d") + "&hl=ja&gl=JP&ceid=JP:ja",
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("通信障害 OR システム障害 OR つながりにくい when:1d") + "&hl=ja&gl=JP&ceid=JP:ja",
]
CYBER_KEYWORDS = ["サイバー", "ランサムウェア", "不正アクセス", "ハッキング", "DDoS", "情報漏えい", "情報流出", "通信障害", "システム障害", "つながりにくい"]
# 自分たちに直接関わるサイバー攻撃・障害（大阪市を「注意」にする）
#   1) 大阪・関西のライフラインなどへの攻撃や障害（情報流出だけのものは含めない）
#   2) 携帯会社・LINEの通信障害（住んでいる場所に関係なく連絡に響く）
CYBER_LOCAL_PLACES = ["大阪", "関西", "近畿", "関電", "大阪ガス", "大阪メトロ", "生野", "旭区"]
CYBER_LOCAL_WORDS = ["サイバー攻撃", "ランサムウェア", "通信障害", "システム障害", "大規模障害", "つながりにくい"]
CARRIERS = ["ドコモ", "docomo", "au", "KDDI", "ソフトバンク", "SoftBank", "楽天モバイル", "LINE"]
CARRIER_WORDS = ["通信障害", "障害", "つながりにくい", "つながらない"]

# ---------- 危険度の判定（目安） ----------
# 世界：直近24時間のニュース見出しに出てくる言葉で判定
WORLD_RED = ["核攻撃", "核兵器を使用", "核兵器使用", "全面戦争", "宣戦布告", "日本を攻撃", "在日米軍基地を攻撃", "在日米軍基地に攻撃",
             "台湾に侵攻", "台湾を攻撃", "台湾へ攻撃", "台湾に上陸"]
# 「核攻撃の偽警報」「核攻撃を想定した訓練」のような見出しで緊急にしないための除外語
RED_EXCLUDE = ["回避", "避け", "防ぐ", "阻止", "食い止め", "偽", "誤報", "誤って", "訓練", "試験", "テスト", "？", "?", "のか", "か｜", "へ突入か", "想定", "可能性", "恐れ", "おそれ", "シナリオ", "シミュレーション", "否定", "なら", "仮に", "警告", "懸念"]
WORLD_YELLOW = ["攻撃", "空爆", "爆撃", "軍事衝突", "交戦", "報復", "ミサイル", "封鎖", "侵攻", "大規模演習"]


def get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def iso(dt):
    return dt.astimezone(JST).isoformat(timespec="minutes") if dt else None


# ---------- 警報・注意報 ----------
def kinds_to_list(kinds):
    out, seen = [], set()
    for k in kinds or []:
        code, status = str(k.get("code", "")), k.get("status", "")
        if not code or status in INACTIVE or code in seen:
            continue
        seen.add(code)
        name, level = WARN_CODES.get(code, (f"警報・注意報（コード{code}）", 2))
        out.append({"code": code, "name": name, "level": level, "status": status})
    return out


def parse_warnings(data):
    """新形式（電文の配列）と旧形式の両方から、大阪市の発表中の警報・注意報を取り出す"""
    items, headline, reported = [], "", None
    if isinstance(data, list):  # 2026年からの形式
        for msg in data:
            rd = msg.get("reportDatetime")
            if rd and (reported is None or rd > reported):
                reported = rd
                headline = (msg.get("headlineText") or "").strip() or headline
            w = msg.get("warning") or {}
            for it in w.get("class20Items") or []:
                if str(it.get("areaCode")) == OSAKA_CITY:
                    items += kinds_to_list(it.get("kinds"))
    elif isinstance(data, dict):  # 以前の形式
        reported = data.get("reportDatetime")
        headline = (data.get("headlineText") or "").strip()
        for at in data.get("areaTypes") or []:
            for a in at.get("areas") or []:
                if str(a.get("code")) == OSAKA_CITY:
                    items += kinds_to_list(a.get("warnings"))
    # 重複を除いて、危険なものから並べる
    uniq = {i["code"]: i for i in items}
    items = sorted(uniq.values(), key=lambda i: (-i["level"], i["code"]))
    return {"area": "大阪市", "items": items, "headline": headline[:300], "reported": reported}


def fetch_warnings():
    last_err = None
    for url in WARN_URLS:
        try:
            return parse_warnings(json.loads(get(url)))
        except Exception as e:  # 次の形式を試す
            last_err = e
    raise last_err


# ---------- 地震 ----------
SHINDO_RANK = {"1": 1, "2": 2, "3": 3, "4": 4, "5-": 5, "5+": 6, "6-": 7, "6+": 8, "7": 9}


def shindo_label(s):
    return {"5-": "5弱", "5+": "5強", "6-": "6弱", "6+": "6強"}.get(s, s or "")


def parse_quakes(data, limit=8):
    out, seen = [], set()
    for q in data or []:
        if not isinstance(q, dict) or not q.get("anm") or not q.get("at"):
            continue  # 震源が決まっていない速報などは飛ばす
        eid = q.get("eid") or q.get("at")
        if eid in seen:
            continue  # 同じ地震の続報は最新の1件だけ
        seen.add(eid)
        osaka = ""
        for p in q.get("int") or []:
            if str(p.get("code")) == OSAKA_PREF_INT:
                osaka = p.get("maxi", "")
        out.append({
            "at": q.get("at"), "place": q.get("anm"), "mag": q.get("mag") or "",
            "maxi": shindo_label(q.get("maxi")), "maxiRank": SHINDO_RANK.get(q.get("maxi"), 0),
            "osaka": shindo_label(osaka), "osakaRank": SHINDO_RANK.get(osaka, 0),
            "title": q.get("ttl") or "",
        })
        if len(out) >= limit:
            break
    return out


def fetch_quakes():
    return parse_quakes(json.loads(get(QUAKE_URL)))


# ---------- ニュース ----------
def parse_rss(xml_bytes):
    root = ET.fromstring(xml_bytes)
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        src = (it.findtext("source") or "").strip()
        pub = it.findtext("pubDate")
        try:
            dt = parsedate_to_datetime(pub) if pub else None
        except Exception:
            dt = None
        if not src and " - " in title:  # Googleニュースは「見出し - 媒体名」
            title, src = title.rsplit(" - ", 1)
        elif src and title.endswith(" - " + src):
            title = title[: -len(" - " + src)]
        src = re.split(r"\s[|｜]\s", src)[0].strip()[:20]
        if "nhk.or.jp" in link and not src:
            src = "NHK"
        if title and link.startswith("http"):
            items.append({"title": title, "link": link, "source": src, "dt": dt})
    return items


def norm(t):
    """同じ記事の転載を1つにまとめるための比較用の文字列"""
    t = re.split(r"\s[–—-]\s", t)[0]                      # 末尾の「 – 媒体名」を落とす
    t = re.sub(r"^[^：:]{1,10}[：:]", "", t)                  # 先頭の「WSJ日本版：」などを落とす
    t = re.sub(r"^【[^】]{1,10}】", "", t)
    return re.sub(r"[\s　「」『』【】（）()〈〉“”\"'、。・:：,，!！?？…]", "", t)[:16]


def collect_news(feeds, keywords, limit, max_age_h, must=None, extra=None):
    items, errors = list(extra or []), 0
    for url in feeds:
        try:
            items += parse_rss(get(url))
        except Exception:
            errors += 1
    if errors == len(feeds):
        raise RuntimeError("all feeds failed")
    now = datetime.now(timezone.utc)
    out, seen = [], set()
    for i in sorted(items, key=lambda x: x["dt"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        if not any(k in i["title"] for k in keywords):
            continue
        if must and not any(k in i["title"] for k in must):
            continue
        if any(b in i["source"] for b in BLOCK_SOURCES):
            continue
        if i["dt"] and now - i["dt"] > timedelta(hours=max_age_h):
            continue
        key = norm(i["title"])
        if key in seen:
            continue
        seen.add(key)
        out.append({"title": i["title"], "link": i["link"], "source": i["source"], "at": iso(i["dt"])})
        if len(out) >= limit:
            break
    return out


def within(at, hours, now):
    try:
        return now - datetime.fromisoformat(at) <= timedelta(hours=hours)
    except Exception:
        return False


def hits(news, words, now, hours=24):
    out = []
    for n in news or []:
        if within(n.get("at"), hours, now) and any(w in n["title"] for w in words):
            out.append(n)
    return out


def assess_world(r, now):
    red = [n for n in hits(r.get("world"), WORLD_RED, now) if not any(x in n["title"] for x in RED_EXCLUDE)]
    if red:
        return {"level": "red", "reasons": [f"「{red[0]['title'][:40]}」などの報道"], "items": red[:3]}
    reasons, items = [], []
    for t in r.get("world_topics") or []:
        yel = hits(t.get("items"), WORLD_YELLOW, now)
        if yel:
            words = [w for w in WORLD_YELLOW if any(w in n["title"] for n in yel)][:2]
            reasons.append(f"{t['label']}：「{'」「'.join(words)}」{len(yel)}件")
            items += yel[:1]
    if not reasons:  # 話題別がまだない古いデータ用
        yel = hits(r.get("world"), WORLD_YELLOW, now)
        if yel:
            words = [w for w in WORLD_YELLOW if any(w in n["title"] for n in yel)][:3]
            reasons.append(f"24時間以内に「{'」「'.join(words)}」の報道が{len(yel)}件")
            items = yel[:3]
    if reasons:
        return {"level": "yellow", "reasons": reasons, "items": items[:3]}
    return {"level": "green", "reasons": ["24時間以内に、攻撃や衝突の報道は見当たりません"], "items": []}


def nankai_level(news, now):
    """南海トラフ地震臨時情報の発表を見出しから拾う（巨大地震警戒→red、巨大地震注意・調査中→yellow）"""
    for n in news or []:
        t = n["title"]
        if "臨時情報" not in t or "発表" not in t:
            continue
        if "巨大地震警戒" in t and within(n.get("at"), 24 * 7, now):
            return "red", f"南海トラフ地震臨時情報（巨大地震警戒）"
    for n in news or []:
        t = n["title"]
        if "臨時情報" not in t or "発表" not in t:
            continue
        if "巨大地震注意" in t and within(n.get("at"), 24 * 7, now):
            return "yellow", "南海トラフ地震臨時情報（巨大地震注意）"
        if "調査中" in t and within(n.get("at"), 24, now):
            return "yellow", "南海トラフ地震臨時情報（調査中）"
    return None, None


def quake_when(q):
    return datetime.fromisoformat(q["at"]).astimezone(JST).strftime("%-m/%-d %H:%M")


def assess_japan(r, now):
    """日本全体：大きな地震、Jアラート・弾道ミサイル"""
    red, yel = [], []
    for q in r.get("quakes") or []:
        if not within(q.get("at"), 24, now):
            continue
        if q.get("maxiRank", 0) >= 7:
            red.append(f"{q['place']}で震度{q['maxi']}（{quake_when(q)}）")
        elif q.get("maxiRank", 0) >= 5:
            yel.append(f"{q['place']}で震度{q['maxi']}（{quake_when(q)}）")
    nl, nr = nankai_level(r.get("nankai"), now)
    if nl == "red":
        red.append(nr)
    elif nl == "yellow":
        yel.append(nr)
    jn = r.get("japan") or []
    ja = [n for n in hits(jn, ["Jアラート", "国民保護"], now, 12) if not any(x in n["title"] for x in RED_EXCLUDE)]
    if ja:
        red.append(f"「{ja[0]['title'][:40]}」")
    else:
        mi = [n for n in hits(jn, ["弾道ミサイル"], now, 24) if any(w in n["title"] for w in JAPAN_MISSILE_PLACES)]
        if mi:
            yel.append(f"弾道ミサイルの報道（{mi[0]['title'][:30]}）")
    if red:
        return {"level": "red", "reasons": red + yel}
    if yel:
        return {"level": "yellow", "reasons": yel}
    return {"level": "green", "reasons": ["大きな地震やミサイルの報道なし"]}


def local_cyber(news, now):
    out = []
    for n in news or []:
        if not within(n.get("at"), 24, now):
            continue
        t = n["title"]
        if any(p in t for p in CYBER_LOCAL_PLACES) and any(w in t for w in CYBER_LOCAL_WORDS):
            out.append(n)
        elif any(c in t for c in CARRIERS) and any(w in t for w in CARRIER_WORDS) and "流出" not in t:
            out.append(n)
    return out


def assess_osaka(r, now):
    """大阪市：警報、大阪の震度、停電・断水・避難指示などの報道"""
    red, yel = [], []
    for w in ((r.get("warnings") or {}).get("items")) or []:
        if w["level"] >= 4:
            red.append(f"{w['name']}")
        elif w["level"] == 3:
            yel.append(f"{w['name']}")
    for q in r.get("quakes") or []:
        if not within(q.get("at"), 24, now):
            continue
        if q.get("osakaRank", 0) >= 5:
            red.append(f"震度{q['osaka']}の地震（{quake_when(q)}）")
        elif q.get("osakaRank", 0) == 4:
            yel.append(f"震度4の地震（{quake_when(q)}）")
    out = hits(r.get("outage"), ["停電"], now, 24)
    if out:
        yel.append(f"停電の報道（{out[0]['title'][:30]}）")
    loc = r.get("osaka") or []
    lr = [n for n in hits(loc, OSAKA_RED, now, 24) if not any(x in n["title"] for x in RED_EXCLUDE)]
    if lr:
        red.append(f"「{lr[0]['title'][:40]}」")
    else:
        ly = hits(loc, OSAKA_YELLOW, now, 24)
        if ly:
            yel.append(f"「{ly[0]['title'][:40]}」")
    nl, nr = nankai_level(r.get("nankai"), now)
    if nl == "red":
        red.append(nr)
    elif nl == "yellow":
        yel.append(nr)
    cy = local_cyber(r.get("cyber"), now)
    if cy:
        yel.append(f"「{cy[0]['title'][:40]}」")
    if red:
        return {"level": "red", "reasons": red + yel}
    if yel:
        return {"level": "yellow", "reasons": yel}
    return {"level": "green", "reasons": ["警報なし・大きな揺れや停電の報道なし"]}


def collect_world_topics():
    out, ok = [], 0
    try:
        nhk = parse_rss(get(NHK_WORLD))
    except Exception:
        nhk = []
    for key, label, queries, must in WORLD_TOPICS:
        feeds = ["https://news.google.com/rss/search?q=" + urllib.parse.quote(q) + "&hl=ja&gl=JP&ceid=JP:ja" for q in queries]
        try:
            items = collect_news(feeds, must, 6, 72, WORLD_NEWS_WORDS, extra=nhk)
            ok += 1
        except Exception:
            items = []
        out.append({"key": key, "label": label, "items": items})
    if not ok:
        raise RuntimeError("all topics failed")
    return out


# ---------- まとめ ----------
def main():
    try:
        with open(OUT, encoding="utf-8") as f:
            prev = json.load(f)
    except Exception:
        prev = {}

    result = {"updated": iso(datetime.now(timezone.utc)), "errors": []}
    jobs = {
        "warnings": fetch_warnings,
        "quakes": fetch_quakes,
        "world_topics": collect_world_topics,
        "nankai": lambda: collect_news(NANKAI_FEEDS, ["南海トラフ"], 6, 24 * 7),
        "outage": lambda: collect_news(OUTAGE_FEEDS, OUTAGE_KEYWORDS, 6, 48, OUTAGE_PLACES),
        "japan": lambda: collect_news(JAPAN_FEEDS, JAPAN_KEYWORDS, 6, 48),
        "cyber": lambda: collect_news(CYBER_FEEDS, CYBER_KEYWORDS, 10, 48),
        "osaka": lambda: collect_news(OSAKA_FEEDS, OSAKA_RED + OSAKA_YELLOW, 6, 48, OSAKA_PLACES),
    }
    for key, fn in jobs.items():
        try:
            result[key] = fn()
        except Exception as e:
            print(f"[{key}] 取得失敗: {e}", file=sys.stderr)
            result["errors"].append(key)
            result[key] = prev.get(key)  # 前回の内容を残す

    # 話題別をまとめた一覧（新しい順・20件）も残す
    merged, seen = [], set()
    for t in result.get("world_topics") or []:
        for n in t["items"]:
            if n["link"] not in seen:
                seen.add(n["link"]); merged.append(dict(n, topic=t["label"]))
    merged.sort(key=lambda n: n.get("at") or "", reverse=True)
    result["world"] = merged[:20]

    now = datetime.now(timezone.utc)
    result["status"] = {"osaka": assess_osaka(result, now), "japan": assess_japan(result, now), "world": assess_world(result, now)}

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(f"更新: {result['updated']} 失敗: {result['errors']}")


if __name__ == "__main__":
    main()
