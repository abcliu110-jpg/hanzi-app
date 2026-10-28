/* 识字星球 · service worker（离线使用）
   只在 http(s) 下由 xzq-common.js 注册；file:// 打开时不会注册，也不会运行。
   - 安装时预缓存所有主页面、样式、脚本和字表索引
   - 页面：先走网络，失败时用缓存（保证上线新版本后能及时更新）
   - data/ 下的字数据和其他静态文件：先用缓存，同时在后台更新
   字义扩展图会在后台把 177 组数据都读一遍，所以打开过一次之后整站都能离线用。
   改了预缓存清单或想强制更新时，把 VERSION 加 1。 */
const VERSION = "xzq-v1";
const CORE = [
  "./", "index.html", "app-shell.html", "ziyi-viewer.html", "pianpang-bushou.html", "zicijv.html",
  "hanzi-mima.html", "yicuo-fuxi.html", "learning-path.html", "jie-ziyi-kuozhan-tu.html", "verify-pilot.html",
  "maps/index.html", "xzq-theme.css", "xzq-common.js", "xzq-back.js", "char-index.json",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("xzq-") && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function put(req, res) {
  if (res && res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  /* 忽略查询参数匹配缓存：ziyi-viewer.html?zi=字 共用一份页面 */
  const isPage = req.mode === "navigate" || req.destination === "document";
  if (isPage) {
    e.respondWith(fetch(req).then(res => put(new Request(url.pathname), res))
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(cached => {
    const net = fetch(req).then(res => put(req, res)).catch(() => cached);
    return cached || net;
  }));
});
