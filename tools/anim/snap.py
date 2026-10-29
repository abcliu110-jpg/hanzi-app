#!/usr/bin/env python3
"""抽帧检查 + 自动体检。
  - 截图：默认每个场景画完时一张（场景结束前 300 ms），也可以 -t 1200,5000 指定毫秒
  - 拼成一张总览图 .cache/anim/<字>/snaps.jpg（自己看图检查画面）
  - 打印：控制台报错、引擎警告、晚于关键词 >0.3 s 的 cue、出框 / 重叠 / 压字幕
用法：python3 tools/anim/snap.py 人 [-t 1000,2000] [--lines]  （--lines：每句话结束时也截一张）
退出码：有报错或体检不通过时为 1
"""
import argparse, asyncio, json, sys
from common import cache_dir, build_page
from playwright.async_api import async_playwright

TOP, BOTTOM, LEFT, RIGHT = 100, 800, 20, 1580   # 上方留给 App 顶栏，下方 800 以下是字幕区


def inter(a, b, m=4):
    return a['x'] + m < b['x'] + b['w'] and b['x'] + m < a['x'] + a['w'] and a['y'] + m < b['y'] + b['h'] and b['y'] + m < a['y'] + a['h']


def lint(layout):
    probs = []
    for bd in layout:
        bx = bd['boxes']
        for b in bx:
            if b.get('note'):
                continue
            if b['x'] < LEFT or b['x'] + b['w'] > RIGHT or b['y'] < TOP or b['y'] + b['h'] > BOTTOM:
                probs.append(f'{bd["id"]}: 出框/压字幕 {b["what"]} x={b["x"]:.0f}..{b["x"] + b["w"]:.0f} y={b["y"]:.0f}..{b["y"] + b["h"]:.0f}')
        solid = [b for b in bx if not b.get('mark') and not b.get('on') and not b.get('note')]
        for i in range(len(solid)):
            for j in range(i + 1, len(solid)):
                if inter(solid[i], solid[j]):
                    probs.append(f'{bd["id"]}: 重叠 {solid[i]["what"]} ↔ {solid[j]["what"]}')
    return probs


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zi')
    ap.add_argument('-t', default='')
    ap.add_argument('--lines', action='store_true')
    ap.add_argument('--reduced', action='store_true', help='检查减少动画模式')
    a = ap.parse_args()
    d = cache_dir(a.zi)
    page = build_page(a.zi, d / 'preview.html', audio=False)
    tl = json.loads((d.parent.parent.parent / 'anim' / f'{a.zi}.timeline.json').read_text())
    ts = [int(x) for x in a.t.split(',') if x] if a.t else []
    if not ts:
        for s in tl:
            if a.lines:
                ts += [s['start'] + c['t'] + c['d'] for c in s['cues'][:-1]]
            ts.append(s['start'] + s['dur'] - 300)
    out = d / 'snaps'; out.mkdir(exist_ok=True)
    for f in out.glob('*.jpg'):
        f.unlink()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
        await pg.goto(page.resolve().as_uri() + ('#cap-reduced' if a.reduced else '#cap'))
        await pg.wait_for_function('window.XZQ_READY||window.XZQ_ERROR', timeout=30000)
        await pg.evaluate('document.fonts.ready')
        info = await pg.evaluate('({w:XZQ.warnings,r:XZQ.report,l:XZQ.layout(),total:XZQ.total})')
        el = await pg.query_selector('#player .xzq-stage')
        files = []
        for t in ts:
            await pg.evaluate(f'XZQ.render({t})')
            fp = out / f'{t:06d}.jpg'
            await el.screenshot(path=str(fp), type='jpeg', quality=80)
            files.append(fp)
        # 随机跳转回放一次，检查任意跳转后画面一致
        await pg.evaluate(f'XZQ.render({ts[-1]});XZQ.render(0);XZQ.render({ts[0]})')
        fp2 = out / 'seek_check.jpg'; await el.screenshot(path=str(fp2), type='jpeg', quality=80)
        await b.close()
    # 总览图
    from PIL import Image
    ims = [Image.open(f) for f in files]
    W, H = 640, 360; cols = 2 if len(ims) <= 6 else 3
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * W + (cols + 1) * 6, rows * H + (rows + 1) * 6), (60, 60, 60))
    for i, im in enumerate(ims):
        sheet.paste(im.resize((W, H)), (6 + (i % cols) * (W + 6), 6 + (i // cols) * (H + 6)))
    sheet.save(d / 'snaps.jpg', quality=85)
    late = [r for r in info['r'] if r['late'] > 300]
    probs = lint(info['l'])
    same = open(files[0], 'rb').read() == open(fp2, 'rb').read()
    print(f'总长 {info["total"] / 1000:.1f}s，截图 {len(files)} 张 → {d / "snaps.jpg"}')
    print('控制台报错：', errs or '无')
    print('引擎警告：', info['w'] or '无')
    print('晚于关键词 >0.3s：', [f'{r["scene"]}.{r["line"]} {r["do"]} 「{r["at"]}」 晚 {r["late"]}ms' for r in late] or '无')
    print('版面体检：', probs or '通过')
    print('跳转一致：', '是' if same else '否（seek_check.jpg 与第一张不同）')
    bad = errs or info['w'] or probs or not same
    sys.exit(1 if bad else 0)

asyncio.run(main())
