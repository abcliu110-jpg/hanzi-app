"""tools/anim 公共函数：路径、读字数据、笔画数据、页面打包、Playwright 打开页面。"""
import base64, json, os, re, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # 仓库根目录
ANIM = ROOT / 'anim'
ART = ANIM / 'art'
HZD = ANIM / 'hz'
CACHE = ROOT / '.cache' / 'anim'                      # 中间文件（配音分句、混音 wav），不进仓库
EXPORTS = ROOT / 'exports'                            # mp4 / 离线 HTML，不进仓库
HZ_CDN = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/'


def cache_dir(zi):
    d = CACHE / zi
    d.mkdir(parents=True, exist_ok=True)
    return d


def no_proxy_env():
    """edge-tts 用的 aiohttp 不接受带冒号用户名的代理变量，调用前去掉。"""
    return {k: v for k, v in os.environ.items() if 'proxy' not in k.lower()}


def load_char(zi):
    """从 data/zi-<批>.json 读一个字的数据，返回 (批号, 字数据)。"""
    idx_p = ROOT / 'char-index.json'
    grp = None
    if idx_p.exists():
        grp = json.loads(idx_p.read_text()).get(zi)
    files = [ROOT / 'data' / f'zi-{grp}.json'] if grp else sorted((ROOT / 'data').glob('zi-*.json'))
    for p in files:
        if not p.exists():
            continue
        d = json.loads(p.read_text())
        for c in d['chars']:
            if c['zi'] == zi:
                return d.get('group', grp), c
    raise SystemExit(f'数据里没有「{zi}」（查了 {len(files)} 个 data/zi-*.json）')


def load_script(zi):
    p = ANIM / f'{zi}.json'
    if not p.exists():
        raise SystemExit(f'没有 {p.relative_to(ROOT)}，先运行 draft.py {zi}')
    return json.loads(p.read_text())


def needs(script):
    art, chars = [], []
    for s in script['scenes']:
        for l in s.get('lines', []):
            for c in l.get('cues', []):
                if c.get('do') == 'draw' and c.get('art') and c['art'] not in art:
                    art.append(c['art'])
                if c.get('do') == 'write':
                    for ch in c.get('chars', ''):
                        if ch not in chars:
                            chars.append(ch)
    return art, chars


def get_hz(ch):
    """笔画数据：先看 anim/hz/<字>.json，没有就从 jsDelivr 下载并缓存（只留 strokes + medians）。"""
    p = HZD / f'{ch}.json'
    if p.exists():
        return json.loads(p.read_text())
    HZD.mkdir(parents=True, exist_ok=True)
    url = HZ_CDN + urllib.parse.quote(ch) + '.json'
    with urllib.request.urlopen(url, timeout=30) as r:
        d = json.loads(r.read())
    d = {'strokes': d['strokes'], 'medians': d['medians']}
    p.write_text(json.dumps(d, ensure_ascii=False, separators=(',', ':')))
    return d


def bundle(zi, audio=True, timeline=None):
    """把播放器需要的全部数据收成一个 dict（给离线 HTML 内嵌用）。"""
    sc = load_script(zi)
    tl_p = ANIM / f'{zi}.timeline.json'
    tl = timeline or json.loads(tl_p.read_text())
    art_names, chars = needs(sc)
    art = {}
    for a in art_names:
        p = ART / f'{a}.json'
        if not p.exists():
            raise SystemExit(f'缺少线稿 anim/art/{a}.json')
        art[a] = json.loads(p.read_text())
    hz = {ch: get_hz(ch) for ch in chars}
    hand = 'data:image/png;base64,' + base64.b64encode((ANIM / 'hand.png').read_bytes()).decode()
    d = {'script': sc, 'timeline': tl, 'art': art, 'hz': hz, 'hand': hand}
    mp3 = ANIM / f'{zi}.mp3'
    if audio and mp3.exists():
        d['audio'] = 'data:audio/mpeg;base64,' + base64.b64encode(mp3.read_bytes()).decode()
    return d


PAGE = '''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>字义动画 ·「__ZI__」</title>
<style>body{margin:0;background:#ECE9E3;display:flex;justify-content:center;padding:20px}.wrap{width:min(1120px,100%)}
body.cap{padding:0;background:#000}body.cap .wrap{width:100%}
__CSS__</style></head>
<body><div class="wrap"><div id="player"></div></div>
<script>window.XZQ_ANIM_DATA={};window.XZQ_ANIM_DATA[__ZIJ__]=__DATA__;</script>
<script>__JS__</script>
<script>
(function(){var cap=location.hash.indexOf('cap')>=0, rm=location.hash.indexOf('reduced')>=0?true:undefined;
if(cap)document.body.classList.add('cap');
XZQAnim.mount(document.getElementById('player'),__ZIJ__,{capture:cap,reducedMotion:cap&&rm===undefined?false:rm}).then(function(p){window.XZQ=p;window.render=p.render;window.XZQ_READY=true})
.catch(function(e){console.error(e);window.XZQ_ERROR=String(e)});})();
</script></body></html>'''


def build_page(zi, out, audio=True, timeline=None):
    d = bundle(zi, audio=audio, timeline=timeline)
    js = (ROOT / 'xzq-anim.js').read_text()
    css = (ROOT / 'xzq-anim.css').read_text()
    html = (PAGE.replace('__CSS__', css).replace('__JS__', js.replace('</script', '<\\/script'))
            .replace('__DATA__', json.dumps(d, ensure_ascii=False).replace('</', '<\\/'))
            .replace('__ZIJ__', json.dumps(zi, ensure_ascii=False)).replace('__ZI__', zi))
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html)
    return out


async def open_page(pw, path, hash='#cap', viewport=(1280, 720)):
    """用 Chromium 打开页面（capture 模式），返回 (browser, page, errors)。"""
    b = await pw.chromium.launch()
    pg = await b.new_page(viewport={'width': viewport[0], 'height': viewport[1]})
    errs = []
    pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    await pg.goto(Path(path).resolve().as_uri() + hash)
    await pg.wait_for_function('window.XZQ_READY||window.XZQ_ERROR', timeout=30000)
    err = await pg.evaluate('window.XZQ_ERROR||null')
    if err:
        raise SystemExit('页面出错：' + err)
    await pg.evaluate('document.fonts.ready')
    return b, pg, errs
