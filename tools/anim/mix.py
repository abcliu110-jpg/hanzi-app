#!/usr/bin/env python3
"""混音：配音 + 每笔马克笔沙沙声 + 转场翻页声 + 合成背景乐（配音时压低）→ −16 LUFS → anim/<字>.mp3

笔画时间从页面里取（用 Playwright 打开不带音频的预览页，读 XZQ.segs / XZQ.slides），
所以画面怎么改，笔声都跟着对上。音效和背景乐全部程序合成，没有版权问题（算法与试点 sfx.py 相同）。
用法：python3 tools/anim/mix.py 人 [--bitrate 96k]
输出：anim/<字>.mp3，以及 .cache/anim/<字>/mixn.wav（导出视频用）
"""
import argparse, asyncio, json, subprocess, wave
import numpy as np
from common import ANIM, cache_dir, build_page, open_page
from playwright.async_api import async_playwright

SR = 44100


async def get_segs(page):
    async with async_playwright() as p:
        b, pg, errs = await open_page(p, page)
        d = await pg.evaluate('({segs:XZQ.segs,slides:XZQ.slides,total:XZQ.total})')
        await b.close()
    return d


def rd(f):
    with wave.open(str(f)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768


def band(x, lo, hi):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR); X[(f < lo) | (f > hi)] = 0
    return np.fft.irfft(X, len(x))


def synth(v, d, seed=1):
    N = len(v); dur_s = N / SR
    rng = np.random.default_rng(seed)
    # 马克笔沙沙声：带通噪声 × 每笔的包络（带一点颤动）
    noise = band(rng.standard_normal(N), 1800, 7000); noise /= np.abs(noise).max()
    env = np.zeros(N)
    for st, du in d['segs']:
        a = int(st / 1000 * SR); b = min(N, int((st + du) / 1000 * SR)); L = b - a
        if L <= 0:
            continue
        t = np.arange(L) / SR; e = np.ones(L); fd = min(int(.02 * SR), L // 2)
        if fd > 0:
            e[:fd] = np.linspace(0, 1, fd); e[-fd:] = np.linspace(1, 0, fd)
        trem = .65 + .35 * np.sin(2 * np.pi * (9 + rng.random() * 6) * t + rng.random() * 6)
        env[a:b] = np.maximum(env[a:b], e * trem)
    scratch = noise * env * .07
    # 翻页声
    wh = np.zeros(N)
    for s in d['slides']:
        a = int(s / 1000 * SR); L = min(int(.6 * SR), N - a)
        if L <= 0:
            continue
        x = band(rng.standard_normal(L), 300, 3000); t = np.linspace(0, 1, L); x *= np.sin(np.pi * t) ** 2
        wh[a:a + L] += x / np.abs(x).max() * .09
    # 背景乐：84 BPM，C–G–Am–F 拨弦 + 柔和铺底
    beat = 60 / 84; mus = np.zeros(N)
    note = lambda m: 440 * 2 ** ((m - 69) / 12)
    prog = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]

    def pluck(fq, L):
        t = np.arange(L) / SR
        return (np.sin(2 * np.pi * fq * t) + .3 * np.sin(4 * np.pi * fq * t) + .1 * np.sin(6 * np.pi * fq * t)) * np.exp(-t * 3.5)
    bar = 0; t0 = 0.0
    while t0 < dur_s:
        ch = prog[bar % 4]; pat = [0, 1, 2, 1, 12, 2, 1, 2]
        for k, pi in enumerate(pat):
            m = ch[pi % 3] + 12 + (12 if pi >= 12 else 0); a = int((t0 + k * beat / 2) * SR); L = int(1.4 * SR)
            if a >= N:
                break
            s = pluck(note(m), L) * (.5 if k % 2 else .7); e = min(N, a + L); mus[a:e] += s[:e - a]
        a = int(t0 * SR); L = int(4 * beat * SR); t = np.arange(L) / SR
        pad = sum(np.sin(2 * np.pi * note(m - 12) * t) for m in ch) / 3
        pad *= np.minimum(1, t / .8) * np.minimum(1, (L / SR - t) / .8) * .35
        if a < N:
            e = min(N, a + L); mus[a:e] += pad[:e - a]
        t0 += 4 * beat; bar += 1
    mus /= np.abs(mus).max()
    # 配音响时压低背景乐（约 −9 dB）
    ve = np.abs(v); k = int(.25 * SR); ve = np.convolve(ve, np.ones(k) / k, 'same')
    duck = np.clip(ve / (ve.max() * .15), 0, 1)
    gain = .11 - .07 * duck
    fade = np.ones(N); fo = min(N, int(2.5 * SR)); fade[-fo:] = np.linspace(1, 0, fo); fi = int(1 * SR); fade[:fi] = np.linspace(0, 1, fi)
    mix = v + scratch + wh + mus * gain * fade
    return mix / max(1, np.abs(mix).max() / .95)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zi')
    ap.add_argument('--bitrate', default='96k')
    a = ap.parse_args()
    d = cache_dir(a.zi)
    narr = d / 'narr.wav'
    if not narr.exists():
        raise SystemExit('没有配音，先运行 tts.py ' + a.zi)
    page = build_page(a.zi, d / 'nosound.html', audio=False)
    info = asyncio.run(get_segs(page))
    n44 = d / 'narr44.wav'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(narr), '-ar', str(SR), '-ac', '1', str(n44)], check=True)
    v = rd(n44)
    N = int(SR * info['total'] / 1000)
    vv = np.zeros(N); vv[:min(N, len(v))] = v[:N]
    mix = synth(vv, info)
    raw = d / 'mix.wav'
    with wave.open(str(raw), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
    out = d / 'mixn.wav'
    # 两遍 loudnorm：先测量，再线性校正到 −16 LUFS / −1.5 dBTP
    comp = d / 'mixc.wav'   # 轻压缩，削掉配音的尖峰，让 −16 LUFS 和 −1.5 dBTP 能同时满足
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(raw), '-af', 'acompressor=threshold=-20dB:ratio=3:attack=5:release=120:makeup=2', str(comp)], check=True)
    raw = comp
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(raw), '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
                       capture_output=True, text=True).stderr
    m = json.loads(r[r.rfind('{'):r.rfind('}') + 1])
    af = (f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(raw), '-af', af, '-ar', str(SR), str(out)], check=True)
    mp3 = ANIM / f'{a.zi}.mp3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(out), '-c:a', 'libmp3lame', '-b:a', a.bitrate, str(mp3)], check=True)
    r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(mp3), '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    summ = r[r.rfind('Summary:'):].split()
    lufs = summ[summ.index('I:') + 1] if 'I:' in summ else '?'
    peak = summ[summ.index('Peak:') + 1] if 'Peak:' in summ else '?'
    print(f'{a.zi}: {len(info["segs"])} 笔, {len(info["slides"])} 次转场, {info["total"] / 1000:.1f}s → anim/{a.zi}.mp3 '
          f'({mp3.stat().st_size // 1024} KB, {lufs} LUFS, 峰值 {peak} dBTP)')


if __name__ == '__main__':
    main()
