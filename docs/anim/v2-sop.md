# 识字星球 · 白板动画制作 SOP（引擎 v2）

> 每个字按本流程走完才能提交。技术细节见 `docs/anim/v2-jishu.md`，内容规则见 `docs/anim/donghua-sheji.md`。

## 1. 准备（一次性）

```
pip install numpy pillow playwright fonttools brotli
python3 -m playwright install chromium
cd tools/anim2 && npm i esbuild gsap roughjs
```

## 2. 单字流程

1. **定类别**：查字源。A 类讲字源和引申；B 类有假借/借声音时明确说明；C 类字源待查，不讲字源，角落写「字源还没有定论」。
2. **写脚本** `anim/<字>.json`：4–6 个义项章节，每句旁白 ≤25 字，总长 ≤120 秒。
   - 需要的线稿先查 `anim/art/`，缺的先补线稿再引用。
   - `circle` / `arrow` 只能指向本场景已画出的线稿。
   - 写字动作留 3–6 秒；场景最后一句不要落在正在写的字上；场景结束前留 ≥200 ms。
3. **配音**：生成每句音频 → `mix.py` 混音到约 -16 LUFS → `anim/<字>.mp3` 与 `anim/<字>.timeline.json`（含词级时间戳）。检查 MP3 时长与 timeline 一致（差 >0.5 秒要查）。
4. **字体子集**：新增用字后运行 `python3 tools/anim2/fonts.py`，重新生成 WenKai / Kalam woff2 子集。
5. **构建预览**：`node tools/anim2/build.mjs <字> /tmp/<字>.html`（单文件，不入库）。
6. **自检**（全部通过才算完成）：
   - `snap.py --lines`：无控制台错误；cue 延迟 ≤0.3 秒；无重叠/出框；章节跳转正常。
   - 确定性：同一 t 截图两次，逐像素一致（`tools/anim2/test/determinism`）。
   - sandbox iframe 内加载无报错（localStorage、音频被禁时不崩）。
   - 字幕重点词与旁白同步变橙；动作结果帧保留。
   - **亲眼看** `.cache/anim/<字>/snaps.jpg`：笔顺正确、手跟笔尖、画面不挤。
7. **提交**：每完成两个字提交一次（最后剩一个单独提交）：
   `python3 /workspace/work/gh/commit_chars.py 字 字`（shell 凭据 `github-pat`）。
   脚本会更新 `anim/index.json` 和交接文档进度区块，并推到 GitHub `master`。

## 3. 引擎改动流程

1. 只改 `tools/anim2/` 与 `dist/anim2/`；v1（`xzq-anim.js/css`、`tools/anim/`）不动。
2. 每个小改动：构建 → 跑全部测试（确定性、iframe、已完成字的 `snap.py --lines` 回归）→ 立即提交。
3. 改完更新 `v2-jishu.md` 和交接文档第 7 节。

## 4. 禁止事项

- 不提交 MP4 或内嵌 MP3 的单字 HTML（需要时再生成）。
- 不手改 `anim/index.json`（由脚本生成）。
- 不在任何文件、日志、提交信息里写出 token。
- 不向 Gitee 提交（token 已撤销），只提交 GitHub `abcliu110-jpg/hanzi-app` 的 `master`。

## 5. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| TypeError: circle 目标不存在 | 指向了本场景尚未画的线稿，先画再圈 |
| cue 延迟 >0.3 秒 | circle/arrow 排在同一支笔队列后面；拆开或提前 |
| MP3 比 timeline 长 | 检查混音是否加了尾部静音、timeline 是否漏最后一句 |
| iframe 里白屏 | localStorage / 音频调用缺 try/catch |
| 两次截图不一致 | 绘制里用了 Math.random、Date.now 或依赖上一帧状态；改成只依赖 t 和固定 seed |
