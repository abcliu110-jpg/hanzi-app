#!/usr/bin/env python3
"""回归：所有已有脚本在 v2 下能加载、每 400 ms 渲染一帧无报错；引擎警告与 v1 对比。
用法：python3 tools/anim2/test/allchars.py [字 …] [--anim-dir DIR]
  默认取 anim/ 下所有有 timeline 的字。--anim-dir 可指向别的工作目录里的 anim/（脚本正在制作时用）。
"""
import argparse, asyncio, json, os, subprocess, sys
from pathlib import Path
from playwright.async_api import async_playwright

A2 = Path(__file__).resolve().parents[1]
ROOT = A2.parents[1]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zi', nargs='*')
    ap.add_argument('--anim-dir', default=str(ROOT / 'anim'))
    a = ap.parse_args()
    ad = Path(a.anim_dir)
    zs = a.zi or sorted(p.name[:-len('.timeline.json')] for p in ad.glob('*.timeline.json') if (ad / (p.name[:-len('.timeline.json')] + '.json')).exists())
    out = ROOT / '.cache' / 'anim2' / '_all'
    subprocess.run(['node', str(A2 / 'build.mjs'), '--many', str(out), *zs], env={**os.environ, 'XZQ_ANIM_DIR': str(ad)}, check=True, stdout=subprocess.DEVNULL)
    bad = 0
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 960, 'height': 540})
        for z in zs:
            f = out / f'{z}.html'
            if not f.exists():
                print(f'✗ {z} 打包失败'); bad += 1; continue
            errs = []
            pg.remove_listener('pageerror', pg._xe) if hasattr(pg, '_xe') else None
            pg._xe = lambda e: errs.append(str(e))
            pg.on('pageerror', pg._xe)
            await pg.goto(f.as_uri() + '#cap')
            await pg.wait_for_function('window.XZQ_READY||window.XZQ_ERROR', timeout=30000)
            r = await pg.evaluate('''()=>{if(window.XZQ_ERROR)return {err:XZQ_ERROR};const T=XZQ.total;let n=0;
              for(let t=0;t<=T;t+=400){XZQ.render(t);n++} XZQ.render(T);
              const late=XZQ.report.filter(x=>x.late>300).length;
              return {w:XZQ.warnings,n,T,late}}''')
            if r.get('err') or errs:
                bad += 1; print(f'✗ {z}', r.get('err') or '', errs[:3]); continue
            print(f'{"✓" if not r["w"] else "!"} {z} {r["T"]/1000:.1f}s {r["n"]} 帧 警告{len(r["w"])} 顺延>0.3s:{r["late"]}' + (' | ' + ' / '.join(r['w'][:2]) if r['w'] else ''))
        await b.close()
    print(f'{len(zs)} 个字，失败 {bad}')
    sys.exit(1 if bad else 0)


asyncio.run(main())
