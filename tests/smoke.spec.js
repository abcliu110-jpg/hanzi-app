// 冒烟测试：每个页面能打开、没有控制台错误、站内链接不坏、模块页有可用的返回按钮
const { test, expect } = require("@playwright/test");
const fs = require("fs"), path = require("path");
const { ROOT, all, root, ENTRY } = require("./pages");

// 浏览器在无头环境下没有中文语音之类的提示不算错误；只收真正的报错
function watch(page) {
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("response", r => {
    const u = new URL(r.url());
    if (u.hostname === "127.0.0.1" && r.status() >= 400) errors.push(`HTTP ${r.status()}: ${u.pathname}`);
  });
  return errors;
}

// 额外要打开的带参数地址
const EXTRA = ["ziyi-viewer.html?zi=%E9%B9%85", "ziyi-viewer.html?zi=%E9%BE%98", "pianpang-bushou.html#shengpang", "yicuo-fuxi.html#review"];

for (const p of [...all, ...EXTRA]) {
  test(`打开 ${p} 无报错`, async ({ page }) => {
    const errors = watch(page);
    const res = await page.goto(p, { waitUntil: "load" });
    expect(res.status()).toBeLessThan(400);
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.locator("body")).not.toBeEmpty();
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

// 站内链接：静态扫描所有 HTML 里的 href/src，确认目标文件存在（不需要浏览器，快）
test("站内链接都指向存在的文件", () => {
  const broken = [];
  for (const p of all) {
    const html = fs.readFileSync(path.join(ROOT, p), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, m => /\bsrc=/.test(m) ? m.replace(/>[\s\S]*$/, ">") : "");
    const re = /\b(?:href|src)=["']([^"'#?]*)(?:[?#][^"']*)?["']/g; let m;
    while ((m = re.exec(html))) {
      const u = m[1];
      if (!u || /^(https?:|mailto:|tel:|data:|javascript:|blob:|\/\/)/i.test(u) || u.includes("${")) continue;
      const target = path.resolve(path.dirname(path.join(ROOT, p)), decodeURI(u));
      if (!fs.existsSync(target)) broken.push(`${p} → ${u}`);
    }
  }
  expect(broken, broken.join("\n")).toEqual([]);
});

// 运行时生成的链接（菜单等由脚本渲染）：打开主页面后收集 <a href>，逐个请求
test("页面渲染后的站内链接可以访问", async ({ page, request }) => {
  const seen = new Set(), broken = [];
  for (const p of root) {
    await page.goto(p, { waitUntil: "load" });
    await page.waitForLoadState("networkidle").catch(() => {});
    const hrefs = await page.$$eval("a[href]", as => as.map(a => a.href));
    for (const h of hrefs) {
      const u = new URL(h);
      if (u.hostname !== "127.0.0.1") continue;
      const key = u.pathname;
      if (seen.has(key)) continue; seen.add(key);
      const r = await request.get(key);
      if (r.status() >= 400) broken.push(`${p} → ${decodeURIComponent(key)} (${r.status()})`);
    }
  }
  expect(broken, broken.join("\n")).toEqual([]);
});

// 返回按钮：每个模块页都有；从首页进入后点它回到首页；直接打开时点它也回首页
const MODULES = all.filter(p => !ENTRY.has(p) && p !== "maps/index.html");
test("模块页都有返回按钮", async ({ page }) => {
  const missing = [];
  for (const p of MODULES.filter(p => !p.startsWith("maps/maps-") || /maps-(1|88|177)\.html$/.test(p))) {
    await page.goto(p, { waitUntil: "domcontentloaded" });
    if (!(await page.locator(".xzq-back").first().isVisible().catch(() => false))) missing.push(p);
  }
  expect(missing, "缺少返回按钮：" + missing.join(", ")).toEqual([]);
});

for (const p of root.filter(p => !ENTRY.has(p))) {
  test(`返回按钮可用：${p}`, async ({ page }) => {
    await page.goto("index.html");
    await page.evaluate(u => { location.href = u; }, p);
    await page.waitForURL("**/" + p);
    await page.locator(".xzq-back").first().click();
    await page.waitForURL(/\/index\.html$/);
    // 直接打开（没有上一页）
    await page.goto(p);
    await page.locator(".xzq-back").first().click();
    await page.waitForURL(/\/index\.html$/);
  });
}
