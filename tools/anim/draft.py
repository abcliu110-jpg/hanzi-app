#!/usr/bin/env python3
"""从仓库数据 data/zi-<批>.json 生成动画脚本初稿 anim/<字>.json。

规则（设计文档 3.1 / 3.2 / 4.2）：
  - 开场类型：本义可信度为 待查/未标注 → C（不讲字源）；否则有 假借 义项 → B；否则 → A。
  - 可信度：确定 正常讲；通行说法 角落加小字「通行说法」；待查/未标注 不讲字源，角落「字源还没有定论」。
  - 场景模板按义项 type：本义 / 引申 / 比喻 / 转喻 / 假借。
  - 配音每句 ≤25 字（超了会自动断句；断不开的写进 todo）。
初稿只是起点：线稿按关键字简单匹配，需要人工改文案、配 cue。
用法：python3 tools/anim/draft.py 人 [--force] [--print]
       python3 tools/anim/draft.py --classify 人 大 不 的   # 只打印分类
"""
import argparse, json, re, sys
from common import ANIM, ART, load_char

try:
    from pypinyin import pinyin, Style
except ImportError:  # 没装 pypinyin 就不写词语拼音
    pinyin = None

MAXLEN = 25
DOUBT = ('待查', '', None, '未标注')
# 关键字 → 线稿（初稿用，按出现先后取第一个）
ART_HINTS = [('张开', 'person-open'), ('的人', 'person'), ('眼', 'eye'), ('目', 'eye'), ('看', 'eye'), ('头', 'head'), ('脸', 'head'), ('手', 'hand'), ('心', 'heart'),
             ('太阳', 'sun'), ('日', 'sun'), ('月', 'moon'), ('山', 'mountain'), ('水', 'water'), ('河', 'water'),
             ('树', 'tree'), ('木', 'tree'), ('苗', 'sprout'), ('草', 'sprout'), ('生长', 'sprout'), ('房', 'house'), ('家', 'house'),
             ('门', 'door'), ('路', 'road'), ('走', 'road'), ('书', 'book'), ('学', 'book'), ('桌', 'desk'), ('田', 'field'),
             ('地', 'ground'), ('上', 'arrow-up'), ('下', 'arrow-down'), ('前', 'arrow-right'), ('工', 'worker'),
             ('张开', 'person-open'), ('人', 'person')]


def classify(c):
    oc = (c.get('origin') or {}).get('conf')
    types = [s.get('type') for s in c.get('senses', [])]
    if oc in DOUBT:
        return 'C'
    return 'B' if '假借' in types else 'A'


def py_of(word):
    if not pinyin:
        return None
    return '  '.join(x[0] for x in pinyin(word, style=Style.TONE))


def clean(t):
    t = (t or '').strip()
    t = re.sub(r'\s+', '', t)
    return t


def split_lines(text, n=MAXLEN):
    """按标点断成 ≤n 字的句子；尽量在 ，。；！？ 处断。"""
    text = clean(text)
    if not text:
        return []
    parts = re.findall(r'[^，。；！？、]*[，。；！？、]?', text)
    parts = [p for p in parts if p]
    out, cur = [], ''
    for p in parts:
        if len(cur) + len(p) <= n:
            cur += p
        else:
            if cur:
                out.append(cur)
            while len(p) > n:
                out.append(p[:n]); p = p[n:]
            cur = p
    if cur:
        out.append(cur)
    # 句尾逗号改句号，读起来更自然
    return [re.sub(r'[，、；]$', '。', s) for s in out]


def guess_art(*texts):
    t = ''.join(texts)
    for k, a in ART_HINTS:
        if k in t and (ART / f'{a}.json').exists():
            return a
    return None


def short_label(name, words):
    name = re.sub(r'（.*?）|\(.*?\)', '', name or '')
    if words:
        return words[0][:4]
    return re.split(r'[、，,]', name)[0][:4] or '义项'


def sense_scene(zi, c, s, idx):
    typ = s.get('type') or '引申'
    words = [w for w in s.get('words', []) if w]
    w0 = words[0] if words else zi
    why = clean(s.get('why'))
    ex = clean((s.get('example') or {}).get('text'))
    todo = []
    lines = []
    if typ == '假借':
        lines.append({'text': f'“{zi}”的声音被借来，表示{clean(s.get("name"))}。'[:MAXLEN], 'cues': [
            {'at': 0, 'do': 'draw', 'art': 'speaker', 'slot': 'L', 'scale': .8},
            {'at': '借来', 'do': 'label', 'text': '借声音', 'x': 450, 'y': 700, 'color': 'orange', 'size': 50}]})
    else:
        body = why or f'“{zi}”还可以表示{clean(s.get("name"))}。'
        for i, t in enumerate(split_lines(body)):
            lines.append({'text': t, 'cues': []})
        a = guess_art(why, ex, s.get('name', ''), w0)
        if lines:
            if a:
                lines[0]['cues'].append({'at': 0, 'do': 'draw', 'art': a, 'slot': 'L'})
            else:
                todo.append('选一张线稿画在 L 区（库里没有合适的就新画一张）')
    if ex:
        for t in split_lines(ex):
            lines.append({'text': t, 'cues': []})
    if not lines:
        lines = [{'text': f'“{w0}”里的“{zi}”。', 'cues': []}]
    # 关键词出现在哪句，就在那句写
    host = next((l for l in lines if w0 in l['text']), lines[-1])
    host['cues'].append({'at': w0 if w0 in host['text'] else 0, 'do': 'write', 'chars': w0, 'slot': 'R1'})
    p = py_of(w0)
    if p:
        host['cues'].append({'at': (w0 + '+1.2s') if w0 in host['text'] else 1.2, 'do': 'label', 'text': p, 'slot': 'R2'})
    if len(words) > 1:
        lines[-1]['cues'].append({'at': 'end-0.8s', 'do': 'label', 'text': ' · '.join(words[:3]), 'slot': 'R3'})
    if s.get('conf') == '通行说法':
        lines[0]['cues'].append({'at': 0, 'do': 'note', 'text': '通行说法'})
    if s.get('conf') in DOUBT and typ != '本义':
        todo.append('这个义项的来历是“待查”，配音里不要讲“为什么”，只讲用法')
    if typ == '比喻':
        todo.append('比喻模板：左旧物、右新物，中间写“像”')
    if typ == '转喻':
        todo.append('转喻模板：局部放大代表整体')
    for l in lines:
        if len(l['text']) > MAXLEN:
            todo.append(f'这句超过 {MAXLEN} 字：{l["text"]}')
    sc = {'id': s.get('id') or f's{idx}', 'kind': 'sense', 'sense': s.get('id') or f's{idx}', 'type': typ,
          'label': short_label(s.get('name'), words), 'word': w0, 'lines': lines}
    if todo:
        sc['todo'] = todo
    return sc


def draft(zi):
    grp, c = load_char(zi)
    track = classify(c)
    o = c.get('origin') or {}
    senses = c.get('senses', [])
    scenes = []
    intro = {'id': 'intro', 'kind': 'intro', 'label': '字形', 'lines': [
        {'text': f'这是“{zi}”字。', 'cues': [{'at': 0, 'do': 'grid', 'slot': 'C'}, {'at': 0, 'do': 'write', 'chars': zi, 'slot': 'C'}]}]}
    if track == 'C':
        common = next((s for s in senses if s.get('type') != '本义'), senses[0] if senses else None)
        nm = clean(common.get('name')) if common else ''
        intro['lines'].append({'text': f'它最常用的意思是：{nm}。'[:MAXLEN], 'cues': [{'at': 0, 'do': 'note', 'text': '字源还没有定论'}]})
    else:
        why = clean(o.get('why'))
        for t in split_lines(why):
            intro['lines'].append({'text': t, 'cues': []})
        if o.get('conf') == '通行说法':
            intro['lines'][-1]['cues'].append({'at': 0, 'do': 'note', 'text': '通行说法'})
        intro['todo'] = ['开场改成孩子听得懂的话；有老写法就画在右侧 R 区并圈出部件']
    scenes.append(intro)
    for i, s in enumerate(senses):
        if s.get('type') == '本义':
            if track == 'C':
                continue  # 字源待查：不讲本义来历
            nm = clean(re.sub(r'（.*?）', '', s.get('name') or o.get('name') or zi))
            a = guess_art(o.get('why', ''), nm)
            sc = {'id': 'h0', 'kind': 'sense', 'sense': s.get('id') or '0', 'type': '本义', 'label': '本义', 'word': zi,
                  'lines': [{'text': f'最早，“{zi}”的意思就是{nm}。'[:MAXLEN], 'cues': ([{'at': 0, 'do': 'draw', 'art': a, 'slot': 'L'}] if a else []) +
                             [{'at': 'end-0.6s', 'do': 'write', 'chars': zi, 'slot': 'R1'}, {'at': 'end+0.8s', 'do': 'label', 'text': c.get('py', ''), 'slot': 'R2'}]}]}
            if s.get('conf') == '通行说法' or o.get('conf') == '通行说法':
                sc['lines'][0]['cues'].append({'at': 0, 'do': 'note', 'text': '通行说法'})
            scenes.append(sc)
        else:
            scenes.append(sense_scene(zi, c, s, i))
    nodes = [s['sense'] for s in scenes if s.get('kind') == 'sense' and s.get('type') != '本义']
    scenes.append({'id': 'recap', 'kind': 'recap', 'label': '回顾', 'lines': [
        {'text': f'你看，一个“{zi}”字，', 'cues': []}, {'text': '长出了这么多意思。', 'cues': []}]})
    return {'zi': zi, 'version': 1, 'group': grp, 'track': track, 'status': 'draft',
            'voice': {'name': 'zh-CN-XiaoxiaoNeural', 'rate': '-6%'},
            'source': {'origin_conf': o.get('conf') or '未标注', 'senses': len(senses)},
            'scenes': scenes, 'recap': {'center': zi, 'nodes': nodes}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('chars', nargs='+')
    ap.add_argument('--force', action='store_true', help='覆盖已有的 anim/<字>.json')
    ap.add_argument('--print', action='store_true', help='只打印，不写文件')
    ap.add_argument('--classify', action='store_true', help='只打印 A/B/C 分类')
    a = ap.parse_args()
    for zi in a.chars:
        if a.classify:
            g, c = load_char(zi)
            print(zi, classify(c), (c.get('origin') or {}).get('conf'), [s.get('type') for s in c.get('senses', [])])
            continue
        d = draft(zi)
        js = json.dumps(d, ensure_ascii=False, indent=1)
        if a.print:
            print(js); continue
        p = ANIM / f'{zi}.json'
        if p.exists() and not a.force:
            print(f'{p.name} 已存在（人工改过的稿子不覆盖），用 --force 覆盖；初稿写到 {zi}.draft.json')
            p = ANIM / f'{zi}.draft.json'
        p.write_text(js)
        n = sum(len(s.get('todo', [])) for s in d['scenes'])
        print(f'{p.relative_to(ANIM.parent)}  track={d["track"]}  scenes={len(d["scenes"])}  todo={n}')


if __name__ == '__main__':
    main()
