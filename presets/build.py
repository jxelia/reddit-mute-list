#!/usr/bin/env python3
"""Builds presets.js (the built-in recommendation filters) from src/*.txt.

Run after editing a list: python3 presets/build.py
Lines are "CC: Name/alias, Name, ..."; see the notes at the top of each src
file. Each filter's exceptions (countries, places, airlines, groups) are
picked in the popup; nothing is whitelisted here.
"""
import json
import os
import re
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')

# Subreddit names that also mean something else (a word, a brand, a show...),
# so a sub by that name may not be about the place or airline at all.
SKIP = set('''
nice reading bath mobile split orange phoenix victoria aurora buffalo
riverside providence concord savannah anchorage springfield columbia hamilton
flint bend midland hull derby highlands surprise corona eureka billings casper
auburn boulder logan fargo lincoln jackson mesa male normal triangle nova dmv
indy gta queens manhattan bayern olympia chico davenport chandler flagstaff
pueblo norman mesquite garland clearwater bowlinggreen siliconvalley windsor
regina stoke slough winchester bangor mayo cork tours angers dijon champagne
burgundy reunion nancy como marche perm essen kobe hue java fes muscat shiraz
para acre patagonia angeles scoot latam corsair ana pia
'''.split())


def slug(name):
    s = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]', '', s.lower())


def read(path, min_len=3):
    """Returns {(code, kind): {name: ...}} where kind is '' or 'parts'.

    Each line is "CODE[ kind]: entry, entry/alias, ...".
    """
    out = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.split('#', 1)[0].strip()
            if not line:
                continue
            head, _, rest = line.partition(':')
            code, _, kind = head.strip().partition(' ')
            names = out.setdefault((code, kind), set())
            for entry in rest.split(','):
                for alt in entry.split('/'):
                    s = slug(alt)
                    if len(s) >= min_len:
                        names.add(s)
    return out


def by_country(groups, kind=''):
    """{name: set of country codes} for one kind of line."""
    names = {}
    for (code, k), group in groups.items():
        if k == kind:
            for n in group:
                names.setdefault(n, set()).add(code)
    return names


def filtered(names, skip=()):
    return sorted(n for n, ccs in names.items() if n not in SKIP and n not in skip)


def items(path, valid, min_len=3):
    """[country code, display name, "name name ..."] per entry, for the
    popup's exceptions pickers. Only names in valid (the filter's own list)."""
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.split('#', 1)[0].strip()
            head, _, rest = line.partition(':')
            code, _, kind = head.strip().partition(' ')
            if not line or kind or code == 'SKIP':
                continue
            for entry in rest.split(','):
                names = [n for n in dict.fromkeys(slug(a) for a in entry.split('/')) if len(n) >= min_len and n in valid]
                if names:
                    out.append([code, entry.split('/')[0].strip(), ' '.join(names)])
    return out


def groups(path, word_kind):
    """[{id, label, names, words}] from "group ID: Label", "names ID: ..." and
    "<word_kind> ID: ..." lines."""
    out = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.split('#', 1)[0].strip()
            head, _, rest = line.partition(':')
            kind, _, gid = head.strip().partition(' ')
            if not line or not gid or kind not in ('group', 'names', word_kind):
                continue
            g = out.setdefault(gid, {'id': gid, 'label': gid, 'names': '', 'words': ''})
            if kind == 'group':
                g['label'] = rest.strip()
            else:
                g['names' if kind == 'names' else 'words'] = ' '.join(sorted({slug(w) for w in rest.split(',') if slug(w)}))
    return list(out.values())


places_src = read(os.path.join(SRC, 'places.txt'))
# Exact country subs can be two letters (r/de, r/nl, r/uk).
countries_src = read(os.path.join(SRC, 'countries.txt'), min_len=2)
airlines_src = read(os.path.join(SRC, 'airlines.txt'))
identity_src = read(os.path.join(SRC, 'identity.txt'))
news_src = read(os.path.join(SRC, 'news.txt'))

place_names = by_country(places_src)
for n, ccs in by_country(countries_src).items():
    place_names.setdefault(n, set()).update(ccs)
# The SKIP line is read as a country named SKIP: names that parts hit by
# accident. news.txt adds its own below.
part_skip = countries_src.get(('SKIP', ''), set())
place_names = {n: ccs - {'SKIP'} for n, ccs in place_names.items() if ccs - {'SKIP'}}
places = filtered(place_names)

parts = by_country(countries_src, 'parts')
# Too short to hide anything by (r/design, r/ozempic), though a ticked country
# still lets them through (country_parts below). Exact names still match.
RISKY_PARTS = {'oz', 'aus', 'desi', 'desis'}
place_parts = filtered(parts, RISKY_PARTS)
# {country code: "part part ..."}, so a ticked country lets r/ukpolitics through.
country_parts = {}
for n, ccs in parts.items():
    for cc in ccs:
        country_parts.setdefault(cc, []).append(n)
country_parts = {cc: ' '.join(sorted(ns)) for cc, ns in sorted(country_parts.items())}
place_items = items(os.path.join(SRC, 'places.txt'), set(places)) + items(os.path.join(SRC, 'countries.txt'), set(places), 2)

airlines = [n for n in filtered(by_country(airlines_src)) if n not in set(places)]

airline_items = items(os.path.join(SRC, 'airlines.txt'), set(airlines))

identity_names = sorted(set().union(*(ns for (k, _), ns in identity_src.items() if k == 'names')))
# "ask" words can be short (r/askmen), so read them without the length limit.
identity_parts = sorted(set().union(*(ns for (k, _), ns in read(os.path.join(SRC, 'identity.txt'), min_len=1).items() if k == 'ask')))
identity_groups = groups(os.path.join(SRC, 'identity.txt'), 'ask')
news_groups = groups(os.path.join(SRC, 'news.txt'), 'words')


# Topics for the keep list (src/topics.txt): ticked at first in the popup.
DEFAULT_TOPICS = ['tech', 'science', 'learning', 'money', 'health']
topics = []
with open(os.path.join(SRC, 'topics.txt'), encoding='utf-8') as f:
    for line in f:
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        head, _, rest = line.partition(':')
        tid, _, kind = head.strip().partition(' ')
        if not kind:
            topics.append({'id': tid, 'label': rest.strip(), 'words': [], 'names': []})
        else:
            topics[-1][kind] = sorted({slug(w) for w in rest.split(',') if slug(w)})
for t in topics:
    t['words'] = ' '.join(t['words'])
    t['names'] = ' '.join(t['names'])

news = sorted(news_src.get(('names', ''), set()))
news_parts = sorted(news_src.get(('parts', ''), set()))
part_skip |= news_src.get(('skip', ''), set())


def js_list(names):
    return "'" + ' '.join(names) + "'"


with open(os.path.join(HERE, 'presets.js'), 'w', encoding='utf-8') as f:
    f.write('// Generated by presets/build.py from presets/src/*.txt. Edit those and rerun.\n')
    f.write('// Space-separated subreddit names and name parts; content.js compiles them.\n')
    f.write('const MutePresets = {\n')
    f.write(f'  places: {js_list(places)},\n')
    f.write(f'  placeParts: {js_list(place_parts)},\n')
    f.write(f'  countryParts: {json.dumps(country_parts)},\n')
    f.write('  placeItems: [\n' + ',\n'.join('    ' + json.dumps(a) for a in place_items) + '\n  ],\n')
    f.write(f'  partSkip: {js_list(sorted(part_skip))},\n')
    f.write(f'  airlines: {js_list(airlines)},\n')
    f.write('  airlineItems: [\n' + ',\n'.join('    ' + json.dumps(a) for a in airline_items) + '\n  ],\n')
    f.write(f'  identity: {js_list(identity_names)},\n')
    f.write(f'  identityParts: {js_list(identity_parts)},\n')
    f.write('  identityGroups: [\n' + ',\n'.join('    ' + json.dumps(g) for g in identity_groups) + '\n  ],\n')
    f.write(f'  news: {js_list(news)},\n')
    f.write(f'  newsParts: {js_list(news_parts)},\n')
    f.write('  newsGroups: [\n' + ',\n'.join('    ' + json.dumps(g) for g in news_groups) + '\n  ],\n')
    f.write(f'  defaultTopics: {json.dumps(DEFAULT_TOPICS)},\n')
    f.write('  topics: [\n' + ',\n'.join('    ' + json.dumps(t) for t in topics) + '\n  ]\n')
    f.write('};\n')

print(f'{len(places)} places, {len(place_parts)} place parts, {len(place_items)} place entries, '
      f'{len(airlines)} airlines, {len(identity_names)} identity subs, {len(identity_parts)} identity words, '
      f'{len(news)} news subs, {len(news_parts)} news words, {len(identity_groups)} identity groups, {len(news_groups)} news groups, {len(topics)} topics')
