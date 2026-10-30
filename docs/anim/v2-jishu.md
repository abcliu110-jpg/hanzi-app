# 识字星球 · 白板动画引擎 v2 技术文档（Canvas + rough.js）

> 状态：设计定稿，实现中（见交接文档第 7 节）。v1（SVG，`xzq-anim.js`）继续可用，v2 完成验收前不替换。
> 目标：手绘白板讲解动画，单文件 HTML，1920×1080 画布，可播放/暂停/拖动，配旁白与字幕，可嵌进 App 的 iframe。

## 0. 与参考方案的取舍

| 参考方案 | 本项目做法 | 原因 |
|---|---|---|
| 英文 Web Speech 朗读 + 中文字幕 | **保留中文 MP3 旁白**（现 edge-tts，上线前换商用 TTS/真人）+ 中文字幕 | 用户是学汉字的儿童，需中文讲解；MP3 可确定性同步 |
| 每幕一个 scene.js | **沿用 `anim/<字>.json` + `.timeline.json` + `.mp3` 数据格式** | 100 字正在批量制作，不重写脚本 |
| 代码不画人，AI 绿幕关键帧 | 列为后续可选（§7），首版仍用线稿库 `anim/art/` | 先保证字的主线 |
| 其余（Canvas、rough、GSAP 取值、字体子集、esbuild、播放器、确定性验收、iframe 共享块） | **全部采用** | — |

## 1. 技术栈

- **渲染**：原生 Canvas 2D（`getContext('2d')`）。`requestAnimationFrame` 循环只做一件事：`drawFrame(ctx, t)`。不用 React / Remotion / 视频文件 / SVG 动画。
- **逻辑画布**：1920×1080；v1 数据坐标为 1600×900，统一乘 1.2。按 `devicePixelRatio` 缩放后备缓冲。
- **手绘线条**：rough.js（`rough.generator()`）。固定 seed，每画一笔 seed+1，保证每次一模一样。
- **画到一半**：把 rough 生成的 ops（move / lineTo / bcurveTo）展开成折线，贝塞尔每段细分 10 点，算累计长度，按进度只画前 e% 长度，笔尖（手图）跟随末端。
  - 笔速约 2600 px/s，每笔最短 0.12 s。
  - 同一图形的两遍描边同时推进；hachure 填充在描边完成后淡入。
- **汉字书写**：保留真实笔顺。用 `anim/hz/<字>.json`（hanzi-writer-data）的笔画轮廓做 clip，沿 median 按长度推进揭开；手/笔尖跟随 median 末端。
- **普通手写字**（标题、标注）：逐字之字形遮罩揭开（clip 一条 zigzag 路径按长度推进）。
- **时间轴**：GSAP 只建 `paused` timeline，用 `tl.time(t)` 取镜头、弹字等数值，**永不自行播放**。
- **字体**：中文 LXGW WenKai（霞鹜文楷），英文/数字 Kalam，均 OFL。fonttools 按全部用到的字做子集，转 woff2（brotli）内嵌。
- **打包**：esbuild。`node build.mjs <字> <out.html>` 输出单文件 HTML = 共享引擎 + 字体子集 + 该字数据 + MP3（base64）。
- **验收**：Playwright + Chromium 无头截图（见 SOP）。

## 2. 硬规则

1. 画面只由时间 t 决定（纯函数），任意拖动到 t 都画出同一帧，不依赖上一帧状态。
2. 人物不用代码画，只做位移、换帧、镜头、高亮、字幕。
3. 动作结果帧留在画面上，不消失。
4. 字幕重点词与旁白同步变橙。
5. 配色：墨 `#0A0503`，橙 `#EF7226`，浅橙 `#E9A67C`，白板底 `#FBFBFB`，灰 `#8a8a86`。
6. 单字总长 ≤120 秒（参考方案每幕 60–90 秒）；内容只增不减。
7. 所有 `localStorage` / 媒体 API 调用 try/catch（sandbox iframe 会抛错）。

## 3. 数据与 API

- 输入不变：`anim/<字>.json`（场景、cue、义项章节）、`anim/<字>.timeline.json`（每句起止与词级时间戳）、`anim/<字>.mp3`。
- 对外 API 兼容 v1：`XZQAnim.mount(el, '字', { base, capture, reducedMotion, subtitles })`，App 接入代码无需改。
- 内部场景原语（与参考方案对齐，按时间顺序自动排时）：
  - `line / path / curve / rect / ellipse / circle / arrow / cross / under`：rough 线条
  - `text`：手写字；`hanzi`：真实笔顺写字
  - `art`：线稿库图形（`anim/art/`）
  - `prop`：道具；`cam`：镜头推拉；`pop`：橙色弹字
  - `narr`：中文字幕（重点词变橙）
  - `shade / end`：收尾
  - 预留 `actor`（绿幕关键帧角色，§7）

## 4. 播放器

- ▶/❚❚ 按钮、进度条拖动、点画面暂停、🔊/🔇 开关（记在 localStorage `xzq_anim_mute`）。
- 标签页隐藏（`visibilitychange`）自动暂停。
- 义项章节跳转、倍速 0.75 / 1 / 1.25（沿用 v1）。
- 观看进度写 `localStorage.xzq_anim`（与 v1 同键）。
- `prefers-reduced-motion`：直接显示每章结果帧，不做推拉。
- `window.__seek(t)` 供测试跳帧。
- 音频为主时钟：播放中 t = `audio.currentTime`；静音或无音频时用 performance.now 推进。

## 5. 嵌入 App（共享块模式，可选）

- ≥2 KB 的图片和字体抽成共享块，按内容哈希去重。
- 引擎整段 gzip 存一份；每字其余 HTML gzip+base64 存在 `<script type="text/plain">`。
- 运行时按需解压（`DecompressionStream`）、挂进 iframe、同页缓存。几百个字共用一份引擎和字体。
- PWA：service worker 首播后缓存该字资源，不预缓存全部 MP3。

## 6. 目录约定

- `tools/anim2/`：v2 源码（`engine/`、`build.mjs`、`fonts.py`、`test/`）
- `dist/anim2/`：构建产物（引擎 bundle、字体子集）；单字 HTML 不入库，需要时生成
- v1 文件（`xzq-anim.js/css`、`tools/anim/`）不改动

## 7. 后续：AI 绿幕角色（未实施）

- 生图：绿幕 `#00FF00` 关键帧；每个动作 3 帧（准备/发力/结果），走路、小跑各 4 帧循环；同一演员表、同一画风、脚底线统一。
- 抠图（Python + Pillow + NumPy）：绿色判定 `g>150` 且 g 比 r、b 都大 50；半透明边去溢色（g 改成 max(r,b)）；裁边；缩到最高 520 px；WebP 质量约 74；base64 data URI 内嵌。
- 锚点：bottom 脚底行、ax 上 30% 身体中轴、hand 手、foot 脚，用于对位；`actor` 按移动距离换帧。

## 8. 环境

```
pip install numpy pillow playwright fonttools brotli
python3 -m playwright install chromium
npm i esbuild gsap roughjs
```

## 9. 许可

- rough.js MIT，GSAP 标准许可（免费商用），esbuild MIT。
- LXGW WenKai、Kalam：OFL，子集化后保留许可文本。
- hanzi-writer-data：Arphic Public License，保留 `ARPHICPL.TXT`。
- edge-tts 无商用授权，上线前须换 Azure / 讯飞 / 火山或真人配音。
