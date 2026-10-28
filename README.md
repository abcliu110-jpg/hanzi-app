# 识字星球 · 儿童汉字学习

纯静态网站（HTML + CSS + 原生 JS），无需构建，收录 3,499 个常用字，分 177 批。

## 运行
- 推荐：在项目根目录运行 `python3 -m http.server`，浏览器打开 http://localhost:8000
- 也可以直接双击 `index.html`（file://）。此时浏览器不允许读本地 JSON，页面会改用 `data/char-index.js` 和 `data/js/zi-<组号>.js` 里的同一份数据（字义扩展图按组读取）。
- 通过 http(s) 打开时可以“添加到主屏幕”离线使用（PWA：`manifest.webmanifest` + `sw.js`）。打开过一次字义扩展图后，177 组数据都会缓存下来。file:// 下不注册 service worker。

## 页面
| 文件 | 内容 |
|---|---|
| index.html | 首页、学习路径入口、查字 |
| app-shell.html | 新版总入口 |
| ziyi-viewer.html | 字义扩展图（读取 `?zi=字`） |
| pianpang-bushou.html | 偏旁部首、声旁音部（`#shengpang`） |
| zicijv.html | 字词句 |
| hanzi-mima.html | 汉字密码 |
| yicuo-fuxi.html | 易错诊所、记忆复习（`#review`） |
| learning-path.html | 学习路径 |
| maps/ | 各批字的字义扩展图（目录：maps/index.html） |
| jie-ziyi-kuozhan-tu.html | 单字示例「节」 |
| verify-pilot.html | 「待查」条目核对报告（试点） |

## 公共文件
| 文件 | 作用 |
|---|---|
| `xzq-theme.css` | 全站颜色、字体、阴影变量（`--xzq-*`），深色模式（跟随系统 `prefers-color-scheme`），小屏布局和 ≥44px 点击尺寸 |
| `xzq-common.js` | `window.XZQ`：file:// 读数据兜底、字表和按组读取（`loadIndex` / `loadGroup`）、搜索（`search`）、一级菜单（`NAV` / `navHtml`）、存储（`store`，localStorage 不可用时退回内存）、学习进度（`progress`）、朗读（`speech`）、提示（`toast`）、注册 service worker |
| `xzq-back.js` | 各模块页的「← 返回」按钮（有上一页就返回，否则回首页） |
| `sw.js`、`manifest.webmanifest`、`icons/` | PWA 离线缓存 |

新页面在 `<head>` 里引用 `xzq-theme.css` 和 `xzq-common.js`，颜色只用 `--xzq-*` 变量，深色模式就会自动生效。

## 学习进度
存在浏览器 localStorage（键名约定见 `xzq-theme.css` 开头注释）：
- `xzq_learned`：学会的字。字义扩展图的「我学会了」按钮、学习路径通关时写入；学习路径、首页统计读取
- `xzq_meanings`：看过字义扩展图的字（打开即记录）
- `hz_wrong`：答错的题，每条带 `zi`。易错诊所写入；学习路径「错题本」按字合并显示
- `hz_srs`：复习卡片；`xzq_path`：闯关进度
- 从学习路径进入易错诊所时带 `?zis=本关的字`，小测只出这些字的题
- 浏览器禁止存储（隐私模式等）时页面照常使用，记录只保存在本次打开期间，并会给出提示

## 朗读
`XZQ.speech.speak()` 先检测 `speechSynthesis`，优先选 zh-CN 声音；浏览器不支持或没有中文语音时弹出提示（每页一次），不会悄悄失败。

## 数据
- `data/zi-<批号>.json`：每批 10–20 字，是唯一需要手工编辑的数据源
- `char-index.json`：字 → 批号
- `data/bundle.js`、`data/char-index.js`、`maps/index.html`：生成文件，改完数据后运行

```bash
python3 tools/build_data.py
```

脚本会先检查 JSON 格式、批号、重复字和索引是否一致，有问题不会生成。
`python3 tools/build_data.py --check` 只校验并确认生成文件是最新的，不写文件（CI 用）。

`origin.ref` / `origin.refNote`：核对过的字源记录出处（书名、网址）和补充说明，字义扩展图「本义溯源」里会显示。

## 测试
```bash
npm ci
npx playwright install --with-deps chromium
npm run check   # 数据校验 + 所有 HTML 内联脚本语法检查（等同 node --check）
npm test        # Playwright：打开全部页面（含 maps/ 177 页）查控制台报错和 4xx、站内链接、返回按钮、按组加载、file://、学习进度、存储不可用、朗读提示、PWA
```
已经自己开了服务器时：`PW_NO_SERVER=1 npx playwright test`（默认端口 4173）。
GitHub Actions（`.github/workflows/ci.yml`）在每次 push 时运行以上全部检查。

## maps/ 旧版页面
`maps/maps-N.html` 是早期按组生成的页面，内嵌旧格式数据。现在以 `data/` + `ziyi-viewer.html` 为唯一数据源：
- `maps/index.html`（生成文件）每组直接打开新版字义扩展图，旧页面只作次要链接
- 每个旧页面顶部有提示条和「打开新版」按钮
- 已逐字比对：旧页的字形演变说明、结构、本义说法都已在 `data/` 中；第 49/59/69/79/99 组 100 个字的「汉字密码」原来只在旧页里，已迁回 `data/`
- 旧页没有删除：还有约 120 处措辞不同的说明（主要是文言出处的书名写法、偏旁“表义/表音”的角色标注），需要人工判断后再决定是否合并

## 部首字段说明
- 全部 3,499 字的部首（除原有的现代部首外）取自 Unicode Unihan 数据库（kRSUnicode，康熙部首；简化偏旁如讠、钅、纟按简化形，艹、辶按今形）。像氵/水、扌/手这类位置变体统一写康熙部首原形

## 待办
- 210 个字的字源可信度为「待查」，80 个未标注（2026-10 已核对 30 个，依据汉典所载《说文解字》大徐本和段注，出处记在 origin.ref）
- 约 1,300 条字形演变缺少说明，约 500 条缺少阶段名
- 结构（struct）中原本为空的 1,930 字，按 cjkvi-ids 的汉字结构描述序列（IDS）首个结构符自动填写（左右、上下、包围、独体等），未标六书类型
- 易读错（misread）为空表示没有常见误读；617 个义项没有例词，页面显示「例词待补」
- 字形图片：调研结论见下，尚未接入

## 古文字字形图片（调研，未接入）
| 来源 | 授权 | 说明 |
|---|---|---|
| Wikimedia Commons 古汉字计划（Ancient Chinese characters project） | 公有领域 | SVG，甲骨/金文/楚简/说文小篆/六书通大篆；按繁体命名；常用字抽样约一半有至少一种字形 |
| 中研院小学堂 字形演变 | CC0 1.0（查询所得字形图片） | PNG，带时代和出处，适合补缺；须按繁体查询 |
| 崇羲篆体（字体） | CC BY-ND 3.0 TW | 小篆字体，须署名、不得修改 |
| 镜原甲骨文（字体） | OFL | 映射率未测 |
不建议：hanziyuan.net（版权所有）、ctext（禁止抓取）、方正甲骨文（网页嵌入需授权）、HUST-OBC（上游权利不清）。建议一次性下载打包，不外链 Commons。
