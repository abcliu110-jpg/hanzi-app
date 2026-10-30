#!/usr/bin/env python3
"""线稿库总览：把 anim/art/*.json 画成一张对照图（带锚点），用来检查线稿质量。
用法：python3 tools/anim/artsheet.py [-o out.png] [--anchors] [名 ...]
"""
import argparse, asyncio, json
from common import ART, CACHE
from playwright.async_api import async_playwright


def sheet_html(arts, anchors):
    cells = []
    for a in arts:
        ss = ''.join(
            f'<path d="{(s if isinstance(s, str) else s["d"])}" fill="{"#222" if isinstance(s, dict) and s.get("fill") else "none"}" '
            f'stroke="{({"blue": "#2F7FD0", "red": "#D9443F", "orange": "#F08A2C", "green": "#3C9A5A"}).get(s.get("c") if isinstance(s, dict) else "", "#222")}" '
            f'stroke-width="{(s.get("w", 6) if isinstance(s, dict) else 6) * 1.0}" stroke-linecap="round" stroke-linejoin="round"/>' for s in a['strokes'])
        an = ''
        if anchors:
            for k, q in (a.get('anchors') or {}).items():
                an += f'<circle cx="{q[0]}" cy="{q[1]}" r="5" fill="#F08A2C"/><text x="{q[0] + 7}" y="{q[1] - 6}" font-size="15" fill="#F08A2C">{k}</text>'
                if len(q) >= 4 and q[2]:
                    an += f'<ellipse cx="{q[0]}" cy="{q[1]}" rx="{q[2]}" ry="{q[3]}" fill="none" stroke="#F08A2C" stroke-dasharray="4 4"/>'
            bb = a.get('bbox')
            if bb:
                an += f'<rect x="{bb[0]}" y="{bb[1]}" width="{bb[2] - bb[0]}" height="{bb[3] - bb[1]}" fill="none" stroke="#2F7FD0" stroke-dasharray="3 5"/>'
        cells.append(f'<div class="c"><svg viewBox="0 0 400 400"><rect width="400" height="400" fill="#fff" stroke="#ddd"/>'
                     f'<g filter="url(#r)">{ss}</g>{an}</svg><b>{a["name"]}</b></div>')
    return ('<html><body style="margin:0;background:#eee;font-family:sans-serif"><svg width="0" height="0"><filter id="r" x="-5%" y="-5%" width="110%" height="110%">'
            '<feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter></svg>'
            '<div style="display:grid;grid-template-columns:repeat(6,260px);gap:8px;padding:8px">' + ''.join(cells) +
            '</div><style>.c{background:#fff;text-align:center}.c svg{width:260px;height:260px;display:block}.c b{font-size:14px}</style></body></html>')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('names', nargs='*')
    ap.add_argument('-o', default=str(CACHE / 'artsheet.png'))
    ap.add_argument('--anchors', action='store_true')
    a = ap.parse_args()
    files = [ART / f'{n}.json' for n in a.names] if a.names else sorted(ART.glob('*.json'))
    arts = [json.loads(p.read_text()) for p in files]
    CACHE.mkdir(parents=True, exist_ok=True)
    h = CACHE / 'artsheet.html'
    h.write_text(sheet_html(arts, a.anchors))
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1640, 'height': 400})
        await pg.goto(h.resolve().as_uri())
        await pg.screenshot(path=a.o, full_page=True)
        await b.close()
    print(a.o)

asyncio.run(main())
