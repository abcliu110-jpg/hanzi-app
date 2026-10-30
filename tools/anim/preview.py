#!/usr/bin/env python3
"""离线预览：把播放器、脚本、时间轴、线稿、笔画、手、音频全部内嵌进一个 HTML（可以直接双击打开、发给别人看）。
用法：python3 tools/anim/preview.py 人 [-o exports/人.html] [--no-audio]
"""
import argparse
from common import EXPORTS, build_page

ap = argparse.ArgumentParser()
ap.add_argument('zi')
ap.add_argument('-o')
ap.add_argument('--no-audio', action='store_true')
a = ap.parse_args()
out = build_page(a.zi, a.o or EXPORTS / f'{a.zi}.html', audio=not a.no_audio)
print(out, out.stat().st_size // 1024, 'KB')
