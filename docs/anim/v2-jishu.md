# 识字星球 · 白板动画引擎 v2 技术文档（Canvas + rough.js）

> 状态（2026-10-31）：**第一版已实现并通过验收**——`tools/anim2/` 源码、`dist/anim2/xzq-anim2.js` 引擎；现有 34 个字的脚本不改一行即可在 v2 播放（0 警告）。App 仍用 v1（SVG，`xzq-anim.js`），切换前需产品负责人看过对比图。实现细节见 §1.1，与参考方案的偏差见 §0 和 §1.2。
> 目标：手绘白板讲解动画，单文件 HTML，1920×1080 画布，可播放/暂停/拖动，配旁白与字幕，可嵌进 App 的 iframe。

## 0. 与参考方案的取舍

| 参考方案 | 本项目做法 | 原因 |
|---|---|---|
| 英文 Web Speech 朗读 + 中文字幕 | **保留中文 MP3 旁白**（现 edge-tts，上线前换商用 TTS/真人）+ 中文字幕 | 用户是学汉字的儿童，需中文讲解；MP3 可确定性同步 |
| 每幕一个 scene.js | **沿用 `anim/<字>.json` + `.timeline.json` + `.mp3` 数据格式** | 100 字正在批量制作，不重写脚本 |
| 代码不画人，AI 绿幕关键帧 | 列为后续可选（§7），首版仍用线稿库 `anim/art/` | 先保证字的主线 |
| 英文/数字用 Kalam | **不用 Kalam**：霞鹜文楷自带拉丁字母和带声调拼音（ā á ǎ à ü…） | 少一个字体，拼音和汉字同一风格 |
| 笔速固定 2600 px/s | 线稿、圈、箭头、下划线按 2600 px/s（最短 0.12 s）；**脚本里写了 `k` 的 cue 和所有 `write` 仍按 v1 公式计时** | 已做好的脚本里 `k`/`gap` 是按配音调过的（如「人」的“一撇，一捺”），不能变 |
| 其余（Canvas、rough、GSAP 取值、字体子集、esbuild、播放器、确定性验收、iframe 共享块） | **全部采用** | — |

## 1. 技术栈

- **渲染**：原生 Canvas 2D（`getContext('2d')`）。`requestAnimationFrame` 循环只做一件事：`drawFrame(ctx, t)`。不用 React / Remotion / 视频文件 / SVG 动画。
- **逻辑画布**：1920×1080；v1 数据坐标为 1600×900，统一乘 1.2。按 `devicePixelRatio` 缩放后备缓冲。
- **手绘线条**：rough.js（`rough.generator()`）。固定 seed，每画一笔 seed+1，保证每次一模一样。
- **画到一半**：把 rough 生成的 ops（move / lineTo / bcurveTo）展开成折线，贝塞尔每段细分 10 点，算累计长度，按进度只画前 e% 长度，笔尖（手图）跟随末端。
  - 笔速约 2600 px/s，每笔最短 0.12 s。
  - 同一图形的两遍描边同时推进；hachure 填充在描边完成后淡入。
- **汉字书写**：保留真实笔顺。用 `anim/hz/<字>.json`（hanzi-writer-data）的笔画轮廓做 clip，沿 median 按长度推进揭开；手/笔尖跟随 median 末端。
- **普通手写字**（标题、标注）：逐字之字形遮罩揭开——每个字按 `measureText` 的真实宽度切 3 行，左→右、右→左、左→右依次揭开（clip 矩形组，进度由 GSAP 时间轴给出），每字约 0.13 s，最长 1.2 s。角落小字（`note`）、田字格只淡入。
- **时间轴**：GSAP 只建 `paused` timeline，用 `tl.time(t)` 取镜头、弹字等数值，**永不自行播放**。
- **字体**：LXGW WenKai（霞鹜文楷，OFL，含拉丁/拼音，未用 Kalam）。`fonts.py` 用 fonttools 按用到的字做子集，转 woff2（brotli）：单字 HTML 只含该字用到的字（约 50 KB，`@font-face` 内嵌）；`dist/anim2/xzq-anim2-font.woff2` 覆盖 `anim/` 下全部脚本（约 165 KB，新增字后重跑 `--dist`），引擎从自身所在目录加载，缺字时浏览器回退楷体。
- **打包**：esbuild。`node tools/anim2/build.mjs <字> <out.html>` 输出单文件 HTML = 共享引擎 + 字体子集 + 该字数据 + MP3（base64）；`--dist` 输出 App 用的引擎和字体。
- **验收**：Playwright + Chromium 无头截图（见 SOP）。

### 1.1 实现细节（与代码一致）

| 项 | 做法 | 代码 |
|---|---|---|
| 模型 | mount 时一次性把脚本 + 时间轴排成每个场景的绘制项（rough 线、真实笔顺字、文字、田字格）和手的笔画队列；版位、引用、锚点、一只手排队、cue 时间解析与 v1 逐行一致，`report` / `layout()` / `warnings` 也一致，`tools/anim/snap.py` 的体检逻辑可照用 | `engine/model.js` |
| 画一帧 | `drawFrame(ctx, t)`：底色 `#FBFBFB` → `tl.time(t)` 取镜头/文字进度 → 可见场景（最多 2 块）按 `cam.x` 平移绘制 → 手。只读 t 和预先算好的数据，不读上一帧、不用随机数和时钟 | `engine/model.js` |
| rough | `rough.generator()`，起始 seed 20261030，每个图形 seed+1；roughness 0.9、bowing 0.8、maxRandomnessOffset 1.6；两遍描边线宽 = 原线宽 × 0.72；圈用 `curve`（点列与 v1 相同），其余用 `path`（先把线稿 400×400 路径变换到画布坐标再生成，抖动幅度与缩放无关） | `model.js` `roughItem` |
| 画一部分 | rough 每段线输出两遍（相邻两个 move），按对推进：总长取第一遍，当前段第二遍按同一比例画；贝塞尔每段 10 点；进度曲线 0.4·线性 + 0.6·缓入缓出（近匀速） | `geom.js` `flattenOps` / `tracePart` |
| 填充 | 线稿里带 `fill` 的笔画用 hachure（-41°，间距随线稿大小 4–8），描边画完后 0.3 s 淡入 | `model.js` |
| 汉字 | `Path2D(笔画轮廓)` 做 clip，median 折线按长度画，线宽 170（字库单位）；时长、笔间隔公式与 v1 相同（`k`、`gap`） | `model.js` `write` |
| 镜头 | GSAP 暂停时间轴：每个场景开始时 `cam.x` 600 ms 推到下一块白板（power2.inOut），替代 v1 的整板滑动 | `model.js` |
| 手 | `hand.png` 笔尖 (3.3, 18)，跟随正在画的那一笔的末端；笔与笔之间抬笔走弧线，空闲 0.45 s 移出画面（与 v1 相同） | `model.js` `handAt` |
| 画布 | 逻辑 1920×1080；`#cap` 导出模式固定 1920×1080 像素，其他按显示宽度 × dpr（480–3840） | `player.js` |
| 字幕 | DOM 叠在画布上（清晰、可关），按 timeline 的每字时间 `ct` 变深；被 cue 的 `at` 引用到的关键词读到时变橙 `#EF7226` | `player.js` |

### 1.2 与 v1 的差别

- 线稿、圈、箭头画得更快（2600 px/s），画完得更早，cue 顺延更少；`write` 速度不变。
- 白板底色 `#FBFBFB`、墨色 `#0A0503`、橙 `#EF7226`、灰 `#8a8a86`；脚本里的 `green/red/blue` 仍用 v1 颜色。
- 去掉 SVG 抖动滤镜，改成 rough.js 双线手绘。
- 圈注目标还没画出来时只记警告，不再抛 TypeError（v1 已知问题 6.3）。

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
- 已实现的动作就是 v1 的全部 cue：`grid` `write` `draw` `path` `circle` `arrow` `label` `note` + 回顾关系图（参数、版位、锚点写法不变）。
- 参考方案的其他原语（`rect / ellipse / cross / under`、`prop`、`cam` 推拉、`pop` 弹字、`shade / end`、`actor`）**尚未加进脚本格式**；需要时作为新 `do` 加到 `model.js` 的 `ACT`，v1 遇到不认识的 `do` 只会警告。
- 加载顺序：`window.XZQ_ANIM_DATA[字]`（单文件 HTML）→ `window.XZQ_ANIM2_GET(字)`（共享块模式）→ 按 `base` 取 `anim/` 下的文件。也可以直接 `mount(el, 数据对象)`（App 把 mp3 读成 blob 时用）。
- 全局名：`dist/anim2/xzq-anim2.js` 挂 `window.XZQAnim2`；页面里没有 v1 时同时挂成 `window.XZQAnim`（同一套 API，`version: 2`）。
- player 对象：`render(ms)` `play()` `pause()` `seek(ms)` `setRate(r)` `toggle()` `time()` `destroy()` `total` `chapters` `warnings` `report` `layout()` `drawFrame(ctx, ms)`。

## 4. 播放器

- ▶/❚❚ 按钮、进度条拖动、点画面暂停、🔊/🔇 开关（记在 localStorage `xzq_anim_mute`）。
- 标签页隐藏（`visibilitychange`）自动暂停。
- 义项章节跳转、倍速 0.75 / 1 / 1.25（沿用 v1）。
- 观看进度写 `localStorage.xzq_anim`（与 v1 同键）。
- `prefers-reduced-motion`：直接显示每章结果帧，不做推拉。
- `window.__seek(秒)` 供测试跳帧（暂停后跳到该秒并同步画出，返回当前秒数）。
- 时钟：播放中音频在走时 t = `audio.currentTime`；音频还没起来、被拦（沙箱、自动播放策略）或没有音频时用 performance.now 推进。静音是 `audio.muted`，音频照常走，所以静音时仍以音频为准。
- 沙箱 iframe（只有 `allow-scripts`）：localStorage 抛错时静音状态和“已看”不保存，不影响播放；iframe 的源是 `null`，**不能按 `base` 去 fetch `anim/` 文件**，所以 iframe 里请用单文件 HTML（或共享块模式）。

## 5. 嵌入 App（共享块模式，可选）——✅ 已实现

`node tools/anim2/build.mjs --embed <out.html> 人 大 …`（`tools/anim2/embed.mjs`，验收 `test/embed.py`）：

- 共享块 `<script type="text/plain" class="xzq-chunk" data-h="<sha256 前 16 位>">`：引擎整段 gzip 一份、文楷子集（这一页所有字合起来一份）、≥2 KB 的图片/音频（`hand.png` 全页一份；mp3 每字一块），按内容哈希去重。
- 每字数据 `<script type="text/plain" class="xzq-zi" data-zi="人">`：脚本+时间轴+线稿+笔画 JSON，gzip+base64，大块换成 `chunk:<hash>`。
- 运行时点哪个字才解压哪个字（`DecompressionStream('gzip')`），解压结果同页缓存；拼成单字页面放进 `<iframe sandbox="allow-scripts" srcdoc>`。iframe 没有 `allow-same-origin`，所以引擎、字体（data: URL）、数据全部内联进 srcdoc，不依赖 blob: URL 或网络。
- 「人」「大」两字一页 2.7 MB，其中 mp3 约 2.4 MB；引擎（gzip 后约 45 KB）和字体只算一次。
- PWA：service worker 首播后缓存该字资源，不预缓存全部 MP3。

## 6. 目录约定

- `tools/anim2/`：v2 源码
  - `engine/`：`model.js`（排时 + `drawFrame`）、`geom.js`（折线/路径工具）、`player.js` + `player.css`（控件、字幕、时钟）、`index.js`（load/mount）、`global.js`（IIFE 入口）
  - `build.mjs`（esbuild 打包）、`fonts.py`（文楷子集）、`package.json`（`npm i` 装 esbuild gsap roughjs）
  - `lib.mjs`（build/embed 共用）、`embed.mjs`（共享块模式）
  - `test/determinism.py`（确定性 + 沙箱 iframe + v1 对比图）、`test/allchars.py`（全量回归）、`test/embed.py`（共享块模式）、`test/dist-demo.html`（dist 演示页）
  - `.cache/`（源字体 TTF，不入库）、`node_modules/`（不入库）
- `dist/anim2/`：构建产物 `xzq-anim2.js`（约 130 KB，含 rough.js + GSAP）、`xzq-anim2-font.woff2`、`OFL-LXGW-WenKai.txt`；单字 HTML 不入库，需要时生成
- v1 文件（`xzq-anim.js/css`、`tools/anim/`）不改动

## 7. 后续：AI 绿幕角色（未实施，本轮按要求跳过）

- 生图：绿幕 `#00FF00` 关键帧；每个动作 3 帧（准备/发力/结果），走路、小跑各 4 帧循环；同一演员表、同一画风、脚底线统一。
- 抠图（Python + Pillow + NumPy）：绿色判定 `g>150` 且 g 比 r、b 都大 50；半透明边去溢色（g 改成 max(r,b)）；裁边；缩到最高 520 px；WebP 质量约 74；base64 data URI 内嵌。
- 锚点：bottom 脚底行、ax 上 30% 身体中轴、hand 手、foot 脚，用于对位；`actor` 按移动距离换帧。

## 8. 环境

```
pip install numpy pillow playwright fonttools brotli
python3 -m playwright install chromium
cd tools/anim2 && npm i      # esbuild gsap roughjs（版本见 package.json）
```

## 9. 许可

- rough.js MIT，GSAP 标准许可（免费商用），esbuild MIT。
- LXGW WenKai：OFL，子集化后保留许可文本（`dist/anim2/OFL-LXGW-WenKai.txt`）。未使用 Kalam。
- hanzi-writer-data：Arphic Public License，保留 `ARPHICPL.TXT`。
- edge-tts 无商用授权，上线前须换 Azure / 讯飞 / 火山或真人配音。
