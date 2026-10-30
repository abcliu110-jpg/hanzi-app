// 字义白板动画接入测试：字义扩展图的“看动画”入口、播放 / 拖动、进度 xzq_anim、减少动画模式、PWA 按需缓存
const { test, expect } = require("@playwright/test");
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const ANIM = path.join(ROOT, "anim");
const readJSON = p => JSON.parse(fs.readFileSync(p, "utf8"));
const INDEX = readJSON(path.join(ANIM, "index.json"));
const ZI = "人";
// 播放器要下载整段音轨，CI 机器慢时给足时间
test.beforeEach(() => test.setTimeout(120_000));
const URL_ZI = z => "ziyi-viewer.html?zi=" + encodeURIComponent(z);

/* anim/index.json 由动画工具链生成。万一“人”暂时没被收录（但动画文件齐全、status 为 done），
   接入测试照样用“人”跑：拦截目录请求补上这一条，并在报告里留下提示。目录本身的完整性另有用例检查。 */
function indexWith(zi) {
  const idx = JSON.parse(JSON.stringify(INDEX));
  if (idx.chars[zi]) return { idx, patched: false };
  const sc = readJSON(path.join(ANIM, zi + ".json")), tl = readJSON(path.join(ANIM, zi + ".timeline.json"));
  if (sc.status !== "done" || !fs.existsSync(path.join(ANIM, zi + ".mp3"))) throw new Error(zi + " 的动画还没完成");
  idx.chars[zi] = { version: sc.version || 1, track: sc.track, duration: Math.round((tl[tl.length - 1].start + tl[tl.length - 1].dur) / 100) / 10,
    chapters: sc.scenes.map(s => s.label || s.id), updated: "test" };
  return { idx, patched: true };
}
async function useIndex(page, zi) {  // page 或 context（有 service worker 时用 context 才拦得到）
  const { idx, patched } = indexWith(zi);
  if (patched) {
    test.info().annotations.push({ type: "warning", description: `anim/index.json 没有收录「${zi}」，测试里临时补上` });
    await page.route(/\/anim\/index\.json$/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify(idx) }));
  }
}

function watch(page) {
  const errors = [];
  page.on("console", m => { if (m.type() === "error" || (m.type() === "warning" && m.text().includes("[xzq-anim]"))) errors.push(m.type() + ": " + m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("response", r => { const u = new URL(r.url()); if (u.hostname === "127.0.0.1" && r.status() >= 400) errors.push(`HTTP ${r.status()}: ${decodeURIComponent(u.pathname)}`); });
  return errors;
}
async function openPlayer(page, zi = ZI) {
  await page.goto(URL_ZI(zi));
  await expect(page.locator("#bigChar")).toHaveText(zi, { timeout: 20000 });
  const btn = page.locator("#animBtn");
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator(".anim-mask [role=dialog]")).toBeVisible();
  await expect(page.locator("#animPlayer .xzq-ctrl")).toBeVisible({ timeout: 20000 });
  await page.waitForFunction(() => window.__xzqAnimPlayer);
}
const P = (page, fn, arg) => page.evaluate(new Function("arg", "const p=window.__xzqAnimPlayer;return (" + fn + ")(p,arg)"), arg);

test("动画目录里的每个字文件齐全", () => {
  const bad = [];
  for (const z of Object.keys(INDEX.chars)) for (const ext of [".json", ".timeline.json", ".mp3"]) if (!fs.existsSync(path.join(ANIM, z + ext))) bad.push(z + ext);
  expect(bad, "缺少：" + bad.join(", ")).toEqual([]);
  expect(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8")).toMatch(/"xzq-anim\.js", "xzq-anim\.css"/);
});

test("有动画的字显示“看动画”，没有的字不显示", async ({ page }) => {
  await useIndex(page, ZI);
  const errors = watch(page);
  await page.goto(URL_ZI(ZI));
  await expect(page.locator("#bigChar")).toHaveText(ZI, { timeout: 20000 });
  await expect(page.locator("#animBtn")).toBeVisible();
  await expect(page.locator("#animBtn")).toContainText("看动画");
  await expect(page.locator("#animBtn .seen")).toHaveCount(0);
  // 播放器脚本只在打开时才加载
  expect(await page.evaluate(() => !!window.XZQAnim)).toBe(false);
  const none = ["鹅", "龘", "檐"].find(z => !INDEX.chars[z] && z !== ZI) || "鹅";
  await page.fill("#q", none); await page.press("#q", "Enter");
  await expect(page.locator("#bigChar")).toHaveText(none);
  await expect(page.locator("#animBtn")).toBeHidden();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("播放器能加载、播放、拖动，没有报错；Esc 关闭后停止", async ({ page }) => {
  await useIndex(page, ZI);
  const errors = watch(page);
  await openPlayer(page);
  expect(await P(page, p => p.warnings)).toEqual([]);
  expect(await P(page, p => p.audio.src.startsWith("blob:"))).toBe(true);
  await page.locator("#animPlayer .xzq-start").click();
  await expect.poll(() => P(page, p => p.audio.currentTime), { timeout: 15000 }).toBeGreaterThan(0.5);
  expect(await P(page, p => p.audio.paused)).toBe(false);
  // 点章节标记跳到第 3 章
  const ch = await P(page, p => p.chapters[2].start);
  await page.locator("#animPlayer .xzq-mk").nth(2).click();
  await expect.poll(() => P(page, p => p.chapter)).toBe(2);
  expect(await P(page, p => p.audio.currentTime * 1000)).toBeGreaterThanOrEqual(ch - 100);
  await expect(page.locator("#animPlayer .xzq-mk").nth(2)).toHaveClass(/on/);
  // 程序拖动到中间
  const total = await P(page, p => p.total);
  await P(page, (p, t) => p.seek(t), total * 0.5);
  await expect.poll(() => P(page, p => p.audio.currentTime * 1000)).toBeGreaterThan(total * 0.5 - 200);
  // 暂停 / 继续
  await page.locator("#animPlayer .xzq-pp").click();
  await expect.poll(() => P(page, p => p.audio.paused)).toBe(true);
  await page.locator("#animPlayer .xzq-pp").click();
  await expect.poll(() => P(page, p => p.audio.paused)).toBe(false);
  // Esc 关闭：浮层消失，声音停止
  const audio = await page.evaluateHandle(() => window.__xzqAnimPlayer.audio);
  await page.keyboard.press("Escape");
  await expect(page.locator(".anim-mask")).toHaveCount(0);
  expect(await audio.evaluate(a => a.paused)).toBe(true);
  await expect(page.locator("#animBtn")).toBeFocused();
  expect(errors, errors.join("\n")).toEqual([]);
});

test("看完 90% 记入 xzq_anim，按钮显示“已看”", async ({ page }) => {
  await useIndex(page, ZI);
  const errors = watch(page);
  await openPlayer(page);
  await page.locator("#animPlayer .xzq-start").click();
  await P(page, p => p.seek(p.total * 0.95));
  await expect.poll(() => page.evaluate(z => (JSON.parse(localStorage.getItem("xzq_anim") || "{}"))[z] || 0, ZI), { timeout: 10000 }).toBeGreaterThan(0);
  await page.locator(".anim-mask .x").click();
  await expect(page.locator(".anim-mask")).toHaveCount(0);
  await expect(page.locator("#animBtn .seen")).toHaveText("已看");
  // 刷新后仍然显示
  await page.reload();
  await expect(page.locator("#animBtn .seen")).toHaveText("已看", { timeout: 20000 });
  await page.locator("#animBtn").click();
  await expect(page.locator(".anim-top .seen")).toHaveText("已看");
  expect(errors, errors.join("\n")).toEqual([]);
});

test.describe("减少动画", () => {
  test.use({ reducedMotion: "reduce" });
  test("系统开了减少动画时显示静态板（整页画好、没有手、不滑动）", async ({ page }) => {
    await useIndex(page, ZI);
    const errors = watch(page);
    await openPlayer(page);
    expect(await P(page, p => p.reduced)).toBe(true);
    await page.locator("#animPlayer .xzq-start").click();
    // 跳到第 3 章刚开始，暂停后看画面
    await P(page, p => p.seek(p.chapters[2].start + 150));
    await P(page, p => p.pause());
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => {
      const svg = document.querySelector("#animPlayer svg");
      const vis = [...svg.children].filter(g => g.tagName === "g" && g.getAttribute("visibility") === "visible");
      const paths = vis.length ? [...vis[0].querySelectorAll("path[stroke-dasharray]")] : [];
      const drawn = paths.filter(e => Math.abs(parseFloat(e.getAttribute("stroke-dashoffset") || "0")) < 1).length;
      const hand = svg.querySelector("image");
      return { layers: vis.length, transform: vis[0] && vis[0].getAttribute("transform"), paths: paths.length, drawn, hand: hand && hand.getAttribute("visibility") };
    });
    expect(st.layers).toBe(1);
    expect(st.transform).toBe("translate(0,0)");
    expect(st.paths).toBeGreaterThan(0);
    expect(st.drawn).toBe(st.paths);
    expect(st.hand).toBe("hidden");
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test("没有减少动画时同一时刻还在画（对照）", async ({ page }) => {
  await useIndex(page, ZI);
  await openPlayer(page);
  expect(await P(page, p => p.reduced)).toBe(false);
  const st = await P(page, p => { const t = p.chapters[2].start + 150; p.render(t); const paths = [...document.querySelectorAll("#animPlayer svg path[stroke-dasharray]")]; return paths.filter(e => parseFloat(e.getAttribute("stroke-dashoffset") || "0") > 1).length; });
  expect(st).toBeGreaterThan(0);
});

test.describe("PWA", () => {
  test.use({ serviceWorkers: "allow" });
  test("看过的字的动画才缓存，离线还能再看", async ({ page, context }) => {
    await useIndex(context, ZI);
    const errors = watch(page);
    await page.goto(URL_ZI(ZI));
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const animKeys = () => page.evaluate(async () => {
      const out = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) { const p = decodeURIComponent(new URL(r.url).pathname); if (/\/anim\/|xzq-anim/.test(p)) out.push(p); }
      return out;
    });
    let keys = await animKeys();
    expect(keys).toEqual(expect.arrayContaining(["/xzq-anim.js", "/xzq-anim.css"]));
    expect(keys.filter(k => k.endsWith(".mp3"))).toEqual([]);
    await page.locator("#animBtn").click();
    await expect(page.locator("#animPlayer .xzq-ctrl")).toBeVisible({ timeout: 20000 });
    await expect.poll(async () => (await animKeys()).filter(k => /\.(mp3|json)$/.test(k) && !k.includes("/art/") && !k.includes("/hz/")).sort(), { timeout: 10000 })
      .toEqual(expect.arrayContaining([`/anim/${ZI}.json`, `/anim/${ZI}.timeline.json`, `/anim/${ZI}.mp3`]));
    keys = await animKeys();
    expect(keys.filter(k => k.endsWith(".mp3"))).toEqual([`/anim/${ZI}.mp3`]);
    await page.keyboard.press("Escape");
    // 断网（service worker 发出的请求也拦下）后重新打开
    await context.route("**/*", r => r.abort());
    await page.reload();
    await expect(page.locator("#animBtn")).toBeVisible({ timeout: 20000 });
    await page.locator("#animBtn").click();
    await expect(page.locator("#animPlayer .xzq-ctrl")).toBeVisible({ timeout: 20000 });
    await page.waitForFunction(() => window.__xzqAnimPlayer);
    expect(await P(page, p => p.audio.src.startsWith("blob:"))).toBe(true);
    expect(await P(page, p => p.warnings)).toEqual([]);
    expect(errors.filter(e => !/ERR_FAILED|net::/.test(e)), errors.join("\n")).toEqual([]);
  });
});
