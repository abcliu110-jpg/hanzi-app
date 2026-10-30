#!/usr/bin/env python3
"""导出视频：逐帧调用 render(t) 截图（Playwright，多页并行）+ ffmpeg 合成 mp4。

帧先写到 /tmp（工作区的 JuiceFS 写大文件报过 I/O 错误），视频也先写 /tmp 再复制到 exports/<字>.mp4。
可断点续跑：已有的帧会跳过；--budget 秒数用完就先退出（退出码 3），再跑一次接着来。
用法：python3 tools/anim/export.py 人 [--fps 25] [--size 1280x720] [--workers 4] [--budget 100] [--clean]
"""
import argparse, asyncio, json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from common import EXPORTS, cache_dir, build_page, open_page
from playwright.async_api import async_playwright


async def render_frames(page, frames, fdir, size, workers, deadline):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        done = 0

        async def worker(chunk):
            nonlocal done
            pg = await b.new_page(viewport={'width': size[0], 'height': size[1]})
            await pg.goto(Path(page).resolve().as_uri() + '#cap')
            await pg.wait_for_function('window.XZQ_READY', timeout=30000)
            await pg.evaluate('document.fonts.ready')
            el = await pg.query_selector('#player .xzq-stage')
            for f, t in chunk:
                if time.time() > deadline:
                    break
                await pg.evaluate(f'XZQ.render({t})')
                tmp = fdir / f'.{f:05d}.jpg'
                await el.screenshot(path=str(tmp), type='jpeg', quality=90)
                tmp.rename(fdir / f'{f:05d}.jpg'); done += 1
            await pg.close()
        chunks = [frames[i::workers] for i in range(workers)]
        await asyncio.gather(*(worker(c) for c in chunks if c))
        await b.close()
        return done


async def total_ms(page):
    async with async_playwright() as p:
        b, pg, errs = await open_page(p, page)
        t = await pg.evaluate('XZQ.total')
        await b.close()
        return t, errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zi')
    ap.add_argument('--fps', type=int, default=25)
    ap.add_argument('--size', default='1280x720')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--budget', type=float, default=100, help='本次最多跑多少秒（0 = 不限）')
    ap.add_argument('--clean', action='store_true', help='删掉旧帧重新来')
    ap.add_argument('-o')
    a = ap.parse_args()
    size = tuple(int(x) for x in a.size.split('x'))
    d = cache_dir(a.zi)
    audio = d / 'mixn.wav'
    if not audio.exists():
        raise SystemExit('没有混音，先运行 mix.py ' + a.zi)
    tag = f'{a.zi}-{a.size}-{a.fps}'
    fdir = Path(tempfile.gettempdir()) / 'xzq-frames' / tag
    page = d / 'export.html'
    stamp = fdir / 'source.json'
    src = {'script': (d.parent.parent.parent / 'anim' / f'{a.zi}.json').stat().st_mtime,
           'timeline': (d.parent.parent.parent / 'anim' / f'{a.zi}.timeline.json').stat().st_mtime,
           'engine': (d.parent.parent.parent / 'xzq-anim.js').stat().st_mtime}
    if a.clean or (stamp.exists() and json.loads(stamp.read_text()) != src):
        shutil.rmtree(fdir, ignore_errors=True)
    fdir.mkdir(parents=True, exist_ok=True)
    if not page.exists() or not stamp.exists():
        build_page(a.zi, page, audio=False)
        stamp.write_text(json.dumps(src))
    T, errs = asyncio.run(total_ms(page))
    if errs:
        print('页面报错：', errs)
    n = int(T / 1000 * a.fps) + 1
    todo = [(f, min(f * 1000 / a.fps, T)) for f in range(n) if not (fdir / f'{f:05d}.jpg').exists()]
    t0 = time.time(); deadline = t0 + a.budget if a.budget else float('inf')
    if todo:
        done = asyncio.run(render_frames(page, todo, fdir, size, a.workers, deadline))
        left = len(todo) - done
        print(f'帧：本次 {done}，剩 {left} / {n}（{time.time() - t0:.0f}s）')
        if left:
            print('时间用完，再运行一次接着导出'); sys.exit(3)
    tmp = Path(tempfile.gettempdir()) / f'xzq-{tag}.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(a.fps), '-i', str(fdir / '%05d.jpg'), '-i', str(audio),
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
                    '-movflags', '+faststart', '-shortest', str(tmp)], check=True)
    out = Path(a.o) if a.o else EXPORTS / f'{a.zi}.mp4'
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(tmp, out)
    print(out, out.stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    main()
