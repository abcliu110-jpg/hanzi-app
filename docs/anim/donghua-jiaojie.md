---
title: 识字星球 · 字义白板动画 交接文档
subtitle: v2.1 · 2026-10-30 · 配合《设计文档》一起看
---

# 1. 一句话现状

通用引擎 `xzq-anim.js` + 工具链 `tools/anim/` + 线稿库 `anim/art/`（100+ 张）已完成，已在 master。**2026-10-30 起主仓库改为 GitHub `abcliu110-jpg/hanzi-app` 的 master**（Gitee 令牌已撤销，`anim-engine` 分支停用）。按产品负责人要求：读本文档和设计文档完成全部任务，**每完成一个小任务立即提交 GitHub，并同步更新本文档**。进度以 `anim/` 目录里的 `<字>.mp3` 为准（有 mp3 = 已混音完成）。

# 2. 已经定下的决定

| 决定 | 原因 / 来源 |
|---|---|
| 连续自动播放，不做点击推进 | 产品负责人明确要求 |
| 白板风格（白底黑笔、手绘线条、一只手在画） | 对比过彩色绘本版，选定白板 |
| 边画边讲：画面动作卡在配音念到的词上 | 产品负责人要求 |
| 关键字按真实笔顺写出，大字下加橙色下划线 | 让孩子顺便看到正确笔顺 |
| 首批做字频前 100 个字，按设计文档 A/B/C 分类 | 产品负责人要求 |
| 字源“待查”的字不讲字源；“通行说法”加角落小字 | 避免把推测当事实 |
| 每个字 4–6 个义项章节 + 回顾，总长 ≤120 秒 | 儿童注意力；义项多的字只挑常用的 |
| 直接提交 GitHub master；每完成一个小任务（如每 2 个字）提交一次，并同步更新本文档 | 产品负责人 2026-10-30 要求 |

# 3. 仓库里的文件

| 路径 | 作用 |
|---|---|
| `xzq-anim.js` / `xzq-anim.css` | 播放器引擎（数据驱动，`render(t)` 纯函数，播放和导出视频共用） |
| `tools/anim/` | `draft.py` 初稿、`tts.py` 配音、`snap.py` 体检、`mix.py` 混音、`preview.py` 离线页、`export.py` 视频、`make.py` 一条龙、`art_base.py`/`artsheet.py` 线稿；用法见 `tools/anim/README.md` |
| `anim/<字>.json` | 动画脚本（人工维护，`status: done` 才算完成） |
| `anim/<字>.timeline.json` | 配音时间轴（含 edge-tts 每字时间） |
| `anim/<字>.mp3` | 混好的音轨（−16 LUFS） |
| `anim/index.json` | 已完成字的目录（`make.py --index` 生成） |
| `anim/art/*.json` | 线稿库：400×400 单线路径 + 锚点 |
| `anim/hz/*.json` | 笔画数据（hanzi-writer-data，Arphic PL，许可在 `anim/hz/ARPHICPL.TXT`） |
| `docs/anim/donghua-sheji.md` | 设计文档 |
| `docs/anim/donghua-jiaojie.md` | 本文档 |

MP4 和离线 HTML 不进仓库（`.gitignore` 已排除 `exports/` 和 `.cache/`），需要时用 `export.py` / `preview.py` 现生成。「节」的试点仍是单独样片，不在 3,499 字数据中。

# 4. 进度（首批 100 字）

制作顺序：首批 20 字 → 其余 A 类 → B 类（含借声音段落）→ C 类（不讲字源）。

<!--progress-->
- 已完成并提交（20/100）：上 下 中 天 小 心 生 年 家 出 开 本 前 看 动 学 好 分 一 到。
- 待做（78）：在 为 和 国 以 时 要 就 会 可 对 得 自 过 作 用 行 种 事 多 经 去 法 同 现 当 没 起 定 还 进 主 理 她 因 从 想 实 的 是 有 我 他 个 来 地 说 你 能 而 子 那 之 发 后 里 道 然 成 方 如 都 面 其 些 样 但 只 不 了 这 们 也 于 着 所 么 部。
<!--/progress-->

## 4.1 待产品负责人确认

- 「成」的“一成（十分之一）”在数据里来历待查，计划不说“借声音”，改加角落小字“来历还没有定论”，与 B 类规则不完全一致。
- 各字删掉的冷僻或“待查”义项：上（上色、皇上）、下（下策、一下）、生（学生）、中（中暑）、年（年代）、出（一出戏）、家（儒家）、看（看病、试试看）、一（统一）。

# 5. 制作经验（写脚本必看）

- **一只手画**：write/draw/path/circle/arrow 共用一支笔按时间排队。前一笔没画完，后面的 cue 会顺延，`snap.py` 报“cue 晚于关键词”。解决：缩短前一张线稿的 `dur`、`write` 用 `k≈1.0–1.7`、写字提前到句首。
- **写一个词要 3–6 秒**（笔画多更慢）。场景最后一句不要以正在写的词结尾，否则会画出场景外；画面需在场景结束前 200 ms 画完。
- `circle` 圈一张这个场景里还没画出来的线稿会直接报 TypeError（引擎待修，见 6）。
- 用 `on:` 贴附的线稿不参与重叠检查，要自己看 `snaps.jpg`。
- 3 个字以上的词会缩到 200 px 以下，不画下划线。
- 新线稿先查 `anim/art/` 有没有，重名不要覆盖。

# 6. 已知问题和风险

1. **配音授权**：edge-tts 没有商用授权，也可能失效。上线前换 Azure / 讯飞 / 火山或真人配音（也可评估开源可商用的 VoxCPM2）；只需在 `tts.py` 加 Backend，timeline 格式不变，然后全部重跑 `tts.py` + `mix.py`。
2. **笔画数据授权**：Arphic Public License，随应用附 `ARPHICPL.TXT`。
3. **引擎小问题**：circle 指向未画出的线稿会崩溃（应改成警告）；个别字混音后 mp3 比 timeline 长几秒（上：84.7 s vs 78.0 s），原因未查。
4. **楷体字体**：建议打包霞鹜文楷子集（OFL）。
5. **手的图片**是 AI 生成的，正式版建议换矢量手。
6. **提交方式**：GitHub Git Data API（blobs → trees → commits → 更新 refs）一次提交多个文件。Gitee 仓库停止更新，若 Gitee→GitHub 有自动镜像需关掉，否则可能覆盖 GitHub 上的提交。
7. 仓库 CI 是 GitHub Actions，迁到 GitHub 后会自动跑，新增的动画检查要保证能通过。

# 7. 下一步

| # | 任务 |
|---|---|
| 1 | 继续做完首批 100 字（每 2 字提交 master） |
| 2 | 更新 `anim/index.json` |
| 3 | 接入 App（进行中）：<br>✅ `ziyi-viewer.html` “看动画”按钮（`anim/index.json` 里有的字才显示）→ 浮层播放，`xzq_anim` 有记录时显示“已看”；减少动画由引擎处理；音轨整段读成 blob 再播放（服务器不支持 Range 也能拖动）<br>☐ PWA 按需缓存 anim JSON/mp3<br>☐ Playwright 用例 |
| 4 | 换正式配音并重新生成全部音轨 |

## 7.1 每个字的制作流程

1. `python3 tools/anim/draft.py 字` 出初稿；改写文案（每句 ≤25 字），按 A/B/C 和可信度规则处理。
2. 配 cue，复用线稿，必要时新增。
3. `tts.py 字` → `snap.py 字 --lines`（必须全过）→ 看 `.cache/anim/字/snaps.jpg` → `mix.py 字`。
4. 脚本 `status` 设为 `done`；凑满 2 个字一起提交 GitHub master，同时更新本文档第 4 节进度。

# 8. 联系与资料

- 仓库：GitHub `abcliu110-jpg/hanzi-app`，master 分支（原 Gitee `abcdliu110hark02/hanzi-app` 已停用）。数据唯一源是 `data/zi-<批>.json`。
- 字频：Jun Da, *Modern Chinese Character Frequency List*。
- 笔画数据：hanzi-writer-data 2.0，Arphic Public License。
