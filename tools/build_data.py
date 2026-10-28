#!/usr/bin/env python3
"""重新生成离线（file://）兜底数据。

改完 data/zi-*.json 或 char-index.json 后运行：
    python3 tools/build_data.py

生成：
  data/char-index.js  —— 把 char-index.json 包成 window.XZQ_FILES，供 file:// 下读取
  data/bundle.js      —— 把全部 data/zi-*.json 包成 window.XZQ_FILES，供 file:// 下 ziyi-viewer 使用
  maps/index.html     —— maps 各批字的目录页（首页「打开 maps 各批字」链接到这里）
通过 http(s) 访问时页面直接 fetch JSON，不会加载这两个文件。
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PREFIX = "window.XZQ_FILES=Object.assign(window.XZQ_FILES||{},{"
SUFFIX = "});"


def group_no(p):
    m = re.fullmatch(r"zi-(\d+)\.json", p.name)
    return int(m.group(1)) if m else None


def write_maps_index(files):
    import html
    items = []
    for p in files:
        n = group_no(p)
        if not (ROOT / "maps" / f"maps-{n}.html").exists():
            continue
        chars = "".join(c.get("zi", "") for c in json.loads(p.read_text(encoding="utf-8")).get("chars", []))
        items.append(f'<a href="maps-{n}.html"><b>第 {n} 批</b><span>{html.escape(chars)}</span></a>')
    page = f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>字义扩展图 · 各批字目录</title>
<link rel="stylesheet" href="../xzq-theme.css">
<style>
main{{max-width:1080px;margin:0 auto;padding:24px 18px 60px}}
h1{{font-family:var(--xzq-kai);margin:0 0 6px}}
.top{{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:18px}}
.top a{{color:var(--xzq-meaning)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}}
.grid a{{display:block;background:var(--xzq-card);border:1px solid var(--xzq-line);border-radius:16px;padding:12px 14px;text-decoration:none;box-shadow:var(--xzq-shadow)}}
.grid b{{display:block;color:var(--xzq-meaning)}}
.grid span{{font-family:var(--xzq-kai);font-size:20px;letter-spacing:2px;word-break:break-all}}
</style></head>
<body class="xzq" style="padding-top:0"><main>
<div class="top"><div><h1>字义扩展图 · 各批字</h1><p style="color:var(--xzq-muted);margin:0">共 {len(items)} 批，点一批打开</p></div><a href="../index.html">← 回首页</a></div>
<div class="grid">
{chr(10).join(items)}
</div></main></body></html>
"""
    (ROOT / "maps" / "index.html").write_text(page, encoding="utf-8")


def main():
    errors = []
    files = sorted((p for p in DATA.glob("zi-*.json") if group_no(p) is not None), key=group_no)
    parts, seen = [], {}
    for p in files:
        raw = p.read_text(encoding="utf-8").strip()
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError as e:
            errors.append(f"{p.name}: JSON 格式错误 {e}")
            continue
        if obj.get("group") != group_no(p):
            errors.append(f"{p.name}: group 字段是 {obj.get('group')}，与文件名不一致")
        for c in obj.get("chars", []):
            zi = c.get("zi")
            if zi in seen:
                errors.append(f"{p.name}: 「{zi}」与 {seen[zi]} 重复")
            seen[zi] = p.name
        parts.append(json.dumps(f"data/{p.name}") + ":" + raw)

    index_path = ROOT / "char-index.json"
    index_raw = index_path.read_text(encoding="utf-8").strip()
    index = json.loads(index_raw)
    for zi, g in index.items():
        if seen.get(zi) != f"zi-{g}.json":
            errors.append(f"char-index.json: 「{zi}」指向第 {g} 组，但数据在 {seen.get(zi, '无')}")
    for zi in seen:
        if zi not in index:
            errors.append(f"char-index.json: 缺少「{zi}」")

    if errors:
        print("发现问题，未生成：", *errors[:50], sep="\n  ")
        sys.exit(1)

    (DATA / "bundle.js").write_text(PREFIX + ",".join(parts) + SUFFIX, encoding="utf-8")
    (DATA / "char-index.js").write_text(PREFIX + '"char-index.json": ' + index_raw + SUFFIX, encoding="utf-8")
    write_maps_index(files)
    print(f"完成：{len(files)} 组，{len(seen)} 字")


if __name__ == "__main__":
    main()
