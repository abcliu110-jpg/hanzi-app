#!/usr/bin/env python3
"""逐句配音 → anim/<字>.timeline.json + .cache/anim/<字>/narr.wav

timeline 格式与试点相同：[{id, start, dur, cues:[{t, d, text, ct}]}]（毫秒）
  t  = 这句相对场景开头的起点；d = 这句时长；ct = 每个字相对句首的开始时间（TTS 有字边界时才有）
静音：场景前 600 ms、句间 380 ms、场景后 1900 ms（与试点一致）。

配音服务可替换：实现一个 Backend（synth(text, voice, rate, out_wav) -> (时长ms, 每字时间|None)），
在 BACKENDS 里登记，用 --engine 或环境变量 XZQ_TTS 选。edge-tts 只用于样片，不能商用。
用法：python3 tools/anim/tts.py 人 [--engine edge] [--force]
"""
import argparse, asyncio, hashlib, json, os, subprocess, wave
from common import ANIM, cache_dir, load_script, no_proxy_env

LEAD, GAP, TAIL = 600, 380, 1900
SR = 24000


def run(*a):
    subprocess.run(a, check=True)


def wav_ms(p):
    with wave.open(str(p)) as w:
        return w.getnframes() * 1000 / w.getframerate()


def char_times(text, bounds):
    """字边界 [(offset_ms, dur_ms, word)] → 每个字相对句首的开始时间；标点等没对上的字取前一个字的时间。"""
    ct = [None] * len(text)
    cur = 0
    for off, du, w in bounds:
        k = text.find(w, cur)
        if k < 0:
            continue
        for i in range(len(w)):
            ct[k + i] = round(off + du * i / len(w))
        cur = k + len(w)
    last = 0
    for i in range(len(ct)):
        if ct[i] is None:
            ct[i] = last
        last = ct[i]
    return ct


class EdgeTTS:
    """微软 edge-tts（非公开接口，无商用授权，仅样片用）"""
    name = 'edge'

    def synth(self, text, voice, rate, out_wav):
        import edge_tts
        for k in list(os.environ):
            if 'proxy' in k.lower():
                del os.environ[k]
        mp3 = str(out_wav)[:-4] + '.mp3'

        async def go():
            c = edge_tts.Communicate(text, voice, rate=rate, boundary='WordBoundary')
            bounds = []
            with open(mp3, 'wb') as f:
                async for ch in c.stream():
                    if ch['type'] == 'audio':
                        f.write(ch['data'])
                    elif ch['type'] == 'WordBoundary':
                        bounds.append((ch['offset'] / 1e4, ch['duration'] / 1e4, ch['text']))
            return bounds
        err = None
        for _ in range(3):
            try:
                bounds = asyncio.run(go()); break
            except Exception as e:  # 网络抖动重试
                err = e
        else:
            raise SystemExit(f'edge-tts 失败：{err}')
        run('ffmpeg', '-y', '-loglevel', 'error', '-i', mp3, '-ar', str(SR), '-ac', '1', str(out_wav))
        os.remove(mp3)
        return wav_ms(out_wav), (char_times(text, bounds) if bounds else None)


class AzureTTS:
    """占位：正式版换 Azure 语音（同一个晓晓声音，有商用授权）。需要 AZURE_SPEECH_KEY / AZURE_SPEECH_REGION。
    实现思路：REST /cognitiveservices/v1 取 riff-24khz-16bit-mono-pcm；字边界用 Speech SDK 的 word_boundary 事件。"""
    name = 'azure'

    def synth(self, text, voice, rate, out_wav):
        raise SystemExit('AzureTTS 还没实现：接入授权服务时补上这个类即可，timeline 格式不变')


BACKENDS = {'edge': EdgeTTS, 'azure': AzureTTS}


def silence(d, ms):
    p = d / f'sil{ms}.wav'
    if not p.exists():
        with wave.open(str(p), 'w') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes(b'\0\0' * int(SR * ms / 1000))
    return p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zi')
    ap.add_argument('--engine', default=os.environ.get('XZQ_TTS', 'edge'))
    ap.add_argument('--force', action='store_true', help='忽略缓存重新合成')
    a = ap.parse_args()
    sc = load_script(a.zi)
    be = BACKENDS[a.engine]()
    v = sc.get('voice') or {}
    voice, rate = v.get('name', 'zh-CN-XiaoxiaoNeural'), v.get('rate', '-6%')
    d = cache_dir(a.zi); td = d / 'tts'; td.mkdir(exist_ok=True)
    parts, tl, t = [], [], 0
    for s in sc['scenes']:
        st = t; cues = []
        parts.append(silence(td, LEAD)); t += LEAD
        lines = s.get('lines', [])
        for i, ln in enumerate(lines):
            txt = ln['text']
            if len(txt) > 25:
                print(f'  ! {s["id"]} 第{i}句超过 25 字：{txt}')
            h = hashlib.sha1(f'{be.name}|{voice}|{rate}|{txt}'.encode()).hexdigest()[:12]
            wav = td / f'{h}.wav'; meta = td / f'{h}.json'
            if a.force or not (wav.exists() and meta.exists()):
                ms, ct = be.synth(txt, voice, rate, wav)
                meta.write_text(json.dumps({'text': txt, 'ct': ct}, ensure_ascii=False))
            ms = wav_ms(wav); ct = json.loads(meta.read_text())['ct']
            cue = {'t': round(t - st), 'd': round(ms), 'text': txt}
            if ct:
                cue['ct'] = ct
            cues.append(cue); parts.append(wav); t += ms
            if i < len(lines) - 1:
                parts.append(silence(td, GAP)); t += GAP
        parts.append(silence(td, TAIL)); t += TAIL
        tl.append({'id': s['id'], 'start': round(st), 'dur': round(t - st), 'cues': cues})
    # 拼接（全是同格式 PCM，直接按帧拼，避免累计误差）
    out = d / 'narr.wav'
    with wave.open(str(out), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        for p in parts:
            with wave.open(str(p)) as r:
                w.writeframes(r.readframes(r.getnframes()))
    # 用实际帧数重算一遍时间，保证 timeline 与音频严格一致
    (ANIM / f'{a.zi}.timeline.json').write_text(json.dumps(tl, ensure_ascii=False, indent=1))
    print(f'{a.zi}: {round(t / 1000, 1)} s, {len(tl)} 段 → anim/{a.zi}.timeline.json, {out}')
    print('  ', [(x['id'], round(x['dur'] / 1000, 1)) for x in tl])


if __name__ == '__main__':
    main()
