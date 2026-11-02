const $ = (id) => document.getElementById(id);

// The same page serves as the toolbar popup and the options tab. File pickers
// close the popup on some platforms, so restoring happens in the tab.
const isPopup = chrome.extension.getViews({ type: 'popup' }).includes(window);
document.body.classList.toggle('popup', isPopup);
// Reload the extension if its files changed (see background.js), so Reddit
// tabs don't keep running code older than this page.
try { chrome.runtime.sendMessage('rmute:checkBuild').catch(() => {}); } catch (_) { /* not loaded as an extension */ }

const PREFIX = { subs: 'r/', users: 'u/', popularWords: '', subWords: '', commentWords: '', bodyWords: '', flairWords: '', recSubs: 'r/', recUsers: 'u/', keepSubs: 'r/', skipSubs: 'r/' };
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
  users: 'One name per line. Links and u/ prefixes are fine. *bot* mutes every user with “bot” in their name.',
  popularWords: 'One word or phrase per line. * matches any letters, as in spoil*.',
  subWords: 'One word or phrase per line. * matches any letters, as in spoil*.',
  commentWords: 'One word or phrase per line. * matches any letters, as in spoil*.',
  bodyWords: 'One word or phrase per line. * matches any letters, as in spoil*.',
  flairWords: 'One word or phrase per line. * matches any letters, as in spoil*.',
  recSubs: 'One name per line. Links and r/ prefixes are fine. *cat* matches every sub with “cat” in its name.',
  recUsers: 'One name per line. Links and u/ prefixes are fine. *bot* matches every user with “bot” in their name.',
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

// undo: adds an Undo button after the message.
function setStatus(message, isError = false, undo = null) {
  const status = $('status');
  status.textContent = message;
  status.classList.toggle('error', isError);
  if (!undo) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'link';
  button.textContent = 'Undo';
  button.addEventListener('click', async () => {
    button.remove();
    if (await undo()) setStatus('Undone');
  });
  status.append(' ', button);
}

// Puts removed names back where they were in each list, with their scope and
// subreddit notes. before: the state they were removed from.
function restoreNames(kinds, names, before) {
  const next = { ...state };
  for (const k of kinds) {
    const list = [...next[k]];
    for (const name of names) {
      const i = before[k].indexOf(name);
      if (i >= 0 && !list.includes(name)) list.splice(Math.min(i, list.length), 0, name);
    }
    next[k] = list;
  }
  const mine = (entry) => names.some((n) => entry.split('\t')[1] === n || entry.startsWith(n + ':'));
  for (const k of ['scopes', 'userSubs']) next[k] = [...next[k], ...before[k].filter((e) => mine(e) && !next[k].includes(e))];
  // Named word lists: their entries from before, in place of any shrunk copy.
  const lists = before.wordGroups.filter((e) => e.split('\t').slice(1).some((w) => names.includes(w)));
  const listNames = new Set(lists.map((e) => e.split('\t')[0]));
  next.wordGroups = [...next.wordGroups.filter((e) => !listNames.has(e.split('\t')[0])), ...lists];
  return save(next);
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
    const name = MuteStore.isSubKind(k) ? MuteStore.normalizeSub(part)
      : MuteStore.isUserKind(k) ? MuteStore.normalizeUser(part) : MuteStore.normalize(part);
    (name ? good : bad).push(name || part);
  }
  return { good, bad };
}

// Words are shown in quotes; names with their r/ or u/ prefix.
function display(k, name) {
  return PREFIX[k] ? PREFIX[k] + name : `“${name}”`;
}

/* ---------- Scope (where a word or user applies) ---------- */

function scopeText(scope) {
  if (!scope) return 'everywhere';
  const subs = scope.subs.map((s) => 'r/' + s).join(', ');
  return scope.mode === '+' ? `only in ${subs}` : `everywhere except ${subs}`;
}

// A word or user's name is a button that opens the scope editor under its
// row; a scope that's set shows under the name.
function nameCell(type, name, text, extra) {
  const scope = MuteStore.scopeOf(state, type, name);
  const cell = document.createElement('div');
  cell.className = 'name-cell';
  // Scopes are an extra: without them the name is plain text.
  if (!extras()) {
    const label = document.createElement('span');
    label.append(text);
    if (extra) label.append(extra);
    cell.append(label);
    return cell;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'name-btn';
  button.textContent = text;
  button.title = 'Choose the subreddits this applies in';
  const toggle = () => {
    const row = cell.closest('li');
    if (row.nextElementSibling?.classList.contains('scope-edit')) row.nextElementSibling.remove();
    else row.after(scopeEditor(type, name, scope));
  };
  button.addEventListener('click', toggle);
  const label = document.createElement('span');
  label.append(button);
  if (extra) label.append(extra);
  cell.append(label);
  if (scope) {
    const set = document.createElement('button');
    set.type = 'button';
    set.className = 'link scope set';
    set.textContent = scopeText(scope);
    set.addEventListener('click', toggle);
    cell.append(set);
  }
  return cell;
}

function scopeEditor(type, name, scope) {
  const li = document.createElement('li');
  li.className = 'scope-edit';
  const mode = document.createElement('select');
  mode.setAttribute('aria-label', 'Where it applies');
  for (const [value, text] of [['', 'Everywhere'], ['-', 'Everywhere except'], ['+', 'Only in']]) mode.add(new Option(text, value));
  mode.value = scope?.mode || '';
  const subs = document.createElement('input');
  subs.type = 'text';
  subs.placeholder = 'r/name, r/other';
  subs.setAttribute('aria-label', 'Subreddits');
  subs.value = scope ? scope.subs.map((s) => 'r/' + s).join(', ') : '';
  subs.hidden = !mode.value;
  mode.addEventListener('change', () => {
    subs.hidden = !mode.value;
    if (!subs.hidden) subs.focus();
  });
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = 'Save';
  const apply = async () => {
    const { good, bad } = parseNames(mode.value ? subs.value : '', 'subs');
    const names = good.filter((n) => !n.includes('*'));
    if (bad.length || names.length < good.length) return setStatus(`Not valid subreddit names: ${[...bad, ...good.filter((n) => n.includes('*'))].join(', ')}`, true);
    if (mode.value && !names.length) return setStatus('Add at least one subreddit.', true);
    const what = type === 'w' ? `“${name}”` : `u/${name}`;
    const next = MuteStore.withScope(state, type, name, mode.value, mode.value ? names : null);
    if (await save(next)) setStatus(`${what} now applies ${scopeText(MuteStore.scopeOf(next, type, name))}`);
  };
  ok.addEventListener('click', apply);
  subs.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
  li.append(mode, subs, ok);
  return li;
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
    const before = state;
    if (await save({ ...state, [k]: state[k].filter((n) => n !== name) })) {
      setStatus(k === 'keepSubs' ? `Stopped keeping ${display(k, name)}`
        : k === 'skipSubs' ? `${display(k, name)} will be in Mute all again`
        : `Unmuted ${display(k, name)}${WHERE[k] || ''}`, false, () => restoreNames([k], [name], before));
    }
  });
  if (k === 'users') {
    li.append(nameCell('u', name, display(k, name), label.querySelector('.from')), remove);
  } else {
    li.append(label, remove);
  }
  return li;
}

/* ---------- Sort ---------- */

// A–Z, Z–A, or by date added: lists keep the order names were added in
// (entries from before that were stored A–Z).
const SORT_KEY = 'listSort';
let sortOrder = 'az';

// age(name): higher = added later.
function sortNames(names, age) {
  const byName = (a, b) => a.localeCompare(b);
  const list = [...names];
  const order = extras() ? sortOrder : 'az'; // sorting is an extra
  if (order === 'za') return list.sort((a, b) => byName(b, a));
  if (order === 'new') return list.sort((a, b) => age(b) - age(a) || byName(a, b));
  if (order === 'old') return list.sort((a, b) => age(a) - age(b) || byName(a, b));
  return list.sort(byName);
}

document.querySelectorAll('select.sort').forEach((select) => {
  select.addEventListener('change', () => {
    sortOrder = select.value;
    chrome.storage.local.set({ [SORT_KEY]: sortOrder });
    render();
  });
});

// Names from an imported file are left out here and shown in its group (renderImports).
function renderList(k, list, empty, filter) {
  const noteOf = (name) => (k === 'users' ? MuteStore.subNoteFor(state, name) : null);
  const imported = new Set(KINDS_IMPORTED.includes(k) ? imports.flatMap((g) => g[k] || []) : []);
  const names = sortNames(state[k].filter((n) => !imported.has(n) && (n.includes(filter) || noteOf(n)?.includes(filter))), (n) => state[k].indexOf(n));
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
      const before = state;
      if (await save({ ...state, [k]: state[k].filter((n) => !gone.has(n)) })) {
        setStatus(`Unmuted ${all.length} ${k === 'subs' ? 'subreddits' : 'users'} imported from ${g.file}`, false, () => restoreNames([k], all, before));
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
  document.body.classList.toggle('extras', extras());
  $('extras').checked = extras();
  document.body.classList.toggle('extras-x', !!state.settings.extrasX);
  $('extras-x').checked = !!state.settings.extrasX;
  $('hide-seen').checked = !!state.settings.hideSeen;
  $('hide-duplicates').checked = !!state.settings.hideDuplicates;
  $('max-age').value = String(Number(state.settings.maxAgeHours) || 0);
  $('hide-crossposts').checked = !!state.settings.hideCrossposts;
  $('enabled-switch').title = state.settings.enabled === false ? 'Off on Reddit. Click to turn on.' : 'On on Reddit. Click to turn off.';
  $('hide-comments').checked = !!state.settings.hideComments;
  $('default-feed').value = state.settings.defaultFeed || 'last';
  $('hide-avatars').checked = !!state.settings.hideCommentAvatars;
  $('comment-names').value = state.settings.commentNames || 'show';
  $('hide-sections').checked = !!state.settings.hideCommentSections;
  $('comment-action').value = state.settings.commentAction || 'bar';
  $('comment-show-word').checked = state.settings.commentShowWord !== false;
  $('comment-hide-replies').checked = !!state.settings.commentHideReplies;
  renderSummary();
  $('show-counter').checked = !!state.settings.showCounter;
  if (document.activeElement !== $('min-score')) $('min-score').value = Number(state.settings.minScore) || 0;
  $('word-action').value = state.settings.wordAction || 'hide';
  document.querySelectorAll('select.sort').forEach((select) => { select.value = sortOrder; });
  applyTheme(state.settings.theme);
  for (const [id, key] of PRESET_BOXES) $(id).checked = !!state.settings[key];
  $('keep-mode').checked = !!state.settings.keepMode;
  $('collapse-popular').checked = !!state.settings.collapsePopular;
  EXCEPTIONS.forEach(renderException);
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
  $('add-input').placeholder = kind === 'subs' ? 'r/name, word, or paste links' : 'u/name, *bot*, or paste links';
  const filter = $('filter').value.trim().toLowerCase().replace(/^[ru]\//, '');
  renderList(kind, $('list'), $('empty'), filter);
  // The list starts collapsed; filtering opens it.
  const imported = new Set(imports.flatMap((g) => g[kind] || []));
  $('main-label').textContent = kind === 'subs' ? 'Muted subreddits' : 'Muted users';
  $('count-main').textContent = state[kind].filter((n) => !imported.has(n)).length;
  $('main-group').firstElementChild.title = $('main-group').firstElementChild.ariaLabel = `${$('main-label').textContent} ${$('count-main').textContent}`;
  if (filter) $('main-group').open = true;
  renderSkip(filter);
  renderImports(kind, filter);
}

/* ---------- Muted words table ---------- */

// Each word is one row: Comments (commentWords), Title (popularWords and
// subWords together; half-ticked when it's in only one of them), Text
// (bodyWords) and Flair (flairWords).
const TITLE_KINDS = ['popularWords', 'subWords'];

function allWords() {
  return [...new Set(MuteStore.WORD_KINDS.flatMap((k) => state[k]))].sort();
}

// How recently a word was added: new words go at the end of their lists.
function wordAge(word) {
  const fromEnd = MuteStore.WORD_KINDS
    .map((k) => state[k].indexOf(word))
    .map((i, j) => (i < 0 ? Infinity : state[MuteStore.WORD_KINDS[j]].length - i));
  return -Math.min(...fromEnd);
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

// The popup's "Extra features" switch (MuteStore.effective says what it changes on the page).
const extras = () => !!state.settings.extras;
const EXTRA_WORDS = ['bodyWords', 'flairWords'];

function wordRow(word) {
  const li = document.createElement('li');
  const label = document.createElement('span');
  label.textContent = display('commentWords', word);
  const cell = nameCell('w', word, label.textContent);
  const inComments = state.commentWords.includes(word);
  const titleIn = TITLE_KINDS.filter((k) => state[k].includes(word));
  const comments = wordBox(`Mute ${label.textContent} in comments`, inComments, false, async (on) => {
    if (await setWord(word, ['commentWords'], on)) setStatus(`${on ? 'Muted' : 'Unmuted'} ${label.textContent} in comments`);
  });
  const title = wordBox(`Mute ${label.textContent} in post titles`, titleIn.length === 2, titleIn.length === 1, async (on) => {
    if (await setWord(word, TITLE_KINDS, on)) setStatus(`${on ? 'Muted' : 'Unmuted'} ${label.textContent} in post titles`);
  });
  if (titleIn.length === 1) title.title = titleIn[0] === 'popularWords' ? 'Only on r/popular' : 'Only on subreddit pages';
  const body = wordBox(`Mute ${label.textContent} in post text`, state.bodyWords.includes(word), false, async (on) => {
    if (await setWord(word, ['bodyWords'], on)) setStatus(`${on ? 'Muted' : 'Unmuted'} ${label.textContent} in post text`);
  });
  const flair = wordBox(`Mute ${label.textContent} in post flair`, state.flairWords.includes(word), false, async (on) => {
    if (await setWord(word, ['flairWords'], on)) setStatus(`${on ? 'Muted' : 'Unmuted'} ${label.textContent} in flair`);
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'remove';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Unmute ${label.textContent}`);
  remove.addEventListener('click', async () => {
    const before = state;
    if (await setWord(word, MuteStore.WORD_KINDS, false)) {
      setStatus(`Unmuted ${label.textContent}`, false, () => restoreNames(MuteStore.WORD_KINDS, [word], before));
    }
  });
  li.append(cell, comments, title, body, flair, remove);
  return li;
}

// Words in a named list are shown in that list's group, not the main table.
function renderWords(filter) {
  const all = allWords();
  // Without extras, list groups aren't shown, so all words are in the table.
  const grouped = new Set(extras() ? groups().flatMap((g) => g.words) : []);
  const words = sortNames(all.filter((w) => !grouped.has(w) && w.includes(filter)), wordAge);
  $('count-words').textContent = all.length;
  $('list-words').replaceChildren(...words.map(wordRow));
  $('word-table').hidden = !words.length;
  const shown = words.length || [...grouped].some((w) => w.includes(filter));
  $('empty-words').hidden = !!shown;
  $('empty-words').textContent = all.length ? 'No matches.' : 'No words muted.';
  renderGroups(filter);
  renderSuggested();
}

/* ---------- Named word lists ---------- */

// wordGroups entries ("Name<TAB>word<TAB>…") as { name, words }.
const groups = () => state.wordGroups.map((e) => {
  const [name, ...words] = e.split('\t');
  return { name, words };
});

// The places ticked under the Mute box, where new words go.
const WORD_BOX = { commentWords: 'word-comments', popularWords: 'word-popular', subWords: 'word-subs', bodyWords: 'word-body', flairWords: 'word-flair' };
const tickedKinds = () => MuteStore.WORD_KINDS.filter((k) => $(WORD_BOX[k]).checked && (extras() || !EXTRA_WORDS.includes(k)));

// Adds (or adds to) a named list; its new words go to the ticked places.
async function addList(name, words, removed = []) {
  const targets = tickedKinds();
  if (!targets.length) return setStatus('Tick at least one place to mute in.', true), false;
  const next = { ...state };
  const known = new Set(allWords());
  for (const k of MuteStore.WORD_KINDS) {
    next[k] = state[k].filter((w) => !removed.includes(w));
    if (targets.includes(k)) next[k].push(...words.filter((w) => !known.has(w)));
  }
  const old = groups().find((g) => g.name.toLowerCase() === name.toLowerCase());
  const merged = [...new Set([...(old?.words || []).filter((w) => !removed.includes(w)), ...words])];
  next.wordGroups = [...state.wordGroups.filter((e) => e !== (old && [old.name, ...old.words].join('\t'))), [name, ...merged].join('\t')];
  return save(next);
}

// "Name: word, word" (as Share copies it) or just words.
function parseShared(text) {
  const m = text.match(/^\s*([^:\n,]{1,40}):\s*([\s\S]*)$/);
  return m ? { name: m[1].trim(), text: m[2] } : { name: '', text };
}

function renderGroups(filter) {
  $('word-groups').replaceChildren(...groups().map((g) => {
    const words = g.words.filter((w) => w.includes(filter));
    if (filter && !words.length && !g.name.toLowerCase().includes(filter)) return '';
    const box = document.createElement('details');
    box.className = 'import-group';
    if (filter && words.length) box.open = true;
    const summary = document.createElement('summary');
    summary.textContent = g.name + ' ';
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = g.words.length;
    summary.append(count);
    const table = document.createElement('div');
    table.className = 'word-table';
    table.append($('word-table').querySelector('.word-head').cloneNode(true));
    table.querySelector('.count')?.remove();
    const list = document.createElement('ul');
    list.className = 'list';
    list.append(...sortNames(filter ? words : g.words, wordAge).map(wordRow));
    table.append(list);
    const actions = document.createElement('div');
    actions.className = 'group-actions';
    const button = (text, run) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link';
      b.textContent = text;
      b.addEventListener('click', run);
      actions.append(b);
    };
    button('Edit', () => box.replaceChildren(summary, groupEditor(g)));
    button('Share', async () => {
      const text = `${g.name}: ${g.words.join(', ')}`;
      try {
        await navigator.clipboard.writeText(text);
        setStatus(`Copied “${g.name}”. Paste it into “New list” to add it, here or in another browser.`);
      } catch (_) {
        setStatus(text);
      }
    });
    button(`Unmute all ${g.words.length}`, async () => {
      const before = state;
      const gone = new Set(g.words);
      const next = { ...state };
      for (const k of MuteStore.WORD_KINDS) next[k] = state[k].filter((w) => !gone.has(w));
      if (await save(next)) setStatus(`Unmuted the list “${g.name}”`, false, () => restoreNames(MuteStore.WORD_KINDS, g.words, before));
    });
    box.append(summary, table, actions);
    return box;
  }));
}

function groupEditor(g) {
  const wrap = document.createElement('div');
  wrap.className = 'group-edit';
  const name = document.createElement('input');
  name.type = 'text';
  name.value = g.name;
  name.maxLength = 40;
  name.setAttribute('aria-label', 'List name');
  const words = document.createElement('textarea');
  words.className = 'list-words';
  words.value = g.words.join('\n');
  words.setAttribute('aria-label', 'Words in the list');
  const row = document.createElement('div');
  row.className = 'row';
  const ok = document.createElement('button');
  ok.type = 'button';
  ok.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', render);
  ok.addEventListener('click', async () => {
    const { good, bad } = parseWords(words.value, /[,\n]+/);
    if (bad.length) return setStatus(`Too short or long (2–100 characters): ${bad.join(', ')}`, true);
    const newName = name.value.replace(/\s+/g, ' ').trim() || g.name;
    const removed = g.words.filter((w) => !good.includes(w));
    // The old entry goes first, so a rename isn't merged into the old list.
    state = { ...state, wordGroups: state.wordGroups.filter((e) => e.split('\t')[0] !== g.name) };
    if (await addList(newName, good, removed)) setStatus(`Saved the list “${newName}”`);
  });
  row.append(ok, cancel);
  wrap.append(name, words, row);
  return wrap;
}

$('list-add').addEventListener('click', async () => {
  const shared = parseShared($('list-words').value);
  const name = $('list-name').value.replace(/\s+/g, ' ').trim() || shared.name;
  if (!name) return setStatus('Give the list a name.', true);
  const { good, bad } = parseWords(shared.text, /[,\n]+/);
  if (!good.length) return setStatus('Add some words to the list.', true);
  if (await addList(name, good)) {
    $('list-name').value = '';
    $('list-words').value = bad.join(', ');
    $('new-list').open = false;
    setStatus(`Added the list “${name}” (${plural(good.length, 'word')})` + (bad.length ? `. Skipped: ${bad.join(', ')}` : ''), bad.length > 0);
  }
});

// Suggested lists (presets/wordlists.js); one already added says so.
function renderSuggested() {
  const have = new Set(groups().map((g) => g.name.toLowerCase()));
  $('suggested-list').replaceChildren(...WordPacks.map((pack) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'pack';
    info.textContent = pack.name;
    const sample = document.createElement('small');
    sample.textContent = pack.words.join(', ');
    info.append(sample);
    const add = document.createElement('button');
    add.type = 'button';
    const added = have.has(pack.name.toLowerCase());
    add.textContent = added ? 'Added' : 'Add';
    add.disabled = added;
    add.addEventListener('click', async () => {
      if (await addList(pack.name, pack.words.map(MuteStore.normalizeWord).filter(Boolean))) {
        setStatus(`Added the list “${pack.name}” (${plural(pack.words.length, 'word')})`);
      }
    });
    li.append(info, add);
    return li;
  }));
}

/* ---------- Summary under the add box ---------- */

// What muting the typed words will do, in one sentence.
function renderSummary() {
  const { good } = parseWords($('word-input').value, /[,\n]+/);
  const what = good.length ? good.slice(0, 3).map((w) => `“${w}”`).join(', ') + (good.length > 3 ? ` and ${good.length - 3} more` : '') : 'A word';
  const on = (k) => $(WORD_BOX[k]).checked;
  const pages = on('popularWords') && on('subWords') ? 'on r/popular and on subreddits you haven’t joined'
    : on('popularWords') ? 'on r/popular' : 'on subreddits you haven’t joined';
  const fields = [on('popularWords') || on('subWords') ? 'title' : '', on('bodyWords') ? 'text' : ''].filter(Boolean).join(' or ');
  const many = good.length > 1;
  const it = many ? 'any of them' : 'it';
  const s = many ? '' : 's';
  const posts = [];
  if (fields) posts.push(`posts with ${it} in the ${fields} ${pages}`);
  if (on('flairWords')) posts.push(`posts with ${it} as flair, anywhere`);
  const parts = [];
  if (posts.length) parts.push(`${state?.settings.wordAction === 'rename' ? 'mark' : 'hide'}${s} ${posts.join(', and ')}`);
  if (on('commentWords')) parts.push(state?.settings.commentAction === 'hide' ? `hide${s} comments with ${it}` : `shrink${s} comments with ${it} to one line`);
  $('word-summary').hidden = !good.length;
  $('word-summary').textContent = parts.length
    ? `${what} ${parts.join(', and ')}. You can limit ${many ? 'each' : 'it'} to some subreddits after adding.`
    : '';
}

for (const id of ['word-input', ...Object.values(WORD_BOX)]) $(id).addEventListener('input', renderSummary);

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
    if (await MuteStore.onDevice()) {
      $('usage').textContent = 'On this device only';
      $('usage').title = 'The list is over browser sync’s 100 KB, so it’s saved on this device and not synced. It goes back to sync once it fits.';
      return;
    }
    const bytes = await chrome.storage.sync.getBytesInUse(null);
    $('usage').textContent = `${(bytes / 1024).toFixed(1)} of 100 KB synced`;
    $('usage').title = '';
  } catch (_) { /* not critical */ }
}

/* ---------- List view ---------- */

document.querySelectorAll('.tabs [role="tab"]').forEach((tab) => {
  tab.addEventListener('click', () => {
    kind = tab.dataset.kind;
    textKind = null;
    $('main-group').open = false;
    render();
  });
});

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  // u/ names and links pasted in the Subreddits tab go to Users, r/ ones in
  // the Users tab to Subreddits.
  const other = kind === 'subs' ? 'users' : 'subs';
  const parts = $('add-input').value.split(/[\s,]+/).filter(Boolean);
  const isOther = (p) => MuteStore.refKind(p) === (other === 'users' ? 'u' : 'r');
  const here = parseNames(parts.filter((p) => !isOther(p)).join(' '));
  const there = parseNames(parts.filter(isOther).join(' '), other);
  const bad = [...here.bad, ...there.bad];
  const added = [...here.good.map((n) => PREFIX[kind] + n), ...there.good.map((n) => PREFIX[other] + n)];
  if (!added.length && !bad.length) return;
  if (added.length && await save({ ...state, [kind]: [...state[kind], ...here.good], [other]: [...state[other], ...there.good] })) {
    $('add-input').value = bad.join(' ');
  }
  setStatus(bad.length
    ? `Not valid: ${bad.join(', ')}`
    : `Muted ${added.join(', ')}`, bad.length > 0);
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
  const targets = tickedKinds();
  if (!targets.length) {
    setStatus('Tick at least one place to mute in.', true);
    return;
  }
  const { good, bad } = parseWords($('word-input').value, /[,\n]+/);
  if (!good.length && !bad.length) return;
  const next = { ...state };
  for (const k of targets) next[k] = [...state[k], ...good];
  if (good.length && await save(next)) {
    $('word-input').value = bad.join(', ');
    renderSummary();
  }
  const PLACE = { commentWords: 'comments', popularWords: 'r/popular titles', subWords: 'subreddit titles', bodyWords: 'post text', flairWords: 'flair' };
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
const isUserRef = (part) => MuteStore.refKind(part) === 'u';

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
    ? `Not valid: ${bad.join(', ')}`
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
$('extras').addEventListener('change', (e) => save({ ...state, settings: { ...state.settings, extras: e.target.checked } }));
$('extras-x').addEventListener('change', (e) => save({ ...state, settings: { ...state.settings, extrasX: e.target.checked } }));
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

// Exceptions under each built-in filter (settings.*Except): whole groups (a
// country "US", or "g:<id>") or single items (a place, airline or sub name).
// content.js isException shows them in full. One picker for all five.
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (cc) => { try { return regionNames.of(cc); } catch { return cc; } };

// One group per country from [code, label, names] items, A–Z.
function byCountry(items, kind) {
  const groups = new Map();
  for (const [cc, label, names] of items) {
    const name = countryName(cc);
    if (!groups.has(cc)) {
      groups.set(cc, { tag: cc, label: name, option: `All ${name} ${kind}`, chip: name, many: (n) => `${n} ${name} ${kind}`, items: [] });
    }
    groups.get(cc).items.push({ tag: names.split(' ')[0], label, option: `${label} (${name})` });
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// Groups from presets' {id, label, names}, plus an "other" group for subs in none.
function byGroup(groups, other, withItems = true) {
  const list = groups.map((g) => ({
    tag: 'g:' + g.id, label: g.label, option: `Group: ${g.label}`, chip: g.label, many: (n) => `${g.label}: ${n} subreddits`,
    items: withItems && g.names ? g.names.split(' ').map((n) => ({ tag: n, label: 'r/' + n, option: `r/${n} (${g.label})` })) : []
  }));
  if (other) list.push({ tag: 'g:other', label: other, option: `Group: ${other}`, chip: other, items: [] });
  return list;
}

const EXCEPTIONS = [
  { filter: 'places', key: 'placeExcept', add: 'Add a country, city or subreddit', all: 'See all places', groups: byCountry(MutePresets.placeItems, 'places') },
  { filter: 'identity', key: 'identityExcept', add: 'Add a group or subreddit', all: 'See all groups', groups: byGroup(MutePresets.identityGroups) },
  { filter: 'ask', key: 'askExcept', add: 'Add a topic or subreddit', all: 'See all topics', groups: byGroup(MutePresets.topics, 'Other topics', false) },
  { filter: 'news', key: 'newsExcept', add: 'Add a group or subreddit', all: 'See all groups', groups: byGroup(MutePresets.newsGroups, 'Other news and politics') },
  { filter: 'airlines', key: 'airlineExcept', add: 'Add an airline or country', all: 'See all airlines', groups: byCountry(MutePresets.airlineItems, 'airlines') }
];

// r/Name, a reddit link or a bare name → the name content.js compares (no _ or -).
function exceptName(text) {
  const name = text.trim().replace(/^.*\/r\//i, '').replace(/^r\//i, '').replace(/\/.*$/, '').toLowerCase();
  return /^[a-z0-9_-]{2,32}$/.test(name) ? name.replace(/[_-]/g, '') : null;
}

function setupException(cfg) {
  const box = document.querySelector(`.except[data-filter="${cfg.filter}"]`);
  box.innerHTML = `<span class="except-label">Except</span> <span class="chips"></span>
    <details class="except-add"><summary>Add exception</summary>
      <input type="text" list="except-${cfg.filter}" autocomplete="off" spellcheck="false">
      <datalist id="except-${cfg.filter}"></datalist>
      <details class="see-all"><summary></summary><div class="all"></div></details>
    </details>`;
  const input = box.querySelector('input');
  input.placeholder = cfg.add;
  input.setAttribute('aria-label', cfg.add);
  box.querySelector('.see-all summary').textContent = cfg.all;
  cfg.box = box;
  cfg.groupOf = new Map();
  cfg.labelOf = new Map(cfg.groups.map((g) => [g.tag, g.chip]));
  for (const g of cfg.groups) for (const item of g.items) {
    if (!cfg.groupOf.has(item.tag)) cfg.groupOf.set(item.tag, g);
    cfg.labelOf.set(item.tag, item.label);
  }
  const options = new Map(cfg.groups.flatMap((g) => [[g.option, g.tag], ...g.items.map((item) => [item.option, item.tag])]));
  box.querySelector('datalist').replaceChildren(...[...options.keys()].map((value) => Object.assign(document.createElement('option'), { value })));
  // A picked suggestion adds at once; any other subreddit name on Enter.
  input.addEventListener('input', () => {
    const tag = options.get(input.value);
    if (tag) { input.value = ''; setException(cfg, tag, true); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = exceptName(input.value);
    if (name) { input.value = ''; setException(cfg, name, true); }
  });
  box.querySelector('.see-all').addEventListener('toggle', () => renderException(cfg));
}

const exceptTags = (cfg) => state.settings[cfg.key] || [];
const saveException = (cfg, tags) => save({ ...state, settings: { ...state.settings, [cfg.key]: [...new Set(tags)] } });

// Ticking a group replaces its single items; unticking one item of a ticked
// group keeps the rest; ticking its last item ticks the group.
function setException(cfg, tag, on) {
  let tags = exceptTags(cfg);
  const group = cfg.groups.find((g) => g.tag === tag);
  if (group) {
    const ids = group.items.map((item) => item.tag);
    tags = tags.filter((t) => t !== tag && !ids.includes(t));
    return saveException(cfg, on ? [...tags, tag] : tags);
  }
  const owner = cfg.groupOf.get(tag);
  const ids = owner ? owner.items.map((item) => item.tag) : [];
  if (owner && tags.includes(owner.tag)) tags = [...tags.filter((t) => t !== owner.tag), ...ids];
  tags = on ? [...tags, tag] : tags.filter((t) => t !== tag);
  if (owner && ids.length > 1 && ids.every((id) => tags.includes(id))) tags = [...tags.filter((t) => !ids.includes(t)), owner.tag];
  saveException(cfg, tags);
}

function exceptBox(cfg, label, tag, checked, className) {
  const row = document.createElement('label');
  row.className = 'check' + (className ? ' ' + className : '');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => setException(cfg, tag, box.checked));
  row.append(box, ' ' + label);
  return row;
}

function renderException(cfg) {
  const tags = exceptTags(cfg);
  // Three or more single items from one group share a chip.
  const chips = [];
  for (const tag of tags) {
    const owner = cfg.groupOf.get(tag);
    const same = owner ? tags.filter((t) => cfg.groupOf.get(t) === owner) : [];
    if (same.length >= 3) {
      if (same[0] === tag) chips.push([owner.many(same.length), same]);
    } else {
      chips.push([cfg.labelOf.get(tag) || 'r/' + tag, [tag]]);
    }
  }
  cfg.box.querySelector('.chips').replaceChildren(...chips.map(([label, group]) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-label', `${label}: filter again`);
    const x = document.createElement('span');
    x.className = 'x';
    chip.addEventListener('click', () => saveException(cfg, exceptTags(cfg).filter((t) => !group.includes(t))));
    const checkRoom = () => chip.classList.toggle('tight', chip.getBoundingClientRect().right + 16 > cfg.box.getBoundingClientRect().right);
    chip.addEventListener('mouseenter', checkRoom);
    chip.addEventListener('focus', checkRoom);
    chip.append(label, x);
    return chip;
  }));
  // The full list is long (places: about 2,000), so it's only built while open.
  const all = cfg.box.querySelector('.all');
  if (!cfg.box.querySelector('.see-all').open) return all.replaceChildren();
  all.replaceChildren(...cfg.groups.flatMap((g) => [
    exceptBox(cfg, g.label, g.tag, tags.includes(g.tag), 'group'),
    ...g.items.map((item) => exceptBox(cfg, item.label, item.tag, tags.includes(g.tag) || tags.includes(item.tag)))
  ]));
}

EXCEPTIONS.forEach(setupException);

const PRESET_LISTS = [
  ['Places', 'places', 'r/'], ['Also any name starting or ending with', 'placeParts', ''],
  ['Gender, nationality, ethnicity, religion', 'identity', 'r/'],
  ['Also r/ask…, r/ex…, r/true… followed by', 'identityParts', ''],
  ['News and politics', 'news', 'r/'], ['Also any name containing', 'newsParts', ''],
  ['Airlines', 'airlines', 'r/'], ['Not matched by the name parts above', 'partSkip', 'r/'],
];
$('preset-list').value = PRESET_LISTS
  .map(([title, key, prefix]) => [title + ':', ...MutePresets[key].split(' ').map((n) => prefix + n)].join('\n'))
  .join('\n\n');

/* ---------- Text view ---------- */

const SAVED_LABEL = {
  subs: 'subreddits', users: 'users', popularWords: 'words for r/popular titles', subWords: 'words for subreddit page titles', commentWords: 'words for comments',
  bodyWords: 'words for post text', flairWords: 'words for flair',
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

const setSetting = (key, value) => save({ ...state, settings: { ...state.settings, [key]: value } });

$('hide-comments').addEventListener('change', (e) => setSetting('hideComments', e.target.checked));
$('default-feed').addEventListener('change', (e) => setSetting('defaultFeed', e.target.value));
$('hide-avatars').addEventListener('change', (e) => setSetting('hideCommentAvatars', e.target.checked));
$('comment-names').addEventListener('change', (e) => setSetting('commentNames', e.target.value));
$('hide-sections').addEventListener('change', (e) => setSetting('hideCommentSections', e.target.checked));
$('comment-action').addEventListener('change', (e) => setSetting('commentAction', e.target.value));
$('comment-show-word').addEventListener('change', (e) => setSetting('commentShowWord', e.target.checked));
$('comment-hide-replies').addEventListener('change', (e) => setSetting('commentHideReplies', e.target.checked));

// Running total of posts hidden (background.js counts them), with Reset.
const TOTAL_KEY = 'hiddenTotal';

async function renderTotal() {
  const total = (await chrome.storage.local.get(TOTAL_KEY))[TOTAL_KEY];
  const line = $('hidden-total');
  if (!total?.count) {
    line.textContent = 'No posts hidden yet.';
    return;
  }
  const since = new Date(total.since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  line.textContent = `${total.count.toLocaleString()} posts hidden since ${since}. `;
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'link';
  reset.textContent = 'Reset';
  reset.addEventListener('click', () => chrome.storage.local.remove(TOTAL_KEY));
  line.append(reset);
}
$('show-counter').addEventListener('change', (e) => setSetting('showCounter', e.target.checked));
$('hide-seen').addEventListener('change', (e) => setSetting('hideSeen', e.target.checked));
$('hide-duplicates').addEventListener('change', (e) => setSetting('hideDuplicates', e.target.checked));
$('max-age').addEventListener('change', (e) => setSetting('maxAgeHours', Number(e.target.value)));
$('hide-crossposts').addEventListener('change', (e) => setSetting('hideCrossposts', e.target.checked));

// Posts remembered as seen (content.js, background.js), on this device only.
const SEEN_KEY = 'seenPosts';
async function renderSeen() {
  const ids = (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY];
  const count = ids ? ids.split(' ').length : 0;
  const line = $('seen-line');
  line.textContent = `Hidden from the next page load. ${count.toLocaleString()} remembered on this device. `;
  if (!count) return;
  const forget = document.createElement('button');
  forget.type = 'button';
  forget.className = 'link';
  forget.textContent = 'Forget them';
  forget.addEventListener('click', () => chrome.storage.local.remove(SEEN_KEY));
  line.append(forget);
}
renderSeen();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && SEEN_KEY in changes) renderSeen();
});
$('word-action').addEventListener('change', (e) => setSetting('wordAction', e.target.value));
$('min-score').addEventListener('change', (e) => {
  const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
  e.target.value = n;
  setSetting('minScore', n).then((ok) => ok && setStatus(n ? `Hiding feed posts under ${n} upvotes` : 'Score filter off'));
});

/* ---------- Theme ---------- */

// System, light or dark, in that order on each click. Also kept in
// localStorage, so the next open starts in the right theme.
const THEMES = { system: 'Theme: same as system', light: 'Theme: light', dark: 'Theme: dark' };

function applyTheme(theme = 'system') {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  $('theme').title = THEMES[theme] || THEMES.system;
  try { localStorage.setItem('theme', theme); } catch (_) { /* not critical */ }
}

try { applyTheme(localStorage.getItem('theme') || 'system'); } catch (_) { /* no storage */ }

$('theme').addEventListener('click', () => {
  const order = Object.keys(THEMES);
  const next = order[(order.indexOf(state.settings.theme || 'system') + 1) % order.length];
  applyTheme(next);
  setSetting('theme', next);
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
    version: 9,
    exportedAt: new Date().toISOString(),
    subs: state.subs,
    users: state.users,
    popularWords: state.popularWords,
    subWords: state.subWords,
    commentWords: state.commentWords,
    bodyWords: state.bodyWords,
    flairWords: state.flairWords,
    scopes: state.scopes,
    wordGroups: state.wordGroups,
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
  // Version 1 backups have no word lists; 1-2 no recommendation lists; 1-3 no keep list; 1-4 no comment words; 1-5 no user subreddit notes; 1-6 no Mute all whitelist; 1-7 no text or flair words or scopes; 1-8 no word lists.
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

// Pages that mix many subs (same as content.js's onFeed). Checked here too,
// so a list saved from, or sent by, another page never shows.
const SORT = '(?:(?:best|hot|new|top|rising|controversial)/?)?';
const FEED_RE = new RegExp(`^/(?:${SORT}|r/(?:popular|all|[^/]+\\+[^/]+)/${SORT}|(?:user/[^/]+|me)/m/[^/]+/${SORT}|m/[^/]+/${SORT})$`, 'i');
const isFeedPath = (path) => !!path && FEED_RE.test(path.replace(/\/?$/, '/'));

let pageSubs = [];
let pageOrigin = 'https://www.reddit.com';
let pagePath = null;
// − puts a sub on the Mute all whitelist (skipSubs), which keeps it out of
// later lists; in this one it stays, crossed out, so − again can undo it.
const shownSkipped = new Set();
// Background tabs opened from the list this time, so each goes after the last.
let backgroundOpened = 0;
const isSkipped = (sub) => !!state?.skipSubs.includes(sub);
// The collected list is kept per tab in local storage, so it's still there
// when the popup is opened again (it closes when Chrome focuses something
// else) and after an extension reload (which clears session storage).
// Entries older than a day are dropped.
const PAGE_SUBS_MAX_AGE = 24 * 60 * 60 * 1000;
let pageKey = null;

function savePageSubs() {
  if (!pageKey) return;
  const entry = { at: Date.now(), path: pagePath, origin: pageOrigin, subs: pageSubs };
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
    button.ariaLabel = out ? `Take r/${sub} off the Mute all whitelist` : `Leave r/${sub} out of Mute all from now on`;
    button.addEventListener('click', async () => {
      shownSkipped.add(sub);
      await save({ ...state, skipSubs: out ? state.skipSubs.filter((n) => n !== sub) : [...state.skipSubs, sub] });
      renderPageSubList();
      $('page-subs-list').children[i]?.querySelector('button').focus();
    });
    // Opens in a new tab next to this one and switches to it (the list is kept, see savePageSubs).
    // Cmd/Ctrl-click or middle-click opens it in the background instead, after earlier ones.
    // A double-click scrolls the Reddit page to the sub's post instead, so a
    // plain click waits a moment to see whether a second one follows.
    const link = document.createElement('a');
    link.href = `${pageOrigin}/r/${sub}/`;
    link.textContent = 'r/' + sub;
    let clickTimer = null;
    const open = (background) => activeTab().then((tab) => chrome.tabs.create({
      url: link.href, index: tab.index + 1 + (background ? backgroundOpened++ : 0), openerTabId: tab.id, active: !background,
    }));
    link.addEventListener('click', (e) => {
      e.preventDefault();
      if (e.metaKey || e.ctrlKey) return open(true);
      clearTimeout(clickTimer);
      clickTimer = e.detail > 1 ? null : setTimeout(() => open(false), 300);
    });
    link.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      clearTimeout(clickTimer);
      try {
        await chrome.tabs.sendMessage((await activeTab()).id, { type: 'rmute:scrollTo', sub });
      } catch (_) {} // page script from before an extension reload
    });
    link.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); open(true); } });
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
  if (saved?.subs.length && isFeedPath(saved.path)) {
    ({ path: pagePath, origin: pageOrigin, subs: pageSubs } = saved);
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
    if (res.counts) return renderCounts(res.counts);
    if (res.path !== pagePath) { // another page in this tab: start over
      pageSubs = [];
    }
    pageOrigin = res.origin;
    pagePath = res.path;
    pageSubs = isFeedPath(res.path) ? [...new Set([...pageSubs, ...res.subs])] : [];
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

// How many posts on the open Reddit page show, are one-line bars, or are hidden.
function renderCounts({ shown, bar, hidden }) {
  const parts = [`${shown} showing`, bar ? `${bar} as one line` : '', `${hidden} hidden`].filter(Boolean);
  $('page-counts').textContent = `This page: ${parts.join(' · ')}`;
  $('page-counts').hidden = !(shown + bar + hidden);
}

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
  if (area === 'local' && 'listOnDevice' in changes) usage();
  if (area === 'local' && TOTAL_KEY in changes) renderTotal();
  if (area === 'local' && IMPORTS_KEY in changes) {
    imports = changes[IMPORTS_KEY].newValue || [];
    if (state) render();
  }
});

Promise.all([MuteStore.load(), chrome.storage.local.get([IMPORTS_KEY, SORT_KEY])]).then(([list, stored]) => {
  imports = stored[IMPORTS_KEY] || [];
  sortOrder = stored[SORT_KEY] || 'az';
  state = list;
  render();
  usage();
  renderFeeds();
  renderTotal();
  if (new URLSearchParams(location.search).has('restore')) $('restore-panel').hidden = false;
  if (new URLSearchParams(location.search).has('import')) setStatus('Click “Import list…” to pick the file.');
});
