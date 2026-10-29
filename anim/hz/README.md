# anim/hz — 笔画数据

每个文件是一个字的 `strokes`（轮廓）和 `medians`（中线），取自 [hanzi-writer-data](https://github.com/chanind/hanzi-writer-data) 2.0（jsDelivr），
上游是 [Make Me a Hanzi](https://github.com/skishore/makemeahanzi)。许可：Arphic Public License，全文见 `ARPHICPL.TXT`，
随应用分发时必须一起带上并保留出处。

文件由 `tools/anim/common.py:get_hz()` 自动下载缓存（`snap.py` / `mix.py` / `preview.py` 用到哪个字就取哪个），不要手改。
