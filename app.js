import { firebaseConfig } from "./firebase-config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";

// 大阪市の各区役所が公表している災害時避難所（2026年10月時点で確認）
// [名称, 住所, 地震時に浸水のおそれ]
const SHELTERS = {
  "生野区": [["北鶴橋小学校","鶴橋3-4-50"],["鶴橋小学校","桃谷2-20-32"],["いくのコーライブズパーク（もと御幸森小）","桃谷5-5-37"],["東勝山小学校","勝山北3-7-21"],["もと舎利寺小学校","勝山南4-15-25"],["ワン・ワールド・インターナショナルスクール大阪（もと生野小）","舎利寺3-1-39"],["田島南小中一貫校 第2校地","田島3-7-38"],["東朋学園高等学校（もと生野南小）","林寺6-6-7"],["アブロードインターナショナル大阪校（もと林寺小）","林寺2-14-3"],["大池小学校","中川3-4-3"],["東中川小学校","新今里7-14-37"],["小路小学校","小路2-24-40"],["東小路小学校","小路東3-8-15"],["巽小学校","巽中3-12-5"],["北巽小学校","巽北1-30-29"],["巽南小学校","巽南2-10-7"],["巽東小学校","巽東3-8-13"],["もと鶴橋中学校","勝山北4-9-22"],["桃谷中学校","勝山北3-13-44"],["生野未来学園","生野西3-5-40"],["田島南小中一貫校","田島5-23-7"],["大池中学校","中川6-3-6"],["東生野中学校","新今里7-9-25"],["新生野中学校","巽東3-3-12"],["巽中学校","巽中3-17-20"],["新巽中学校","巽南4-2-53"],["府立生野工業高等学校","生野東2-3-66"],["府立生野支援学校","巽東4-2-47"],["府立桃谷高等学校","勝山南3-1-4"],["府立大阪わかば高等学校","巽東3-10-75"],["金光藤蔭高等学校","小路東4-1-26"],["プール学院中学校・高等学校","勝山北1-19-31"],["大阪偕星学園高等学校","勝山南2-6-38"],["天理教葛上分教会","新今里5-3-1"],["NRB日本理容美容専門学校","鶴橋1-6-34"],["府立生野聴覚支援学校","桃谷1-2-1"]],
  "旭区": [["清水小学校","清水5-1-12"],["新森小路小学校","新森6-3-13"],["古市小学校","森小路2-10-35"],["太子橋小学校","太子橋1-12-15"],["大宮小学校","大宮4-9-16"],["大宮西小学校","中宮1-8-14",1],["生江小学校","生江1-10-21"],["城北小学校","赤川3-13-47"],["高殿小学校","高殿6-9-10"],["高殿南小学校","高殿3-10-30"],["旭東中学校","新森6-7-25"],["今市中学校","大宮5-13-40"],["大宮中学校","中宮4-7-11"],["旭陽中学校","高殿5-9-31",1],["旭高等学校","高殿5-6-41",1],["淀川工科高等学校","太子橋3-1-32"],["大阪工業大学 総合体育館","大宮5-16-1"],["大阪工業大学 第2体育館","大宮5-16-1"],["思斉支援学校","大宮5-11-7"],["光陽支援学校","新森6-8-21"]]
};
const LABEL = { ok: "無事", hurt: "ケガあり", help: "助けて" };
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

/* ---------- SMS文 ---------- */
function smsText(st = ls.get("last")) {
  let t = "【安否】まだ送っていません";
  if (st) {
    t = `【安否】${LABEL[st.state]}（${hm(st.at)}）`;
    if (st.shelter) t += ` ${st.shelter}にいる`;
    if (st.note) t += ` ${st.note}`;
    if (st.battery != null) t += ` 電池${st.battery}%`;
  }
  $("#smsText").textContent = t;
  $("#smsLink").href = "sms:?&body=" + encodeURIComponent(t);
}
$("#copyBtn").onclick = e => copyText($("#smsText").textContent, e.target, "文をコピー");

/* ---------- 安否送信 ---------- */
async function send(state) {
  const battery = await readBattery();
  const st = { name: ls.get("name") || "", state, note: $("#note").value.trim().slice(0, 40), battery, shelter: myShelter, at: Date.now() };
  ls.set("last", st); ls.set("lastSent", st.at); smsText(st);
  if (fb) {
    people[fb.uid] = { ...st, pending: true }; renderPeople();
    // オフラインでも端末に保存され、電波が戻ると自動で送られる
    fb.setDoc(fb.doc(fb.db, roomPath, fb.uid), st)
      .then(() => toast(`送信しました（${hm(st.at)}）`))
      .catch(() => toast("送れませんでした。合言葉や設定を確認してください"));
    if (!navigator.onLine) toast("いまはオフラインです。電波が戻ったら自動で送ります");
  } else {
    people.me = { ...st, pending: true }; renderPeople();
    toast("まだ共有につながっていません。SMSか171も使ってください");
  }
  paintMode();
}
document.querySelectorAll(".sbtn").forEach(b => b.onclick = () => send(b.dataset.s));

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
    el.querySelector(".pill").textContent = LABEL[s.state] || "";
    const meta = el.querySelector(".meta");
    meta.textContent = `${hm(s.at)}（${ago(s.at)}）` + (s.battery != null ? ` ・ 電池 ${s.battery}%` : "");
    if (s.pending) { const w = document.createElement("span"); w.className = "pending"; w.textContent = " ・ 送信待ち"; meta.appendChild(w); }
    if (Date.now() - s.at > SIX_H) { const w = document.createElement("span"); w.className = "stale"; w.textContent = " ・ 6時間以上更新なし"; meta.appendChild(w); }
    el.querySelector(".nt").textContent = [s.shelter ? "いる場所：" + s.shelter : "", s.note || ""].filter(Boolean).join("　");
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
  for (const id of ["rules", "shel", "conf"]) $("#" + id).hidden = t.dataset.t !== id;
});

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
}
start();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
