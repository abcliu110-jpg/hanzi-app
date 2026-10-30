#!/usr/bin/env python3
"""霞鹜文楷（LXGW WenKai，OFL）子集化 → woff2（brotli）。
用法：
  python3 tools/anim2/fonts.py --text-file chars.txt -o out.woff2   # 只保留文件里出现的字
  python3 tools/anim2/fonts.py --all                                # 扫描 anim/*.json + timeline，生成 dist/anim2/xzq-anim2-font.woff2
源字体 tools/anim2/.cache/LXGWWenKai-Regular.ttf（不进仓库；没有就自动从 GitHub release 下载，约 24 MB）。
英文/拼音/数字也由文楷覆盖（含带声调拼音），所以不需要 Kalam。
"""
import argparse, json, subprocess, sys, tempfile, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SRC = HERE / '.cache' / 'LXGWWenKai-Regular.ttf'
URL = 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/LXGWWenKai-Regular.ttf'
# 引擎和播放器固定会用到的字符
BASE = ('0123456789:/.×+-–·…%（）()《》“”‘’"\'，。！？、；：— '
        'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
        'āáǎàōóǒòēéěèīíǐìūúǔùǖǘǚǜüê'
        '播放暂停字幕静音打开声音进度看动画义形章节回顾通行说法源还没有定论来历')


def ensure_src():
    if SRC.exists():
        return SRC
    SRC.parent.mkdir(parents=True, exist_ok=True)
    print('下载霞鹜文楷 …', file=sys.stderr)
    urllib.request.urlretrieve(URL, SRC)
    return SRC


def script_text(zi):
    """一个字的动画里所有会出现在画面/字幕/控件上的文字。"""
    out = []
    sp = ROOT / 'anim' / f'{zi}.json'
    s = json.loads(sp.read_text())
    for sc in s.get('scenes', []):
        out += [sc.get('label', ''), sc.get('word', ''), sc.get('recap', '') if isinstance(sc.get('recap'), str) else '']
        rc = sc.get('recap') if isinstance(sc.get('recap'), dict) else None
        if rc:
            out.append(rc.get('center', ''))
        for ln in sc.get('lines', []):
            out.append(ln.get('text', ''))
            for c in ln.get('cues', []):
                if c.get('do') in ('label', 'note'):
                    out.append(c.get('text', ''))
    rc = s.get('recap') or {}
    out.append(rc.get('center', '') if isinstance(rc, dict) else '')
    out.append(s.get('zi', ''))
    tp = ROOT / 'anim' / f'{zi}.timeline.json'
    if tp.exists():
        for sc in json.loads(tp.read_text()):
            for c in sc.get('cues', []):
                out.append(c.get('text', ''))
    return ''.join(x for x in out if isinstance(x, str))


def all_scripts():
    return sorted(p.stem for p in (ROOT / 'anim').glob('*.json')
                  if p.stem != 'index' and not p.stem.endswith('.timeline') and not p.stem.endswith('.draft'))


def subset(text, out):
    chars = ''.join(sorted(set(text + BASE)))
    out = Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8') as f:
        f.write(chars)
    subprocess.check_call([sys.executable, '-m', 'fontTools.subset', str(ensure_src()), f'--text-file={f.name}',
                           '--flavor=woff2', f'--output-file={out}', '--layout-features=*', '--no-hinting', '--desubroutinize'])
    return out, len(chars)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--text-file')
    ap.add_argument('--zi', help='只取这个字的动画文字')
    ap.add_argument('--all', action='store_true')
    ap.add_argument('-o', '--out')
    a = ap.parse_args()
    if a.all:
        text = ''.join(script_text(z) for z in all_scripts())
        out = a.out or ROOT / 'dist' / 'anim2' / 'xzq-anim2-font.woff2'
    elif a.zi:
        text = script_text(a.zi); out = a.out
    else:
        text = Path(a.text_file).read_text(encoding='utf-8'); out = a.out
    p, n = subset(text, out)
    print(p, n, 'chars', p.stat().st_size // 1024, 'KB')
