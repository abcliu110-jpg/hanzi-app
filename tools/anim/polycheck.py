#!/usr/bin/env python3
"""多音字读音核对：对每个句子，把目标字换成读音唯一的同音字（各候选读音各一个），
用同一 edge-tts 声音合成，比较原句和各替换句的 log-mel DTW 距离。最接近的候选 = edge-tts 实际读音。
另外用 faster-whisper small 转写原句做旁证。
清单 polychecks.json：[{zi, where, text, pos, len?, expect, cands:{读音: 同音字}, asr?}]，pos 是目标字在 text 里的下标。
用法：env -u HTTPS_PROXY -u HTTP_PROXY python3 tools/anim/polycheck.py [tools/anim/polychecks.json] [输出.json]
依赖：edge-tts numpy；asr 旁证要 faster-whisper（pip install faster-whisper，首次自动下载 small 模型）。
判读：读音相同时距离约 0.5–0.9，读音不同约 2.5 以上；全都远时说明不是任何候选读音（可用排除法）。"""
import asyncio, json, os, subprocess, sys, hashlib, wave
import numpy as np

for k in list(os.environ):
    if 'proxy' in k.lower():
        del os.environ[k]
import edge_tts

VOICE, RATE = 'zh-CN-XiaoxiaoNeural', '-6%'
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CD = os.path.join(ROOT, '.cache', 'polycheck'); os.makedirs(CD, exist_ok=True)


def synth(text):
    h = hashlib.sha1(f'{VOICE}|{RATE}|{text}'.encode()).hexdigest()[:12]
    wav = f'{CD}/{h}.wav'
    if not os.path.exists(wav):
        mp3 = wav[:-4] + '.mp3'
        async def go():
            await edge_tts.Communicate(text, VOICE, rate=RATE).save(mp3)
        for _ in range(3):
            try:
                asyncio.run(go()); break
            except Exception as e:
                err = e
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mp3, '-ar', '16000', '-ac', '1', wav], check=True)
    return wav


def load(wav):
    with wave.open(wav) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    return x


def mel_fb(sr=16000, n=512, m=40):
    f = lambda hz: 2595 * np.log10(1 + hz / 700)
    fi = lambda mm: 700 * (10 ** (mm / 2595) - 1)
    pts = fi(np.linspace(f(60), f(7600), m + 2))
    bins = np.floor((n + 1) * pts / sr).astype(int)
    fb = np.zeros((m, n // 2 + 1))
    for i in range(1, m + 1):
        a, b, c = bins[i - 1], bins[i], bins[i + 1]
        for k in range(a, b): fb[i - 1, k] = (k - a) / max(b - a, 1)
        for k in range(b, c): fb[i - 1, k] = (c - k) / max(c - b, 1)
    return fb
FB = mel_fb()


def feat(x):
    # 修剪首尾静音
    e = np.abs(x); idx = np.where(e > 0.01)[0]
    if len(idx): x = x[idx[0]:idx[-1] + 1]
    fr = [x[i:i + 400] * np.hanning(400) for i in range(0, len(x) - 400, 160)]
    S = np.abs(np.fft.rfft(np.array(fr), 512)) ** 2
    M = np.log(S @ FB.T + 1e-8)
    return M - M.mean(0)


def dtw(a, b):
    D = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(-1))
    n, m = D.shape; C = np.full((n + 1, m + 1), np.inf); C[0, 0] = 0
    for i in range(1, n + 1):
        Ci, Cp, Di = C[i], C[i - 1], D[i - 1]
        for j in range(1, m + 1):
            Ci[j] = Di[j - 1] + min(Cp[j], Ci[j - 1], Cp[j - 1])
    return C[n, m] / (n + m)


_wm = None
def asr(wav):
    global _wm
    from faster_whisper import WhisperModel
    if _wm is None:
        _wm = WhisperModel('small', device='cpu', compute_type='int8', download_root=os.path.join(ROOT, '.cache', 'whisper'))
    seg, _ = _wm.transcribe(load(wav), language='zh', beam_size=5)
    return ''.join(s.text for s in seg)


def main():
    checks = json.load(open(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'tools', 'anim', 'polychecks.json')))
    out = []
    for c in checks:
        text, pos, expect, cands = c['text'], c['pos'], c['expect'], c['cands']  # cands: {reading: char}
        assert 0 <= pos < len(text)
        fo = feat(load(synth(text)))
        ds = {}
        for rd, ch in cands.items():
            t2 = text[:pos] + ch + text[pos + c.get('len', 1):]
            ds[rd] = round(float(dtw(fo, feat(load(synth(t2))))), 3)
        best = min(ds, key=ds.get)
        r = {'zi': c['zi'], 'where': c.get('where'), 'text': text, 'target': text[pos] + f'@{pos}', 'expect': expect,
             'best': best, 'ok': best == expect if expect in cands else None, 'dist': ds}
        if c.get('asr'):
            r['asr'] = asr(synth(text))
        out.append(r)
        print(json.dumps(r, ensure_ascii=False), flush=True)
    json.dump(out, open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(CD, 'result.json'), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
