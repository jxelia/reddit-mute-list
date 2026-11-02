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
  // bodyWords: post text, on the same pages as title words. flairWords: post
  // flair, everywhere.
  const WORD_KINDS = ['popularWords', 'subWords', 'commentWords', 'bodyWords', 'flairWords'];
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
  // Where a word or user applies, by subreddit: "w<TAB>word<TAB>-<TAB>sub sub"
  // (everywhere except those subs) or "+" (only in them); "u" for users.
  // Entries for words and users no longer muted are dropped on save.
  const SCOPE_KINDS = ['scopes'];
  // Named word lists: "Name<TAB>word<TAB>word…". Only labels for grouping in
  // the popup; the words themselves are in the word lists. Words no longer
  // muted drop out on save, and an empty list goes.
  const GROUP_KINDS = ['wordGroups'];
  const ALL_KINDS = [...KINDS, ...WORD_KINDS, ...REC_KINDS, ...KEEP_KINDS, ...SKIP_KINDS, ...NOTE_KINDS, ...SCOPE_KINDS, ...GROUP_KINDS];
  const SEP = {
    subs: ',', users: ',', popularWords: '\n', subWords: '\n', commentWords: '\n', bodyWords: '\n', flairWords: '\n',
    recSubs: ',', recUsers: ',', keepSubs: ',', skipSubs: ',', userSubs: ',', scopes: '\n', wordGroups: '\n'
  };
  const CHUNK_CHARS = 7000;
  const NAME_RE = /^[a-z0-9_-]{2,32}$/;
  // preset*: built-in recommendation filters (presets/), all on by default.
  // keepMode / keepTopics: the keep list (see content.js).
  const DEFAULT_SETTINGS = {
    hideComments: true, presetPlaces: true, presetAirlines: true, presetIdentity: true, presetAsk: true, presetNews: true,
    keepMode: true, keepTopics: MutePresets.defaultTopics, // presets/presets.js loads first
    // Exceptions per built-in filter, shown in full (content.js isException):
    // country codes ("US"), groups ("g:men"), or sub names without _ or -.
    placeExcept: [], airlineExcept: [], identityExcept: [], askExcept: [], newsExcept: [],
    collapsePopular: true, // every r/popular post starts as a one-line bar
    enabled: true, // the popup's on/off switch
    wordAction: 'hide', // posts with a muted word: 'hide', or 'rename' (title replaced, text and media hidden)
    minScore: 0, // feed posts under this many upvotes are hidden; 0 = off
    hideCommentAvatars: false,
    commentNames: 'show', // usernames in comments: 'show', 'replace' (with "Redditor") or 'hide'
    commentAction: 'bar', // comments with a muted word: 'bar' (one line, click to show) or 'hide'
    commentShowWord: true, // the bar says which word matched
    commentHideReplies: false, // their replies go too
    hideCommentSections: false, // no comments at all
    showCounter: true, // hidden-post count on the toolbar icon
    theme: 'system', // the popup's own light/dark theme
    defaultFeed: 'last', // home page tab on arrival: 'following', 'for you', or 'last' (Reddit's own memory)
    extras: false, // the popup's "Extra features" switch (see effective)
    extrasX: false, // the popup's "Extra features 2 (X)" switch (see effective)
    hideSeen: false, // feed posts already on screen before this page load are hidden
    hideDuplicates: false, // feed posts of a link already showing are hidden
    maxAgeHours: 0, // feed posts older than this are hidden; 0 = off
    hideCrossposts: false // crossposts of a muted sub's posts are hidden
  };

  // With extra features off, the page acts as the plain mute list: these
  // settings fall back to their core values and these lists are ignored.
  // Nothing is deleted, so turning extras back on restores them.
  const CORE_SETTINGS = {
    wordAction: 'hide', minScore: 0, hideCommentAvatars: false, commentNames: 'show', commentAction: 'bar',
    commentShowWord: true, commentHideReplies: false, hideCommentSections: false, showCounter: false
  };
  const EXTRA_KINDS = ['bodyWords', 'flairWords', 'scopes'];

  // The same for the "Extra features 2 (X)" switch, on its own.
  const X_SETTINGS = { hideSeen: false, hideDuplicates: false, maxAgeHours: 0, hideCrossposts: false };

  function effective(list) {
    const x = list.settings?.extrasX ? {} : X_SETTINGS;
    if (list.settings?.extras) return { ...list, settings: { ...list.settings, ...x } };
    return { ...list, ...Object.fromEntries(EXTRA_KINDS.map((k) => [k, []])), settings: { ...list.settings, ...CORE_SETTINGS, ...x } };
  }
  // Set in local storage when the list outgrew sync and is kept on this device.
  const ON_DEVICE = 'listOnDevice';

  // Accepts "name", "r/name", "/u/name", "user/name" or a full reddit URL.
  // Links count only from reddit.com (any subdomain); other sites' links,
  // and redd.it short links (no subreddit in them), give null.
  function refPath(raw) {
    const s = String(raw || '').trim().toLowerCase();
    const link = s.match(/^(?:https?:\/\/)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(\/.*)?$/);
    if (!link) return s.replace(/^\/+/, '');
    if (link[1] !== 'reddit.com' && !link[1].endsWith('.reddit.com')) return null;
    return (link[2] || '').replace(/^\/+/, '');
  }

  // 'u' for a u/ or user/ name or link, 'r' for r/, else null.
  function refKind(raw) {
    return refPath(raw)?.match(/^(u|user|r)\//)?.[1].slice(0, 1) || null;
  }

  function normalize(raw) {
    let s = refPath(raw);
    if (s == null) return null;
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

  // Users can be patterns too, as for subreddits: "*bot*", "auto*".
  function normalizeUser(raw) {
    const s = String(raw || '').trim().toLowerCase().replace(/^\/?(?:u|user)\//, '');
    if (!s.includes('*')) return normalize(raw);
    return /^\*?[a-z0-9_-]{2,32}\*?$/.test(s) ? s : null;
  }

  // "w<TAB>word<TAB>+|-<TAB>sub sub" or "u<TAB>user<TAB>…"; subs are plain names.
  function normalizeScope(raw) {
    const [type, name, mode, subs] = String(raw || '').split('\t');
    const n = type === 'w' ? normalizeWord(name) : type === 'u' ? normalizeUser(name) : null;
    const list = [...new Set(String(subs || '').split(/[\s,]+/).map(normalize).filter(Boolean))];
    return n && (mode === '+' || mode === '-') && list.length ? [type, n, mode, list.join(' ')].join('\t') : null;
  }

  // "Name<TAB>word<TAB>word…"; the name is 1-40 characters.
  function normalizeGroup(raw) {
    const [name, ...words] = String(raw || '').split('\t');
    const n = name.replace(/\s+/g, ' ').trim().slice(0, 40);
    const list = [...new Set(words.map(normalizeWord).filter(Boolean))];
    return n && list.length ? [n, ...list].join('\t') : null;
  }

  // "user:sub", both plain names.
  function normalizeUserSub(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return /^[a-z0-9_-]{2,32}:[a-z0-9_-]{2,32}$/.test(s) ? s : null;
  }

  const isSubKind = (kind) => kind === 'subs' || kind === 'recSubs' || kind === 'keepSubs' || kind === 'skipSubs';
  const isUserKind = (kind) => kind === 'users' || kind === 'recUsers';

  // Lists keep the order names were added in (the popup sorts by name or date).
  function clean(names, kind = 'subs') {
    const norm = WORD_KINDS.includes(kind) ? normalizeWord
      : NOTE_KINDS.includes(kind) ? normalizeUserSub
      : SCOPE_KINDS.includes(kind) ? normalizeScope
      : GROUP_KINDS.includes(kind) ? normalizeGroup
      : isSubKind(kind) ? normalizeSub
      : isUserKind(kind) ? normalizeUser : normalize;
    return [...new Set((names || []).map(norm).filter(Boolean))];
  }

  // scopes entry for a word ('w') or user ('u'): { mode: '+' | '-', subs: [...] } or null.
  function scopeOf(list, type, name) {
    const prefix = `${type}\t${name}\t`;
    const entry = list.scopes?.find((e) => e.startsWith(prefix));
    if (!entry) return null;
    const [, , mode, subs] = entry.split('\t');
    return { mode, subs: subs.split(' ') };
  }

  // Sets (or with no subs, clears) the scope of a word or user in a list copy.
  function withScope(list, type, name, mode, subs) {
    const prefix = `${type}\t${name}\t`;
    const scopes = (list.scopes || []).filter((e) => !e.startsWith(prefix));
    if (subs?.length) scopes.push([type, name, mode, subs.join(' ')].join('\t'));
    return { ...list, scopes };
  }

  // Version of the stored data's shape. Raise it, and add a step below, only
  // when the shape changes in a way old lists need converting for; a new
  // setting with a default doesn't need it. Lists from before this have none (1).
  const SCHEMA = 2;
  // Steps run on every read of an older list, in memory (nothing is written
  // until the next save), so each takes and returns the raw stored items.
  const MIGRATIONS = {
    // India and Australia were built in as never filtered before the country
    // picker; lists saved back then keep them ticked.
    2: (all) => (all.settings && !('placeExcept' in all.settings)
      ? { ...all, settings: { ...all.settings, placeExcept: ['IN', 'AU'] } } : all)
  };

  function migrate(all) {
    for (let v = (all.schema || 1) + 1; v <= SCHEMA; v++) all = MIGRATIONS[v](all);
    return all;
  }

  function parse(raw) {
    const all = migrate(raw);
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

  // The list is in sync storage, or in local storage once it outgrew sync's
  // 100 KB (see save).
  const onDevice = async () => !!(await chrome.storage.local.get(ON_DEVICE))[ON_DEVICE];
  const area = async () => (await onDevice() ? chrome.storage.local : chrome.storage.sync);
  const isListKey = (key) => key === 'settings' || key === 'schema' || key === ON_DEVICE || ALL_KINDS.includes(key.replace(/\.(?:count|\d+)$/, ''));

  async function load() {
    const all = await (await area()).get(null);
    const list = parse(all);
    if (!all[SEED.key] && !(await chrome.storage.sync.get(SEED.key))[SEED.key]) {
      await chrome.storage.sync.set({ [SEED.key]: true }); // first, so onChange reloads don't seed again
      list.subs.push(...SEED.subs);
      await save(list);
    }
    return list;
  }

  async function save(list) {
    const from = await area();
    const prev = await from.get(null);
    const data = { settings: { ...DEFAULT_SETTINGS, ...(list.settings || {}) } };
    // Never lowered: a stale tab saving mustn't mark a newer list as old.
    data.schema = Math.max(prev.schema || 1, SCHEMA);

    // Entries already stored are kept even if this copy of the code can't
    // read them, so a stale tab can't wipe a newer format (as it did *cats*).
    const stored = parse(prev);
    const users = new Set(list.users || []);
    const words = new Set(WORD_KINDS.flatMap((k) => list[k] || []));
    for (const kind of ALL_KINDS) {
      let kept = (list[kind] || []).filter((n) => stored[kind].includes(n));
      if (kind === 'userSubs' || kind === 'scopes' || kind === 'wordGroups') kept = [];
      const chunks = [];
      let chunk = '';
      let names = [...new Set([...clean(list[kind], kind), ...kept])];
      if (kind === 'userSubs') names = names.filter((n) => users.has(n.split(':')[0]));
      if (kind === 'wordGroups') {
        names = names.map((n) => {
          const [name, ...list] = n.split('\t');
          const left = list.filter((w) => words.has(w));
          return left.length ? [name, ...left].join('\t') : null;
        }).filter(Boolean);
      }
      if (kind === 'scopes') {
        names = names.filter((n) => {
          const [type, name] = n.split('\t');
          return type === 'w' ? words.has(name) : users.has(name);
        });
      }
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
    }

    // Too big for sync (100 KB): kept on this device instead, and moved back
    // to sync by the first save that fits again.
    const local = chrome.storage.local;
    try {
      const syncPrev = from === chrome.storage.sync ? prev : await chrome.storage.sync.get(null);
      await chrome.storage.sync.set(data);
      await removeStale(chrome.storage.sync, syncPrev, data);
      if (from === local) await local.remove([...Object.keys(prev).filter(isListKey), ON_DEVICE]);
    } catch (err) {
      if (!/QUOTA_BYTES/.test(err.message)) throw err;
      const localPrev = from === local ? prev : await local.get(null);
      await local.set({ ...data, [ON_DEVICE]: true });
      await removeStale(local, localPrev, data);
    }
  }

  // Chunks a list no longer needs, e.g. subs.3 after the list shrank to 3 chunks.
  function removeStale(store, prev, data) {
    const stale = Object.keys(prev).filter((k) => /\.\d+$/.test(k) && isListKey(k) && !(k in data));
    return stale.length ? store.remove(stale) : Promise.resolve();
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
    chrome.storage.onChanged.addListener((changes, where) => {
      if (where !== 'sync' && !(where === 'local' && Object.keys(changes).some(isListKey))) return;
      load().then((list) => {
        [...inflight, ...pending].forEach((op) => op.fn(list));
        callback(list);
      });
    });
  }

  return {
    KINDS, WORD_KINDS, REC_KINDS, KEEP_KINDS, SKIP_KINDS, NOTE_KINDS, SCOPE_KINDS, GROUP_KINDS, ALL_KINDS, subNoteFor, isSubKind, isUserKind,
    normalize, refKind, normalizeSub, normalizeUser, normalizeWord, scopeOf, withScope, clean, load, save, add, remove, idle, onChange, onDevice, effective
  };
})();
