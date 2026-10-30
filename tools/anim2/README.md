# 白板动画引擎 v2（Canvas + rough.js）

设计见 `docs/anim/v2-jishu.md`，制作流程见 `docs/anim/v2-sop.md`。数据格式与 v1 相同（`anim/<字>.json` + `.timeline.json` + `.mp3`），v1（`xzq-anim.js`）不受影响。

```bash
cd tools/anim2 && npm i            # esbuild gsap roughjs
pip install fonttools brotli playwright pillow
node tools/anim2/build.mjs 人 /tmp/人.html [--no-audio]   # 单文件 HTML（引擎 + 文楷子集 + 数据 + mp3）
node tools/anim2/build.mjs --dist                         # dist/anim2/xzq-anim2.js + xzq-anim2-font.woff2
python3 tools/anim2/test/determinism.py 人 大 --v1          # 验收：逐像素一致 / 无报错 / 沙箱 iframe / v1 对比图
```

| 文件 | 作用 |
|---|---|
| `engine/model.js` | 读脚本+时间轴排出绘制项；`drawFrame(ctx, t)` 纯函数 |
| `engine/geom.js` | rough ops 展开成折线、按长度画一部分、路径变换 |
| `engine/player.js` / `player.css` | Canvas、字幕（重点词变橙）、控件、时钟 |
| `engine/index.js` / `global.js` | `load` / `mount`，IIFE 挂到 `window.XZQAnim2`（没有 v1 时也挂 `XZQAnim`） |
| `build.mjs` | esbuild 打包；单字 HTML / dist |
| `fonts.py` | 霞鹜文楷子集 → woff2 |
| `test/determinism.py` | Playwright 验收 |
