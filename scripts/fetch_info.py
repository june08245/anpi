"""気象庁の警報・地震情報と、ニュースの見出しを集めて data/info.json に保存する。
GitHub Actions から30分ごとに実行される。標準ライブラリだけで動く。
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

WORLD_FEEDS = [
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("イラン アメリカ when:3d") + "&hl=ja&gl=JP&ceid=JP:ja",
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("イラン 米軍 when:3d") + "&hl=ja&gl=JP&ceid=JP:ja",
    "https://www3.nhk.or.jp/rss/news/cat6.xml",  # NHK 国際
]
WORLD_KEYWORDS = ["イラン", "米国", "アメリカ", "米軍", "トランプ", "イスラエル", "中東", "ミサイル",
                  "攻撃", "空爆", "停戦", "ホルムズ", "核"]
OUTAGE_FEEDS = [
    "https://news.google.com/rss/search?q=" + urllib.parse.quote("停電 大阪 when:2d") + "&hl=ja&gl=JP&ceid=JP:ja",
]
OUTAGE_KEYWORDS = ["停電"]


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
        if "nhk.or.jp" in link and not src:
            src = "NHK"
        if title and link.startswith("http"):
            items.append({"title": title, "link": link, "source": src, "dt": dt})
    return items


def norm(t):
    return re.sub(r"[\s　「」『』【】（）()、。・:：]", "", t)[:40]


def collect_news(feeds, keywords, limit, max_age_h):
    items, errors = [], 0
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
        "world": lambda: collect_news(WORLD_FEEDS, WORLD_KEYWORDS, 15, 72),
        "outage": lambda: collect_news(OUTAGE_FEEDS, OUTAGE_KEYWORDS, 6, 48),
    }
    for key, fn in jobs.items():
        try:
            result[key] = fn()
        except Exception as e:
            print(f"[{key}] 取得失敗: {e}", file=sys.stderr)
            result["errors"].append(key)
            result[key] = prev.get(key)  # 前回の内容を残す

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(f"更新: {result['updated']} 失敗: {result['errors']}")


if __name__ == "__main__":
    main()
