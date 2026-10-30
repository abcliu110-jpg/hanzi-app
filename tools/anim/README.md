# 字义白板动画 · 工具链

设计见 `docs/anim/donghua-sheji.md`，交接见 `docs/anim/donghua-jiaojie.md`。

## 文件

| 路径 | 作用 |
|---|---|
| `xzq-anim.js` / `xzq-anim.css` | 播放器引擎（数据驱动，`render(t)` 纯函数） |
| `anim/<字>.json` | 动画脚本（人工维护） |
| `anim/<字>.timeline.json` | 配音时间轴（`tts.py` 生成） |
| `anim/<字>.mp3` | 混好的音轨（`mix.py` 生成） |
| `anim/index.json` | 已完成的字、时长、章节 |
| `anim/art/*.json` | 线稿库：400×400 单线路径 + 锚点 + bbox（`art_base.py` 生成，可手改） |
| `anim/hz/*.json` | 笔画数据（hanzi-writer-data，Arphic PL，见 `anim/hz/README.md`） |
| `anim/hand.png` | 握笔手，笔尖在 (3.3, 18)（按 300 px 宽） |
| `.cache/anim/<字>/` | 中间文件（分句配音、混音 wav、截图），不进仓库 |
| `exports/` | mp4、离线 HTML，不进仓库 |

## 环境

```bash
pip install edge-tts playwright numpy pillow pypinyin
python3 -m playwright install --with-deps chromium
# Linux 需要中文字体：fonts-wqy-zenhei、fonts-arphic-ukai；ffmpeg
```

## 做一个字

```bash
cd tools/anim
python3 draft.py 头            # 1. 从 data/zi-*.json 出初稿 anim/头.json（已存在则写 头.draft.json）
#                                2. 人工改文案（每句 ≤25 字）、配 cue、选线稿；看初稿里的 todo
python3 tts.py 头              # 3. 配音 + timeline（按句缓存，只改了一句只重合成那一句）
python3 snap.py 头 --lines     # 4. 抽帧 + 体检：控制台报错 / cue 晚于关键词 >0.3s / 出框 / 重叠 / 跳转一致
#                                   看 .cache/anim/头/snaps.jpg
python3 mix.py 头              # 5. 笔声 + 翻页声 + 背景乐（压低）→ −16 LUFS → anim/头.mp3
python3 preview.py 头          # 6. exports/头.html（全部内嵌，离线可看）
python3 export.py 头           # 7. exports/头.mp4（一次跑不完会退出码 3，再跑一次续上）
python3 make.py --index        # 8. 更新 anim/index.json（脚本 status 为 done 才收录）
# 或者一条：python3 make.py 头 --video
```

其他：`python3 draft.py --classify 的 一 不` 打印 A/B/C 分类；`python3 artsheet.py --anchors` 出线稿总览图。

## 脚本格式要点（anim/<字>.json）

- `scenes[]`：`id` `kind`(intro/sense/recap) `label`(章节名) `word`(回顾图里的词) `lines[]`。
- 每句 `{text, cues[]}`；cue 的 `at`：`0` 句首、数字=秒、`"关键词"`、`"关键词+1.5s"`、`"关键词-0.3s"`、`"end"`、`"end+0.8s"`。
  有字边界时（edge-tts WordBoundary）按真实读音时间，否则按字符位置估算。
- 动作 `do`：`grid` `write` `draw` `path` `circle` `arrow` `label` `note`。
- 位置：`slot`（`C` `GL` `L` `LL` `LR` `R` `R1` `R2` `R3` `TL` `BR`）或 `box:[x,y,w,h]` 或 `x,y`；
  `draw`/`label` 可用 `on:"线稿id.锚点"` 贴在别的线稿上（`size` `dx` `dy`）。
- 引用：线稿用 `id`（默认是线稿名），锚点 `"person.hand-r"`；写的字用字本身，`"工人#1"` 是第 2 个字。
- 一只手画：画笔类动作（write/draw/path/circle/arrow）按时间排队，前一笔没画完后一笔会顺延，`snap.py` 会报出顺延超过 0.3 s 的 cue。
  `draw` 的 `dur`（秒）整体压缩一张线稿的绘制时长；`write` 的 `k` 越小写得越快。
- 回顾场景（`kind: recap`）自动画关系图：中心 `recap.center`，节点 `recap.nodes`（义项 id，显示该场景的 `recap`/`word`/`label`）。
- 可信度：`通行说法` 用 `{"do":"note","text":"通行说法"}`；字源待查（C 类）开场不讲字源，`note` 写“字源还没有定论”。

## 播放器 API

```html
<link rel="stylesheet" href="xzq-anim.css"><script src="xzq-anim.js"></script>
<div id="p"></div>
<script>XZQAnim.mount(document.getElementById('p'), '人', {base: 'anim/'}).then(p => { /* p.play() p.seek(ms) p.setRate(1.25) */ })</script>
```

选项：`capture`（导出模式，无控件）、`reducedMotion`（默认跟随系统 `prefers-reduced-motion`：静态板 + 配音）、`subtitles`。
看完 90% 写入 `localStorage.xzq_anim[字] = 时间戳`。

## 配音授权

`tts.py` 默认 edge-tts（微软浏览器朗读的非公开接口，**不能商用**）。换服务只需在 `tts.py` 里实现一个 Backend
（`synth(text, voice, rate, out_wav) -> (时长ms, 每字时间)`），`--engine` 选择；timeline 格式不变。
