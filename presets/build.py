#!/usr/bin/env python3
"""Builds presets.js (the built-in recommendation filters) from src/*.txt.

Run after editing a list: python3 presets/build.py
Lines are "CC: Name/alias, Name, ..."; see the notes at the top of each src
file. Places and airlines from India and Australia are never filtered, and
neither is any name they share with another country.
"""
import json
import os
import re
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
KEEP_COUNTRIES = {'IN', 'AU'}

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
    return sorted(n for n, ccs in names.items() if not ccs & KEEP_COUNTRIES and n not in SKIP and n not in skip)


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
place_parts = filtered(parts)
keep_parts = sorted(n for n, ccs in parts.items() if ccs & KEEP_COUNTRIES)

airlines = [n for n in filtered(by_country(airlines_src)) if n not in set(places)]

# Each airline with its country and sub names, for the popup's exceptions
# picker: [country code, display name, "name name ..."]. Same names as above.
airline_items = []
with open(os.path.join(SRC, 'airlines.txt'), encoding='utf-8') as f:
    for line in f:
        line = line.split('#', 1)[0].strip()
        if not line:
            continue
        code, _, rest = line.partition(':')
        for entry in rest.split(','):
            names = [n for n in dict.fromkeys(slug(a) for a in entry.split('/')) if n in airlines]
            if names:
                airline_items.append([code.strip(), entry.split('/')[0].strip(), ' '.join(names)])

identity_names = sorted(identity_src.get(('names', ''), set()) - set(keep_parts))
# "ask" words can be short (r/askmen), so read them without the length limit.
identity_parts = sorted(read(os.path.join(SRC, 'identity.txt'), min_len=1).get(('ask', ''), set()))


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

# Indian and Australian places: shown in full in keep mode.
keep_places = set()
for src in (places_src, countries_src):
    for n, ccs in by_country(src).items():
        if ccs & KEEP_COUNTRIES:
            keep_places.add(n)

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
    f.write(f'  keepParts: {js_list(keep_parts)},\n')
    f.write(f'  partSkip: {js_list(sorted(part_skip))},\n')
    f.write(f'  airlines: {js_list(airlines)},\n')
    f.write('  airlineItems: [\n' + ',\n'.join('    ' + json.dumps(a) for a in airline_items) + '\n  ],\n')
    f.write(f'  identity: {js_list(identity_names)},\n')
    f.write(f'  identityParts: {js_list(identity_parts)},\n')
    f.write(f'  news: {js_list(news)},\n')
    f.write(f'  newsParts: {js_list(news_parts)},\n')
    f.write(f'  keepPlaces: {js_list(sorted(keep_places))},\n')
    f.write(f'  defaultTopics: {json.dumps(DEFAULT_TOPICS)},\n')
    f.write('  topics: [\n' + ',\n'.join('    ' + json.dumps(t) for t in topics) + '\n  ]\n')
    f.write('};\n')

print(f'{len(places)} places, {len(place_parts)} place parts, {len(keep_parts)} kept parts, '
      f'{len(airlines)} airlines, {len(identity_names)} identity subs, {len(identity_parts)} identity words, '
      f'{len(news)} news subs, {len(news_parts)} news words, {len(keep_places)} kept places, {len(topics)} topics')
