// 全站页面清单：根目录所有 .html + maps/ 目录（自动扫描，新增页面无需改测试）
const fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..");
const root = fs.readdirSync(ROOT).filter(f => f.endsWith(".html")).sort();
const maps = fs.readdirSync(path.join(ROOT, "maps")).filter(f => f.endsWith(".html"))
  .sort((a, b) => (parseInt(a.replace(/\D/g, "")) || 0) - (parseInt(b.replace(/\D/g, "")) || 0)).map(f => "maps/" + f);
// 入口页不需要返回按钮
const ENTRY = new Set(["index.html", "app-shell.html"]);
module.exports = { ROOT, root, maps, all: [...root, ...maps], ENTRY };
