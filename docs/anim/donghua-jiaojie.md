---
title: 识字星球 · 字义白板动画 交接文档
subtitle: v1.0 · 2026-10-29 · 配合《设计文档》一起看
---

# 1. 一句话现状

「节」的白板动画试点已定稿（白底黑笔、手跟着配音边画边讲，约 110 秒）。下一步：把试点抽成通用引擎和数据格式，按《设计文档》做首批 100 个最常用字。**试点代码目前不在 Gitee 仓库里**，在随附的 `anim-pilot.zip` 中。

# 2. 已经定下的决定

| 决定 | 原因 / 来源 |
|---|---|
| 连续自动播放，不做点击推进 | 产品负责人明确要求 |
| 白板风格（白底黑笔、手绘线条、一只手在画） | 对比过彩色绘本插画版，产品负责人认为太复杂，选定白板 |
| 边画边讲：画面动作卡在配音念到的词上 | 产品负责人要求“边画边讲解” |
| 关键字按真实笔顺写出 | 让孩子顺便看到正确笔顺 |
| 加笔声、翻页声、轻背景乐，手在笔画间抬笔走弧线，手绘抖动线条，关键词下划线 | 第二轮优化，产品负责人确认“就这样” |
| 首批做字频前 100 个字 | 产品负责人要求 |
| 字源“待查”的字不讲字源 | 避免把推测当事实（仓库 README 待办里也有这条） |

# 3. 交付物清单

| 文件 | 内容 |
|---|---|
| `donghua-sheji.pdf` | 设计文档：风格规范、叙事结构、100 字清单与分类、数据格式、播放器、验收标准 |
| `donghua-jiaojie.pdf` | 本文档 |
| `anim-pilot.zip` | 试点全部源码和素材（见第 4 节） |
| `jie-baiban-v2.mp4` | 定稿效果视频（「节」，110 秒，带声音） |
| `jie-baiban.html` | 定稿单文件网页版（离线可放，可按章节跳转） |

# 4. 试点代码结构（`anim-pilot.zip`）

| 文件 | 作用 |
|---|---|
| `script.json` | 9 个场景的配音文案（每场景 2–3 句） |
| `audio.py` | 逐句调 edge-tts 生成配音，拼接静音（场景前 600 ms、句间 380 ms、场景后 1,900 ms），输出 `narr.wav` 和 `timeline.json` |
| `template.html` | **核心**：白板引擎 + 「节」的全部画面。占位符 `__TL__` `__HZ__` `__HAND__` `__AUDIO__` 由 build.py 填入 |
| `build.py` | 把 timeline、笔画数据、手的图片、音频以 base64 嵌进模板，生成单文件 `jie-baiban.html` |
| `getsegs.py` | 用 Playwright 打开页面，导出每一笔的开始时间和时长（`segs.json`），给音效用 |
| `sfx.py` | 按 `segs.json` 合成笔声、翻页声，合成背景乐，按配音包络压低背景乐，混成 `mix.wav` |
| `frames.py` | 逐帧调用 `render(t)` 截图（25 fps，1280×720），可分段并行 |
| `snap.py` | 抽几个时间点截图，用来检查画面 |
| `hz/*.json` | 10 个字的笔画数据（hanzi-writer-data） |
| `hand_d.png` | 握笔手，笔尖在图片 (3.3, 18)（按 300 px 宽计） |

## 4.1 引擎要点（`template.html`）

- **确定性渲染**：所有动画登记为 `track(start, dur, apply)`，`render(t)` 每帧对全部 track 求值。播放时 `t = audio.currentTime`，所以音画永远同步，跳转无副作用；导出视频时逐帧调用同一个函数。
- `ink(parent, d, start, opts)`：画一条路径（stroke-dasharray 展开），时长按路径长度算，同时登记给“手”。
- `write(parent, 字, x, y, size, start)`：按 hanzi-writer-data 的笔画轮廓做 clipPath，沿中线画粗线，得到逐笔书写效果。坐标变换 `translate(x,y) scale(size/1024) translate(0,900) scale(1,-1)`。
- `word(...)`：连续写多个字，大字写完自动画橙色下划线（`noul` 可关）。
- `C(场景, 句, '关键词')`：返回配音念到该词的时间（按字符位置比例估算）。所有 cue 都用它，改文案不用重新对时间。
- 手：所有笔画按开始时间排序；正在画时取路径当前点（`getPointAtLength` × `getCTM`）；两笔之间间隔 < 1.5 秒就抬笔走弧线过去，否则移出画面。
- 场景：每个场景一个 `<g>`，内层套抖动滤镜；转场是整板平移。

## 4.2 怎么跑

```bash
pip install edge-tts playwright numpy
python3 -m playwright install --with-deps chromium
# Linux 需要中文字体：fonts-wqy-zenhei、fonts-arphic-ukai
python3 audio.py          # 配音 + timeline.json（试点是在 jie2 目录跑的）
python3 build.py          # 先生成一次页面
python3 getsegs.py        # 导出笔画时间
python3 sfx.py            # 合成音效并混音 -> mix.wav
ffmpeg -i mix.wav -af loudnorm=I=-16:TP=-1.5 mixn.wav
ffmpeg -i mixn.wav -b:a 96k mix.mp3
python3 build.py          # 用 mix.mp3 重新生成最终页面
python3 frames.py 0 2760  # 逐帧截图（可拆成 4 段并行）
ffmpeg -framerate 25 -i fr/%05d.jpg -i mixn.wav -c:v libx264 -crf 22 -pix_fmt yuv420p -c:a aac -shortest out.mp4
```

注意：脚本里写死了 `/workspace/work/jie3/` 等路径，迁进仓库时改成相对路径；`frames.py` 的帧目录也要改。

# 5. 已知问题和风险（按重要程度）

1. **「节」不在仓库的 3,499 字数据里**。`char-index.json` 和 `data/zi-*.json` 都查不到「节」，只有单页 `jie-ziyi-kuozhan-tu.html`。要么把「节」补进数据，要么试点只作样片。
2. **配音授权**：edge-tts 用的是微软浏览器朗读的非公开接口，没有商用授权，也可能随时失效。上线前必须换成 Azure 语音 / 讯飞 / 火山引擎或真人配音。换服务后只需重写 `audio.py`，timeline 格式不变。
3. **笔画数据授权**：hanzi-writer-data 源自 Make Me a Hanzi，许可是 Arphic Public License。可以使用和再分发，但要随应用附上许可文本（ARPHICPL.TXT）并保留出处。
4. **楷体字体**：辅助文字用系统楷体（KaiTi / STKaiti）。安卓和部分电脑没有，会退回其他字体。建议打包一个开源楷体子集（如霞鹜文楷，OFL 许可）。
5. **手的图片**是 AI 生成的，边缘做过去绿处理；正式版建议请设计师画一张矢量手。
6. **画面是手写坐标**。试点每个场景的线稿和位置都直接写在代码里，不能复用。做 100 字前必须先完成第 6 节的引擎抽取，否则每个字都要重写。
7. **背景乐是程序合成的**，比较简单。如需更好听，换正版曲库。
8. **试点导出视频时写 MP4 到 JuiceFS 工作区报过 I/O 错误**，先写到 `/tmp` 再复制就正常。
9. 仓库 CI 是 GitHub Actions，但仓库在 Gitee，目前不会自动跑；新加的动画检查要么迁到 Gitee Go，要么本地 `npm test`。

# 6. 下一步任务（建议顺序）

| # | 任务 | 产出 | 预估 |
|---|---|---|---|
| 1 | 抽引擎：`template.html` → `xzq-anim.js`，画面改为读 `anim/<字>.json`（格式见设计文档 5.1） | 引擎 + 用 JSON 重做的「节」，效果与定稿一致 | 2–3 天 |
| 2 | 工具链：`tools/anim/draft.py`（从 `data/zi-*.json` 生成脚本初稿和 A/B/C 分类）、`tts.py`、`mix.py`、`export.py` | 一条命令出单个字的 mp3 + timeline + mp4 | 2 天 |
| 3 | 线稿库第一批（约 40 张基础件）+ 槽位布局 | `anim/art/*.json` | 3–4 天 |
| 4 | 首批 20 字（设计文档 4.3） | 20 个字的动画 + 复盘，修模板 | 1 周 |
| 5 | 接入 App：`ziyi-viewer.html` 加“看动画”、进度 `xzq_anim`、减少动画模式、PWA 按需缓存 | 页面改动 + Playwright 用例 | 2 天 |
| 6 | 其余 80 字，每 10 个一批审核 | 100 字完成 | 3–4 周 |
| 7 | 换正式配音并重新生成全部音轨 | 可上线版本 | 视供应商 |

## 6.1 每个字的制作流程

1. `draft.py 头` 生成 `anim/头.json` 初稿（义项、为什么、例词都从数据里来）。
2. 改写配音：口语化，每句 ≤25 字；检查可信度规则。
3. 给每句配 cue：选线稿、圈注、箭头、要写的字。
4. `tts.py 头` → 配音和 timeline。
5. 浏览器预览，`snap.py` 抽帧检查重叠和出框。
6. `mix.py 头` 混音，`export.py 头` 出视频（可选）。
7. 对照设计文档第 8 节验收，写入 `anim/index.json`。

单字熟练后约 1–1.5 小时（线稿库齐全的前提下），主要时间在改文案和配 cue。

# 7. 联系与资料

- 仓库：Gitee `abcdliu110hark02/hanzi-app`（私有）。数据唯一源是 `data/zi-<批>.json`，改完运行 `python3 tools/build_data.py`。
- 字频来源：Jun Da, *Modern Chinese Character Frequency List*（lingua.mtsu.edu/chinese-computing）。
- 笔画数据：hanzi-writer-data 2.0（jsDelivr），许可 Arphic Public License。
