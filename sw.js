/* 识字星球 · service worker（离线使用）
   只在 http(s) 下由 xzq-common.js 注册；file:// 打开时不会注册，也不会运行。
   - 安装时预缓存所有主页面、样式、脚本和字表索引
   - 页面：先走网络，失败时用缓存（保证上线新版本后能及时更新）
   - data/ 下的字数据和其他静态文件：先用缓存，同时在后台更新
   字义扩展图会在后台把 177 组数据都读一遍，所以打开过一次之后整站都能离线用。
   改了预缓存清单或想强制更新时，把 VERSION 加 1。
   字义动画 anim/（单独的缓存 ANIM_CACHE，升级 VERSION 时保留，免得已下载的音轨全部重下）：
   - 不预缓存，看过一次的字才缓存（每个 mp3 约 1–2 MB）
   - anim/<字>.json / .timeline.json / .mp3：先用缓存（看过一次后离线可看）
   - anim/index.json：先走网络；发现某个字的 version / updated 变了，就删掉这个字缓存的三个文件，下次播放重新下载
   - anim/art/、anim/hz/、hand.png（各字共用的小文件）：先用缓存，同时在后台更新
   动画缓存格式变了才改 ANIM_CACHE。 */
const VERSION = "xzq-v2";
const ANIM_CACHE = "xzq-anim-1";
const CORE = [
  "./", "index.html", "app-shell.html", "ziyi-viewer.html", "pianpang-bushou.html", "zicijv.html",
  "hanzi-mima.html", "yicuo-fuxi.html", "learning-path.html", "jie-ziyi-kuozhan-tu.html", "verify-pilot.html",
  "maps/index.html", "xzq-theme.css", "xzq-common.js", "xzq-back.js", "xzq-anim.js", "xzq-anim.css", "char-index.json",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("xzq-") && k !== VERSION && k !== ANIM_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function put(req, res, cache) {
  /* 只缓存完整的 200 响应（音频的 Range 请求会得到 206，Cache API 存不了） */
  if (res && res.status === 200 && res.type === "basic") { const copy = res.clone(); caches.open(cache || VERSION).then(c => c.put(req, copy)).catch(() => {}); }
  return res;
}

/* ---------- 字义动画 ---------- */
const ANIM_RE = /\/anim\/(.+)$/;
const ANIM_CHAR_RE = /^([^\/]+?)\.(json|timeline\.json|mp3)$/;
function animStamp(o) { return o ? String(o.version) + "|" + String(o.updated || "") : ""; }
/* 新目录和缓存里的旧目录比较，删掉有更新的字 */
async function animPurge(cache, fresh) {
  const old = await cache.match("anim/index.json").then(r => r && r.json()).catch(() => null);
  if (!old || !old.chars || !fresh || !fresh.chars) return;
  const stale = new Set(Object.keys(old.chars).filter(z => animStamp(old.chars[z]) !== animStamp(fresh.chars[z])));
  if (!stale.size) return;
  for (const req of await cache.keys()) {
    const m = new URL(req.url).pathname.match(ANIM_RE), f = m && decodeURIComponent(m[1]).match(ANIM_CHAR_RE);
    if (f && stale.has(f[1])) await cache.delete(req);
  }
}
function animFetch(e, req, file) {
  const cacheP = caches.open(ANIM_CACHE);
  if (file === "index.json") {
    e.respondWith(fetch(req).then(async res => {
      if (res.status === 200) {
        const c = await cacheP, copy = res.clone(), keep = res.clone();
        e.waitUntil(copy.json().then(o => animPurge(c, o)).then(() => c.put("anim/index.json", keep)).catch(() => {}));
      }
      return res;
    }).catch(() => cacheP.then(c => c.match("anim/index.json")).then(r => r || Response.error())));
    return;
  }
  const shared = !ANIM_CHAR_RE.test(file);
  e.respondWith(cacheP.then(c => c.match(req, { ignoreSearch: true })).then(cached => {
    if (cached && !shared) return cached;
    const net = fetch(req).then(res => put(req, res, ANIM_CACHE));
    if (cached) { e.waitUntil(net.catch(() => {})); return cached; }
    return net;
  }));
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  /* 忽略查询参数匹配缓存：ziyi-viewer.html?zi=字 共用一份页面 */
  const am = url.pathname.match(ANIM_RE);
  if (am) { animFetch(e, req, decodeURIComponent(am[1])); return; }
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
