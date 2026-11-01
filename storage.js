// The mute list lives in chrome.storage.sync so it follows the browser profile
// across devices. Sync caps each item at 8 KB, so each list is stored as a
// comma-joined string split across numbered chunks: "subs.count", "subs.0", ...
// Title words can contain spaces and commas, so their lists are newline-joined.
//
// TODO: back up to / restore from the user's own cloud storage (kept in sync),
// and restore from a web address such as a shared public drive link.
const MuteStore = (() => {
  const KINDS = ['subs', 'users'];
  // Title words muted on r/popular, and on home pages of subreddits that
  // aren't joined or in any of the user's custom feeds; and words that
  // collapse comments containing them.
  const WORD_KINDS = ['popularWords', 'subWords', 'commentWords'];
  // Subs and users muted only where Reddit recommends them (home feed posts
  // from subreddits the user hasn't joined); see content.js.
  const REC_KINDS = ['recSubs', 'recUsers'];
  // Subs always shown in full in recommendations (keep mode, see content.js).
  const KEEP_KINDS = ['keepSubs'];
  // Subs the popup's "Mute all" (subs on the page) never offers: its whitelist.
  const SKIP_KINDS = ['skipSubs'];
  // Where each muted user was muted from: "user:sub" entries, one per user.
  // Entries for users no longer muted are dropped on save.
  const NOTE_KINDS = ['userSubs'];
  const ALL_KINDS = [...KINDS, ...WORD_KINDS, ...REC_KINDS, ...KEEP_KINDS, ...SKIP_KINDS, ...NOTE_KINDS];
  const SEP = { subs: ',', users: ',', popularWords: '\n', subWords: '\n', commentWords: '\n', recSubs: ',', recUsers: ',', keepSubs: ',', skipSubs: ',', userSubs: ',' };
  const CHUNK_CHARS = 7000;
  const NAME_RE = /^[a-z0-9_-]{2,32}$/;
  // preset*: built-in recommendation filters (presets/), all on by default.
  // keepMode / keepTopics: the keep list (see content.js).
  const DEFAULT_SETTINGS = {
    hideComments: true, presetPlaces: true, presetAirlines: true, presetIdentity: true, presetAsk: true, presetNews: true,
    keepMode: true, keepTopics: MutePresets.defaultTopics, // presets/presets.js loads first
    collapsePopular: true, // every r/popular post starts as a one-line bar
    enabled: true // the popup's on/off switch
  };

  // Accepts "name", "r/name", "/u/name", "user/name" or a full reddit URL.
  function normalize(raw) {
    let s = String(raw || '').trim().toLowerCase();
    s = s.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
    const m = s.match(/^(?:r|u|user)\/([^/?#\s]+)/);
    if (m) s = m[1];
    return NAME_RE.test(s) ? s : null;
  }

  // Subreddit entries can also be patterns: "*cat*" (name contains "cat"),
  // "cat*" (starts with) or "*cat" (ends with).
  function normalizeSub(raw) {
    const s = String(raw || '').trim().toLowerCase().replace(/^\/?r\//, '');
    if (!s.includes('*')) return normalize(raw);
    return /^\*?[a-z0-9_-]{2,32}\*?$/.test(s) ? s : null;
  }

  // Lowercase, single-spaced, 2-100 chars. "*" is a wildcard (see content.js).
  function normalizeWord(raw) {
    const s = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return s.replace(/\*/g, '').length >= 2 && s.length <= 100 ? s : null;
  }

  // "user:sub", both plain names.
  function normalizeUserSub(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return /^[a-z0-9_-]{2,32}:[a-z0-9_-]{2,32}$/.test(s) ? s : null;
  }

  const isSubKind = (kind) => kind === 'subs' || kind === 'recSubs' || kind === 'keepSubs' || kind === 'skipSubs';

  function clean(names, kind = 'subs') {
    const norm = WORD_KINDS.includes(kind) ? normalizeWord
      : NOTE_KINDS.includes(kind) ? normalizeUserSub
      : isSubKind(kind) ? normalizeSub : normalize;
    return [...new Set((names || []).map(norm).filter(Boolean))].sort();
  }

  function parse(all) {
    const list = { settings: { ...DEFAULT_SETTINGS, ...(all.settings || {}) } };
    for (const kind of ALL_KINDS) {
      const count = all[kind + '.count'] || 0;
      const chunks = [];
      for (let i = 0; i < count; i++) chunks.push(all[kind + '.' + i] || '');
      list[kind] = chunks.join(SEP[kind]).split(SEP[kind]).filter(Boolean);
    }
    return list;
  }

  // Sub patterns added once, then editable like any other entry (the user asked).
  const SEED = { key: 'seeded.animals', subs: ['*cat*', '*dog*', '*bird*'] };

  async function load() {
    const all = await chrome.storage.sync.get(null);
    const list = parse(all);
    if (!all[SEED.key]) {
      await chrome.storage.sync.set({ [SEED.key]: true }); // first, so onChange reloads don't seed again
      list.subs.push(...SEED.subs);
      await save(list);
    }
    return list;
  }

  async function save(list) {
    const prev = await chrome.storage.sync.get(null);
    const data = { settings: { ...DEFAULT_SETTINGS, ...(list.settings || {}) } };
    const stale = [];

    // Entries already stored are kept even if this copy of the code can't
    // read them, so a stale tab can't wipe a newer format (as it did *cats*).
    const stored = parse(prev);
    const users = new Set(list.users || []);
    for (const kind of ALL_KINDS) {
      let kept = (list[kind] || []).filter((n) => stored[kind].includes(n));
      if (kind === 'userSubs') kept = [];
      const chunks = [];
      let chunk = '';
      let names = [...new Set([...clean(list[kind], kind), ...kept])].sort();
      if (kind === 'userSubs') names = names.filter((n) => users.has(n.split(':')[0]));
      for (const name of names) {
        const next = chunk ? chunk + SEP[kind] + name : name;
        if (next.length > CHUNK_CHARS) {
          chunks.push(chunk);
          chunk = name;
        } else {
          chunk = next;
        }
      }
      if (chunk) chunks.push(chunk);

      data[kind + '.count'] = chunks.length;
      chunks.forEach((c, i) => { data[kind + '.' + i] = c; });
      for (let i = chunks.length; (kind + '.' + i) in prev; i++) stale.push(kind + '.' + i);
    }

    try {
      await chrome.storage.sync.set(data);
    } catch (err) {
      throw new Error(/quota/i.test(err.message)
        ? 'The mute list is too big for browser sync (100 KB limit).'
        : err.message);
    }
    if (stale.length) await chrome.storage.sync.remove(stale);
  }

  // add/remove are queued and applied in batches (one load, one save), so
  // quick clicks in a row don't each save a list missing the others' mutes.
  const pending = [];
  let inflight = [];
  let flushing = null;

  // On Reddit pages the background worker does the saving (background.js),
  // so a refresh or link click right after a mute doesn't lose it. The op
  // stays in pending here until the worker has saved it, for onChange.
  const onPage = typeof location !== 'undefined' && location.protocol.startsWith('http');

  function mutate(fn, msg) {
    if (onPage) {
      const op = { fn };
      pending.push(op);
      return chrome.runtime.sendMessage({ type: 'rmute:mutate', ...msg }).then((res) => {
        if (res?.error) throw new Error(res.error);
      }).finally(() => pending.splice(pending.indexOf(op), 1));
    }
    return new Promise((resolve, reject) => {
      pending.push({ fn, resolve, reject });
      flushing ||= flush();
    });
  }

  async function flush() {
    while (pending.length) {
      inflight = pending.splice(0);
      try {
        const list = await load();
        inflight.forEach((op) => op.fn(list));
        await save(list);
        inflight.forEach((op) => op.resolve());
      } catch (err) {
        inflight.forEach((op) => op.reject(err));
      }
    }
    inflight = [];
    flushing = null;
  }

  // Resolves once queued changes are saved (background.js waits before reloading).
  const idle = () => flushing || Promise.resolve();

  // sub: for users, the subreddit they were muted from (see userSubs).
  function add(kind, name, sub) {
    return mutate((list) => {
      if (!list[kind].includes(name)) list[kind].push(name);
      if (kind === 'users' && sub) list.userSubs = [...list.userSubs.filter((n) => !n.startsWith(name + ':')), `${name}:${sub}`];
    }, { op: 'add', kind, name, sub });
  }

  // The subreddit a user was muted from, if noted.
  const subNoteFor = (list, user) => list.userSubs?.find((n) => n.startsWith(user + ':'))?.slice(user.length + 1) || null;

  function remove(kind, name) {
    return mutate((list) => {
      list[kind] = list[kind].filter((n) => n !== name);
    }, { op: 'remove', kind, name });
  }

  // Changes still queued here are applied on top, so a save finishing
  // doesn't briefly undo mutes that haven't been saved yet.
  function onChange(callback) {
    chrome.storage.onChanged.addListener((_changes, area) => {
      if (area !== 'sync') return;
      load().then((list) => {
        [...inflight, ...pending].forEach((op) => op.fn(list));
        callback(list);
      });
    });
  }

  return { KINDS, WORD_KINDS, REC_KINDS, KEEP_KINDS, SKIP_KINDS, NOTE_KINDS, ALL_KINDS, subNoteFor, isSubKind, normalize, normalizeSub, normalizeWord, clean, load, save, add, remove, idle, onChange };
})();
