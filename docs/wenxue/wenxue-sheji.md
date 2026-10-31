# 文学常识功能：设计文档

需求见 `wenxue-xuqiu.md`。2026-10-31 起草，尚未实现。

## 1. 文件
- 页面：`wenxue.html`（仓库根目录，现有冒烟测试和返回键测试自动覆盖）。
- 数据：`wenxue/wenxue.json`，格式 `xzq-wenxue-v1`，含扁平 `entries` 列表和 `order`（字顺序）列表。
- file:// 离线兜底：`wenxue/wenxue.js`，挂到 `window.XZQ_FILES`（由 build.py 生成）。
- 音频：`wenxue/audio/<字>-<n>.mp3`。

## 2. 条目字段
| 字段 | 说明 |
|---|---|
| id | 唯一 id，如 `人-1` |
| zi | 所属汉字 |
| type | 古诗名句 / 成语 / 汉字趣闻 / 课本链接 |
| text | 正文 |
| pinyin | 每个汉字一个音节，与 text 对齐 |
| explain | 白话解释 |
| sense | 对应 `data/zi-N.json` 的义项 id + 说明 |
| source | 作品、作者、朝代；作者不确定的标“俗语” |
| textbook | 课本册次/课次（版本待定前标“待核对”） |
| story | 成语故事（可选） |
| grade | 1-2 / 3-4 / 5-6 |
| verify | 核对来源 |
| review | 草稿 / 已核对 / 已确认 |
| audio | `voiced`、`tts` 覆盖文本、`polycheck` 结果。`tts` 必须与 text 等长，逐字替换，保持拼音对齐 |

## 3. 工具（`tools/wenxue/`）
- `build.py`：校验数据、生成 `.js` 兜底；`--check` 模式加入 `ci.yml`。
- `tts.py`：Xiaoxiao 声音，先读正文再读解释。
- `polycheck.py`：复用 `tools/anim/polycheck.py` 的 DTW 函数，只检查 text 部分，对照常见多音字表。

## 4. 入口与交互
- `index.html`（MODS/FILES）和 `app-shell.html`（MODULES）加模块卡片。
- `ziyi-viewer.html` 动画按钮旁加“📜 文学”按钮，仅对有内容的字显示。
- 年级筛选记在 `xzq_wenxue_grade`，默认取 `xzq_grade`。
- 音频以 blob 播放以便缓存。
- `sw.js` VERSION 升到 `xzq-v4`，预缓存 `wenxue.html`、`wenxue/wenxue.json`。

## 5. 测试
- Playwright：页面加载、年级筛选、按字查看、音频按钮、ziyi-viewer 入口、离线兜底。
- CI：`build.py --check`。

## 6. 内容与核对
- 草拟 → 对照课本/《汉语大词典》/古籍原文核对 → 产品负责人审核 → 配音 + polycheck → 上线。
- 有争议的古音（《山行》斜、《回乡偶书》衰、《鹿柴》景）在负责人确认课本读音前不选用。

## 7. 批次
- 每批 10 字，顺序按 `docs/anim/donghua-jiaojie.md` §4 的 100 字表：人 大 上 下 中 天 小 心 生 年 起。
