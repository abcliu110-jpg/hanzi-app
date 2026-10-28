// 功能测试：字义扩展图按组加载、file:// 兜底、学习进度、存储不可用时降级、朗读提示
const { test, expect } = require("@playwright/test");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

test("字义扩展图先只加载当前字所在的组，再后台补全，搜索可用", async ({ page }) => {
  const groups = [];
  page.on("request", r => { const m = r.url().match(/data\/zi-(\d+)\.json/); if (m) groups.push(m[1]); });
  await page.goto("ziyi-viewer.html?zi=%E9%B9%85"); // 鹅，第 111 组
  await expect(page.locator("#bigChar")).toHaveText("鹅", { timeout: 20000 });
  expect(groups[0]).toBe("111");
  await expect.poll(() => new Set(groups).size, { timeout: 30000 }).toBe(177);
  await page.fill("#q", "头"); await page.press("#q", "Enter");
  await expect(page.locator("#bigChar")).toHaveText("头");
  await page.fill("#q", "龘"); await page.press("#q", "Enter");
  await expect(page.locator("#qmsg")).toContainText("暂未收录");
});

test("file:// 直接打开字义扩展图也能显示和搜索", async ({ page }) => {
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("file://" + path.join(ROOT, "ziyi-viewer.html") + "?zi=%E9%B9%85");
  await expect(page.locator("#bigChar")).toHaveText("鹅", { timeout: 20000 });
  await expect(page.locator("#banner")).toBeHidden();
  await page.fill("#q", "头"); await page.press("#q", "Enter");
  await expect(page.locator("#bigChar")).toHaveText("头");
  expect(errors).toEqual([]);
});

test("学会的字和答错的字会出现在学习路径", async ({ page }) => {
  await page.goto("ziyi-viewer.html?zi=%E5%A4%B4");
  await page.click("#learnBtn");
  await expect(page.locator("#learnBtn")).toHaveText(/已学会/);
  await page.evaluate(() => localStorage.setItem("hz_wrong", JSON.stringify([
    { zi: "长", key: "poly|长大", cat: "poly", times: 2, last: "2026-10-01" },
    { zi: "长", key: "poly|校长", cat: "poly", times: 1, last: "2026-10-02" }])));
  await page.goto("learning-path.html");
  await expect(page.locator("#sLearned")).toHaveText("1");
  await expect(page.locator("#bWrong")).toHaveText("1");
});

test("localStorage 不可用时页面照常工作", async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } }); });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  for (const u of ["index.html", "app-shell.html", "learning-path.html", "yicuo-fuxi.html", "ziyi-viewer.html?zi=%E5%A4%B4"]) {
    await page.goto(u); await page.waitForLoadState("networkidle").catch(() => {});
  }
  await page.click("#learnBtn");
  await expect(page.locator("#learnBtn")).toHaveText(/已学会/);
  expect(errors).toEqual([]);
  await ctx.close();
});

test("没有中文语音或不支持朗读时给出提示", async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { delete window.speechSynthesis; window.speechSynthesis = undefined; });
  const page = await ctx.newPage();
  await page.goto("jie-ziyi-kuozhan-tu.html");
  await page.click("#speak");
  await expect(page.locator("#toast")).toContainText("朗读");
  await ctx.close();
});

test("PWA：有 manifest，http 下注册 service worker", async ({ browser }) => {
  const ctx = await browser.newContext({ serviceWorkers: "allow" });
  const page = await ctx.newPage();
  await page.goto("index.html");
  const href = await page.getAttribute('link[rel="manifest"]', "href");
  const res = await page.request.get(href); expect(res.ok()).toBeTruthy();
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())), { timeout: 15000 }).toBe(true);
  await ctx.close();
});
