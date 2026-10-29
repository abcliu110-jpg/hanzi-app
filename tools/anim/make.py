#!/usr/bin/env python3
"""一条命令做完一个字：tts → snap 体检 → mix → preview →（可选）export → 写 anim/index.json

用法：python3 tools/anim/make.py 人 [--video] [--skip-tts]
  体检不通过（控制台报错、cue 晚于关键词、出框重叠）会停下，先修脚本。
  --video 会调 export.py；视频帧多时一次跑不完（每次最多约 100 秒），按提示重复运行即可。
单独更新索引：python3 tools/anim/make.py --index
"""
import argparse, json, subprocess, sys, time
from pathlib import Path
from common import ANIM, ROOT

HERE = Path(__file__).resolve().parent


def step(*args):
    print('$', ' '.join(args))
    r = subprocess.run([sys.executable, *args], cwd=HERE)
    return r.returncode


def update_index():
    idx = {}
    for p in sorted(ANIM.glob('*.json')):
        if p.name.endswith('.timeline.json') or p.name.endswith('.draft.json') or p.name == 'index.json':
            continue
        sc = json.loads(p.read_text())
        zi = sc.get('zi')
        tl_p = ANIM / f'{zi}.timeline.json'
        mp3 = ANIM / f'{zi}.mp3'
        if not (tl_p.exists() and mp3.exists()) or sc.get('status') != 'done':
            continue
        tl = json.loads(tl_p.read_text())
        idx[zi] = {'version': sc.get('version', 1), 'track': sc.get('track'),
                   'duration': round((tl[-1]['start'] + tl[-1]['dur']) / 1000, 1),
                   'chapters': [s.get('label') or s['id'] for s in sc['scenes']],
                   'updated': time.strftime('%Y-%m-%d', time.localtime(mp3.stat().st_mtime))}
    out = ANIM / 'index.json'
    out.write_text(json.dumps({'version': 1, 'chars': idx}, ensure_ascii=False, indent=1))
    print('anim/index.json:', ', '.join(f'{k} {v["duration"]}s' for k, v in idx.items()) or '（空）')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zi', nargs='?')
    ap.add_argument('--video', action='store_true')
    ap.add_argument('--skip-tts', action='store_true')
    ap.add_argument('--index', action='store_true')
    a = ap.parse_args()
    if a.index or not a.zi:
        update_index(); return
    if not a.skip_tts and step('tts.py', a.zi):
        sys.exit('tts 失败')
    if step('snap.py', a.zi):
        sys.exit('体检没通过：看上面的报告和 .cache/anim/%s/snaps.jpg，改好 anim/%s.json 再跑' % (a.zi, a.zi))
    if step('mix.py', a.zi) or step('preview.py', a.zi):
        sys.exit('混音/预览失败')
    if a.video:
        while True:
            rc = step('export.py', a.zi)
            if rc == 3:
                print('（视频还没导完，继续）'); continue
            if rc:
                sys.exit('导出失败')
            break
    update_index()


if __name__ == '__main__':
    main()
