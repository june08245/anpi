// オフラインでもアプリを開けるようにする
const CACHE = "futari-anpi-v28";
const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const ASSETS = [
  "./", "index.html", "data/info.json", "style.css?v=28", "app.js?v=28", "firebase-config.js",
  "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "icon-180.png",
  FB + "firebase-app.js", FB + "firebase-auth.js", FB + "firebase-firestore.js"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const sameOrigin = url.origin === location.origin;
  const isFirebaseSdk = url.href.startsWith(FB);
  if (!sameOrigin && !isFirebaseSdk) return; // Firestore通信などはそのまま通す

  // ネット優先、つながらなければ保存しておいたものを返す
  // 自分のファイルは、ブラウザに残っている古い版を使わず毎回サーバーに確かめる
  // （ページ本体の読み込みは Request を作り直せないので、URLで取り直す）
  const net = !sameOrigin ? fetch(e.request)
    : e.request.mode === "navigate" ? fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" })
    : fetch(new Request(e.request, { cache: "no-cache" }));
  e.respondWith(
    net
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html")))
  );
});
