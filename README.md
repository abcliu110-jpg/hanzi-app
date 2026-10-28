# 识字星球 · 儿童汉字学习

纯静态网站（HTML + CSS + 原生 JS），无需构建，收录 3,499 个常用字，分 177 批。

## 运行
- 推荐：在项目根目录运行 `python3 -m http.server`，浏览器打开 http://localhost:8000
- 也可以直接双击 `index.html`（file://）。此时浏览器不允许读本地 JSON，页面会改用 `data/char-index.js` 和 `data/bundle.js` 里的同一份数据。

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

`xzq-back.js` 给各模块页加「← 返回」按钮（有上一页就返回，否则回首页）。

学习进度存在浏览器 localStorage，键名约定见 `xzq-theme.css` 开头注释。

## 数据
- `data/zi-<批号>.json`：每批 10–20 字，是唯一需要手工编辑的数据源
- `char-index.json`：字 → 批号
- `data/bundle.js`、`data/char-index.js`、`maps/index.html`：生成文件，改完数据后运行

```bash
python3 tools/build_data.py
```

脚本会先检查 JSON 格式、批号、重复字和索引是否一致，有问题不会生成。

## 部首字段说明
- 带「部」字的（如「女部」「司部」，约 120 字）是《说文》部首
- 其余 3,329 字的部首取自 Unicode Unihan 数据库（kRSUnicode，康熙部首；简化偏旁如讠、钅、纟按简化形，艹、辶按今形）。像氵/水、扌/手这类位置变体统一写康熙部首原形

## 待办
- 240 个字的字源可信度为「待查」，80 个未标注
- 约 1,300 条字形演变缺少说明，约 500 条缺少阶段名
- 结构（struct）1,930 字、易读错（misread）689 字为空；617 个义项没有例词
- ziyi-viewer 启动时会加载全部 177 组数据（约 9MB），可改为按组加载
- maps/ 页面内嵌的是旧格式数据，和 data/ 不同步
