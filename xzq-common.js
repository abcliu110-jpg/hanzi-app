/* 识字星球 · 公共脚本 xzq-common.js
   各页面共用：数据读取（含 file:// 离线兜底）、搜索、顶部菜单、本地存储、学习进度、朗读、PWA 注册。
   用法：在 <head> 里 <script src="xzq-common.js"></script>（maps/ 下的页面用 ../xzq-common.js）。
   全局对象 window.XZQ，不依赖任何框架。 */
(function (W) {
  "use strict";
  if (W.XZQ) return;
  var me = document.currentScript;
  /* 站点根目录（本文件所在目录），maps/ 子目录页面也能正确拼出 data/ 路径 */
  var ROOT = me && me.src ? me.src.replace(/[^\/]*$/, "") : "";
  var FILE = location.protocol === "file:";

  /* ---------- file:// 离线兜底：fetch 本地 JSON 时改读 data/*.js 预先放进 window.XZQ_FILES 的数据 ---------- */
  function fileKey(u) {
    var s = String(u);
    if (ROOT && s.indexOf(ROOT) === 0) s = s.slice(ROOT.length);
    return s.replace(/^\.\//, "").replace(/^(\.\.\/)+/, "").split("?")[0];
  }
  if (FILE && W.fetch && !W.__xzqFetchShim) {
    W.__xzqFetchShim = true;
    var of = W.fetch;
    W.fetch = function (u) {
      var k = fileKey(u), F = W.XZQ_FILES || {};
      if (k in F) return Promise.resolve(new Response(JSON.stringify(F[k]), { status: 200, headers: { "Content-Type": "application/json" } }));
      if (/\.json$/.test(k)) return Promise.resolve(new Response("", { status: 404 }));
      return of.apply(this, arguments);
    };
  }

  /* ---------- 小工具 ---------- */
  var ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function addDays(s, n) { var p = s.split("-").map(Number), t = new Date(p[0], p[1] - 1, p[2]); t.setDate(t.getDate() + n); return ymd(t); }
  function isHan(s) { return /^[\u3400-\u9fff\uf900-\ufaff]$/.test(s); }
  function toneless(s) { return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ü/g, "v").toLowerCase().replace(/[^a-z\s\/]/g, ""); }
  function ziOf(o) { return typeof o === "string" ? o : (o && (o.zi || o.char || o.hanzi || o.c || o["字"])) || ""; }

  /* ---------- 本地存储：localStorage 不可用（隐私模式、iframe 限制、配额满）时退回内存，页面照常工作 ---------- */
  var MEM = {};
  var storeOk = (function () { try { var k = "__xzq_t"; localStorage.setItem(k, "1"); localStorage.removeItem(k); return true; } catch (e) { return false; } })();
  var store = {
    ok: storeOk,
    get: function (k, def) {
      try { var v = localStorage.getItem(k); if (v != null) return JSON.parse(v); } catch (e) {}
      return k in MEM ? MEM[k] : def;
    },
    set: function (k, v) {
      MEM[k] = v;
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { store.ok = false; return false; }
    }
  };

  /* ---------- 学习进度（各页面共用的键名见 xzq-theme.css 开头注释） ----------
     xzq_learned [{zi,date}]  已学会的字
     hz_wrong    错题数组，每条带 zi（易错诊所写入，学习路径读取） */
  var progress = {
    learned: function () { var a = store.get("xzq_learned", []); return Array.isArray(a) ? a.filter(function (o) { return ziOf(o); }) : []; },
    isLearned: function (zi) { return progress.learned().some(function (o) { return ziOf(o) === zi; }); },
    markLearned: function (zis) {
      zis = [].concat(zis); var a = progress.learned(), have = {}, d = today(), n = 0;
      a.forEach(function (o) { have[ziOf(o)] = 1; });
      zis.forEach(function (z) { if (z && !have[z]) { a.push({ zi: z, date: d }); have[z] = 1; n++; } });
      if (n) store.set("xzq_learned", a);
      return n;
    },
    unmarkLearned: function (zi) { store.set("xzq_learned", progress.learned().filter(function (o) { return ziOf(o) !== zi; })); },
    /* 错过的字：从错题本里按字去重，最近错的排前面 */
    missed: function () {
      var w = store.get("hz_wrong", []), out = [], seen = {};
      (Array.isArray(w) ? w : Object.keys(w || {}).map(function (k) { return Object.assign({ zi: k }, w[k]); })).forEach(function (o) {
        var z = ziOf(o); if (!z || seen[z]) return; seen[z] = 1;
        out.push({ zi: z, times: o.times || 1, last: o.last || "", cat: o.cat || "" });
      });
      return out;
    },
    markViewed: function (zi) {
      var raw = store.get("xzq_meanings", null), d = today();
      if (raw && !Array.isArray(raw) && typeof raw === "object") { if (!(zi in raw)) { raw[zi] = { date: d }; store.set("xzq_meanings", raw); } return; }
      var a = Array.isArray(raw) ? raw : [];
      if (!a.some(function (o) { return ziOf(o) === zi; })) { a.push({ zi: zi, date: d }); store.set("xzq_meanings", a); }
    }
  };

  /* ---------- 数据读取 ---------- */
  function getJSON(url) {
    return fetch(ROOT + url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  /* file:// 下按需插入 <script> 读取 data/js/zi-N.js（由 tools/build_data.py 生成） */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script"); s.src = ROOT + src; s.onload = res; s.onerror = function () { rej(new Error(src)); };
      document.head.appendChild(s);
    });
  }
  var idxP = null;
  function loadIndex() {
    if (!idxP) idxP = getJSON("char-index.json").catch(function () {
      if (FILE && (W.XZQ_FILES || {})["char-index.json"]) return W.XZQ_FILES["char-index.json"];
      if (FILE) return loadScript("data/char-index.js").then(function () { return (W.XZQ_FILES || {})["char-index.json"] || null; });
      return null;
    }).then(function (o) { if (o && typeof o === "object") { api.index = o; return o; } idxP = null; return null; });
    return idxP;
  }
  var groupP = {};
  function loadGroup(n) {
    n = String(n);
    if (groupP[n]) return groupP[n];
    var key = "data/zi-" + n + ".json";
    var p = getJSON(key).catch(function (e) {
      if (!FILE) throw e;
      var F = W.XZQ_FILES || {};
      if (F[key]) return F[key];
      return loadScript("data/js/zi-" + n + ".js").then(function () { var o = (W.XZQ_FILES || {})[key]; if (!o) throw new Error(key); return o; });
    });
    groupP[n] = p;
    p.catch(function () { delete groupP[n]; });
    return p;
  }
  function groupOf(zi) { return api.index ? api.index[zi] : undefined; }
  function groupNumbers() {
    var s = {}; Object.keys(api.index || {}).forEach(function (k) { s[api.index[k]] = 1; });
    return Object.keys(s).map(Number).sort(function (a, b) { return a - b; });
  }

  /* ---------- 搜索：list 为 [{zi,py,mean}]；按 字 > 整音节拼音 > 拼音包含 > 释义包含 排序 ---------- */
  function search(list, q, limit) {
    q = String(q || "").trim(); if (!q) return [];
    var t = toneless(q), hits = [];
    list.forEach(function (o) {
      var score = -1;
      if (q.indexOf(o.zi) >= 0) score = 0;
      else if (t && o.py) { var p = toneless(o.py); if (p.split(/[\s\/]+/).indexOf(t) >= 0) score = 1; else if (p.indexOf(t) >= 0) score = 2; }
      if (score < 0 && o.mean && o.mean.indexOf(q) >= 0) score = 3;
      if (score >= 0) hits.push([score, o]);
    });
    return hits.sort(function (a, b) { return a[0] - b[0]; }).slice(0, limit || 40).map(function (h) { return h[1]; });
  }

  /* ---------- 顶部菜单 ---------- */
  var NAV = [
    ["meaning", "字义扩展图", "ziyi-viewer.html"],
    ["radical", "偏旁部首", "pianpang-bushou.html"],
    ["phon", "声旁音部", "pianpang-bushou.html#shengpang"],
    ["word", "字词句", "zicijv.html"],
    ["code", "汉字密码", "hanzi-mima.html"],
    ["clinic", "易错诊所", "yicuo-fuxi.html#yicuo"],
    ["review", "记忆复习", "yicuo-fuxi.html#review"],
    ["path", "学习路径", "learning-path.html"]
  ];
  /* 返回 <a> 列表 HTML；cur 为当前模块 key；zi 有值时带上 ?zi= 方便在模块间切换同一个字 */
  function navHtml(cur, zi) {
    var q = zi ? "?zi=" + encodeURIComponent(zi) : "";
    return NAV.map(function (n) {
      var parts = n[2].split("#"), href = parts[0] + q + (parts[1] ? "#" + parts[1] : "");
      return '<a href="' + esc(href) + '"' + (n[0] === cur ? ' class="on" aria-current="page"' : "") + ">" + esc(n[1]) + "</a>";
    }).join("");
  }

  /* ---------- 朗读：检测 speechSynthesis，优先中文（zh-CN）声音；没有时给出提示而不是静默失败 ---------- */
  var speech = {
    supported: !!(W.speechSynthesis && W.SpeechSynthesisUtterance),
    voice: null,
    pickVoice: function () {
      if (!speech.supported) return null;
      var vs = W.speechSynthesis.getVoices() || [];
      var norm = function (v) { return String(v.lang || "").replace("_", "-").toLowerCase(); };
      speech.voice = vs.find(function (v) { return norm(v) === "zh-cn"; }) ||
        vs.find(function (v) { return /^zh(-hans)?(-|$)/.test(norm(v)) && !/hk|tw/.test(norm(v)); }) ||
        vs.find(function (v) { return /^(zh|cmn)/.test(norm(v)); }) || null;
      return speech.voice;
    },
    voicesKnown: false,
    _told: {},
    /* 返回 true 表示已开始朗读；false 表示无法朗读（并已通过 onFail 提示） */
    speak: function (text, opts) {
      opts = opts || {};
      /* 同一条提示每次打开页面只说一次，免得每点一下都弹 */
      var fail = function (msg) { if (!speech._told[msg]) { speech._told[msg] = 1; (opts.onFail || speech.hint)(msg); } return false; };
      if (!speech.supported) return fail("这个浏览器不支持朗读，可以换用手机自带浏览器或 Chrome、Edge、Safari 试试。");
      if (!speech.voice) speech.pickVoice();
      if (!speech.voice && speech.voicesKnown) return fail("没有找到中文语音，读音可能不准。可以在系统设置里添加“中文（普通话）”语音。");
      try {
        W.speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-CN"; u.rate = opts.rate || 0.8;
        if (speech.voice) u.voice = speech.voice;
        u.onerror = function (e) { if (e && e.error && e.error !== "interrupted" && e.error !== "canceled") fail("朗读没有成功（" + e.error + "），请稍后再试。"); };
        W.speechSynthesis.speak(u);
        return true;
      } catch (e) { return fail("朗读没有成功，请稍后再试。"); }
    },
    hint: function (msg) { toast(msg, 3200); }
  };
  if (speech.supported) {
    var onVoices = function () { var vs = W.speechSynthesis.getVoices() || []; if (vs.length) { speech.voicesKnown = true; speech.pickVoice(); } };
    onVoices();
    try { W.speechSynthesis.addEventListener("voiceschanged", onVoices); } catch (e) { W.speechSynthesis.onvoiceschanged = onVoices; }
  }

  /* ---------- 轻提示（页面自己有 #toast 时用页面的） ---------- */
  function toast(msg, ms) {
    var el = document.getElementById("toast") || document.getElementById("xzq-toast");
    if (!el) {
      el = document.createElement("div"); el.id = "xzq-toast"; el.setAttribute("role", "status");
      el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:min(92vw,520px);padding:12px 18px;border-radius:14px;background:var(--xzq-ink,#2B2A4C);color:var(--xzq-on-ink,#fff);font:600 15px/1.5 var(--xzq-sans,sans-serif);box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;transition:opacity .2s;pointer-events:none";
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = msg; el.classList.add("show"); el.style.opacity = "1";
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.classList.remove("show"); if (el.id === "xzq-toast") el.style.opacity = "0"; }, ms || 1800);
  }

  /* ---------- PWA：只在 http(s) 下注册 service worker；file:// 下什么也不做 ---------- */
  if (!FILE && "serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !W.__xzqNoSW) {
    W.addEventListener("load", function () { navigator.serviceWorker.register(ROOT + "sw.js").catch(function () {}); });
  }

  var api = {
    ROOT: ROOT, FILE: FILE, index: null,
    esc: esc, today: today, addDays: addDays, ymd: ymd, isHan: isHan, toneless: toneless, ziOf: ziOf,
    store: store, progress: progress,
    getJSON: getJSON, loadIndex: loadIndex, loadGroup: loadGroup, groupOf: groupOf, groupNumbers: groupNumbers,
    search: search, NAV: NAV, navHtml: navHtml, speech: speech, toast: toast
  };
  W.XZQ = api;
})(window);
