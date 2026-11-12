import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

// 大阪市の各区役所が公表している災害時避難所（2026年10月時点で確認）
// [名称, 住所, 地震時に浸水のおそれ]
const SHELTERS = {
  "生野区": [["北鶴橋小学校","鶴橋3-4-50"],["鶴橋小学校","桃谷2-20-32"],["いくのコーライブズパーク（もと御幸森小）","桃谷5-5-37"],["東勝山小学校","勝山北3-7-21"],["もと舎利寺小学校","勝山南4-15-25"],["ワン・ワールド・インターナショナルスクール大阪（もと生野小）","舎利寺3-1-39"],["田島南小中一貫校 第2校地","田島3-7-38"],["東朋学園高等学校（もと生野南小）","林寺6-6-7"],["アブロードインターナショナル大阪校（もと林寺小）","林寺2-14-3"],["大池小学校","中川3-4-3"],["東中川小学校","新今里7-14-37"],["小路小学校","小路2-24-40"],["東小路小学校","小路東3-8-15"],["巽小学校","巽中3-12-5"],["北巽小学校","巽北1-30-29"],["巽南小学校","巽南2-10-7"],["巽東小学校","巽東3-8-13"],["もと鶴橋中学校","勝山北4-9-22"],["桃谷中学校","勝山北3-13-44"],["生野未来学園","生野西3-5-40"],["田島南小中一貫校","田島5-23-7"],["大池中学校","中川6-3-6"],["東生野中学校","新今里7-9-25"],["新生野中学校","巽東3-3-12"],["巽中学校","巽中3-17-20"],["新巽中学校","巽南4-2-53"],["府立生野工業高等学校","生野東2-3-66"],["府立生野支援学校","巽東4-2-47"],["府立桃谷高等学校","勝山南3-1-4"],["府立大阪わかば高等学校","巽東3-10-75"],["金光藤蔭高等学校","小路東4-1-26"],["プール学院中学校・高等学校","勝山北1-19-31"],["大阪偕星学園高等学校","勝山南2-6-38"],["天理教葛上分教会","新今里5-3-1"],["NRB日本理容美容専門学校","鶴橋1-6-34"],["府立生野聴覚支援学校","桃谷1-2-1"]],
  "旭区": [["清水小学校","清水5-1-12"],["新森小路小学校","新森6-3-13"],["古市小学校","森小路2-10-35"],["太子橋小学校","太子橋1-12-15"],["大宮小学校","大宮4-9-16"],["大宮西小学校","中宮1-8-14",1],["生江小学校","生江1-10-21"],["城北小学校","赤川3-13-47"],["高殿小学校","高殿6-9-10"],["高殿南小学校","高殿3-10-30"],["旭東中学校","新森6-7-25"],["今市中学校","大宮5-13-40"],["大宮中学校","中宮4-7-11"],["旭陽中学校","高殿5-9-31",1],["旭高等学校","高殿5-6-41",1],["淀川工科高等学校","太子橋3-1-32"],["大阪工業大学 総合体育館","大宮5-16-1"],["大阪工業大学 第2体育館","大宮5-16-1"],["思斉支援学校","大宮5-11-7"],["光陽支援学校","新森6-8-21"]]
};
// 内部の値（ok/hurt/help）はFirebaseのルールと合わせてあるので変えない。表示だけ変える
const LABEL = { ok: "家で無事", hurt: "避難した", help: "ケガ・危ない" };
const SIX_H = 6 * 3600e3;

const $ = s => document.querySelector(s);
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

let fb = null;          // { db, uid, setDoc, doc }
let roomPath = null;
let people = {};        // uid -> status
let batt = ls.get("batt");
let myShelter = ls.get("shelter") || "";
let ward = ls.get("ward") || "生野区";
let mode = !!ls.get("mode");

const pad = n => String(n).padStart(2, "0");
const hm = ms => { const d = new Date(ms); return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "たった今";
  if (m < 60) return m + "分前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "時間" + (m % 60 ? (m % 60) + "分" : "") + "前";
  return Math.floor(h / 24) + "日前";
}
function toast(msg, el = "#toast") { const t = $(el); t.textContent = msg; t.hidden = false; }

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- 回線表示 ---------- */
function paintNet() { const n = $("#net"); n.textContent = navigator.onLine ? "オンライン" : "オフライン"; n.classList.toggle("off", !navigator.onLine); }
addEventListener("online", paintNet); addEventListener("offline", paintNet); paintNet();

/* ---------- 初回設定 ---------- */
function genCode() {
  const words = "さくら,みかん,くじら,つばめ,こだま,ひかり,あおぞら,たんぽぽ,かもめ,どんぐり,ほたる,ゆうやけ".split(",");
  const r = crypto.getRandomValues(new Uint32Array(3));
  return words[r[0] % words.length] + "-" + words[r[1] % words.length] + "-" + (1000 + r[2] % 9000);
}
async function copyText(text, btn, label) {
  try { await navigator.clipboard.writeText(text); btn.textContent = "コピーしました"; }
  catch { btn.textContent = "コピーできませんでした"; }
  setTimeout(() => btn.textContent = label, 2000);
}
$("#genRoom").onclick = () => { $("#room").value = genCode(); };
$("#copyRoom").onclick = e => copyText($("#room").value, e.target, "合言葉をコピー");
$("#copyRoom2").onclick = e => copyText(ls.get("room") || "", e.target, "合言葉をコピー");
$("#saveSetup").onclick = () => {
  const name = $("#myName").value.trim(), room = $("#room").value.trim();
  if (!name) return toast("呼び名を入れてください", "#setupMsg");
  if (room.length < 12) return toast("合言葉は12文字以上にしてください。「合言葉を作る」も使えます", "#setupMsg");
  ls.set("name", name); ls.set("room", room);
  start();
};
$("#resetSetup").onclick = () => {
  $("#myName").value = ls.get("name") || ""; $("#room").value = ls.get("room") || "";
  $("#main").hidden = true; $("#setup").hidden = false;
};

/* ---------- 電池 ---------- */
function paintBatt() { document.querySelectorAll("#batt .chip").forEach(c => c.setAttribute("aria-pressed", String(+c.dataset.b === batt))); }
document.querySelectorAll("#batt .chip").forEach(c => c.onclick = () => { batt = +c.dataset.b; ls.set("batt", batt); paintBatt(); });
paintBatt();
async function readBattery() {
  try { if (navigator.getBattery) { const b = await navigator.getBattery(); return Math.round(b.level * 100); } } catch {}
  return batt ?? null;
}

/* ---------- 今ここにいる（現在地） ---------- */
// Firebaseのルールを変えずに済むよう、位置は shelter 欄の末尾に「@緯度,経度±誤差m~時刻」の形で入れる
let myLoc = ls.get("loc");
function joinShelter(name, loc) {
  if (!loc) return (name || "").slice(0, 80);
  const tag = `@${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}±${Math.min(9999, Math.round(loc.acc || 0))}~${Math.floor(loc.t / 60000).toString(36)}`;
  return ((name || "").slice(0, 80 - tag.length - 1) + " " + tag).trim();
}
function splitShelter(str) {
  const m = /(?:^|\s)@(-?\d+\.\d+),(-?\d+\.\d+)±(\d+)~([0-9a-z]+)$/.exec(str || "");
  if (!m) return { name: str || "", loc: null };
  return { name: str.slice(0, m.index).trim(), loc: { lat: +m[1], lng: +m[2], acc: +m[3], t: parseInt(m[4], 36) * 60000 } };
}
// 「家で無事」のまま現在地を送ると矛盾するので、位置付きの無事は「外で無事」と表示する
// 会社にいる時は、場所の欄に「会社」とだけ入れて送る（Firebaseのルールを変えずに済むように）
const WORK = "会社";
let myPlace = ls.get("place") || null; // "work" か null
function stateLabel(st) {
  if (st.state !== "ok") return LABEL[st.state] || "";
  const sh = splitShelter(st.shelter);
  if (sh.name === WORK) return "会社で無事";
  return sh.loc ? "外で無事" : "家で無事";
}
const mapUrl = loc => `https://maps.google.com/?q=${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
// 古い位置（地下鉄に乗る前の場所など）を使わないよう、押した後に取れた位置だけを使う。
// 12秒まで待って、いちばん精度のよい位置を送る。
const LOC_LABEL = "今ここにいる（現在地を送る）";
function sendLocation() {
  const last = ls.get("last");
  if (!last) return toast("先に上の3つのボタンのどれかで、いまの状態を送ってください");
  if (!navigator.geolocation) return toast("この端末では現在地を取れません");
  const b = $("#locBtn"); b.disabled = true; b.textContent = "現在地を調べています…";
  const start = Date.now();
  let best = null, done = false, watchId = null, timer = null;
  const finish = (err) => {
    if (done) return; done = true;
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    clearTimeout(timer);
    b.disabled = false; b.textContent = LOC_LABEL;
    if (err && err.code === 1 && !best) toast("位置情報の利用が許可されていません。地図で場所を選んで送れます（許可するには、iPhoneの「設定」→「プライバシーとセキュリティ」→「位置情報サービス」）");
    // 取れた位置（取れなければ前回の位置か大阪の中心）から、地図で場所を合わせてもらう
    openPicker(best, last.state);
  };
  watchId = navigator.geolocation.watchPosition(pos => {
    if (pos.timestamp && pos.timestamp < start - 2000) return; // 押す前の古い位置は使わない
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: pos.timestamp || Date.now() };
    if (!best || p.acc < best.acc) best = p;
    b.textContent = `現在地を調べています…（誤差 約${Math.round(best.acc)}m）`;
    if (best.acc <= 30) finish();
  }, err => { if (err.code === 1) finish(err); }, { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 });
  timer = setTimeout(() => finish(), 8000);
}
/* 地図で位置を合わせる（地図の真ん中が送る位置。地図は国土地理院の地理院タイル） */
const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
let leafletReady = null, pickMap = null, pickCircle = null, pickState = null, pickGps = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletReady) return leafletReady;
  leafletReady = new Promise((res, rej) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = LEAFLET + "leaflet.min.css"; document.head.appendChild(css);
    const js = document.createElement("script"); js.src = LEAFLET + "leaflet.min.js"; js.onload = res;
    js.onerror = () => { leafletReady = null; rej(new Error("leaflet")); };
    document.head.appendChild(js);
    setTimeout(() => { if (!window.L) { leafletReady = null; rej(new Error("timeout")); } }, 10000);
  });
  return leafletReady;
}
async function openPicker(gps, state) {
  pickGps = gps; pickState = state;
  const start = gps || myLoc || { lat: 34.6937, lng: 135.5023, acc: 0 }; // 取れない時は大阪市役所あたり
  try { await loadLeaflet(); }
  catch {
    // 地図が読めない（電波が弱いなど）時は、取れた位置をそのまま送る
    if (gps) { commitLocation(gps.lat, gps.lng, gps.acc, false); toast("地図を読み込めないので、GPSの位置をそのまま送ります"); }
    else toast("現在地も地図も取れませんでした。電波のよい場所でもう一度押してください");
    return;
  }
  const dlg = $("#mapDlg"); dlg.hidden = false; document.body.classList.add("noscroll");
  $("#pickInfo").textContent = gps ? `GPSの位置（誤差 約${Math.round(gps.acc)}m）。ずれていたら地図を動かして、真ん中の印を今いる場所に合わせてください`
    : "現在地を取れませんでした。地図を動かして、真ん中の印を今いる場所に合わせてください";
  if (!pickMap) {
    pickMap = L.map("pickMap", { zoomControl: true, attributionControl: true });
    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
      maxZoom: 18, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>'
    }).addTo(pickMap);
  }
  pickMap.setView([start.lat, start.lng], gps ? 17 : 15);
  if (pickCircle) { pickCircle.remove(); pickCircle = null; }
  if (gps) pickCircle = L.circle([gps.lat, gps.lng], { radius: gps.acc, color: "#24486b", weight: 1, fillOpacity: .08 }).addTo(pickMap);
  setTimeout(() => pickMap.invalidateSize(), 50);
}
function closePicker() { $("#mapDlg").hidden = true; document.body.classList.remove("noscroll"); }
function commitLocation(lat, lng, acc, manual) {
  myLoc = { lat, lng, acc: manual ? 0 : acc, t: Date.now() }; ls.set("loc", myLoc);
  const extra = manual ? "・自分で合わせた位置" : `・誤差 約${Math.round(acc)}m`;
  send(pickState || (ls.get("last") || {}).state || "ok", true, true, extra, null); // 今ここにいる＝会社ではない扱い
}
$("#pickSend").onclick = () => {
  const c = pickMap.getCenter();
  // GPSの位置からほとんど動かしていなければGPSの位置、動かしていれば「自分で合わせた位置」
  const moved = !pickGps || pickMap.distance(c, [pickGps.lat, pickGps.lng]) > 5;
  closePicker();
  if (moved) commitLocation(c.lat, c.lng, 0, true); else commitLocation(pickGps.lat, pickGps.lng, pickGps.acc, false);
};
$("#pickGps").onclick = () => { if (pickGps) pickMap.setView([pickGps.lat, pickGps.lng], 17); };
$("#pickCancel").onclick = closePicker;

function clearLocation() {
  myLoc = null; ls.del("loc");
  const last = ls.get("last"); if (last) send(last.state, true);
}

/* ---------- SMS文 ---------- */
function smsText(st = ls.get("last")) {
  let t = "【安否】まだ送っていません";
  if (st) {
    t = `【安否】${stateLabel(st)}（${hm(st.at)}）`;
    const sh = splitShelter(st.shelter);
    if (sh.name && sh.name !== WORK) t += ` ${sh.name}にいる`;
    if (sh.loc) t += ` 現在地 ${mapUrl(sh.loc)}`;
    if (st.note) t += ` ${st.note}`;
    if (st.battery != null) t += ` 電池${st.battery}%`;
  }
  $("#smsText").textContent = t;
  $("#smsLink").href = "sms:?&body=" + encodeURIComponent(t);
}
$("#copyBtn").onclick = e => copyText($("#smsText").textContent, e.target, "文をコピー");

/* ---------- 安否送信 ---------- */
async function send(state, keepNote, withLoc, extra = "", place) {
  // 場所の扱い：「会社で無事」は会社、それ以外のボタンや「今ここにいる」では会社を外す
  if (place !== undefined) { myPlace = place; place ? ls.set("place", place) : ls.del("place"); }
  // 「家で無事」「会社で無事」を押した時は、家や会社の場所を送らないよう現在地を消す
  if (state === "ok" && !withLoc && myLoc) { myLoc = null; ls.del("loc"); }
  const battery = await readBattery();
  const last = ls.get("last");
  const note = keepNote && last && !$("#note").value.trim() ? last.note : $("#note").value.trim().slice(0, 40);
  const st = { name: ls.get("name") || "", state, note, battery, shelter: joinShelter(myPlace === "work" ? WORK : myShelter, myLoc), at: Date.now() };
  ls.set("last", st); ls.set("lastSent", st.at); smsText(st);
  if (fb) {
    people[fb.uid] = { ...st, pending: true }; renderPeople();
    // オフラインでも端末に保存され、電波が戻ると自動で送られる
    fb.setDoc(fb.doc(fb.db, roomPath, fb.uid), st)
      .then(() => toast(`送信しました（${hm(st.at)}）${extra}`))
      .catch(() => toast("送れませんでした。合言葉や設定を確認してください"));
    if (!navigator.onLine) toast("いまはオフラインです。電波が戻ったら自動で送ります");
  } else {
    people.me = { ...st, pending: true }; renderPeople();
    toast("まだ共有につながっていません。SMSか171も使ってください");
  }
  paintMode();
}
document.querySelectorAll(".sbtn").forEach(b => b.onclick = () => send(b.dataset.s, false, false, "", b.dataset.place || null));
$("#locBtn").onclick = sendLocation;

/* ---------- ふたりの状況 ---------- */
function renderPeople() {
  const box = $("#people");
  const ids = Object.keys(people);
  if (!ids.length) { box.innerHTML = '<p class="empty">まだ誰も送っていません。上のボタンを押すと、ここに表示されます。</p>'; return; }
  const mine = fb ? fb.uid : "me";
  ids.sort((a, b) => (a === mine ? -1 : b === mine ? 1 : people[b].at - people[a].at));
  box.innerHTML = "";
  for (const id of ids) {
    const s = people[id];
    const el = document.createElement("div");
    el.className = "person " + (LABEL[s.state] ? s.state : "");
    el.innerHTML = '<div class="top"><b></b><span class="pill"></span></div><div class="meta"></div><div class="nt"></div>';
    el.querySelector("b").textContent = (id === mine ? "あなた" : (s.name || "相手"));
    el.querySelector(".pill").textContent = stateLabel(s);
    const meta = el.querySelector(".meta");
    meta.textContent = `${hm(s.at)}（${ago(s.at)}）` + (s.battery != null ? ` ・ 電池 ${s.battery}%` : "");
    if (s.pending) { const w = document.createElement("span"); w.className = "pending"; w.textContent = " ・ 送信待ち"; meta.appendChild(w); }
    if (Date.now() - s.at > SIX_H) { const w = document.createElement("span"); w.className = "stale"; w.textContent = " ・ 6時間以上更新なし"; meta.appendChild(w); }
    const sh = splitShelter(s.shelter);
    el.querySelector(".nt").textContent = [sh.name && sh.name !== WORK ? "いる場所：" + sh.name : "", s.note || ""].filter(Boolean).join("　");
    if (sh.loc) {
      const row = document.createElement("div"); row.className = "locrow";
      const a = document.createElement("a"); a.href = mapUrl(sh.loc); a.target = "_blank"; a.rel = "noopener"; a.className = "sm";
      a.textContent = "現在地を地図で見る";
      const m = document.createElement("span"); m.className = "meta";
      m.textContent = sh.loc.acc === 0 ? `${ago(sh.loc.t)}・自分で合わせた位置` : `${ago(sh.loc.t)}の位置・誤差 約${sh.loc.acc}m`;
      row.append(a, m);
      if (id === mine) {
        const c = document.createElement("button"); c.className = "sm"; c.textContent = "位置を消す";
        c.onclick = clearLocation; row.appendChild(c);
      }
      el.appendChild(row);
    }
    box.appendChild(el);
  }
}
setInterval(renderPeople, 60000);

/* ---------- 有事モード ---------- */
let notified = false;
function paintMode() {
  const b = $("#modeBtn"), t = $("#modeText");
  b.setAttribute("aria-pressed", String(mode)); b.textContent = mode ? "オン" : "オフ";
  if (!mode) { t.textContent = "オンにすると、6時間ごとに安否の送り直しを促します"; t.className = "sub"; return; }
  const last = ls.get("lastSent");
  const left = last ? last + SIX_H - Date.now() : 0;
  if (left <= 0) {
    t.textContent = "送り直す時間です。上のボタンでいまの状態を送ってください"; t.className = "due over";
    if (!notified) {
      notified = true;
      try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {}
      try { if (window.Notification && Notification.permission === "granted") new Notification("ふたりの安否", { body: "いまの状態を送ってください", icon: "icon-192.png" }); } catch {}
    }
  } else {
    notified = false;
    t.textContent = `次の送信まで あと${Math.floor(left / 3600e3)}時間${Math.floor(left % 3600e3 / 60000)}分`; t.className = "due";
  }
}
$("#modeBtn").onclick = async () => {
  mode = !mode; ls.set("mode", mode);
  if (mode) { try { if (window.Notification && Notification.permission === "default") await Notification.requestPermission(); } catch {} }
  paintMode();
};
setInterval(paintMode, 30000);

/* ---------- タブ ---------- */
document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", String(x === t)));
  for (const id of ["rules", "shel", "info", "fav", "conf"]) $("#" + id).hidden = t.dataset.t !== id;
  if (t.dataset.t === "fav") renderFavs();
  if (t.dataset.t === "info") loadInfo();
});
function openTab(name) { const t = document.querySelector(`.tab[data-t="${name}"]`); if (t) { t.click(); t.scrollIntoView({ behavior: "smooth", block: "start" }); } }

/* ---------- 避難所 ---------- */
function renderShel() {
  document.querySelectorAll("#ward .chip").forEach(c => c.setAttribute("aria-pressed", String(c.dataset.w === ward)));
  const box = $("#shelList"); box.innerHTML = "";
  for (const [n, a, flood] of SHELTERS[ward]) {
    const full = ward + " " + n, on = myShelter === full;
    const row = document.createElement("div"); row.className = "shel";
    row.innerHTML = '<div class="nm"><b></b><span class="sub"></span></div><div class="acts"><a class="sm" target="_blank" rel="noopener">地図</a><button class="sm"></button></div>';
    row.querySelector("b").textContent = n;
    row.querySelector(".sub").textContent = "大阪市" + ward + a;
    if (flood) { const w = document.createElement("div"); w.className = "note"; w.textContent = "地震時は浸水していないか確かめてから"; row.querySelector(".nm").appendChild(w); }
    row.querySelector("a").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`大阪市${ward}${a} ${n}`);
    const b = row.querySelector("button");
    b.textContent = on ? "ここにいる ✓" : "ここにいる"; b.classList.toggle("on", on);
    b.onclick = () => {
      myShelter = on ? "" : full; ls.set("shelter", myShelter); renderShel();
      toast(myShelter ? `「${n}」を選びました。安否ボタンを押すと相手に届きます` : "避難所の選択を外しました");
    };
    box.appendChild(row);
  }
}
document.querySelectorAll("#ward .chip").forEach(c => c.onclick = () => { ward = c.dataset.w; ls.set("ward", ward); renderShel(); });

/* ---------- 情報（警報・地震・停電・国際ニュース） ---------- */
// GitHub Actions が30分ごとに data/info.json を更新する。最新はリポジトリから直接読む
// 1つ目：GitHubのAPI（配信の遅れがほぼない）。回数制限に当たった時は2つ目以降を使う
const INFO_URLS = [
  { url: "https://api.github.com/repos/june08245/anpi/contents/data/info.json?ref=main", headers: { Accept: "application/vnd.github.raw+json" } },
  { url: "https://raw.githubusercontent.com/june08245/anpi/main/data/info.json" },
  { url: "data/info.json" }
];
const fmtAt = s => { if (!s) return ""; const d = new Date(s); return isNaN(d) ? s : hm(d.getTime()); };
function infoRow(title, meta, link, item) {
  const el = document.createElement(link ? "a" : "div");
  el.className = "irow";
  if (link) { el.href = link; el.target = "_blank"; el.rel = "noopener"; }
  const t = document.createElement("span"); t.className = "t"; t.textContent = title;
  const m = document.createElement("span"); m.className = "m"; m.textContent = meta;
  el.append(t, m);
  if (!link || !item) return el;
  // ニュースには保存ボタン（☆）を付ける
  const w = document.createElement("div"); w.className = "irw";
  w.append(el, starButton(item));
  return w;
}

/* ---------- ニュースの保存（この端末の中だけに残す） ---------- */
const FAV_MAX = 200;
const getFavs = () => ls.get("favs") || [];
const isFav = link => getFavs().some(f => f.link === link);
function toggleFav(item) {
  let favs = getFavs();
  if (favs.some(f => f.link === item.link)) favs = favs.filter(f => f.link !== item.link);
  else favs = [{ title: item.title, link: item.link, source: item.source || "", at: item.at || "", savedAt: Date.now() }, ...favs].slice(0, FAV_MAX);
  ls.set("favs", favs);
  document.querySelectorAll(".star").forEach(b => paintStar(b, isFav(b.dataset.link)));
  renderFavs();
}
function paintStar(b, on) { b.textContent = on ? "★" : "☆"; b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", on ? "保存を外す" : "保存する"); }
function starButton(item) {
  const b = document.createElement("button"); b.className = "star"; b.dataset.link = item.link;
  paintStar(b, isFav(item.link));
  b.onclick = e => { e.preventDefault(); e.stopPropagation(); toggleFav(item); };
  return b;
}
function renderFavs() {
  const box = $("#favList"); if (!box) return;
  const favs = getFavs(); box.innerHTML = "";
  $("#favCount").textContent = favs.length ? `${favs.length}件` : "";
  if (!favs.length) { emptyRow(box, "まだ保存したニュースはありません。情報タブのニュースの右にある☆を押すと、ここに残ります。"); return; }
  for (const f of favs) box.appendChild(infoRow(f.title, [f.source, fmtAt(f.at), `保存 ${hm(f.savedAt)}`].filter(Boolean).join("　"), f.link, f));
}
function emptyRow(box, text) { const p = document.createElement("p"); p.className = "empty"; p.textContent = text; box.appendChild(p); }

function renderInfo(info, fromCache) {
  if (!info) return;
  const t = $("#infoTime");
  t.textContent = timeLine(info) + (fromCache ? "（保存していた情報）" : "");

  // 警報・注意報
  const w = $("#infoWarn"); w.innerHTML = "";
  const items = (info.warnings && info.warnings.items) || [];
  if (items.length) {
    const tags = document.createElement("div"); tags.className = "wtags";
    for (const i of items) { const s = document.createElement("span"); s.className = "wtag l" + i.level; s.textContent = i.name; tags.appendChild(s); }
    w.appendChild(tags);
  } else if (info.warnings) emptyRow(w, "いま発表中の警報・注意報はありません");
  else emptyRow(w, "取得できていません");
  if (items.length && info.warnings.headline) { const p = document.createElement("p"); p.className = "sub"; p.textContent = info.warnings.headline; w.appendChild(p); }

  // 地震
  const q = $("#infoQuake"); q.innerHTML = "";
  for (const e of (info.quakes || []).slice(0, 6)) {
    const row = infoRow(e.place, `${fmtAt(e.at)}　M${e.mag || "-"}` + (e.osaka ? `　大阪 震度${e.osaka}` : ""));
    const b = document.createElement("span");
    b.className = "shindo" + (e.maxiRank >= 5 ? " hi" : e.maxiRank >= 4 ? " mid" : "");
    b.textContent = "震度" + (e.maxi || "-");
    row.querySelector(".t").prepend(b, " ");
    q.appendChild(row);
  }
  if (!q.children.length) emptyRow(q, "取得できていません");

  // 大阪市のニュース
  const ok = $("#infoOsaka"); ok.innerHTML = "";
  for (const n of (info.osaka || [])) ok.appendChild(infoRow(n.title, [n.source, fmtAt(n.at)].filter(Boolean).join("　"), n.link, n));
  if (!ok.children.length) emptyRow(ok, "ここ2日、該当するニュースはありません");

  // 停電ニュース
  const o = $("#infoOutage"); o.innerHTML = "";
  for (const n of (info.outage || [])) o.appendChild(infoRow(n.title, [n.source, fmtAt(n.at)].filter(Boolean).join("　"), n.link, n));
  if (!o.children.length) emptyRow(o, "ここ2日、大阪の停電のニュースはありません");

  // サイバー攻撃・通信障害
  const cy = $("#infoCyber"); cy.innerHTML = "";
  for (const n of (info.cyber || [])) cy.appendChild(infoRow(n.title, [n.source, fmtAt(n.at)].filter(Boolean).join("　"), n.link, n));
  if (!cy.children.length) emptyRow(cy, info.cyber ? "ここ2日、該当するニュースはありません" : "次の更新から表示されます");

  // 国際ニュース（話題ごと）
  const g = $("#infoWorld"); g.innerHTML = "";
  const topics = info.world_topics || (info.world ? [{ label: "イラン・アメリカなど", items: info.world }] : []);
  for (const t of topics) {
    const h = document.createElement("h3"); h.className = "topic"; h.textContent = t.label; g.appendChild(h);
    const box = document.createElement("div"); box.className = "ilist"; g.appendChild(box);
    for (const n of (t.items || []).slice(0, 5)) box.appendChild(infoRow(n.title, [n.source, fmtAt(n.at)].filter(Boolean).join("　"), n.link, n));
    if (!box.children.length) emptyRow(box, "ここ3日、該当するニュースはありません");
  }
  if (!topics.length) emptyRow(g, "取得できていません");

  // 日本：Jアラート・弾道ミサイル
  const jp = $("#infoJapan"); jp.innerHTML = "";
  for (const n of (info.japan || [])) jp.appendChild(infoRow(n.title, [n.source, fmtAt(n.at)].filter(Boolean).join("　"), n.link, n));
  if (!jp.children.length) emptyRow(jp, info.japan ? "ここ2日、該当するニュースはありません" : "取得できていません");

  // 南海トラフ
  const nk = $("#infoNankai"); nk.innerHTML = "";
  for (const n of (info.nankai || [])) nk.appendChild(infoRow(n.title, [n.source, fmtAt(n.at)].filter(Boolean).join("　"), n.link, n));
  if (!nk.children.length) emptyRow(nk, info.nankai ? "ここ1週間、該当するニュースはありません" : "次の更新から表示されます");

  renderWeather(info.forecast);
  renderStatus(info);
}

// 「大阪市」「日本」「世界」の状況を 安全／注意／緊急 で表示する（判定は scripts/fetch_info.py）
const LEVEL = { green: "安全", yellow: "注意", red: "緊急" };
const WD = ["日", "月", "火", "水", "木", "金", "土"];
function dayLabel(t, i) {
  const d = new Date(t), today = dateKey(Date.now()), tm = dateKey(Date.now() + 864e5), da = dateKey(Date.now() + 2 * 864e5);
  const k = dateKey(t);
  const rel = k === today ? "今日" : k === tm ? "明日" : k === da ? "明後日" : "";
  return { rel, md: `${d.getMonth() + 1}/${d.getDate()}(${WD[d.getDay()]})` };
}
function renderWeather(fc) {
  const box = $("#weather"), wk = $("#weekWeather");
  if (!fc || !fc.days || !fc.days.length) { box.hidden = true; if (wk) { wk.innerHTML = ""; emptyRow(wk, "取得できていません"); } return; }
  const rows = $("#wxDays"); rows.innerHTML = "";
  for (const [i, d] of fc.days.slice(0, 3).entries()) {
    const l = dayLabel(d.date, i);
    const pmax = d.pops && d.pops.length ? Math.max(...d.pops.map(p => p.p)) : null;
    const el = document.createElement("div"); el.className = "wxday";
    el.innerHTML = '<span class="wxd"><b></b><small></small></span><span class="wxicon" aria-hidden="true"></span><span class="wxt"></span><span class="wxtemp"></span><span class="wxpop"></span>';
    el.querySelector(".wxd b").textContent = l.rel || l.md;
    el.querySelector(".wxd small").textContent = l.rel ? l.md : "";
    el.querySelector(".wxicon").className = "wxicon " + wxKind(d.code);
    el.querySelector(".wxt").textContent = wxName(d.code, d.text);
    el.querySelector(".wxtemp").innerHTML = (d.max != null ? `<span class="hi">${d.max}°</span>` : "") + (d.min != null ? `<span class="lo">${d.min}°</span>` : "");
    el.querySelector(".wxpop").textContent = pmax != null ? `☂ ${pmax}%` : "";
    if (pmax != null && pmax >= 50) el.querySelector(".wxpop").classList.add("wet");
    rows.appendChild(el);
  }
  box.hidden = false;
  // 週間予報（情報タブ）
  if (wk) {
    wk.innerHTML = "";
    const list = (fc.week || []).filter(d => d.code);
    if (!list.length) emptyRow(wk, "取得できていません");
    for (const [i, d] of list.entries()) {
      const l = dayLabel(d.date, i);
      const c = document.createElement("div"); c.className = "wkday";
      c.innerHTML = '<b></b><span class="wxicon" aria-hidden="true"></span><span class="wkt"></span><span class="wktemp"></span><span class="wkpop"></span>';
      c.querySelector("b").textContent = l.md;
      c.querySelector(".wxicon").className = "wxicon " + wxKind(d.code);
      c.querySelector(".wkt").textContent = wxName(d.code);
      c.querySelector(".wktemp").textContent = [d.max != null ? d.max + "°" : "", d.min != null ? d.min + "°" : ""].filter(Boolean).join(" / ");
      c.querySelector(".wkpop").textContent = d.pop != null ? `☂ ${d.pop}%` : "";
      wk.appendChild(c);
    }
  }
}
function renderHeadline(st) {
  const box = $("#headline"), list = $("#headlineList");
  const items = [], seen = new Set();
  for (const [key, label] of [["osaka", "大阪市"], ["japan", "日本"], ["world", "世界"]]) {
    const s = st[key];
    if (!s || s.level !== "red") continue;
    for (const n of (s.urgent || s.items || []).slice(0, 2)) {
      if (!n || !n.title || seen.has(n.title)) continue;
      seen.add(n.title); items.push({ ...n, area: label });
    }
  }
  list.innerHTML = "";
  for (const n of items.slice(0, 3)) {
    const a = document.createElement(n.link ? "a" : "div");
    a.className = "hl";
    if (n.link) { a.href = n.link; a.target = "_blank"; a.rel = "noopener"; }
    const t = document.createElement("span"); t.className = "hlt"; t.textContent = n.title;
    const m = document.createElement("span"); m.className = "hlm";
    m.textContent = [n.area, n.source, n.at ? fmtAt(n.at) : ""].filter(Boolean).join("　");
    a.append(t, m); list.appendChild(a);
  }
  box.hidden = !items.length;
}
function renderStatus(info) {
  const st = info.status || {};
  renderHeadline(st);
  for (const [key, id] of [["osaka", "#stOsaka"], ["japan", "#stJapan"], ["world", "#stWorld"]]) {
    const card = $(id), s = st[key];
    card.className = "scard" + (s && LEVEL[s.level] ? " " + s.level : "");
    card.querySelector(".slevel").textContent = s ? (LEVEL[s.level] || "不明") : "確認中";
    card.querySelector(".sreason").textContent = s ? (s.reasons || []).slice(0, 2).join("／") : "";
  }
  const t = $("#stTime");
  const newest = Math.max(info.live && info.live.at || 0, info.updated ? new Date(info.updated).getTime() : 0);
  if (!newest) { t.textContent = "まだ情報がありません"; return; }
  const old = Date.now() - newest > 3 * 3600e3;
  t.textContent = timeLine(info) + (old ? "（3時間以上前の情報です。ネットにつながったら更新されます）" : "")
    + "・自動で判定した目安です。押すと詳しく見られます";
  t.classList.toggle("stale", old);
}
function timeLine(info) {
  const parts = [];
  if (info.live && info.live.at) parts.push(`警報・地震 ${hm(info.live.at)}（気象庁から直接）`);
  if (info.updated) parts.push(`ニュース ${fmtAt(info.updated)} 時点`);
  return parts.join("／");
}
// カードを押すと、情報タブの該当する場所（大阪市・日本・世界）まで移動する
for (const [id, grp] of [["#stOsaka", "#grpOsaka"], ["#stJapan", "#grpJapan"], ["#stWorld", "#grpWorld"]]) {
  $(id).onclick = e => {
    e.preventDefault();
    const t = document.querySelector('.tab[data-t="info"]'); if (t) t.click();
    requestAnimationFrame(() => $(grp).scrollIntoView({ behavior: "smooth", block: "start" }));
  };
}

/* 気象庁から警報・地震を直接取る（GitHubの定時実行が遅れても最新になるように） */
const JMA_WARN = ["https://www.jma.go.jp/bosai/warning/data/r8/270000.json", "https://www.jma.go.jp/bosai/warning/data/warning/270000.json"];
const JMA_QUAKE = "https://www.jma.go.jp/bosai/quake/data/list.json";
const OSAKA_CITY = "2710000", OSAKA_PREF_INT = "27";
const WARN_CODES = {
  "32": ["暴風雪特別警報", 5], "33": ["大雨特別警報", 5], "34": ["氾濫特別警報", 5], "35": ["暴風特別警報", 5], "36": ["大雪特別警報", 5],
  "37": ["波浪特別警報", 5], "38": ["高潮特別警報", 5], "39": ["土砂災害特別警報", 5],
  "43": ["大雨危険警報", 4], "44": ["氾濫危険警報", 4], "48": ["高潮危険警報", 4], "49": ["土砂災害危険警報", 4],
  "02": ["暴風雪警報", 3], "03": ["大雨警報", 3], "04": ["氾濫警報", 3], "05": ["暴風警報", 3], "06": ["大雪警報", 3],
  "07": ["波浪警報", 3], "08": ["高潮警報", 3], "09": ["土砂災害警報", 3],
  "10": ["大雨注意報", 2], "12": ["大雪注意報", 2], "13": ["風雪注意報", 2], "14": ["雷注意報", 2], "15": ["強風注意報", 2],
  "16": ["波浪注意報", 2], "17": ["融雪注意報", 2], "18": ["氾濫注意報", 2], "19": ["高潮注意報", 2], "20": ["濃霧注意報", 2],
  "21": ["乾燥注意報", 2], "22": ["なだれ注意報", 2], "23": ["低温注意報", 2], "24": ["霜注意報", 2], "25": ["着氷注意報", 2],
  "26": ["着雪注意報", 2], "27": ["その他の注意報", 2], "29": ["土砂災害注意報", 2]
};
const SHINDO_RANK = { "1": 1, "2": 2, "3": 3, "4": 4, "5-": 5, "5+": 6, "6-": 7, "6+": 8, "7": 9 };
const shindoLabel = x => ({ "5-": "5弱", "5+": "5強", "6-": "6弱", "6+": "6強" })[x] || x || "";

function kindsToList(kinds) {
  const out = [];
  for (const k of kinds || []) {
    const code = String(k.code || ""), st = k.status || "";
    if (!code || st === "解除" || st === "発表警報・注意報はなし") continue;
    const [name, level] = WARN_CODES[code] || [`警報・注意報（コード${code}）`, 2];
    out.push({ code, name, level });
  }
  return out;
}
function parseWarnings(data) {
  let items = [], headline = "", reported = "";
  if (Array.isArray(data)) {
    for (const m of data) {
      if (m.reportDatetime && m.reportDatetime > reported) { reported = m.reportDatetime; headline = (m.headlineText || "").trim() || headline; }
      for (const it of (m.warning && m.warning.class20Items) || []) if (String(it.areaCode) === OSAKA_CITY) items.push(...kindsToList(it.kinds));
    }
  } else if (data && data.areaTypes) {
    reported = data.reportDatetime; headline = (data.headlineText || "").trim();
    for (const at of data.areaTypes) for (const a of at.areas || []) if (String(a.code) === OSAKA_CITY) items.push(...kindsToList(a.warnings));
  } else throw new Error("unknown format");
  const uniq = Object.values(Object.fromEntries(items.map(i => [i.code, i]))).sort((a, b) => b.level - a.level || a.code.localeCompare(b.code));
  return { area: "大阪市", items: uniq, headline: headline.slice(0, 300), reported };
}
// 同じ地震でも「震度速報」「震源・震度情報」「震源要素更新」など何通も出るので、まとめてから使う
// （最新の1通だけだと、震度の入っていないお知らせで上書きされることがある）
function parseQuakes(data) {
  const byId = new Map();
  for (const q of data || []) {
    if (!q || !q.at) continue;
    const id = q.eid || q.at;
    const e = byId.get(id) || { at: q.at, place: "", mag: "", maxiRaw: "", osakaRaw: "" };
    if (!e.place && q.anm) e.place = q.anm;              // 新しい順に並んでいるので、最初に見つけたものが最新
    if (!e.mag && q.mag) e.mag = q.mag;
    if ((SHINDO_RANK[q.maxi] || 0) > (SHINDO_RANK[e.maxiRaw] || 0)) e.maxiRaw = q.maxi;
    const o = ((q.int || []).find(p => String(p.code) === OSAKA_PREF_INT) || {}).maxi || "";
    if ((SHINDO_RANK[o] || 0) > (SHINDO_RANK[e.osakaRaw] || 0)) e.osakaRaw = o;
    byId.set(id, e);
  }
  return [...byId.values()]
    .filter(e => e.place || e.maxiRaw)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8)
    .map(e => ({ at: e.at, place: e.place || "震源を調査中", mag: e.mag, maxi: shindoLabel(e.maxiRaw), maxiRank: SHINDO_RANK[e.maxiRaw] || 0,
      osaka: shindoLabel(e.osakaRaw), osakaRank: SHINDO_RANK[e.osakaRaw] || 0 }));
}
async function getJSON(url) {
  const r = await fetch(url + "?_=" + Math.floor(Date.now() / 30e3), { cache: "no-store" });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
/* 大阪の天気予報（気象庁） */
const JMA_FORECAST = "https://www.jma.go.jp/bosai/forecast/data/forecast/270000.json";
const JMA_FORECAST_PAGE = "https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=270000";
const OSAKA_FC_AREA = "270000", OSAKA_TEMP_AREA = "62078"; // 大阪府の予報区、大阪（気温の地点）
const WX_NAMES = {
  100: "晴れ", 101: "晴れ時々くもり", 102: "晴れ一時雨", 103: "晴れ時々雨", 104: "晴れ一時雪", 110: "晴れのちくもり", 111: "晴れのちくもり",
  112: "晴れのち雨", 113: "晴れのち雨", 114: "晴れのち雨", 115: "晴れのち雪",
  200: "くもり", 201: "くもり時々晴れ", 202: "くもり一時雨", 203: "くもり時々雨", 204: "くもり一時雪", 210: "くもりのち晴れ", 211: "くもりのち晴れ",
  212: "くもりのち雨", 213: "くもりのち雨", 214: "くもりのち雨", 215: "くもりのち雪",
  300: "雨", 301: "雨時々晴れ", 302: "雨時々止む", 303: "雨時々雪", 308: "大雨", 311: "雨のち晴れ", 313: "雨のちくもり", 314: "雨のち雪",
  400: "雪", 401: "雪時々晴れ", 402: "雪時々止む", 403: "雪時々雨", 411: "雪のち晴れ", 413: "雪のちくもり", 414: "雪のち雨"
};
function wxName(code, text) {
  const c = +code;
  if (WX_NAMES[c]) return WX_NAMES[c];
  if (text) return text.replace(/[\s　]+/g, " ").trim();
  return { 1: "晴れ", 2: "くもり", 3: "雨", 4: "雪" }[Math.floor(c / 100)] || "—";
}
const wxKind = code => ({ 1: "sun", 2: "cloud", 3: "rain", 4: "snow" }[Math.floor(+code / 100)] || "cloud");
const dateKey = t => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function parseForecast(data) {
  const out = { days: [], week: [] };
  const short = data && data[0], week = data && data[1];
  if (!short || !short.timeSeries) throw new Error("format");
  // 天気（今日・明日・明後日）
  const ts0 = short.timeSeries[0], a0 = (ts0.areas || []).find(a => a.area && a.area.code === OSAKA_FC_AREA) || (ts0.areas || [])[0];
  (ts0.timeDefines || []).forEach((t, i) => out.days.push({ date: t, code: a0.weatherCodes && a0.weatherCodes[i], text: a0.weathers && a0.weathers[i], wind: a0.winds && a0.winds[i] }));
  // 降水確率（6時間ごと）→ 日ごとの最大と、時間帯の一覧
  const ts1 = short.timeSeries[1], a1 = ts1 && ((ts1.areas || []).find(a => a.area && a.area.code === OSAKA_FC_AREA) || ts1.areas[0]);
  if (a1) (ts1.timeDefines || []).forEach((t, i) => {
    const day = out.days.find(d => dateKey(d.date) === dateKey(t)); const p = a1.pops && a1.pops[i];
    if (!day || p === "" || p == null) return;
    (day.pops = day.pops || []).push({ t, p: +p });
  });
  // 気温（00:00は最低、09:00は最高）
  const ts2 = short.timeSeries[2], a2 = ts2 && ((ts2.areas || []).find(a => a.area && a.area.code === OSAKA_TEMP_AREA) || ts2.areas[0]);
  if (a2) (ts2.timeDefines || []).forEach((t, i) => {
    const day = out.days.find(d => dateKey(d.date) === dateKey(t)); const v = a2.temps && a2.temps[i];
    if (!day || v === "" || v == null) return;
    if (new Date(t).getHours() === 0) day.min = +v; else day.max = +v;
  });
  // 週間予報
  if (week && week.timeSeries) {
    const w0 = week.timeSeries[0], wa = (w0.areas || []).find(a => a.area && a.area.code === OSAKA_FC_AREA) || (w0.areas || [])[0];
    const w1 = week.timeSeries[1], wt = w1 && ((w1.areas || []).find(a => a.area && a.area.code === OSAKA_TEMP_AREA) || w1.areas[0]);
    (w0.timeDefines || []).forEach((t, i) => out.week.push({
      date: t, code: wa.weatherCodes && wa.weatherCodes[i], pop: wa.pops && wa.pops[i] !== "" ? +wa.pops[i] : null,
      min: wt && wt.tempsMin && wt.tempsMin[i] !== "" ? +wt.tempsMin[i] : null, max: wt && wt.tempsMax && wt.tempsMax[i] !== "" ? +wt.tempsMax[i] : null
    }));
  }
  // 今日の最低気温：時間帯が過ぎていると気象庁は最高気温と同じ値を入れてくるので、出さない
  const today = out.days.find(d => dateKey(d.date) === dateKey(Date.now()));
  if (today && today.min != null && today.min === today.max) today.min = null;
  // 朝の発表には明後日が入っていないので、週間予報から足す
  for (const w of out.week) {
    if (out.days.length >= 3) break;
    if (!out.days.some(d => dateKey(d.date) === dateKey(w.date)) && new Date(w.date) > new Date(out.days[out.days.length - 1].date))
      out.days.push({ date: w.date, code: w.code });
  }
  // 足りない気温・降水確率を、もう片方（3日間／週間）で埋める
  for (const d of out.days) {
    const w = out.week.find(x => dateKey(x.date) === dateKey(d.date)); if (!w) continue;
    if (d.max == null && w.max != null) d.max = w.max;
    if (d.min == null && w.min != null) d.min = w.min;
    if (!d.pops && w.pop != null) d.pops = [{ t: w.date, p: w.pop }];
  }
  for (const w of out.week) {
    const d = out.days.find(x => dateKey(x.date) === dateKey(w.date)); if (!d) continue;
    if (w.max == null && d.max != null) w.max = d.max;
    if (w.min == null && d.min != null) w.min = d.min;
    if (w.pop == null && d.pops) w.pop = Math.max(...d.pops.map(p => p.p));
  }
  out.reported = short.reportDatetime;
  return out;
}

async function fetchJMA() {
  const live = { at: Date.now() };
  try { live.forecast = parseForecast(await getJSON(JMA_FORECAST)); } catch {}
  for (const u of JMA_WARN) { try { live.warnings = parseWarnings(await getJSON(u)); break; } catch {} }
  try { live.quakes = parseQuakes(await getJSON(JMA_QUAKE)); } catch {}
  return (live.warnings || live.quakes || live.forecast) ? live : null;
}

// 判定（scripts/fetch_info.py と同じ基準）
const within = (at, h) => { const t = new Date(at).getTime(); return !isNaN(t) && Date.now() - t <= h * 3600e3; };
// 「Jアラートの訓練」「爆発を想定」のような見出しで緊急にしないための除外語（scripts/fetch_info.py と同じ）
const RED_EXCLUDE = ["危険なし", "被害なし", "けが人なし", "異常なし", "回避", "避け", "防ぐ", "阻止", "食い止め", "偽", "誤報", "誤って", "訓練", "試験", "テスト", "？", "?", "のか", "か｜", "へ突入か", "想定", "可能性", "恐れ", "おそれ", "シナリオ", "シミュレーション", "否定", "なら", "仮に", "警告", "懸念"];
const realOnly = list => list.filter(n => !RED_EXCLUDE.some(x => n.title.includes(x)));
const newsHits = (list, words, h = 24) => (list || []).filter(n => within(n.at, h) && words.some(w => n.title.includes(w)));
const result = (red, yel, ok, urgent = []) => red.length ? { level: "red", reasons: [...red, ...yel], urgent } : yel.length ? { level: "yellow", reasons: yel } : { level: "green", reasons: [ok] };
// 緊急の原因（ヘッドラインに出す）。title と link（押した先）を持つ
const JMA_WARN_PAGE = "https://www.jma.go.jp/bosai/warning/#area_type=class20s&area_code=2710000";
const JMA_QUAKE_PAGE = "https://www.jma.go.jp/bosai/map.html#contents=earthquake_map";
const newsUrgent = n => ({ title: n.title, link: n.link, source: n.source, at: n.at });
// 自分たちに直接関わるサイバー攻撃・障害（scripts/fetch_info.py の local_cyber と同じ基準）
const CYBER_LOCAL_PLACES = ["大阪", "関西", "近畿", "関電", "大阪ガス", "大阪メトロ", "生野", "旭区", "西日本", "全国", "東海から"];
const CYBER_LOCAL_WORDS = ["サイバー攻撃", "ランサムウェア", "通信障害", "システム障害", "大規模障害", "つながりにくい", "取引できず", "利用できず"];
const CARRIERS = ["ドコモ", "docomo", "au", "KDDI", "ソフトバンク", "SoftBank", "楽天モバイル", "LINE", "信用金庫", "信金", "ゆうちょ", "全銀", "ATM", "PayPay", "ICOCA", "交通系IC", "コンビニ"];
const PLATFORMS = ["マイクロソフト", "Microsoft", "Outlook", "アウトルック", "Teams", "チームズ", "Google", "グーグル", "Gmail",
  "iCloud", "アップル", "AWS", "アマゾン ウェブ", "Azure", "Cloudflare", "クラウドフレア", "X（旧ツイッター）", "Instagram", "インスタグラム", "YouTube"];
const PLATFORM_WORDS = ["大規模", "世界", "全国", "通信障害", "システム障害", "接続できず", "使用できず", "使えず", "送れず", "ログインできず"];
const CARRIER_WORDS = ["通信障害", "障害", "つながりにくい", "つながらない"];
// もう直ったことを伝える見出し（「復旧のめど立たず」のような、まだ続いているものは除く）
const RESOLVED_RE = /(で復旧|復旧した|復旧しました|全面復旧|全て復旧|すべて復旧|復旧済み|解消|運転再開|サービス再開|利用再開|取引再開|営業再開)/;
const ONGOING_RE = /(めど|見通し|立たず|未定|続く|継続)/;
const isResolved = t => RESOLVED_RE.test(t) && !ONGOING_RE.test(t);
function localCyber(news) {
  return (news || []).filter(n => {
    if (!within(n.at, 24)) return false;
    const t = n.title;
    if (isResolved(t)) return false;
    if (CYBER_LOCAL_PLACES.some(p => t.includes(p)) && CYBER_LOCAL_WORDS.some(w => t.includes(w))) return true;
    if (CARRIERS.some(c => t.includes(c)) && CARRIER_WORDS.some(w => t.includes(w)) && !t.includes("流出")) return true;
    // 世界中で使われているネットサービス（メール・クラウドなど）の大規模障害
    return PLATFORMS.some(c => t.includes(c)) && PLATFORM_WORDS.some(w => t.includes(w)) && t.includes("障害") && !t.includes("流出");
  });
}
function assessOsaka(info) {
  const red = [], yel = [], urgent = [];
  for (const w of (info.warnings && info.warnings.items) || []) {
    if (w.level >= 4) { red.push(w.name); urgent.push({ title: `大阪市に${w.name}`, link: JMA_WARN_PAGE, source: "気象庁" }); }
    else if (w.level === 3) yel.push(w.name);
  }
  for (const q of info.quakes || []) {
    if (!within(q.at, 24)) continue;
    if (q.osakaRank >= 5) { red.push(`震度${q.osaka}の地震（${fmtAt(q.at)}）`); urgent.push({ title: `大阪で震度${q.osaka}の地震（震源：${q.place}）`, link: JMA_QUAKE_PAGE, source: "気象庁", at: q.at }); }
    else if (q.osakaRank === 4) yel.push(`震度4の地震（${fmtAt(q.at)}）`);
  }
  const out = newsHits(info.outage, ["停電"]).filter(n => !isResolved(n.title));
  if (out.length) yel.push(`停電の報道（${out[0].title.slice(0, 30)}）`);
  // 緊急にするのは大阪市内とはっきり分かる時だけ
  const lr = realOnly(newsHits(info.osaka, ["避難指示", "緊急安全確保", "テロ", "爆発"])).filter(n => ["大阪市", "生野", "旭区"].some(p => n.title.includes(p)));
  if (lr.length) { red.push(`「${lr[0].title.slice(0, 40)}」`); urgent.push(newsUrgent(lr[0])); }
  else { const ly = newsHits(info.osaka, ["断水", "大規模火災", "延焼", "高齢者等避難"]); if (ly.length) yel.push(`「${ly[0].title.slice(0, 40)}」`); }
  pushNankai(info, red, yel, urgent);
  const cy = localCyber(info.cyber);
  if (cy.length) yel.push(`「${cy[0].title.slice(0, 40)}」`);
  return result(red, yel, "警報なし・大きな揺れや停電の報道なし", urgent);
}
function nankaiLevel(news) {
  const list = (news || []).filter(n => n.title.includes("臨時情報") && n.title.includes("発表"));
  const w = list.find(n => n.title.includes("巨大地震警戒") && within(n.at, 24 * 7));
  if (w) return ["red", "南海トラフ地震臨時情報（巨大地震警戒）", w];
  if (list.some(n => n.title.includes("巨大地震注意") && within(n.at, 24 * 7))) return ["yellow", "南海トラフ地震臨時情報（巨大地震注意）"];
  if (list.some(n => n.title.includes("調査中") && within(n.at, 24))) return ["yellow", "南海トラフ地震臨時情報（調査中）"];
  return [null, null];
}
function pushNankai(info, red, yel, urgent) {
  const [l, r, n] = nankaiLevel(info.nankai);
  if (l === "red") { red.push(r); if (urgent && n) urgent.push(newsUrgent(n)); } else if (l === "yellow") yel.push(r);
}
function assessJapan(info) {
  const red = [], yel = [], urgent = [];
  for (const q of info.quakes || []) {
    if (!within(q.at, 24)) continue;
    if (q.maxiRank >= 7) { red.push(`${q.place}で震度${q.maxi}（${fmtAt(q.at)}）`); urgent.push({ title: `${q.place}で震度${q.maxi}の地震（M${q.mag || "-"}）`, link: JMA_QUAKE_PAGE, source: "気象庁", at: q.at }); }
    else if (q.maxiRank >= 5) yel.push(`${q.place}で震度${q.maxi}（${fmtAt(q.at)}）`);
  }
  pushNankai(info, red, yel, urgent);
  // Jアラートで緊急にするのは、実際の発射や避難の呼びかけを伝える見出しだけ（試験放送のお知らせなどは除く）
  const ja = realOnly(newsHits(info.japan, ["Jアラート", "国民保護"], 12))
    .filter(n => !["あした", "明日", "予定", "流れるみたい", "流れます", "放送", "お知らせ", "伝達", "点検", "確認"].some(w => n.title.includes(w)))
    .filter(n => ["発射", "ミサイル", "落下", "通過", "上空", "避難", "地下", "建物の中"].some(w => n.title.includes(w)));
  if (ja.length) { red.push(`「${ja[0].title.slice(0, 40)}」`); urgent.push(newsUrgent(ja[0])); }
  else { const mi = newsHits(info.japan, ["弾道ミサイル"]).filter(n => ["北朝鮮", "日本", "EEZ", "ＥＥＺ", "排他的経済水域", "防衛省", "官房長官", "日本海"].some(w => n.title.includes(w))); if (mi.length) yel.push(`弾道ミサイルの報道（${mi[0].title.slice(0, 30)}）`); }
  return result(red, yel, "大きな地震やミサイルの報道なし", urgent);
}
function withLive(news, live) {
  const info = { ...(news || {}) };
  if (live) {
    info.live = { at: live.at };
    if (live.warnings) info.warnings = live.warnings;
    if (live.quakes) info.quakes = live.quakes;
    if (live.forecast) info.forecast = live.forecast;
  }
  info.status = { ...(info.status || {}), osaka: assessOsaka(info), japan: assessJapan(info) };
  return info;
}

let infoLoading = false, infoLoadedAt = 0;
async function loadInfo(force) {
  if (infoLoading || (!force && Date.now() - infoLoadedAt < 60e3)) return;
  infoLoading = true;
  const cached = ls.get("info");
  if (cached && !infoLoadedAt) renderInfo(cached, true);
  const livePromise = fetchJMA();
  let news = null;
  for (const src of INFO_URLS) {
    try {
      const sep = src.url.includes("?") ? "&" : "?";
      const r = await fetch(src.url + sep + "t=" + Math.floor(Date.now() / 60e3), { cache: "no-store", headers: src.headers || {} });
      if (!r.ok) continue;
      const n = await r.json();
      if (cached && cached.updated && n.updated && n.updated < cached.updated) continue;
      news = n; break;
    } catch {}
  }
  const live = await livePromise;
  if (news || live) {
    const base = news || cached || {};
    const info = withLive(base, live || (news ? null : cached && cached.live && { at: cached.live.at, warnings: cached.warnings, quakes: cached.quakes }));
    if (!info.forecast && cached && cached.forecast) info.forecast = cached.forecast; // 取れなかった時は前回の予報を使う
    ls.set("info", info); renderInfo(info, false); infoLoadedAt = Date.now();
  } else if (!cached) {
    $("#infoTime").textContent = "情報を取得できませんでした。ネットにつながったら「更新」を押してください";
  }
  infoLoading = false;
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadInfo(); });
$("#infoReload").onclick = () => loadInfo(true);
setInterval(() => loadInfo(true), 15 * 60e3);
addEventListener("online", () => loadInfo(true));

/* ---------- 共有（Firebase） ---------- */
let unsub = null;
async function connect() {
  if (firebaseConfig.apiKey === "ここに貼る") { toast("共有の設定がまだです（firebase-config.js）。SMSと171は使えます"); return; }
  try {
    const [{ initializeApp, getApps }, auth, fs] = await Promise.all([
      import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")
    ]);
    const app = getApps()[0] || initializeApp(firebaseConfig);
    let db;
    try { db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) }); }
    catch { db = fs.getFirestore(app); }
    const a = auth.getAuth(app);
    const user = a.currentUser || await new Promise((res, rej) => {
      const off = auth.onAuthStateChanged(a, u => { if (u) { off(); res(u); } });
      auth.signInAnonymously(a).catch(rej);
    });
    roomPath = "rooms/" + (await sha256(ls.get("room"))) + "/status";
    fb = { db, uid: user.uid, setDoc: fs.setDoc, doc: fs.doc };
    if (people.me) { people[fb.uid] = people.me; delete people.me; }
    if (unsub) unsub();
    unsub = fs.onSnapshot(fs.collection(db, roomPath), { includeMetadataChanges: true }, snap => {
      const next = {};
      snap.docs.forEach(d => { const v = d.data(); if (v && v.state && v.at) next[d.id] = { ...v, pending: d.metadata.hasPendingWrites }; });
      people = next; renderPeople();
    }, () => toast("共有データを読めませんでした。合言葉と設定を確認してください"));
  } catch (e) {
    toast(navigator.onLine ? "共有につながりませんでした。SMSと171を使ってください" : "オフラインです。電波が戻ったら開き直してください");
  }
}

/* ---------- 起動 ---------- */
function start() {
  const name = ls.get("name"), room = ls.get("room");
  if (!name || !room) {
    $("#setup").hidden = false; $("#main").hidden = true;
    if (!$("#room").value) $("#room").value = "";
    return;
  }
  $("#setup").hidden = true; $("#main").hidden = false;
  $("#confInfo").textContent = `呼び名：${name}`;
  const last = ls.get("last"); if (last && !Object.keys(people).length) { people.me = last; }
  renderPeople(); renderShel(); smsText(); paintMode();
  connect();
  loadInfo();
}
start();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
