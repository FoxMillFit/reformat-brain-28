#!/usr/bin/env python3
"""Parse the 28 lessons from 'BRAM Discipline Always Fails - Mary Agnes' Google Doc
into structured JSON for the Reformat Your Brain in 28 Days app."""
import json, re, sys

SRC = '/tmp/book_fresh4.json'
OUT = '/home/hatch/workspace/reformat-brain-app/content/lessons.json'

with open(SRC) as f:
    doc = json.load(f)

raw_paras = []
for el in doc['body']['content']:
    p = el.get('paragraph')
    if p:
        text = ''.join(pe.get('textRun', {}).get('content', '') for pe in p.get('elements', []))
        text = text.replace('\u000b', '').strip()
        raw_paras.append(text)

MARKER = re.compile(r'^\**\s*[Cc][Hh]\s*(\d+)\s*-\s*(\d+)\.*$')
TA_HEAD = re.compile(r'^\s*take action now\s*:?\s*$', re.I)
SCRATCH = re.compile(r'^\{.*\}\s*$')
EDIT_NOTE = re.compile(r'^(combine|merge)\b.*:\s*$', re.I)
TODO_NOTE = re.compile(r'^(add|move|delete|fix|remove|insert|todo|note)\b[^.!?]*$', re.I)
CHAPTER_HEAD = re.compile(r'^\s*chapter\s+\d+\s*:', re.I)
BLANK_LINE = re.compile(r'^[_\s]{3,}$')
HAS_BLANK = re.compile(r'_{3,}')
ORDERED = re.compile(r'^(\d+)\.\s+(.*)$')
TERMINAL = re.compile(r'[.!?:]$')

# Manual title overrides for lessons whose title line is an editing note
TITLE_OVERRIDES = {
    (4, 5): 'Begin with the end in mind',
}

def is_scratch(t):
    return bool(SCRATCH.match(t)) or bool(EDIT_NOTE.match(t)) or bool(TODO_NOTE.match(t))

def join_lines(lines):
    """Group raw lines into blocks: paragraphs, bullet lists, ordered lists."""
    blocks = []
    buf = []          # paragraph buffer
    ulist = []        # unordered list buffer
    olist = []        # ordered list buffer

    def flush_para():
        if buf:
            blocks.append({'type': 'p', 'text': ' '.join(buf).strip()})
            buf.clear()

    def flush_ul():
        if ulist:
            blocks.append({'type': 'ul', 'items': ulist.copy()})
            ulist.clear()

    def flush_ol():
        if olist:
            blocks.append({'type': 'ol', 'items': olist.copy()})
            olist.clear()

    def flush_lists():
        flush_ul(); flush_ol()

    for line in lines:
        if not line or is_scratch(line):
            continue
        m = ORDERED.match(line)
        if m and len(line) < 220:
            # ordered list item
            flush_para(); flush_ul()
            olist.append(m.group(2).strip())
            continue
        flush_ol()
        if TERMINAL.search(line):
            buf.append(line)
            flush_para(); flush_ul()
        elif len(line) < 55:
            # short fragment without terminal punctuation -> list item
            flush_para()
            ulist.append(line)
        else:
            flush_ul()
            buf.append(line)
    flush_para(); flush_lists()
    return blocks

def parse_ta(lines):
    """Parse Take Action Now lines into items with fields."""
    items = []
    # first join wrapped lines (but keep blank-only lines separate)
    joined = []
    buf = []
    for line in lines:
        if not line or is_scratch(line):
            continue
        if BLANK_LINE.match(line):
            if buf:
                joined.append(' '.join(buf).strip()); buf = []
            joined.append('__BLANK__')
            continue
        if TERMINAL.search(line) or len(line) < 55:
            buf.append(line)
            joined.append(' '.join(buf).strip()); buf = []
        else:
            buf.append(line)
    if buf:
        joined.append(' '.join(buf).strip())

    current = None
    i = 0
    while i < len(joined):
        j = joined[i]
        if j == '__BLANK__':
            # stray blank line: attach a text field to the last item
            if not items:
                items.append({'instruction': '', 'fields': []})
            items[-1]['fields'].append({'label': '', 'type': 'text'})
            i += 1
            continue
        if HAS_BLANK.search(j):
            # fill-in-the-blank: keep the whole sentence as the label
            label = re.sub(r'_+', '_____', j)
            label = re.sub(r'\s+', ' ', label).strip()
            items.append({'instruction': '', 'fields': [{'label': label, 'type': 'text'}]})
            i += 1
            continue
        # instruction line: if followed only by blank lines, those blanks are its fields
        k = i + 1
        blanks = 0
        while k < len(joined) and joined[k] == '__BLANK__':
            blanks += 1
            k += 1
        if blanks:
            fields = [{'label': f'Entry {b + 1}', 'type': 'text'} for b in range(blanks)]
            items.append({'instruction': j, 'fields': fields})
            i = k
        else:
            items.append({'instruction': j, 'fields': [{'label': '', 'type': 'textarea'}]})
            i += 1
    return items

# locate lesson markers
markers = []
for i, t in enumerate(raw_paras):
    m = MARKER.match(t)
    if m:
        markers.append((int(m.group(1)), int(m.group(2)), i))
markers.sort()

lessons = []
warnings = []
day = 0
for idx, (ch, n, start) in enumerate(markers):
    end = markers[idx + 1][2] if idx + 1 < len(markers) else len(raw_paras)
    # also stop at the next chapter heading (structural, not content)
    for k in range(start + 1, end):
        if CHAPTER_HEAD.match(raw_paras[k]):
            end = k
            break
    seg = raw_paras[start + 1:end]

    # title: first non-empty, non-scratch line (with manual overrides)
    title = TITLE_OVERRIDES.get((ch, n, ), '')
    ti = 0
    if not title:
        for k, t in enumerate(seg):
            if t and not is_scratch(t):
                title, ti = t, k
                break
    # find TA header
    ta_at = None
    for k in range(ti + 1, len(seg)):
        if TA_HEAD.match(seg[k]):
            ta_at = k
            break
    body_lines = seg[ti + 1:ta_at] if ta_at else seg[ti + 1:]
    ta_lines = seg[ta_at + 1:] if ta_at else []

    body = join_lines(body_lines)
    ta = parse_ta(ta_lines)

    # warnings
    scratch_inside = [t for t in seg if is_scratch(t)]
    if scratch_inside:
        warnings.append(f"Ch {ch}-{n}: skipped scratch note(s): {scratch_inside[0][:60]}")
    if not ta:
        warnings.append(f"Ch {ch}-{n}: NO Take Action Now section")
    if not body:
        warnings.append(f"Ch {ch}-{n}: empty body")

    day += 1
    lessons.append({
        'day': day,
        'chapter': ch,
        'lesson': n,
        'code': f'Ch {ch}-{n}',
        'title': title,
        'body': body,
        'ta': ta,
    })

out = {'lessons': lessons}
with open(OUT, 'w') as f:
    json.dump(out, f, indent=1, ensure_ascii=False)

print(f"Parsed {len(lessons)} lessons -> {OUT}")
print(f"\nWarnings ({len(warnings)}):")
for w in warnings:
    print("  -", w)
# summary of TA field counts
print("\nTA items per lesson:")
for L in lessons:
    nf = sum(len(i['fields']) for i in L['ta'])
    print(f"  Day {L['day']:2d} Ch {L['chapter']}-{L['lesson']}: {len(L['ta'])} TA items, {nf} fields | {L['title'][:50]}")
