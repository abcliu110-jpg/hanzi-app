// Playwright 配置：用 python 起一个静态服务器，跑 tests/ 下的冒烟测试
const { defineConfig } = require("@playwright/test");
const PORT = process.env.PORT || 4173;
module.exports = defineConfig({
  testDir: "tests",
  timeout: 60_000,
  fullyParallel: true,
  workers: process.env.CI ? 4 : undefined,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}/`, serviceWorkers: "block" },
  // 已经自己起了服务器时：PW_NO_SERVER=1 npx playwright test
  webServer: process.env.PW_NO_SERVER ? undefined : {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
