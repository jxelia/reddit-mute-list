const $ = (id) => document.getElementById(id);

// The same page serves as the toolbar popup and the options tab. File pickers
// close the popup on some platforms, so restoring happens in the tab.
const isPopup = chrome.extension.getViews({ type: 'popup' }).includes(window);
document.body.classList.toggle('popup', isPopup);
// Reload the extension if its files changed (see background.js), so Reddit
// tabs don't keep running code older than this page.
try { chrome.runtime.sendMessage('rmute:checkBuild').catch(() => {}); } catch (_) { /* not loaded as an extension */ }

const PREFIX = { subs: 'r/', users: 'u/', popularWords: '', subWords: '', commentWords: '', recSubs: 'r/', recUsers: 'u/', keepSubs: 'r/', skipSubs: 'r/' };
const EMPTY_TEXT = {
  subs: 'No subreddits muted. Use “Mute r/…” in a post’s ⋯ menu on Reddit, or add names above.',
  users: 'No users muted. Use “Mute u/…” in a post’s ⋯ menu on Reddit, or add names above.',
  recSubs: 'No subreddits muted in recommendations. Use “Mute r/… in recommendations” in a recommended post’s ⋯ menu, or add names above.',
  recUsers: 'No users muted in recommendations.',
  keepSubs: 'No subreddits kept yet. Use Keep on a one-line recommended post on Reddit.'
};
// Said after "Unmuted r/name" when a list only applies in one place.
const WHERE = { recSubs: ' in recommendations', recUsers: ' in recommendations' };
const TEXT_HINT = {
  subs: 'One name per line. Links and r/ prefixes are fine. *cat* mutes every sub with “cat” in its name.',
  users: 'One name per line. Links and r/ or u/ prefixes are fine.',
  popularWords: 'One word or phrase per line. * matches any letters, as in spoil*.',
  subWords: 'One word or phrase per line. * matches any letters, as in spoil*.',
  commentWords: 'One word or phrase per line. * matches any letters, as in spoil*.',
  recSubs: 'One name per line. Links and r/ prefixes are fine. *cat* matches every sub with “cat” in its name.',
  recUsers: 'One name per line. Links and u/ prefixes are fine.',
  keepSubs: 'One name per line. Links and r/ prefixes are fine. *cat* keeps every sub with “cat” in its name.'
};
const ALL_KINDS = MuteStore.ALL_KINDS;
const FEEDS_KEY = 'feedSubs';
// Imported lists, for grouping only: [{file, subs, users}] (the names themselves are in the mute lists).
const IMPORTS_KEY = 'importGroups';
let imports = [];

let state = null;
let kind = 'subs'; // selected tab: subs, users, words or rec
let textKind = null; // list open in the text editor, if any

function setStatus(message, isError = false) {
  const status = $('status');
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function save(next) {
  try {
    await MuteStore.save(next);
    state = await MuteStore.load();
    render();
    return true;
  } catch (err) {
    setStatus(err.message, true);
    return false;
  }
}

// Splits pasted text on commas, whitespace or newlines; returns good and bad names.
function parseNames(text, k = kind) {
  const parts = text.split(/[\s,]+/).filter(Boolean);
  const good = [];
  const bad = [];
  for (const part of parts) {
    const name = MuteStore.isSubKind(k) ? MuteStore.normalizeSub(part) : MuteStore.normalize(part);
    (name ? good : bad).push(name || part);
  }
  return { good, bad };
}

// Words are shown in quotes; names with their r/ or u/ prefix.
function display(k, name) {
  return PREFIX[k] ? PREFIX[k] + name : `“${name}”`;
}

// Muted users show the subreddit they were muted from; the filter matches it too.
function makeRow(k, name) {
  const li = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = display(k, name);
  const note = k === 'users' ? MuteStore.subNoteFor(state, name) : null;
  if (note) {
    const from = document.createElement('span');
    from.className = 'from';
    from.textContent = ` · r/${note}`;
    from.title = `Muted from a post or comment in r/${note}`;
    label.append(from);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '×';
  const verb = k === 'keepSubs' ? 'Stop keeping' : k === 'skipSubs' ? 'Take off the Mute all whitelist:' : 'Unmute';
  remove.setAttribute('aria-label', `${verb} ${display(k, name)}`);
  remove.addEventListener('click', async () => {
    if (await save({ ...state, [k]: state[k].filter((n) => n !== name) })) {
      setStatus(k === 'keepSubs' ? `Stopped keeping ${display(k, name)}`
        : k === 'skipSubs' ? `${display(k, name)} will be in Mute all again`
        : `Unmuted ${display(k, name)}${WHERE[k] || ''}`);
    }
  });
  li.append(label, remove);
  return li;
}

// Names from an imported file are left out here and shown in its group (renderImports).
function renderList(k, list, empty, filter) {
  const noteOf = (name) => (k === 'users' ? MuteStore.subNoteFor(state, name) : null);
  const imported = new Set(KINDS_IMPORTED.includes(k) ? imports.flatMap((g) => g[k] || []) : []);
  const names = state[k].filter((n) => !imported.has(n) && (n.includes(filter) || noteOf(n)?.includes(filter)));
  list.replaceChildren(...names.map((name) => makeRow(k, name)));
  const own = state[k].filter((n) => !imported.has(n)).length;
  empty.hidden = names.length > 0 || (!own && state[k].length > 0);
  empty.textContent = own ? 'No matches.' : EMPTY_TEXT[k];
}

const KINDS_IMPORTED = ['subs', 'users'];

// The subs left out of the popup's Mute all with −, collapsed, above the imported groups.
function renderSkip(filter) {
  const all = kind === 'subs' ? state.skipSubs : [];
  $('skip-group').hidden = !all.length;
  if (!all.length) return;
  const names = all.filter((n) => n.includes(filter));
  if (filter && names.length) $('skip-group').open = true;
  $('count-skipSubs').textContent = all.length;
  $('skip-list').replaceChildren(...names.map((name) => makeRow('skipSubs', name)));
}

// One collapsed group per imported file, at the bottom of the Subreddits or Users tab.
function renderImports(k, filter) {
  const muted = new Set(state[k]);
  $('imports').replaceChildren(...imports.map((g) => {
    const all = (g[k] || []).filter((n) => muted.has(n));
    if (!all.length) return '';
    const names = all.filter((n) => n.includes(filter));
    const box = document.createElement('details');
    box.className = 'import-group';
    if (filter && names.length) box.open = true;
    const summary = document.createElement('summary');
    summary.textContent = `Imported from ${g.file} `;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = all.length;
    summary.append(count);
    const list = document.createElement('ul');
    list.className = 'list';
    list.append(...names.map((name) => makeRow(k, name)));
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'link';
    drop.textContent = `Unmute all ${all.length}`;
    drop.addEventListener('click', async () => {
      const gone = new Set(all);
      if (await save({ ...state, [k]: state[k].filter((n) => !gone.has(n)) })) {
        setStatus(`Unmuted ${all.length} ${k === 'subs' ? 'subreddits' : 'users'} imported from ${g.file}`);
      }
    });
    box.append(summary, list, drop);
    return box;
  }));
}

function render() {
  const REC_LISTS = [...MuteStore.REC_KINDS, ...MuteStore.KEEP_KINDS];
  for (const k of REC_LISTS) $('count-' + k).textContent = state[k].length;
  document.querySelectorAll('.tabs [role="tab"]').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.kind === kind));
  });
  $('list-view').hidden = !!textKind || kind === 'words' || kind === 'rec';
  $('words-view').hidden = !!textKind || kind !== 'words';
  $('rec-view').hidden = !!textKind || kind !== 'rec';
  $('text-view').hidden = !textKind;
  $('enabled').checked = state.settings.enabled !== false;
  document.body.classList.toggle('off', state.settings.enabled === false);
  $('enabled-label').textContent = state.settings.enabled === false ? 'Off' : 'On';
  $('hide-comments').checked = !!state.settings.hideComments;
  for (const [id, key] of PRESET_BOXES) $(id).checked = !!state.settings[key];
  $('keep-mode').checked = !!state.settings.keepMode;
  $('collapse-popular').checked = !!state.settings.collapsePopular;
  document.querySelectorAll('#keep-topics input').forEach((box) => {
    box.checked = (state.settings.keepTopics || []).includes(box.value);
  });

  if (kind === 'words') {
    const filter = $('word-filter').value.trim().toLowerCase();
    renderWords(filter);
    return;
  }
  if (kind === 'rec') {
    const filter = $('rec-filter').value.trim().toLowerCase().replace(/^[ru]\//, '');
    for (const k of REC_LISTS) renderList(k, $('list-' + k), $('empty-' + k), filter);
    return;
  }
  $('add-input').placeholder = kind === 'subs' ? 'r/name, *word*, or paste links' : 'u/name, or paste links';
  const filter = $('filter').value.trim().toLowerCase().replace(/^[ru]\//, '');
  renderList(kind, $('list'), $('empty'), filter);
  renderSkip(filter);
  renderImports(kind, filter);
}

/* ---------- Muted words table ---------- */

// Each word is one row: Comments (commentWords) and Title (popularWords and
// subWords together; half-ticked when it's in only one of them).
const TITLE_KINDS = ['popularWords', 'subWords'];

function allWords() {
  return [...new Set(MuteStore.WORD_KINDS.flatMap((k) => state[k]))].sort();
}

function wordBox(label, checked, indeterminate, onChange) {
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.indeterminate = indeterminate;
  box.setAttribute('aria-label', label);
  box.addEventListener('change', () => onChange(box.checked));
  return box;
}

// Adds or removes a word in some lists; a word left in no list is unmuted.
function setWord(word, kinds, on) {
  const next = { ...state };
  for (const k of kinds) next[k] = on ? [...state[k], word] : state[k].filter((w) => w !== word);
  return save(next);
}

function renderWords(filter) {
  const all = allWords();
  const words = all.filter((w) => w.includes(filter));
  $('count-words').textContent = all.length;
  $('list-words').replaceChildren(...words.map((word) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = display('commentWords', word);
    const inComments = state.commentWords.includes(word);
    const titleIn = TITLE_KINDS.filter((k) => state[k].includes(word));
    const comments = wordBox(`Mute ${label.textContent} in comments`, inComments, false, async (on) => {
      if (await setWord(word, ['commentWords'], on)) setStatus(`${on ? 'Muted' : 'Unmuted'} ${label.textContent} in comments`);
    });
    const title = wordBox(`Mute ${label.textContent} in post titles`, titleIn.length === 2, titleIn.length === 1, async (on) => {
      if (await setWord(word, TITLE_KINDS, on)) setStatus(`${on ? 'Muted' : 'Unmuted'} ${label.textContent} in post titles`);
    });
    if (titleIn.length === 1) title.title = titleIn[0] === 'popularWords' ? 'Only on r/popular' : 'Only on subreddit pages';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `Unmute ${label.textContent}`);
    remove.addEventListener('click', async () => {
      if (await setWord(word, MuteStore.WORD_KINDS, false)) setStatus(`Unmuted ${label.textContent}`);
    });
    li.append(label, comments, title, remove);
    return li;
  }));
  $('word-table').hidden = !words.length;
  $('empty-words').hidden = words.length > 0;
  $('empty-words').textContent = all.length ? 'No matches.' : 'No words muted.';
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ago(ms) {
  const mins = Math.round((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins / 60)} h ago`;
}

// content.js caches the user's custom feeds in local storage; say what it found.
async function renderFeeds() {
  const status = $('feeds-status');
  const feeds = (await chrome.storage.local.get(FEEDS_KEY))[FEEDS_KEY];
  if (!feeds) {
    status.textContent = 'Your custom feeds and joined subreddits are read the next time you open a subreddit on Reddit.';
    return;
  }
  const feedText = feeds.error
    ? `couldn’t read your custom feeds (${feeds.error})`
    : `${plural(feeds.subs.length, 'subreddit')} in ${plural(feeds.feeds.length, 'custom feed')}`;
  const joinedText = feeds.joinedError || !feeds.joined
    ? `couldn’t read your joined subreddits (${feeds.joinedError || 'not checked'})`
    : `${plural(feeds.joined.length, 'joined subreddit')}`;
  status.textContent = `Subreddit titles skip ${feedText} and ${joinedText}, checked ${ago(feeds.at)}. `;
  const recheck = document.createElement('button');
  recheck.type = 'button';
  recheck.className = 'link';
  recheck.textContent = 'Recheck';
  recheck.addEventListener('click', async () => {
    await chrome.storage.local.remove(FEEDS_KEY);
    setStatus('Custom feeds and joined subreddits will be reread on your next subreddit visit.');
  });
  status.append(recheck);
}

async function usage() {
  try {
    const bytes = await chrome.storage.sync.getBytesInUse(null);
    $('usage').textContent = `${(bytes / 1024).toFixed(1)} of 100 KB synced`;
  } catch (_) { /* not critical */ }
}

/* ---------- List view ---------- */

document.querySelectorAll('.tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind;
    textKind = null;
    render();
  });
});

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { good, bad } = parseNames($('add-input').value);
  if (!good.length && !bad.length) return;
  if (good.length && await save({ ...state, [kind]: [...state[kind], ...good] })) {
    $('add-input').value = bad.join(' ');
  }
  setStatus(bad.length
    ? `Not valid names: ${bad.join(', ')}`
    : `Muted ${good.map((n) => PREFIX[kind] + n).join(', ')}`, bad.length > 0);
});

$('filter').addEventListener('input', render);

/* ---------- Title words ---------- */

// Commas or new lines separate words, so phrases can contain spaces.
function parseWords(text, separator) {
  const good = [];
  const bad = [];
  for (const part of text.split(separator).map((p) => p.trim()).filter(Boolean)) {
    const word = MuteStore.normalizeWord(part);
    (word ? good : bad).push(word || part);
  }
  return { good, bad };
}

$('word-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const BOX = { commentWords: 'word-comments', popularWords: 'word-popular', subWords: 'word-subs' };
  const targets = MuteStore.WORD_KINDS.filter((k) => $(BOX[k]).checked);
  if (!targets.length) {
    setStatus('Tick comments, titles, or both.', true);
    return;
  }
  const { good, bad } = parseWords($('word-input').value, /[,\n]+/);
  if (!good.length && !bad.length) return;
  const next = { ...state };
  for (const k of targets) next[k] = [...state[k], ...good];
  if (good.length && await save(next)) $('word-input').value = bad.join(', ');
  const PLACE = { commentWords: 'comments', popularWords: 'r/popular titles', subWords: 'subreddit titles' };
  const where = targets.map((k) => PLACE[k]).join(', ').replace(/, ([^,]*)$/, ' and $1');
  setStatus(bad.length
    ? `Too short or long (2–100 characters): ${bad.join(', ')}`
    : `Muted ${good.map((w) => `“${w}”`).join(', ')} on ${where}`, bad.length > 0);
});

$('word-filter').addEventListener('input', render);

document.querySelectorAll('[data-edit]').forEach((button) => {
  button.addEventListener('click', () => openTextView(button.dataset.edit));
});

/* ---------- Recommendations ---------- */

// One box for both lists: u/ names and /user/ links are users, the rest subs.
const isUserRef = (part) => /^(?:https?:\/\/[^/]+)?\/?(?:u|user)\//i.test(part);

$('rec-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const parts = $('rec-input').value.split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return;
  const users = parseNames(parts.filter(isUserRef).join(' '), 'recUsers');
  const subs = parseNames(parts.filter((p) => !isUserRef(p)).join(' '), 'recSubs');
  const bad = [...subs.bad, ...users.bad];
  const added = [...subs.good.map((n) => 'r/' + n), ...users.good.map((n) => 'u/' + n)];
  if (added.length && await save({ ...state, recSubs: [...state.recSubs, ...subs.good], recUsers: [...state.recUsers, ...users.good] })) {
    $('rec-input').value = bad.join(' ');
  }
  setStatus(bad.length
    ? `Not valid names: ${bad.join(', ')}`
    : `Muted ${added.join(', ')} in recommendations`, bad.length > 0);
});

$('rec-filter').addEventListener('input', render);

// Built-in filters (presets/presets.js), on by default.
const PRESET_BOXES = [
  ['preset-places', 'presetPlaces'], ['preset-identity', 'presetIdentity'], ['preset-ask', 'presetAsk'],
  ['preset-news', 'presetNews'], ['preset-airlines', 'presetAirlines']
];
for (const [id, key] of PRESET_BOXES) {
  $(id).addEventListener('change', (e) => save({ ...state, settings: { ...state.settings, [key]: e.target.checked } }));
}
// Keep list: the mode and its topics (presets/src/topics.txt).
$('keep-mode').addEventListener('change', (e) => save({ ...state, settings: { ...state.settings, keepMode: e.target.checked } }));
$('collapse-popular').addEventListener('change', (e) => save({ ...state, settings: { ...state.settings, collapsePopular: e.target.checked } }));
// Off: Reddit tabs drop everything the extension adds; the lists stay as they are.
$('enabled').addEventListener('change', (e) => save({ ...state, settings: { ...state.settings, enabled: e.target.checked } }));
$('keep-topics').replaceChildren(...MutePresets.topics.map((t) => {
  const label = document.createElement('label');
  label.className = 'check';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.value = t.id;
  box.addEventListener('change', () => {
    const ids = [...document.querySelectorAll('#keep-topics input:checked')].map((b) => b.value);
    save({ ...state, settings: { ...state.settings, keepTopics: ids } });
  });
  label.append(box, ' ' + t.label);
  return label;
}));

const PRESET_LISTS = [
  ['Places', 'places', 'r/'], ['Also any name starting or ending with', 'placeParts', ''],
  ['Never filtered: names starting or ending with', 'keepParts', ''],
  ['Gender, nationality, ethnicity, religion', 'identity', 'r/'],
  ['Also r/ask…, r/ex…, r/true… followed by', 'identityParts', ''],
  ['News and politics', 'news', 'r/'], ['Also any name containing', 'newsParts', ''],
  ['Airlines', 'airlines', 'r/'], ['Not matched by the name parts above', 'partSkip', 'r/'],
  ['Indian and Australian places (shown in full in keep mode)', 'keepPlaces', 'r/']
];
$('preset-list').value = PRESET_LISTS
  .map(([title, key, prefix]) => [title + ':', ...MutePresets[key].split(' ').map((n) => prefix + n)].join('\n'))
  .join('\n\n');

/* ---------- Text view ---------- */

const SAVED_LABEL = {
  subs: 'subreddits', users: 'users', popularWords: 'words for r/popular titles', subWords: 'words for subreddit page titles', commentWords: 'words for comments',
  recSubs: 'subreddits for recommendations', recUsers: 'users for recommendations', keepSubs: 'kept subreddits'
};

function openTextView(k) {
  textKind = k;
  $('text-hint').textContent = TEXT_HINT[k];
  $('text').value = state[k].join('\n');
  render();
  $('text').focus();
}

function closeTextView() {
  textKind = null;
  render();
}

$('edit-text').addEventListener('click', () => openTextView(kind));
$('text-cancel').addEventListener('click', closeTextView);

$('text-save').addEventListener('click', async () => {
  const k = textKind;
  const { good, bad } = MuteStore.WORD_KINDS.includes(k)
    ? parseWords($('text').value, /\n+/)
    : parseNames($('text').value, k);
  if (bad.length) {
    setStatus(`Fix these first: ${bad.join(', ')}`, true);
    return;
  }
  if (await save({ ...state, [k]: good })) {
    closeTextView();
    setStatus(`Saved ${good.length} ${SAVED_LABEL[k]}`);
  }
});

/* ---------- Settings ---------- */

$('hide-comments').addEventListener('change', (e) => {
  save({ ...state, settings: { ...state.settings, hideComments: e.target.checked } });
});

/* ---------- Import & export ---------- */

$('import').addEventListener('click', () => {
  if (isPopup) {
    chrome.tabs.create({ url: chrome.runtime.getURL('manage/manage.html?import') });
    window.close();
    return;
  }
  $('import-file').click();
});

// Same parsing as the Recommended add box: u/ names and /user/ links are users, the rest subs.
$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const parts = (await file.text()).split(/[\s,]+/).filter(Boolean);
  const users = parseNames(parts.filter(isUserRef).join(' '), 'users');
  const subs = parseNames(parts.filter((p) => !isUserRef(p)).join(' '), 'subs');
  if (!subs.good.length && !users.good.length) {
    setStatus('No subreddit or user names found in that file.', true);
    return;
  }
  const group = { file: file.name, subs: [...new Set(subs.good)], users: [...new Set(users.good)] };
  imports = [...imports.filter((g) => g.file !== file.name), group];
  await chrome.storage.local.set({ [IMPORTS_KEY]: imports });
  if (await save({ ...state, subs: [...state.subs, ...group.subs], users: [...state.users, ...group.users] })) {
    const bad = [...subs.bad, ...users.bad];
    const n = (c, w) => `${c} ${w}${c === 1 ? '' : 's'}`;
    setStatus(`Imported ${n(group.subs.length, 'subreddit')} and ${n(group.users.length, 'user')} from ${file.name}`
      + (bad.length ? `. Skipped (not valid names): ${bad.join(', ')}` : ''), bad.length > 0);
  }
});

// A text file the import above reads back: r/ and u/ names, one per line.
$('export').addEventListener('click', () => {
  const text = [...state.subs.map((n) => 'r/' + n), ...state.users.map((n) => 'u/' + n)].join('\n') + '\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = `reddit-mute-list-${new Date().toLocaleDateString('sv')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus(`Exported ${state.subs.length} subreddits and ${state.users.length} users`);
});

/* ---------- Backup & restore ---------- */

$('backup').addEventListener('click', () => {
  const data = {
    app: 'reddit-mute-list',
    version: 7,
    exportedAt: new Date().toISOString(),
    subs: state.subs,
    users: state.users,
    popularWords: state.popularWords,
    subWords: state.subWords,
    commentWords: state.commentWords,
    recSubs: state.recSubs,
    recUsers: state.recUsers,
    keepSubs: state.keepSubs,
    skipSubs: state.skipSubs,
    userSubs: state.userSubs,
    settings: state.settings
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD in local time
  a.download = `reddit-mute-list-${today}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const words = allWords().length;
  const recs = state.recSubs.length + state.recUsers.length;
  setStatus(`Backed up ${state.subs.length} subreddits, ${state.users.length} users, ${words} words and ${recs} recommendation mutes`);
});

$('restore').addEventListener('click', () => {
  if (isPopup) {
    chrome.tabs.create({ url: chrome.runtime.getURL('manage/manage.html?restore') });
    window.close();
    return;
  }
  $('restore-panel').hidden = false;
});

$('restore-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (!Array.isArray(data.subs) || !Array.isArray(data.users)) throw new Error();
  } catch (_) {
    setStatus('That file isn’t a mute list backup.', true);
    return;
  }

  const replace = document.querySelector('input[name="restore-mode"]:checked').value === 'replace';
  // Version 1 backups have no word lists; 1-2 no recommendation lists; 1-3 no keep list; 1-4 no comment words; 1-5 no user subreddit notes; 1-6 no Mute all whitelist.
  const next = { settings: { ...state.settings, ...(data.settings || {}) } };
  for (const k of ALL_KINDS) {
    const restored = Array.isArray(data[k]) ? data[k] : [];
    next[k] = replace ? restored : [...state[k], ...restored];
  }
  if (await save(next)) {
    setStatus(`Restored. Now muting ${state.subs.length} subreddits and ${state.users.length} users.`);
  }
  e.target.value = '';
});

/* ---------- Mute all on this page (popup only) ---------- */

const activeTab = () => chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab);

let pageSubs = [];
let pageOrigin = 'https://www.reddit.com';
let pagePath = null;
// − puts a sub on the Mute all whitelist (skipSubs), which keeps it out of
// later lists; in this one it stays, crossed out, so − again can undo it.
const shownSkipped = new Set();
const isSkipped = (sub) => !!state?.skipSubs.includes(sub);
// The collected list is kept per tab in local storage, so it's still there
// when the popup is opened again (it closes when Chrome focuses something
// else) and after an extension reload (which clears session storage).
// Entries older than a day are dropped.
const PAGE_SUBS_MAX_AGE = 24 * 60 * 60 * 1000;
let pageKey = null;

function savePageSubs() {
  if (!pageKey) return;
  const entry = { at: Date.now(), path: pagePath, origin: pageOrigin, subs: pageSubs, open: $('page-subs-details').open };
  chrome.storage.local.set({ [pageKey]: entry }).catch(() => {});
}

// List entries can be patterns ("*cat*", "cat*", "*cat"), as in content.js.
function inList(list, name) {
  return list.some((entry) => {
    const s = entry.replace(/\*/g, '');
    if (entry.startsWith('*') && entry.endsWith('*')) return name.includes(s);
    if (entry.startsWith('*')) return name.endsWith(s);
    if (entry.endsWith('*')) return name.startsWith(s);
    return name === s;
  });
}

function renderPageSubList() {
  if (state) pageSubs = pageSubs.filter((s) => !inList(state.subs, s) && !inList(state.keepSubs, s) && (!isSkipped(s) || shownSkipped.has(s)));
  // After Mute all the card stays (with its "Muted N" line) and keeps collecting.
  $('page-subs').hidden = !pageSubs.length && $('page-subs-done').hidden;
  $('page-subs-mute').hidden = !pageSubs.length;
  const n = pageSubs.filter((s) => !isSkipped(s)).length;
  $('page-subs-text').textContent = pageSubs.length
    ? `${pageSubs.length} subreddit${pageSubs.length === 1 ? '' : 's'} on page`
    : 'No new subreddits yet';
  $('page-subs-list').replaceChildren(...pageSubs.map((sub, i) => {
    const out = isSkipped(sub);
    const li = document.createElement('li');
    li.classList.toggle('out', out);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '−';
    button.setAttribute('aria-pressed', out);
    button.title = out ? `Take r/${sub} off the Mute all whitelist` : `Leave r/${sub} out of Mute all from now on`;
    button.addEventListener('click', async () => {
      shownSkipped.add(sub);
      await save({ ...state, skipSubs: out ? state.skipSubs.filter((n) => n !== sub) : [...state.skipSubs, sub] });
      renderPageSubList();
      $('page-subs-list').children[i]?.querySelector('button').focus();
    });
    // Opens in a new tab next to this one and switches to it (the list is kept, see savePageSubs).
    const link = document.createElement('a');
    link.href = `${pageOrigin}/r/${sub}/`;
    link.textContent = 'r/' + sub;
    link.title = `Open r/${sub} in a new tab`;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      activeTab().then((tab) => chrome.tabs.create({ url: link.href, index: tab.index + 1, openerTabId: tab.id }));
    });
    li.append(link, button);
    return li;
  }));
  $('page-subs-mute').textContent = `Mute all ${n}`;
  $('page-subs-mute').disabled = !n;
  savePageSubs();
}

// The open Reddit tab (content.js) sends which subs its showing posts are
// from, and again whenever that changes. Other tabs never answer.
async function watchPageSubs() {
  const tab = await activeTab();
  if (!tab) return;
  pageKey = `pageSubs.${tab.id}`;
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => k.startsWith('pageSubs.') && !(Date.now() - all[k].at < PAGE_SUBS_MAX_AGE));
  if (stale.length) chrome.storage.local.remove(stale);
  const saved = stale.includes(pageKey) ? null : all[pageKey];
  if (saved?.subs.length) {
    ({ path: pagePath, origin: pageOrigin, subs: pageSubs } = saved);
    $('page-subs-details').open = saved.open;
    renderPageSubList();
  }
  const port = chrome.tabs.connect(tab.id, { name: 'rmute:pageSubs' });
  // The page isn't answering (its script is from before an extension
  // reload): the saved list still shows and mutes, but can't grow.
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    $('page-subs-hint').hidden = false;
  });
  // Subs are added as they turn up and kept, since the page's own list can
  // shrink while scrolling; only muting or keeping one takes it off.
  port.onMessage.addListener((res) => {
    if (res.path !== pagePath) { // another page in this tab: start over
      pageSubs = [];
    }
    pageOrigin = res.origin;
    pagePath = res.path;
    pageSubs = [...new Set([...pageSubs, ...res.subs])];
    renderPageSubList();
  });
}

$('page-subs-mute').addEventListener('click', async () => {
  // Left-out subs stay in the list; new ones keep coming in as the page scrolls.
  const subs = pageSubs.filter((s) => !isSkipped(s));
  pageSubs = pageSubs.filter(isSkipped);
  const muted = `Muted ${subs.length} subreddit${subs.length === 1 ? '' : 's'}.`;
  try {
    await chrome.tabs.sendMessage((await activeTab()).id, { type: 'rmute:mutePage', subs });
    $('page-subs-done').textContent = `${muted} Undo is on the Reddit page.`;
  } catch (_) {
    // The page didn't answer (e.g. its script is from before an extension
    // reload): save from here; the page hides them once it's refreshed.
    if (await save({ ...state, subs: [...state.subs, ...subs] })) $('page-subs-done').textContent = muted;
  }
  $('page-subs-done').hidden = false;
  renderPageSubList();
});

$('page-subs-details').addEventListener('toggle', savePageSubs);
if (isPopup) watchPageSubs();

/* ---------- Start ---------- */

MuteStore.onChange((list) => {
  state = list;
  render();
  usage();
  if (pageSubs.length) renderPageSubList();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && FEEDS_KEY in changes) renderFeeds();
  if (area === 'local' && IMPORTS_KEY in changes) {
    imports = changes[IMPORTS_KEY].newValue || [];
    if (state) render();
  }
});

Promise.all([MuteStore.load(), chrome.storage.local.get(IMPORTS_KEY)]).then(([list, stored]) => {
  imports = stored[IMPORTS_KEY] || [];
  state = list;
  render();
  usage();
  renderFeeds();
  if (new URLSearchParams(location.search).has('restore')) $('restore-panel').hidden = false;
  if (new URLSearchParams(location.search).has('import')) setStatus('Click “Import list…” to pick the file.');
});
