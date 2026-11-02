const POST_SELECTOR = 'shreddit-post, shreddit-ad-post';
const STYLE_ID = 'rmute-style';
const isOldReddit = location.hostname === 'old.reddit.com';

// Material icons (Apache 2.0), 24x24. mute is our own: an outline speaker with
// a slash (same winding as the outline so the overlap stays filled).
const ICONS = {
  join: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  mute: 'M6 9h4l5-5v16l-5-5H6zm2 2v2h2.83L13 15.17V8.83L10.83 11zM4.71 3.29l16 16-1.42 1.42-16-16z',
  unmute: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z',
  // visibility_off (outlined), like Reddit's "Show fewer posts like this" and "Hide".
  fewer: 'M12 6c3.79 0 7.17 2.13 8.82 5.5-.59 1.22-1.42 2.27-2.41 3.12l1.41 1.41c1.39-1.23 2.49-2.77 3.18-4.53C21.27 7.11 17 4 12 4c-1.27 0-2.49.2-3.64.57l1.65 1.65C10.66 6.09 11.32 6 12 6zm-1.07 1.14L13 9.21c.57.25 1.03.71 1.28 1.28l2.07 2.07c.08-.34.14-.7.14-1.07C16.5 9.01 14.48 7 12 7c-.37 0-.72.05-1.07.14zM2.01 3.87l2.68 2.68C3.06 7.83 1.77 9.53 1 11.5 2.73 15.89 7 19 12 19c1.52 0 2.98-.29 4.32-.82l3.42 3.42 1.41-1.41L3.42 2.45 2.01 3.87zm7.5 7.5l2.61 2.61c-.04.01-.08.02-.12.02-1.38 0-2.5-1.12-2.5-2.5 0-.05.01-.08.01-.13zm-3.4-3.4l1.75 1.75c-.23.55-.36 1.15-.36 1.78 0 2.48 2.02 4.5 4.5 4.5.63 0 1.23-.13 1.77-.36l.98.98c-.88.24-1.8.38-2.75.38-3.79 0-7.17-2.13-8.82-5.5.7-1.43 1.72-2.61 2.93-3.53z',
  menu: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  keep: 'M16.59 7.58 10 14.17l-3.59-3.58L5 12l5 5 8-8zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
  block: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z'
};
const BLOCK_HASH = '#rmute-block';

let mutes = { subs: [], users: [], popularWords: [], subWords: [], commentWords: [], bodyWords: [], flairWords: [], recSubs: [], recUsers: [], keepSubs: [], userSubs: [], scopes: [], timedMutes: [], settings: { hideComments: true } };
let me = null; // signed-in username (see loadMe)

/* ---------- Hiding ---------- */

// Muted content is hidden by a generated stylesheet keyed on the attributes
// Reddit puts on each post and comment. Being CSS, it applies to posts the
// moment they're inserted (no flash, no per-node scanning on infinite scroll).
// Names are restricted to [a-z0-9_-] by MuteStore.normalize, so they're safe
// to drop into attribute selectors as-is. Sub and user patterns ("*cat*",
// "cat*", "*cat") become substring, prefix or suffix matches.
function attrMatch(attr, entry, prefix = '') {
  const s = entry.replace(/\*/g, '');
  const start = entry.startsWith('*');
  const end = entry.endsWith('*');
  const op = start && end ? '*=' : start ? '$=' : end ? '^=' : '=';
  return `[${attr}${op}"${start ? s : prefix + s}" i]`;
}

function subMatch(entry) {
  return { post: [attrMatch('subreddit-prefixed-name', entry, 'r/'), attrMatch('subreddit-name', entry)], old: attrMatch('data-subreddit', entry) };
}

// A user muted only in (+) or everywhere except (-) some subs. Comments name
// their sub in their permalink (/r/<sub>/comments/…).
function scopeSel(scope, where) {
  const one = (s) => where === 'post' ? `[subreddit-name="${s}" i]`
    : where === 'comment' ? `[permalink^="/r/${s}/" i]` : `[data-subreddit="${s}" i]`;
  const any = scope.subs.map(one).join(', ');
  return scope.mode === '+' ? `:is(${any})` : `:not(${any})`;
}

function buildCss(list) {
  const posts = [];
  const other = [];
  for (const entry of list.subs) {
    const { post, old } = subMatch(entry);
    posts.push(...post.map((a) => `:is(${POST_SELECTOR})${a}`));
    other.push(`.thing${old}`);
  }
  // Recommendation-only mutes: Reddit puts recommendation-source on feed
  // posts it recommends (from subreddits the user hasn't joined). Posts on
  // r/popular carry it too, so these rules only apply on the home feed
  // (data-rmute-scope, see postScope).
  const REC = `shreddit-post[data-rmute-scope="home"][recommendation-source]:not([recommendation-source=""])`;
  const recPosts = [];
  for (const entry of list.recSubs) recPosts.push(...subMatch(entry).post.map((a) => REC + a));
  for (const u of list.recUsers) recPosts.push(REC + attrMatch('author', u));
  // Built-in filters: markPreset() tags recommended posts from city, state,
  // province or airline subreddits.
  for (const preset of PRESETS) {
    if (list.settings[PRESET_SETTING[preset]]) recPosts.push(`${REC}[data-rmute-preset~="${preset}"]`);
  }
  // Keep mode: other recommended posts shrink to the bar markPreset() puts
  // before them, so only the post goes (not its article, which holds the bar).
  if (list.settings.keepMode) other.push(`${REC}[data-rmute-preset~="undecided"]:not([data-rmute-open])`);
  // r/popular: every post starts as a bar (markPopular), recommended or not.
  const POPULAR = '[data-rmute-scope="popular"]';
  if (list.settings.collapsePopular) other.push(`shreddit-post${POPULAR}[data-rmute-preset~="undecided"]:not([data-rmute-open])`);
  // Extra feature: the built-in filters apply there too (markPopular).
  if (list.settings.popularFilters) {
    for (const preset of PRESETS) {
      if (list.settings[PRESET_SETTING[preset]]) posts.push(`shreddit-post${POPULAR}[data-rmute-preset~="${preset}"]`);
    }
  }
  // Muted words: markTitles() tags each post with what matched (see
  // markTitle): popular/subs (title lists) and body apply on r/popular and on
  // pages of subs not joined; flair, and words scoped "only in r/…", anywhere.
  const P = `:is(${POST_SELECTOR}, .thing.link)`;
  const tagged = (tag) => `[data-rmute-words~="${tag}"]`;
  const wordAnywhere = [`${P}${POPULAR}${tagged('popular')}`, `${P}${POPULAR}${tagged('body')}`, `${P}${tagged('flair')}`, `${P}${tagged('only')}`];
  const wordOnSubs = [`${P}${tagged('subs')}`, `${P}${tagged('body')}`];
  const rename = list.settings.wordAction === 'rename';
  // Feed posts under the minimum score (markScore), or seen, repeated or too
  // old, and crossposts from muted subs (markFeedFilters).
  const feedHidden = ':is([data-rmute-low], [data-rmute-seen], [data-rmute-dup], [data-rmute-old], [data-rmute-xpost])';
  posts.push(`${P}${feedHidden}`);
  // A hidden post takes its bar with it.
  other.push(`.rmute-decide:has(+ :is(${rename ? '' : wordAnywhere.join(', ') + ', '}${feedHidden}))`);
  for (const u of list.users) {
    const scope = MuteStore.scopeOf(list, 'u', u);
    const where = (kind) => (scope ? scopeSel(scope, kind) : '');
    posts.push(`:is(${POST_SELECTOR})${attrMatch('author', u)}${where('post')}`);
    other.push(`.thing.link${attrMatch('data-author', u)}${where('old')}`);
    // Only the comment itself goes, not its replies (ownParts). Old Reddit
    // keeps replies in .child.
    if (list.settings.hideComments) {
      const c = `shreddit-comment${attrMatch('author', u)}${where('comment')}`;
      other.push(...ownParts(c), `.thing.comment${attrMatch('data-author', u)}${where('old')} > :not(.child)`);
    }
    // The comment with everything under it.
    if (list.settings.hideRepliesToMuted) {
      other.push(`shreddit-comment${attrMatch('author', u)}${where('comment')}`, `.thing.comment${attrMatch('data-author', u)}${where('old')}`);
    }
  }
  // Comments with a muted word shrink to the bar markComment() puts in them
  // (long-pressing it hides the replies too), or go completely.
  const anyCword = ':is(shreddit-comment, .thing.comment)[data-rmute-cword]';
  if (list.settings.commentAction === 'hide') {
    if (list.settings.commentHideReplies) other.push(anyCword);
    else other.push(...ownParts('shreddit-comment[data-rmute-cword]'), '.thing.comment[data-rmute-cword] > :not(.child)');
  } else {
    const cword = 'shreddit-comment[data-rmute-cword]:not([data-rmute-open])';
    other.push(...ownParts(cword, '.rmute-cbar'),
      '.thing.comment[data-rmute-cword]:not([data-rmute-open]) > :not(.child, .rmute-cbar)',
      ':is(shreddit-comment, .thing.comment)[data-rmute-noreplies] > :not(.rmute-cbar)');
  }
  if (list.settings.hideCommentAvatars) other.push('shreddit-comment [slot="commentAvatar"] > *', '.thing.comment > .entry .tagline .author-avatar');
  if (list.settings.commentNames === 'hide') {
    other.push(`${COMMENT_NAME}, .thing.comment > .entry .tagline :is(.author, .userattrs)`);
  }
  // The comment box, sort and search bar, and the tree (post page dump 2026-11-02).
  if (list.settings.hideCommentSections) {
    other.push('comment-body-header, shreddit-comments-sort-dropdown, shreddit-comment-tree, shreddit-comment-tree-ads, shreddit-comment, .commentarea');
  }
  // The comments on the page of a muted user's post (markMutedPostPage).
  if (list.settings.hideCommentsOnMutedPosts) {
    other.push('html[data-rmute-muted-op] :is(comment-body-header, shreddit-comments-sort-dropdown, shreddit-comment-tree, shreddit-comment-tree-ads, shreddit-comment, .commentarea)');
  }
  posts.push(...recPosts);
  const pagePosts = rename ? [] : wordOnSubs.map((p) => ['html[data-rmute-page="subs"]', p]);
  if (!rename) posts.push(...wordAnywhere);

  // Feed posts sit in an <article> followed by an <hr>; hide those too so no
  // empty gaps or double dividers are left behind. Ads (shreddit-ad-post) sit
  // straight in the feed with no article, so their own next <hr> goes too
  // (leftover dividers stacked into grey strips on r/popular).
  const withArticle = (p) => [p, `${p} + hr`, `article:has(> ${p})`, `article:has(> ${p}) + hr`];
  const selectors = [
    ...posts.flatMap(withArticle),
    ...pagePosts.flatMap(([page, p]) => withArticle(p).map((sel) => `${page} ${sel}`)),
    ...other
  ];
  // Many small rules, not one: Chrome silently ignores selectors past about
  // the 8000th simple selector of a single rule (a 13-bit index), which with a
  // few hundred muted subs left the end of the list, and the bar collapse
  // after it, doing nothing.
  const rules = [];
  for (let i = 0; i < selectors.length; i += 100) {
    rules.push(selectors.slice(i, i + 100).join(',\n') + ' { display: none !important; }');
  }
  // Usernames in comments replaced with a placeholder.
  if (list.settings.commentNames === 'replace') {
    const names = `${COMMENT_NAME} a, .thing.comment > .entry .tagline a.author`;
    rules.push(`${names} { font-size: 0 !important; }`,
      `${names.split(', ').map((n) => n + '::before').join(', ')} { content: "Redditor"; font-size: 12px; }`);
  }
  // Rename: the post stays, its title says which word matched, and its text,
  // media and thumbnail are hidden.
  if (rename) {
    const hit = [...wordAnywhere, ...wordOnSubs.map((p) => `html[data-rmute-page="subs"] ${p}`)];
    const inHit = (sel) => hit.map((p) => `${p} ${sel}`).join(',\n');
    rules.push(
      `${inHit(':is([slot="title"], a.title)[data-rmute-hit]')} { font-size: 0 !important; }`,
      `${inHit(':is([slot="title"], a.title)[data-rmute-hit]::before')} { content: attr(data-rmute-hit); font-size: 14px; font-weight: 400; font-style: italic; opacity: 0.7; }`,
      `${inHit(':is(shreddit-post-text-body, [slot="post-media-container"], [slot="thumbnail"], .thumbnail, .expando, .expando-button)')} { display: none !important; }`
    );
  }
  return rules.join('\n');
}

// The comment author's name link (its avatar is [slot="commentAvatar"]).
const COMMENT_NAME = 'shreddit-comment [slot="commentMeta"] faceplate-tracker[noun="comment_author"]';

// A comment's own parts (header, text, actions) but not its replies. Replies
// sit deep inside the comment (details > div > div > shreddit-comment[slot="children-…"]),
// so walk the path down to them: at each level hide the siblings that hold
// no reply, and never touch anything inside a reply. keep: also left showing.
function ownParts(c, keep) {
  const reply = `shreddit-comment, [slot^="children"], [slot*="more" i]`;
  return [`:is(${c}, ${c} :has(${reply}):not(${c} shreddit-comment *)) > :not(${reply}, :has(${reply})${keep ? ', ' + keep : ''})`];
}

// The popup's on/off switch. Off: no hiding, nothing added to the page
// (content.css hides what's already there via html[data-rmute-off]).
const isOff = () => mutes.settings.enabled === false;

function applyStyle() {
  document.documentElement.toggleAttribute('data-rmute-off', isOff());
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  style.textContent = isOff() ? '' : buildCss(mutes);
  if (document.body) scheduleCount();
}

// sub: for users, the subreddit the post or comment was in (noted in the popup).
async function mute(kind, name, sub) {
  keepScroll();
  if (!mutes[kind].includes(name)) mutes[kind].push(name);
  applyStyle();
  const where = MuteStore.REC_KINDS.includes(kind) ? ' in recommendations' : '';
  showToast(`Muted ${MuteStore.isSubKind(kind) ? 'r/' : 'u/'}${name}${where}`, () => unmute(kind, name));
  try {
    await MuteStore.add(kind, name, sub);
  } catch (err) {
    showToast(err.message);
  }
}

async function unmute(kind, name) {
  mutes[kind] = mutes[kind].filter((n) => n !== name);
  applyStyle();
  await MuteStore.remove(kind, name);
}

// Pages that mix many subs: home, r/popular, r/all, a+b multis and custom
// feeds. Elsewhere (a sub, a post) the popup's "Mute all" card isn't wanted.
const SORT = '(?:(?:best|hot|new|top|rising|controversial)/?)?';
const FEED_RE = new RegExp(`^/(?:${SORT}|r/(?:popular|all|[^/]+\\+[^/]+)/${SORT}|(?:user/[^/]+|me)/m/[^/]+/${SORT}|m/[^/]+/${SORT})$`, 'i');
const onFeed = () => FEED_RE.test(location.pathname.replace(/\/?$/, '/'));

// Subs of the posts showing on the page (open or as a one-line bar), for the
// popup's "Mute all on this page". Ads, profile posts and kept subs are left out.
function pageSubs() {
  if (!onFeed()) return [];
  const posts = isOldReddit
    ? [...document.querySelectorAll('.thing[data-subreddit]:not(.promoted)')]
    : [...document.querySelectorAll('shreddit-post')];
  const subs = new Set();
  for (const post of posts) {
    const bar = post.previousElementSibling?.classList.contains('rmute-decide') ? post.previousElementSibling : null;
    if (!post.checkVisibility() && !bar?.checkVisibility()) continue;
    const sub = isOldReddit ? MuteStore.normalize(post.dataset.subreddit) : postInfo(post).sub;
    if (sub && !inList(mutes.keepSubs, sub) && !inList(mutes.subs, sub)) subs.add(sub);
  }
  return [...subs];
}

// Double-clicking a name in the popup's list: scroll to the first showing
// post from that sub (or its one-line bar) and flash it.
function scrollToSub(sub) {
  const posts = isOldReddit
    ? document.querySelectorAll('.thing[data-subreddit]:not(.promoted)')
    : document.querySelectorAll('shreddit-post');
  for (const post of posts) {
    const name = isOldReddit ? MuteStore.normalize(post.dataset.subreddit) : postInfo(post).sub;
    if (name !== sub) continue;
    const bar = post.previousElementSibling?.classList.contains('rmute-decide') ? post.previousElementSibling : null;
    const target = post.checkVisibility() ? post : bar?.checkVisibility() ? bar : null;
    if (!target) continue;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('rmute-flash');
    void target.offsetWidth; // restart the animation
    target.classList.add('rmute-flash');
    target.addEventListener('animationend', () => target.classList.remove('rmute-flash'), { once: true });
    return true;
  }
  return false;
}

async function muteMany(names) {
  names = names.filter((n) => !mutes.subs.includes(n));
  if (!names.length) return;
  keepScroll();
  mutes.subs.push(...names);
  applyStyle();
  showToast(`Muted ${names.length} subreddit${names.length === 1 ? '' : 's'}`, async () => {
    mutes.subs = mutes.subs.filter((n) => !names.includes(n));
    applyStyle();
    await Promise.all(names.map((n) => MuteStore.remove('subs', n)));
  });
  try {
    // The worker saves adds that arrive together in one go (see MuteStore.mutate).
    await Promise.all(names.map((n) => MuteStore.add('subs', n)));
  } catch (err) {
    showToast(err.message);
  }
}

// While the popup is open it holds a port here, and gets the list again
// whenever the page changes it (posts loaded by scrolling, mutes). Nothing
// is watched once the popup closes.
const subPorts = new Set();
let subsObserver = null;
let subsTimer = null;
let lastSubs = null;

function sendPageSubs() {
  subsTimer = null;
  const subs = isOff() ? [] : pageSubs();
  if (subs.join() === lastSubs) return;
  lastSubs = subs.join();
  for (const port of subPorts) port.postMessage({ subs, origin: location.origin, path: location.pathname });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rmute:pageSubs') return;
  subPorts.add(port);
  lastSubs = null;
  sendPageSubs();
  lastCount = null;
  sendCount();
  subsObserver ||= new MutationObserver(() => { subsTimer ||= setTimeout(sendPageSubs, 500); });
  subsObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-rmute-off'] });
  port.onDisconnect.addListener(() => {
    subPorts.delete(port);
    if (subPorts.size) return;
    subsObserver.disconnect();
    clearTimeout(subsTimer);
    subsTimer = null;
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'rmute:mutePage') {
    // The popup sends the names left after the user took some out.
    const subs = (msg.subs || pageSubs()).map(MuteStore.normalize).filter(Boolean);
    muteMany(subs);
    reply({ count: subs.length });
  }
  if (msg?.type === 'rmute:scrollTo') reply({ found: scrollToSub(msg.sub) });
});

/* ---------- Hidden-post counter ---------- */

// How many posts on this page show, are hidden, or are one-line bars: the
// hidden count goes on the toolbar icon, all three to the open popup. Posts
// are remembered by id while the page's path stays the same, since Reddit
// drops posts far above the viewport while scrolling.
const counted = new Map(); // post id -> 'shown' | 'bar' | 'hidden'
let countPath = null;
let countTimer = null;
let lastCount = null;
let lastBadge = '';

const everHidden = new Set(); // ids counted into the running total (background.js)

function scheduleCount() {
  const wanted = mutes.settings.showCounter || subPorts.size || lastBadge; // (a shown badge still needs clearing)
  if (wanted) countTimer ||= setTimeout(sendCount, 1000);
}

function pageCounts() {
  if (location.pathname !== countPath) {
    counted.clear();
    countPath = location.pathname;
  }
  for (const post of document.querySelectorAll(isOldReddit ? '.thing.link:not(.promoted)' : 'shreddit-post')) {
    const id = post.id || post.getAttribute('permalink');
    if (!id) continue;
    const bar = post.previousElementSibling?.classList.contains('rmute-decide') ? post.previousElementSibling : null;
    counted.set(id, post.checkVisibility() ? 'shown' : bar?.checkVisibility() ? 'bar' : 'hidden');
  }
  const counts = { shown: 0, bar: 0, hidden: 0 };
  let added = 0;
  for (const [id, state] of counted) {
    counts[state]++;
    if (state === 'hidden' && !everHidden.has(id)) {
      everHidden.add(id);
      added++;
    }
  }
  if (added && mutes.settings.extras) try { chrome.runtime.sendMessage({ type: 'rmute:addHidden', count: added }).catch(() => {}); } catch (_) { /* extension reloaded */ }
  return counts;
}

function sendCount() {
  clearTimeout(countTimer);
  countTimer = null;
  const counts = isOff() ? { shown: 0, bar: 0, hidden: 0 } : pageCounts();
  const badge = mutes.settings.showCounter && !isOff() && counts.hidden ? String(counts.hidden) : '';
  const key = JSON.stringify([counts, badge]);
  if (key === lastCount) return;
  lastCount = key;
  lastBadge = badge;
  try { chrome.runtime.sendMessage({ type: 'rmute:badge', text: badge }).catch(() => {}); } catch (_) { /* extension reloaded */ }
  for (const port of subPorts) port.postMessage({ counts });
}

/* ---------- Post actions ---------- */

function postInfo(post) {
  const prefixed = post.getAttribute('subreddit-prefixed-name') || '';
  // Posts made to a user's profile have no subreddit to mute.
  const sub = prefixed.startsWith('u/')
    ? null
    : MuteStore.normalize(prefixed || post.getAttribute('subreddit-name'));
  return { sub, author: MuteStore.normalize(post.getAttribute('author')) };
}

// The subreddit a post, comment or link is in: its post's, else the page's
// (/r/<sub>/…, as on a comments page). Null on profiles and home without a post.
function subOf(el) {
  const post = el && ancestors(el).find((n) => n.matches?.(POST_SELECTOR));
  if (post) return postInfo(post).sub;
  const m = location.pathname.match(/^\/r\/([^/]+)/i);
  return m ? MuteStore.normalize(m[1]) : null;
}

function joinButtonOf(post) {
  const join = post.querySelector('shreddit-join-button');
  if (!join) return null;
  const text = (join.shadowRoot?.textContent || '') + join.textContent;
  if (join.hasAttribute('subscribed') || /\bjoined\b/i.test(text)) return null;
  return join;
}

// The header Join button is hidden by content.css; this drives it from the menu.
function clickJoin(join) {
  (join.shadowRoot?.querySelector('button') || join.querySelector('button') || join).click();
}

// Reddit marks the feed posts it recommends (subs the user hasn't joined).
// Only the home feed counts: r/popular posts carry the attribute too.
const HOME_RE = /^\/(?:(?:best|hot|new|top|rising)\/?)?$/i;
const onHome = () => HOME_RE.test(location.pathname);
const onPopular = () => location.pathname.match(LISTING_RE)?.[1].toLowerCase() === 'popular';
const isRecommended = (post) => postScope(post) === 'home' && !!post.getAttribute('recommendation-source');

// The page a post was loaded on (home, popular or other), kept on the post as
// data-rmute-scope. Reddit changes the URL before it swaps the old feed out,
// so going by the URL expanded the old page's bars for a moment after a
// click. r/popular's feed also names itself (reload-url .../popular-feed).
function postScope(post) {
  if (/\/popular-feed\b/.test(post.closest('shreddit-feed')?.getAttribute('reload-url') || '')) {
    post.dataset.rmuteScope = 'popular';
  }
  return post.dataset.rmuteScope ||= onPopular() ? 'popular' : onHome() ? 'home' : 'other';
}

// Actions in menu order. Mute r/… has its own button under the ⋯ (see
// addMuteButtons), so it's only in the fallback popover and, where that
// button is hidden (post pages), the native menu. On recommended posts the
// button is "Show fewer posts like this" instead, so the menu has both mutes.
function actionsFor(post, { withMuteSub = isRecommended(post) || !post.querySelector('.rmute-under-btn')?.checkVisibility() } = {}) {
  const { sub, author } = postInfo(post);
  const actions = [];
  const join = joinButtonOf(post);
  if (join && sub) actions.push({ label: 'Join', icon: ICONS.join, first: true, run: () => { clickJoin(join); rememberJoined(sub); } });
  if (sub && withMuteSub) {
    actions.push({ label: `Mute r/${sub}${isRecommended(post) ? ' everywhere' : ''}`, icon: ICONS.mute, run: () => mute('subs', sub) });
  }
  if (sub && isRecommended(post)) {
    actions.push({ label: `Mute r/${sub} in recommendations`, icon: ICONS.mute, run: () => mute('recSubs', sub) });
  }
  if (author) actions.push({ label: `Mute u/${author}`, icon: ICONS.mute, run: () => mute('users', author, sub) });
  return actions;
}

/* ---------- Mute r/ button under the ⋯ ---------- */

// The ⋯ and a round mute button are stacked in a small column wrapper, so the
// button sits right under the ⋯ without covering the title.
function addMuteButton(menu) {
  menu.dataset.rmuteUnder = '';
  const post = menu.closest(POST_SELECTOR);
  const sub = post && postInfo(post).sub;
  if (!sub) return;

  const column = document.createElement('span');
  column.className = 'rmute-under';
  // Post pages hide the button (content.css); Mute r/ goes in the menu. Set
  // once here, because Reddit changes the URL before swapping the page out.
  if (location.pathname.includes('/comments/')) column.dataset.rmutePost = '';
  // If the ⋯ is slotted straight into the post, the wrapper takes its place.
  if (menu.slot) {
    column.slot = menu.slot;
    menu.removeAttribute('slot');
  }
  // Recommended posts get Reddit's own "Show fewer posts like this" instead.
  const fewer = isRecommended(post);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = fewer ? 'rmute-under-btn rmute-fewer' : 'rmute-under-btn';
  button.title = fewer ? 'Show fewer posts like this and hide' : `Mute r/${sub}`;
  button.setAttribute('aria-label', button.title);
  button.appendChild(makeSvg(fewer ? ICONS.fewer : ICONS.mute));
  // The post itself opens on click; keep that from happening.
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (fewer) showFewer(post, menu);
    else mute('subs', sub);
  });
  menu.before(column);
  column.append(menu, button);
}

function addMuteButtons() {
  if (isOff()) return;
  document.querySelectorAll(`:is(${POST_SELECTOR}) shreddit-post-overflow-menu:not([data-rmute-under])`).forEach(addMuteButton);
}

/* ---------- Native menu injection ---------- */

// Every element under root, descending into open shadow roots, minus subtrees
// for which skip() is true.
function* walk(root, skip) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node !== root && skip?.(node)) continue;
    if (node.nodeType === Node.ELEMENT_NODE) yield node;
    if (node.shadowRoot) stack.push(node.shadowRoot);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
}

function itemText(el) {
  return el.textContent.replace(/\s+/g, ' ').trim();
}

function findItem(root, test) {
  for (const el of walk(root)) {
    if (!el.matches('li, [role="menuitem"]') || el.dataset.rmuteItem !== undefined) continue;
    const text = itemText(el);
    if (text.length < 30 && test(text)) return el.matches('li') ? el : (el.closest('li') || el);
  }
  return null;
}

const isHide = (t) => /^hide\b/i.test(t);
const isReport = (t) => /^report\b/i.test(t);
const isBlock = (t) => /^block\b/i.test(t);
// Only the signed-in user's own comments have these.
const isOwnItem = (t) => /^(edit|delete)\b/i.test(t);

function makeSvg(pathData, like) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const [attr, fallbackValue] of [['width', '20'], ['height', '20'], ['class', null]]) {
    const value = like?.getAttribute(attr) || fallbackValue;
    if (value) svg.setAttribute(attr, value);
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  return svg;
}

function closeMenu(from) {
  from.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

// Clones one of Reddit's own controls so ours look native, then swaps the
// label (the text node matching isLabel) and icon. Lit binds handlers on the
// original, so clones are inert.
function cloneLike(template, action, isLabel) {
  const item = template.cloneNode(true);
  item.dataset.rmuteItem = '';
  for (const el of [item, ...item.querySelectorAll('*')]) {
    for (const attr of ['id', 'href', 'value', 'data-testid', 'aria-label']) el.removeAttribute(attr);
  }

  const textNode = [...walk(item)]
    .flatMap((el) => [...el.childNodes])
    .find((n) => n.nodeType === Node.TEXT_NODE && isLabel(n.data.trim()));
  if (action.label) {
    if (textNode) textNode.data = action.label;
    else item.textContent = action.label;
  } else if (textNode) {
    // Icon only: drop the label and its now-empty wrapper.
    const holder = textNode.parentElement;
    textNode.remove();
    if (holder !== item && !holder.textContent.trim() && !holder.querySelector('svg')) holder.remove();
  }
  if (action.title) {
    item.title = action.title;
    item.setAttribute('aria-label', action.title);
  }

  const icon = item.querySelector('svg');
  if (icon) icon.replaceWith(makeSvg(action.icon, icon));
  return item;
}

function makeItem(template, action, isLabel) {
  const item = cloneLike(template, action, isLabel);
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    closeMenu(template);
    action.run();
  }, true);
  return item;
}

// Something in the mute path can throw the page back to the top. Undo only
// that jump; ordinary shifts (posts hidden above the viewport, which Chrome's
// scroll anchoring already compensates for) are left alone. Stops once the
// user scrolls themselves.
function keepScroll() {
  let last = window.scrollY;
  const onScroll = () => {
    const y = window.scrollY;
    if (y < 10 && last > 100) window.scrollTo({ top: last, behavior: 'instant' });
    else last = y;
  };
  const userEvents = ['wheel', 'touchmove', 'keydown'];
  const stop = () => {
    window.removeEventListener('scroll', onScroll);
    for (const t of userEvents) window.removeEventListener(t, stop);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  for (const t of userEvents) window.addEventListener(t, stop, { passive: true });
  setTimeout(stop, 1000);
}

// Inserts actions ahead of `anchor` (a native item, also the style template),
// or at the top of the menu for `first` actions.
function injectItems(anchor, actions, isLabel) {
  const list = anchor.parentNode;
  [...list.children].filter((n) => n.dataset?.rmuteItem !== undefined).forEach((n) => n.remove());

  for (const action of actions) {
    const item = makeItem(anchor, action, isLabel);
    list.insertBefore(item, action.first ? list.firstElementChild : anchor);
  }
  return list;
}

function injectPostItems(hide, post) {
  const list = injectItems(hide, actionsFor(post), isHide);
  // Order before Hide: Mute r/…, Mute u/…, then Reddit's own Block if it has one.
  const block = findItem(list, isBlock);
  if (block && block !== hide) list.insertBefore(block, hide);
}

// Popups may be rendered outside the post (appended to <body>); search there
// too, but skip the app shell, which is the bulk of the page.
function findItemAnywhere(menuHost, test) {
  const inMenu = findItem(menuHost, test);
  if (inMenu) return inMenu;
  for (const child of document.body.children) {
    if (child.tagName === 'SHREDDIT-APP') continue;
    const found = findItem(child, test);
    if (found) return found;
  }
  return null;
}

// The menu renders a moment after the click; poll briefly for it.
function waitForMenu(menuHost, post) {
  const started = performance.now();
  const tick = () => {
    const hide = findItemAnywhere(menuHost, isHide);
    if (hide) return injectPostItems(hide, post);
    if (performance.now() - started < 1000) setTimeout(tick, 30);
    else showFallbackMenu(menuHost, actionsFor(post, { withMuteSub: true }));
  };
  setTimeout(tick, 0);
}

/* ---------- Fallback menu ---------- */

// Used when Reddit's menu can't be found (closed shadow root or a redesign),
// so muting from the feed always works.
let fallback = null;

function closeFallback() {
  if (!fallback) return;
  fallback.remove();
  fallback = null;
  document.removeEventListener('click', onOutsideClick, true);
  document.removeEventListener('keydown', onFallbackKey, true);
  window.removeEventListener('scroll', closeFallback, true);
}

function onOutsideClick(e) {
  if (fallback && !e.composedPath().includes(fallback)) closeFallback();
}

function onFallbackKey(e) {
  if (e.key === 'Escape') closeFallback();
}

function showFallbackMenu(anchor, actions) {
  closeFallback();
  if (!actions.length) return;

  fallback = document.createElement('div');
  fallback.className = 'rmute-pop';
  fallback.setAttribute('role', 'menu');
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.append(makeSvg(action.icon), document.createTextNode(action.label));
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeFallback();
      action.run();
    });
    fallback.appendChild(button);
  }

  const rect = anchor.getBoundingClientRect();
  fallback.style.top = `${rect.bottom + 4}px`;
  fallback.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  document.body.appendChild(fallback);

  setTimeout(() => {
    document.addEventListener('click', onOutsideClick, true);
    document.addEventListener('keydown', onFallbackKey, true);
    window.addEventListener('scroll', closeFallback, true);
  }, 0);
}

/* ---------- Comment menu ---------- */

// A comment's ⋯ menu (Follow comment, Report, Save, …) gets "Mute u/…" and
// "Block u/…" above Report. They do the same as the hover card's buttons.
function commentActions(comment) {
  const user = MuteStore.normalize(comment.getAttribute('author'));
  if (!user || user === me) return [];
  return [
    { label: `Mute u/${user}`, icon: ICONS.mute, run: () => mute('users', user, subOf(comment)) },
    { label: `Block u/${user}`, icon: ICONS.block, run: () => blockUser(user) }
  ];
}

const isVisible = (el) => el.getClientRects().length > 0;

function waitForCommentMenu(roots, anchor, comment) {
  const started = performance.now();
  const tick = () => {
    for (const root of roots) {
      // Backstop for when the signed-in name isn't known: it's your own
      // comment, so leave its menu alone (and show no fallback).
      const own = findItem(root, isOwnItem);
      if (own && isVisible(own)) return;
      const report = findItem(root, (t) => isReport(t));
      if (report && isVisible(report)) return injectItems(report, commentActions(comment), isReport);
    }
    if (performance.now() - started < 1000) setTimeout(tick, 30);
    else showFallbackMenu(anchor, commentActions(comment));
  };
  setTimeout(tick, 0);
}

// Is this the comment's ⋯ button (not Reply, Vote, Share…)?
function isOverflowTrigger(el) {
  if (el.localName?.includes('overflow')) return true;
  return el.matches?.('button') &&
    (el.hasAttribute('aria-haspopup') || /more|option|overflow|actions/i.test(el.getAttribute('aria-label') || ''));
}

function onCommentClick(path, commentIndex) {
  const inside = path.slice(0, commentIndex);
  // Clicking an item inside the open menu isn't an "open the menu" click.
  if (inside.some((n) => n.matches?.('li, [role="menuitem"]'))) return;
  const trigger = inside.find(isOverflowTrigger);
  if (!trigger) return;

  const comment = path[commentIndex];
  if (!commentActions(comment).length) return;
  // Search the clicked action row (the comment's light-DOM child, so not the
  // nested replies; the path also passes through the comment's own shadow
  // root via its slot) and anything portalled to <body>.
  const roots = [inside.find((n) => n.parentNode === comment) || trigger];
  for (const child of document.body.children) {
    if (child.tagName !== 'SHREDDIT-APP') roots.push(child);
  }
  waitForCommentMenu(roots, trigger, comment);
}

function onDocumentClick(e) {
  if (driving || isOff()) return;
  const path = e.composedPath();
  if (path.some((n) => n.dataset?.rmuteItem !== undefined) || (fallback && path.includes(fallback))) return;
  // A username click opens its card, not a menu.
  const userLink = userLinkIn(path);
  if (userLink) return watchCard(path, userLink);

  const commentIndex = path.findIndex((n) => n.tagName === 'SHREDDIT-COMMENT');
  const menuIndex = path.findIndex((n) => n.tagName === 'SHREDDIT-POST-OVERFLOW-MENU');
  if (commentIndex !== -1 && (menuIndex === -1 || commentIndex < menuIndex)) return onCommentClick(path, commentIndex);
  if (menuIndex === -1) return;
  // Clicking an item inside the open menu isn't an "open the menu" click.
  if (path.slice(0, menuIndex).some((n) => n.matches?.('li, [role="menuitem"]'))) return;

  const menuHost = path[menuIndex];
  const post = menuHost.closest(POST_SELECTOR);
  if (post) waitForMenu(menuHost, post);
}

/* ---------- User hover card ---------- */

// Hovering a username opens a profile card that ends in a row of pill buttons
// (Follow, then Start Chat or Message Mods). Mute and Block are added after
// them, cloned from the chat button so they match.
const isChat = (t) => /^(start chat|chat|message( mods?)?)$/i.test(t);
const isFollow = (t) => /^(follow|following|unfollow)$/i.test(t);

function userFromHref(href) {
  const m = (href || '').match(/^(?:https?:\/\/[^/]+)?\/u(?:ser)?\/([^/?#]+)/i);
  return m ? MuteStore.normalize(m[1]) : null;
}

// Ancestor chain, stepping out of shadow roots to their hosts.
function ancestors(el) {
  const out = [];
  for (let n = el; n; n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentElement) out.push(n);
  return out;
}

// Visible buttons only, and not inside nested replies (their cards are
// someone else's).
const isNestedComment = (n) => n.localName === 'shreddit-comment';

function findButton(root, test) {
  for (const el of walk(root, isNestedComment)) {
    if (el.matches('button, a') && el.dataset.rmuteItem === undefined && test(itemText(el)) && isVisible(el)) return el;
  }
  return null;
}

// The card is inside the link's *hovercard* ancestor when there is one.
// Otherwise (as in comments, where it's a sibling of the link) search the
// whole comment or post the link is in.
function cardRoots(path, link) {
  const roots = [];
  const card = path.find((n) => n.localName?.includes('hovercard'));
  const container = ancestors(link).find((n) => n.matches?.(`shreddit-comment, ${POST_SELECTOR}`));
  roots.push(card || container || link.parentElement?.parentElement?.parentElement || link);
  // The card itself may be portalled to <body>.
  for (const child of document.body.children) {
    if (child.tagName !== 'SHREDDIT-APP') roots.push(child);
  }
  return roots;
}

// The row child holding the chat button: our buttons go right after it.
function rowSlot(chat, follow) {
  if (!follow) return chat;
  const followUp = new Set(ancestors(follow));
  const up = ancestors(chat);
  const i = up.findIndex((n) => followUp.has(n));
  return i > 0 ? up[i - 1] : chat;
}

// Mute is an icon with a tooltip (a speaker once muted, to unmute).
function cardActions(user, sub) {
  const muted = mutes.users.includes(user);
  return [
    muted
      ? { label: '', title: `Unmute u/${user}`, icon: ICONS.unmute, run: () => unmuteUser(user) }
      : { label: '', title: `Mute u/${user}`, icon: ICONS.mute, run: () => mute('users', user, sub) },
    { label: 'Block', icon: ICONS.block, run: () => blockUser(user) }
  ];
}

async function unmuteUser(user) {
  const sub = MuteStore.subNoteFor(mutes, user);
  showToast(`Unmuted u/${user}`, () => mute('users', user, sub));
  await unmute('users', user);
}

// Returns true once the card is found and has the buttons (or is a comment
// card, which gets none: the comment's ⋯ menu has Mute and Block).
function injectCard(roots, user, sub) {
  for (const root of roots) {
    const chat = findButton(root, isChat);
    if (!chat) continue;
    const slot = rowSlot(chat, findButton(root, isFollow));
    const parent = slot.parentNode;
    const existing = [...parent.children].filter((n) => n.dataset?.rmuteItem !== undefined);
    // A card that sits inside a comment is a comment card, whatever opened it.
    if (ancestors(chat).some((n) => n.tagName === 'SHREDDIT-COMMENT')) {
      existing.forEach((n) => n.remove());
      return true;
    }
    // The card element is reused between users; rebuild if it's someone else's.
    if (existing.length && existing.every((n) => n.dataset.rmuteUser === user)) return true;
    existing.forEach((n) => n.remove());

    // Clone the whole slot when the chat button sits in its light DOM, so any
    // wrapper's spacing comes along; otherwise just the button.
    const template = slot === chat || slot.contains(chat) ? slot : chat;
    let after = slot;
    for (const action of cardActions(user, sub)) {
      const button = cloneLike(template, action, isChat);
      button.dataset.rmuteUser = user;
      // Reddit's spacing between the pills isn't on the cloned element.
      if (button instanceof HTMLElement) button.style.marginInlineStart = '8px';
      button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        action.run();
        // Rebuild to flip Mute ⇄ Unmute.
        [...parent.children].filter((n) => n.dataset?.rmuteItem !== undefined).forEach((n) => n.remove());
        injectCard(roots, user, sub);
      }, true);
      parent.insertBefore(button, after.nextSibling);
      after = button;
    }
    if (parent instanceof Element) parent.style.flexWrap = 'wrap';
    return true;
  }
  return false;
}

let hoverLink = null;

const userLinkIn = (path) => path.find((n) => n.tagName === 'A' && userFromHref(n.getAttribute('href')));

// The card opens after a hover delay (or, on comments, a click on the name)
// and loads its contents, so poll a while. A click restarts the poll.
function onPointerOver(e) {
  if (isOff()) return;
  const path = e.composedPath();
  const link = userLinkIn(path);
  if (link && link !== hoverLink) watchCard(path, link);
}

function watchCard(path, link) {
  if (link.dataset.rmuteItem !== undefined) return;
  const user = userFromHref(link.getAttribute('href'));
  // Comment cards get nothing.
  if (user === me || path.some((n) => n.tagName === 'SHREDDIT-COMMENT')) return;
  hoverLink = link;
  const roots = cardRoots(path, link);
  const sub = subOf(link);
  const started = performance.now();
  const tick = () => {
    if (hoverLink !== link || injectCard(roots, user, sub)) return;
    if (performance.now() - started < 3000) setTimeout(tick, 100);
  };
  setTimeout(tick, 100);
  link.addEventListener('pointerleave', () => setTimeout(() => {
    if (hoverLink === link) hoverLink = null;
  }, 3000), { once: true });
}

/* ---------- Block (via the profile page) ---------- */

// Blocking has no link of its own, so Block opens the user's profile and
// drives Reddit's own "Block" menu item there, which asks for confirmation.
function blockUser(user) {
  if (userFromHref(location.pathname) === user) openNativeBlock();
  else location.assign(`/user/${user}/${BLOCK_HASH}`);
}

function inPostOrComment(el) {
  return ancestors(el).some((n) => n.matches?.(`${POST_SELECTOR}, shreddit-comment, shreddit-post-overflow-menu`));
}

function findProfileMenuButton() {
  for (const el of walk(document.body)) {
    if (el.matches('button') && /more|option|overflow/i.test(el.getAttribute('aria-label') || '') && !inPostOrComment(el)) return el;
  }
  return null;
}

function openNativeBlock() {
  const started = performance.now();
  let opened = false;
  const tick = () => {
    const block = findItem(document.body, (t) => isBlock(t));
    if (block && !inPostOrComment(block)) {
      (block.querySelector('[role="menuitem"], a, button, div, span') || block).click();
      return;
    }
    if (!opened) {
      const more = findProfileMenuButton();
      if (more) {
        more.click();
        opened = true;
      }
    }
    if (performance.now() - started < 8000) setTimeout(tick, 200);
    else showToast('Couldn’t find Reddit’s Block option. Use the ⋯ menu on this profile.');
  };
  tick();
}

function runPendingBlock() {
  if (location.hash !== BLOCK_HASH) return;
  history.replaceState(null, '', location.pathname + location.search);
  openNativeBlock();
}

/* ---------- Show fewer (recommended posts) ---------- */

// The button under a recommended post's ⋯ does what the user would do by hand
// in Reddit's menu: "Show fewer posts like this", then "Hide". Reddit handles
// both (no toast, no extension-side hiding).
const isShowFewer = (t) => /^show fewer\b/i.test(t);
let driving = false; // the extension's own ⋯ clicks get no injected items

const clickItem = (item) => (item.querySelector('a, button, [role="menuitem"]') || item).click();

// Opens the ⋯ (unless its menu is already open) and polls for an item.
function pickFromMenu(menuHost, test, done) {
  const started = performance.now();
  let opened = false;
  const tick = () => {
    const item = findItemAnywhere(menuHost, test);
    if (item) {
      driving = false;
      clickItem(item);
      return done(true);
    }
    // Give a still-open menu a moment before reopening it.
    if (!opened && performance.now() - started > 300) {
      opened = true;
      driving = true;
      [...walk(menuHost)].find((el) => el.matches('button'))?.click();
    }
    if (performance.now() - started < 1800) return setTimeout(tick, 30);
    driving = false;
    done(false);
  };
  tick();
}

function showFewer(post, menuHost) {
  pickFromMenu(menuHost, isShowFewer, () => {
    // "Show fewer" closes the menu (or swaps the post); reopen for Hide.
    setTimeout(() => pickFromMenu(menuHost, isHide, () => {}), 150);
  });
}

// Older versions hid these posts themselves; drop what they stored.
chrome.storage.local.remove('hiddenPosts');

/* ---------- Reddit's "Post hidden" toast ---------- */

// Reddit's toasts are faceplate-toast elements in alert-controller's shadow
// root (alert-controller > #shadow-root > toaster-lite > faceplate-toast, from
// a live dump), out of reach of page CSS. Only "Post hidden" is suppressed.
let toastRoot = null;

function hidePostHiddenToasts(root) {
  if (isOff()) return;
  for (const toast of root.querySelectorAll('faceplate-toast')) {
    if (/^post hidden$/i.test(itemText(toast))) toast.style.setProperty('display', 'none', 'important');
  }
}

function watchToasts() {
  const root = document.querySelector('alert-controller')?.shadowRoot;
  if (!root || root === toastRoot) return;
  toastRoot = root;
  hidePostHiddenToasts(root);
  new MutationObserver(() => hidePostHiddenToasts(root)).observe(root, { childList: true, subtree: true, characterData: true });
}

/* ---------- Toast ---------- */

let toastTimer = null;

function showToast(message, undo) {
  document.querySelector('.rmute-toast')?.remove();
  clearTimeout(toastTimer);

  const toast = document.createElement('div');
  toast.className = 'rmute-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  if (undo) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Undo';
    button.addEventListener('click', () => {
      toast.remove();
      undo();
    });
    toast.appendChild(button);
  }
  document.body.appendChild(toast);
  toastTimer = setTimeout(() => toast.remove(), 6000);
}

/* ---------- Reddit's own Muted communities ---------- */

// On reddit.com/settings/preferences, the Muted communities box (light DOM, see CLAUDE.md) gets a
// button that adds the extension's exact sub names Reddit doesn't have yet. Patterns can't go in.
// Reddit saves nothing until its Save button, so the user still presses that.
let nativeRun = null; // { stop } while adding

function nativeBox() {
  const title = document.getElementById('muted-communities-modal-title');
  const card = title?.closest('rpl-modal-card');
  const field = card?.querySelector('faceplate-text-input[placeholder="Mute new community"]');
  return field?.shadowRoot && { card, title, field };
}

const nativeMuted = (card) => new Set([...card.querySelectorAll('li span')]
  .map((s) => s.textContent.trim().toLowerCase()).filter((t) => t.startsWith('r/')).map((t) => t.slice(2)));

const nativeMissing = (card) => {
  const have = nativeMuted(card);
  return mutes.subs.filter((name) => !name.includes('*') && !have.has(name));
};

function syncNativeButton() {
  if (isOff() || !location.pathname.startsWith('/settings')) return;
  const box = nativeBox();
  if (!box) return;
  let wrap = box.card.querySelector('.rmute-native');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'rmute-native';
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => (nativeRun ? nativeRun.stop() : addToNative()));
    const note = document.createElement('span');
    wrap.append(button, note);
    (box.card.querySelector('#muted-communities-modal-desc') || box.title).after(wrap);
  }
  if (nativeRun) return;
  const count = nativeMissing(box.card).length;
  const [button, note] = wrap.children;
  button.textContent = count ? `Add ${count} from Mute List` : 'All of Mute List is here';
  button.disabled = !count;
  if (!wrap.dataset.done) note.textContent = '';
}

async function addToNative() {
  const box = nativeBox();
  if (!box) return;
  const { card, field } = box;
  const input = field.shadowRoot.querySelector('input');
  const addBtn = field.querySelector('button[slot="trailingIconButton"]');
  const [button, note] = card.querySelector('.rmute-native').children;
  const names = nativeMissing(card);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const failed = [];
  let added = 0;
  let stopped = false;
  nativeRun = { stop: () => { stopped = true; } };
  for (const [i, name] of names.entries()) {
    if (stopped || !card.isConnected) break;
    button.textContent = `Adding ${i + 1} of ${names.length}… (Stop)`;
    if (nativeMuted(card).has(name)) continue;
    input.focus();
    input.value = name;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    addBtn?.click();
    let ok = false;
    for (let t = 0; t < 40 && !ok; t++) { await sleep(100); ok = nativeMuted(card).has(name); }
    if (ok) added++; else failed.push(name);
    await sleep(250 + Math.random() * 500);
  }
  nativeRun = null;
  input.value = '';
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  card.querySelector('.rmute-native').dataset.done = '1';
  note.textContent = `Added ${added}.${failed.length ? ` Not found: ${failed.map((n) => `r/${n}`).join(', ')}.` : ''} Press Save to keep them.`;
  syncNativeButton();
}

/* ---------- Title words ---------- */

const FEEDS_KEY = 'feedSubs';
const FEEDS_MAX_AGE = 6 * 60 * 60 * 1000;
const LISTING_RE = /^\/r\/([^/]+)\/?(?:(?:best|hot|new|top|rising|controversial)\/?)?$/i;

let wordMatchers = {}; // word list -> compileScoped() result, or null when empty
let feedSubs = null; // Set of subreddits joined or in the user's custom feeds, once known

// "café" and "cafe" count as the same word. Only marks on Latin letters go:
// in Hindi or Japanese, for one, a mark can make it a different word.
function foldAccents(text) {
  if (!/[^\x00-\x7f]/.test(text)) return text;
  return text.normalize('NFD').replace(/(\p{Script=Latin})[\u0300-\u036f]+/gu, '$1').normalize('NFC');
}

// Whole words or phrases, case-insensitive, ignoring accents; "*" matches any
// letters, so "spoil*" covers "spoiler" and "spoilers".
function compileWords(words) {
  if (!words.length) return null;
  const parts = words.map((w) => foldAccents(w)
    .split('*')
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'))
    .join('[\\p{L}\\p{N}_]*'));
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${parts.join('|')})(?![\\p{L}\\p{N}_])`, 'iu');
}

// Words with a subreddit scope are tested one by one; the rest as one regex.
function compileScoped(words) {
  if (!words.length) return null;
  const plain = [];
  const scoped = [];
  for (const word of words) {
    const scope = MuteStore.scopeOf(mutes, 'w', word);
    if (scope) scoped.push({ re: compileWords([word]), ...scope });
    else plain.push(word);
  }
  return { all: compileWords(plain), scoped };
}

// { text, only } when the text has a muted word that applies in this sub:
// only = the word is scoped "only in" this sub, so it applies on every page.
function wordHit(m, text, sub) {
  if (!m || !text) return null;
  text = foldAccents(text);
  const found = m.all?.exec(text);
  if (found) return { text: found[0].trim(), only: false };
  let hit = null;
  for (const s of m.scoped) {
    const match = s.re.exec(text);
    if (!match) continue;
    const listed = !!sub && s.subs.includes(sub);
    if (s.mode === '+' && listed) return { text: match[0].trim(), only: true };
    if (s.mode === '-' && !listed) hit ||= { text: match[0].trim(), only: false };
  }
  return hit;
}

function postTitle(post) {
  if (post.matches('.thing')) return post.querySelector('a.title')?.textContent || '';
  return post.getAttribute('post-title') || titleLink(post)?.textContent || '';
}

const titleLink = (post) => post.querySelector(post.matches('.thing') ? 'a.title' : '[slot="title"], a[id^="post-title"]');

// A text post's body (in the feed too, clamped by CSS) or old Reddit's expanded one.
function postBody(post) {
  if (post.matches('.thing')) return post.querySelector('.expando .md, .usertext-body .md')?.textContent || '';
  return post.querySelector('shreddit-post-text-body, [id$="-post-rtjson-content"]')?.textContent || '';
}

function postFlair(post) {
  if (post.matches('.thing')) return [...post.querySelectorAll('.linkflairlabel')].map((f) => f.title || f.textContent).join(' ');
  return post.querySelector('shreddit-post-flair')?.textContent || '';
}

const postSub = (post) => (post.matches('.thing') ? MuteStore.normalize(post.dataset.subreddit) : postInfo(post).sub);

function markTitle(post) {
  markPreset(post);
  markScore(post);
  const sub = postSub(post);
  const tags = new Set();
  let label = null;
  const check = (kind, text, tag) => {
    const hit = wordHit(wordMatchers[kind], text, sub);
    if (!hit) return;
    tags.add(hit.only ? 'only' : tag);
    label ||= hit.text;
  };
  const title = postTitle(post);
  check('popularWords', title, 'popular');
  check('subWords', title, 'subs');
  if (wordMatchers.bodyWords) check('bodyWords', postBody(post), 'body');
  if (wordMatchers.flairWords) check('flairWords', postFlair(post), 'flair');
  if (tags.size) post.dataset.rmuteWords = [...tags].join(' ');
  else delete post.dataset.rmuteWords;
  // Shown in place of the title when muted words rename instead of hide.
  const link = titleLink(post);
  if (label) link?.setAttribute('data-rmute-hit', `Muted word: “${label}”`);
  else link?.removeAttribute('data-rmute-hit');
  markFeedFilters(post);
  markMutedPostPage(post, sub);
}

// On a post's own page, tags <html> when a muted user wrote it. Cleared on
// leaving the page (updatePageScope).
const threadOf = (path) => path?.match(/\/comments\/([a-z0-9]+)/i)?.[1].toLowerCase();

function markMutedPostPage(post, sub) {
  const html = document.documentElement;
  const on = mutes.settings.hideCommentsOnMutedPosts;
  if (!on && !html.hasAttribute('data-rmute-muted-op')) return;
  const author = post.getAttribute('author') || post.dataset.author;
  if (!author || threadOf(post.getAttribute('permalink') || post.dataset.permalink) !== threadOf(location.pathname) || !threadOf(location.pathname)) return;
  html.toggleAttribute('data-rmute-muted-op', on && userMuted(author.toLowerCase(), sub));
}

/* ---------- Minimum score ---------- */

// Old Reddit's front page, r/all, r/popular and multireddits.
const OLD_FEED_RE = /^\/(?:(?:hot|new|top|rising|controversial)\/?)?$|^\/r\/(?:all|popular)\b|^\/(?:me|user\/[^/]+)\/m\//i;

// Only in feeds (home, r/popular, r/all, custom feeds), not on a sub's own page.
const inFeed = (post) => (post.matches('.thing') ? OLD_FEED_RE.test(location.pathname) : post.getAttribute('view-context') === 'AggregateFeed');

function markScore(post) {
  const min = Number(mutes.settings.minScore) || 0;
  const score = parseInt(post.getAttribute('score') ?? post.dataset.score, 10);
  post.toggleAttribute('data-rmute-low', min > 0 && inFeed(post) && Number.isFinite(score) && score < min);
}

/* ---------- Seen posts, repeated links, age limit, crossposts (Extra features 2) ---------- */

function markFeedFilters(post) {
  if (post.matches('shreddit-ad-post, .promoted')) return; // ads are left alone
  const { hideSeen, hideDuplicates, maxAgeHours, hideCrossposts } = mutes.settings;
  if (!hideSeen && !hideDuplicates && !maxAgeHours && !hideCrossposts &&
    !post.matches('[data-rmute-seen], [data-rmute-dup], [data-rmute-old], [data-rmute-xpost]')) return;
  markCrosspost(post, hideCrossposts); // on every page, like a muted sub's own posts
  const feed = inFeed(post);
  markSeen(post, feed && hideSeen);
  markDuplicate(post, feed && hideDuplicates);
  markOld(post, feed ? Number(maxAgeHours) || 0 : 0);
}

// A crosspost names its source only in its link: /r/<sub>/comments/… (a
// crosspost's own sub is in subreddit-name). Old Reddit: a data-url like that.
function markCrosspost(post, on) {
  const crosspost = post.matches('.thing') || post.getAttribute('post-type') === 'crosspost';
  const href = on && crosspost ? post.getAttribute('content-href') || post.dataset.url : '';
  const source = MuteStore.normalize(href?.match(/\/r\/([^/]+)\/comments\//i)?.[1]);
  post.toggleAttribute('data-rmute-xpost', !!source && inList(mutes.subs, source));
}

// "2026-11-01T03:15:34.429000+0000" (always UTC); old Reddit has data-timestamp in ms.
function markOld(post, hours) {
  const stamp = post.getAttribute('created-timestamp');
  const at = stamp ? Date.parse(stamp.slice(0, 19) + 'Z') : Number(post.dataset.timestamp);
  post.toggleAttribute('data-rmute-old', hours > 0 && at > 0 && Date.now() - at > hours * 3600000);
}

// Tracking bits that don't change what a link points to.
const LINK_NOISE = /^(utm_.*|ref|ref_source|ref_src|si|fbclid|gclid|share_id|feature)$/i;

// What a post links to, the same for all its forms. A crosspost's link is the
// original thread, so it counts as a repeat of that thread too.
function linkKey(post) {
  const href = post.getAttribute('content-href') || post.dataset.url || post.getAttribute('permalink');
  if (!href) return null;
  try {
    const url = new URL(href, location.origin);
    const host = url.hostname.replace(/^(www|m|old|new|np)\./, '');
    const thread = url.pathname.match(/\/comments\/([a-z0-9]+)/i);
    if (thread && (host === 'reddit.com' || url.origin === location.origin)) return `reddit:${thread[1].toLowerCase()}`;
    if (host === 'youtu.be') return `youtube.com/watch?v=${url.pathname.slice(1)}`;
    for (const key of [...url.searchParams.keys()]) if (LINK_NOISE.test(key)) url.searchParams.delete(key);
    return host + url.pathname.replace(/\/$/, '') + url.search;
  } catch (_) {
    return null;
  }
}

// The first post of a link on this page holds it; later ones hide while the
// holder shows, so a repeat of a muted post isn't lost with it. A holder that
// Reddit has unloaded far above the viewport still counts.
const linkHolders = new Map(); // link -> { post, id }
let linkPath = null;

function markDuplicate(post, on) {
  let dup = false;
  const key = on && linkKey(post);
  if (key) {
    if (location.pathname !== linkPath) {
      linkHolders.clear();
      linkPath = location.pathname;
    }
    const id = post.dataset.fullname || post.id;
    const holder = linkHolders.get(key);
    dup = !!holder && holder.id !== id && (!holder.post.isConnected || holder.post.checkVisibility());
    if (!dup) linkHolders.set(key, { post, id });
  }
  post.toggleAttribute('data-rmute-dup', dup);
}

// Seen = half of a post (or half the window, for a tall one) on screen for a
// second. Only posts seen before this page load hide, so nothing vanishes
// while reading or on coming back to the feed. A collapsed post's bar doesn't
// count: the post itself wasn't shown.
const SEEN_KEY = 'seenPosts';
const SEEN_DELAY = 1000;
let seenBefore = null; // Set of ids, while hideSeen is on
let seenWatcher = null;
const seenNow = new Set(); // ids noted since this page loaded
const seenTimers = new Map();
const seenQueue = [];
let seenFlush = null;

const seenId = (post) => post.dataset.fullname || post.id;

function markSeen(post, on) {
  const id = on && seenBefore ? seenId(post) : null;
  const before = !!id && seenBefore.has(id);
  post.toggleAttribute('data-rmute-seen', before);
  if (!id || before || seenNow.has(id)) return;
  seenWatcher ||= new IntersectionObserver(onSeenEntries, { threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.75, 1] });
  seenWatcher.observe(post);
}

function onSeenEntries(entries) {
  for (const e of entries) {
    const post = e.target;
    if (e.isIntersecting && e.intersectionRect.height >= Math.min(e.boundingClientRect.height, innerHeight) / 2) {
      if (!seenTimers.has(post)) seenTimers.set(post, setTimeout(() => noteSeen(post), SEEN_DELAY));
    } else {
      clearTimeout(seenTimers.get(post));
      seenTimers.delete(post);
    }
  }
}

function noteSeen(post) {
  seenTimers.delete(post);
  seenWatcher?.unobserve(post);
  const id = seenId(post);
  if (!id || seenNow.has(id)) return;
  seenNow.add(id);
  seenQueue.push(id);
  seenFlush ??= setTimeout(flushSeen, 2000);
}

function flushSeen() {
  clearTimeout(seenFlush);
  seenFlush = null;
  if (!seenQueue.length) return;
  try { chrome.runtime.sendMessage({ type: 'rmute:addSeen', ids: seenQueue.splice(0) }).catch(() => {}); } catch (_) { /* extension reloaded */ }
}
addEventListener('pagehide', flushSeen);

// Follows the setting: reads the ids when it turns on, stops watching when off.
async function syncSeen() {
  if (!mutes.settings.hideSeen) {
    seenBefore = null;
    seenWatcher?.disconnect();
    seenWatcher = null;
    seenTimers.forEach(clearTimeout);
    seenTimers.clear();
    return;
  }
  if (seenBefore) return;
  const ids = (await chrome.storage.local.get(SEEN_KEY))[SEEN_KEY];
  seenBefore = new Set(ids ? ids.split(' ') : []);
  markTitles();
}

// "Forget them" in the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(SEEN_KEY in changes) || changes[SEEN_KEY].newValue || !seenBefore) return;
  seenBefore = new Set();
  markTitles();
});

/* ---------- Comment words ---------- */

// A comment's own text, not its replies': Reddit ids it <thingid>-comment-rtjson-content.
function commentText(c) {
  if (c.matches('.thing')) return c.querySelector(':scope > .entry .usertext-body .md')?.textContent || '';
  const id = c.getAttribute('thingid');
  const own = (el) => el.closest('shreddit-comment') === c;
  const body = (id && c.querySelector(`[id="${CSS.escape(id)}-comment-rtjson-content"]`)) ||
    [...c.querySelectorAll('[slot="comment"], [id$="-comment-rtjson-content"]')].find(own);
  return body?.textContent || '';
}

// The comment's sub, from its permalink (/r/<sub>/comments/…).
function commentSub(c) {
  if (c.matches('.thing')) return MuteStore.normalize(c.dataset.subreddit);
  return MuteStore.normalize(c.getAttribute('permalink')?.match(/^\/r\/([^/]+)/i)?.[1]);
}

function markComment(c) {
  const hit = wordHit(wordMatchers.commentWords, commentText(c), commentSub(c));
  if (hit) c.dataset.rmuteCword = hit.text;
  else delete c.dataset.rmuteCword;
  // Hidden completely: no bar.
  syncCommentBar(c, mutes.settings.commentAction === 'hide' ? null : hit?.text);
}

// The bar a muted-word comment shrinks to: click shows the comment (and
// shrinks it again), pressing and holding hides its replies too, like
// clicking Reddit's thread line.
const LONG_PRESS_MS = 500;

function syncCommentBar(c, word) {
  let bar = c.querySelector(':scope > .rmute-cbar');
  if (!word) {
    bar?.remove();
    c.removeAttribute('data-rmute-open');
    c.removeAttribute('data-rmute-noreplies');
    return;
  }
  const showWord = mutes.settings.commentShowWord !== false;
  const names = mutes.settings.commentNames === 'show';
  const key = `${word} ${showWord} ${names}`;
  if (bar?.dataset.key === key) return;
  bar?.remove();
  // Replies start hidden too when the popup says so.
  if (!bar && mutes.settings.commentHideReplies) c.setAttribute('data-rmute-noreplies', '');
  bar = document.createElement('div');
  bar.dataset.key = key;
  bar.className = 'rmute-cbar';
  bar.dataset.word = word;
  bar.setAttribute('role', 'button');
  bar.tabIndex = 0;
  const author = names ? c.getAttribute('author') || c.dataset.author : null;
  const label = document.createElement('span');
  const update = () => {
    const open = c.hasAttribute('data-rmute-open');
    const noReplies = c.hasAttribute('data-rmute-noreplies');
    const what = showWord ? `comment with “${word}”` : 'comment with a muted word';
    label.textContent = `${author ? `u/${author}: ` : ''}${what}${noReplies ? ' and its replies' : ''} ${open ? 'shown' : 'hidden'}`;
    bar.setAttribute('aria-expanded', String(open));
    bar.title = noReplies ? 'Click to show the replies again' : `Click to ${open ? 'hide' : 'show'}. Press and hold to hide the replies too.`;
  };
  let timer = null;
  let held = false;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false;
    timer = setTimeout(() => {
      held = true;
      c.removeAttribute('data-rmute-open');
      c.setAttribute('data-rmute-noreplies', '');
      update();
    }, LONG_PRESS_MS);
  });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel']) bar.addEventListener(type, () => clearTimeout(timer));
  const toggle = () => {
    if (c.hasAttribute('data-rmute-noreplies')) c.removeAttribute('data-rmute-noreplies');
    else c.toggleAttribute('data-rmute-open');
    update();
  };
  bar.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation(); // not Reddit's own comment handlers
    if (held) held = false;
    else toggle();
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggle();
  });
  bar.addEventListener('contextmenu', (e) => { if (held) e.preventDefault(); }); // touch long-press
  bar.append(label);
  update();
  c.prepend(bar);
}

/* ---------- Built-in recommendation filters ---------- */

// presets/presets.js (built by presets/build.py) lists subreddit names and
// name parts for each filter. A recommended post whose sub matches gets
// data-rmute-preset, and buildCss hides it if that filter is on. Set lookups
// and a few precompiled regexes per post, so list size doesn't matter.
const PRESETS = ['places', 'airlines', 'identity', 'ask', 'news'];
const PRESET_SETTING = {
  places: 'presetPlaces', airlines: 'presetAirlines', identity: 'presetIdentity', ask: 'presetAsk', news: 'presetNews'
};
let presetData = null;

// Local subs often add a topic to the place name, on either side: askNYC,
// torontojobs, FoodLosAngeles. Longer words first: a prefix takes the first hit.
const PLACE_TOPICS = 'jobs|foodies|food|eats|events|housing|rentals|apartments|r4r|social|meetups|circlejerk|news|traffic|weather|pics|photos|music|nightlife|dating|gaybros|lgbt|expats|transit|realestate|memes|bikes|cycling|hiking|running';
const PLACE_PREFIX = new RegExp(`^(?:ask|visit|livingin|living|movingto|moving|greater|metro|downtown|the|${PLACE_TOPICS})`);
const PLACE_SUFFIX = new RegExp(`(?:${PLACE_TOPICS}|area|region|city|county|state)$`);
// What's left beside a country word that makes it a topic, not a place:
// r/learnjapanese, r/frenchbulldogs, r/italianfood.
const TOPIC_REST = /^(?:learn\w*|\w*learning|\w*language\w*|food\w*|cooking|cuisine|recipes|mythology|bulldogs?|shepherds?|fold|corgis?|oven|shorthairs?|cats?|setters?|fries|press|horns?|whiskey|design|horses?)$/;

const words = (key) => MutePresets[key].split(' ');
// Longest first, so "american" wins over "america".
const alternation = (list) => [...list].sort((a, b) => b.length - a.length).join('|');

// [code, label, "name name"] items → name → its tags (code, and the item's
// first name), for the exceptions pickers.
function tagMap(items) {
  const map = new Map();
  for (const [cc, , names] of items) {
    const list = names.split(' ');
    for (const n of list) map.set(n, [...(map.get(n) || []), cc, list[0]]);
  }
  return map;
}

const compileGroups = (groups, form) => groups.map((g) => ({
  id: g.id,
  names: new Set(g.names.split(' ')),
  words: g.words ? form(alternation(g.words.split(' '))) : null
}));

function compilePresets() {
  const geo = alternation(words('placeParts'));
  const partCC = new Map();
  for (const [cc, parts] of Object.entries(MutePresets.countryParts)) {
    for (const p of parts.split(' ')) partCC.set(p, [...(partCC.get(p) || []), cc]);
  }
  const allParts = alternation(partCC.keys());
  return {
    places: new Set(words('places')),
    placeEnds: new Set(words('placeEnds')),
    airlines: new Set(words('airlines')),
    airlineOf: tagMap(MutePresets.airlineItems),
    placeOf: tagMap(MutePresets.placeItems),
    partCC,
    // "aus" isn't Austria or Austin; "india" and "indian" aren't Indiana.
    partStart: new RegExp(`^(${allParts.replace(/\baus\b/, 'aus(?!tri|tin)').replace(/\bindian\b/, 'indian(?!a)').replace(/\bindia\b/, 'india(?!na)')})`),
    partEnd: new RegExp(`(${allParts})$`),
    identityGroups: compileGroups(MutePresets.identityGroups,
      (alt) => new RegExp(`^(?:ask|ex|true)(?:an?)?(?:${alt})s?(?:over\\d+|\\d+)?$`)),
    newsGroups: compileGroups(MutePresets.newsGroups, (alt) => new RegExp(alt)),
    identity: new Set(words('identity')),
    news: new Set(words('news')),
    partSkip: new Set(words('partSkip')),
    geoStart: new RegExp(`^(${geo})(.*)$`),
    geoEnd: new RegExp(`^(.*?)(${geo})$`),
    // r/askmen, r/askachinese, r/AskAnAmerican, r/exmuslim, r/askwomenover30
    identityForm: new RegExp(`^(?:ask|ex|true)(?:an?)?(?:${alternation(words('identityParts'))})s?(?:over\\d+|\\d+)?$`),
    newsParts: new RegExp(alternation(words('newsParts'))),
    topics: Object.fromEntries(MutePresets.topics.map((t) => [t.id, {
      names: new Set(t.names.split(' ')),
      words: t.words ? new RegExp(alternation(t.words.split(' '))) : null
    }]))
  };
}

// The place a name ends with, whatever comes before it: r/PizzaChicago.
function placeAtEnd(name, d) {
  for (let i = 3; i <= name.length - 3; i++) {
    if (d.placeEnds.has(name.slice(i))) return name.slice(i);
  }
  return null;
}

function isPlace(name, d) {
  if (d.places.has(name)) return true;
  const bare = name.replace(PLACE_PREFIX, '').replace(PLACE_SUFFIX, '');
  if (bare.length >= 3 && d.places.has(bare)) return true;
  if (d.partSkip.has(name)) return false;
  if (placeAtEnd(name, d)) return true;
  const start = name.match(d.geoStart);
  if (start && !TOPIC_REST.test(start[2])) return true;
  const end = name.match(d.geoEnd);
  return !!end && !TOPIC_REST.test(end[1]);
}

// List entries can be patterns ("*cat*", "cat*", "*cat"), as in subMatch().
function inList(list, name) {
  return list.some((entry) => {
    const s = entry.replace(/\*/g, '');
    if (entry.startsWith('*') && entry.endsWith('*')) return name.includes(s);
    if (entry.startsWith('*')) return name.endsWith(s);
    if (entry.endsWith('*')) return name.startsWith(s);
    return name === s;
  });
}

// A muted user (patterns too) whose scope covers this sub.
function userMuted(author, sub) {
  if (!author) return false;
  return mutes.users.some((u) => {
    if (!inList([u], author)) return false;
    const scope = MuteStore.scopeOf(mutes, 'u', u);
    return !scope || (scope.mode === '+') === (!!sub && scope.subs.includes(sub));
  });
}

function matchesTopic(name, d) {
  return (mutes.settings.keepTopics || []).some((id) => {
    const t = d.topics[id];
    return t && (t.names.has(name) || !!t.words?.test(name));
  });
}

// Country codes a sub belongs to: an exact place (or one with ask/jobs/…
// around it), a country word at its start or end, or an airline's country.
function countryTags(name, d) {
  const tags = [...(d.placeOf.get(name) || []), ...(d.airlineOf.get(name) || [])];
  const bare = name.replace(PLACE_PREFIX, '').replace(PLACE_SUFFIX, '');
  if (bare !== name) tags.push(...(d.placeOf.get(bare) || []));
  tags.push(...(d.placeOf.get(placeAtEnd(name, d)) || []));
  const start = name.match(d.partStart)?.[1];
  const end = name.match(d.partEnd)?.[1];
  for (const part of [start, end]) if (part) tags.push(...(d.partCC.get(part) || []));
  return tags;
}

// Groups (as "g:<id>") a sub is in; "g:other" when it's in none.
function groupTags(name, groups) {
  const ids = groups.filter((g) => g.names.has(name) || !!g.words?.test(name)).map((g) => 'g:' + g.id);
  return ids.length ? ids : ['g:other'];
}

// A sub picked as an exception in any filter's picker (settings.*Except):
// a country, place, airline, group or exact name. It shows in full.
function isException(name, d) {
  const s = mutes.settings;
  const picked = (key, tags) => (s[key] || []).some((t) => t === name || tags.includes(t));
  if (picked('placeExcept', countryTags(name, d))) return true;
  if (d.airlineOf.has(name) && picked('airlineExcept', d.airlineOf.get(name))) return true;
  if ((d.identity.has(name) || d.identityForm.test(name)) &&
    picked('identityExcept', groupTags(name, d.identityGroups))) return true;
  if (name.startsWith('ask') && picked('askExcept', topicTags(name, d))) return true;
  return isNews(name, d) && picked('newsExcept', groupTags(name, d.newsGroups));
}

const isNews = (name, d) => d.news.has(name) || (!d.partSkip.has(name) && d.newsParts.test(name));
const topicTags = (name, d) => groupTags(name, Object.entries(d.topics).map(([id, t]) => ({ id, ...t })));

// Filters that hide this recommended sub, or ['undecided'] in keep mode when
// nothing says to show it. Kept subs and exceptions always show.
function presetsFor(sub) {
  const d = presetData ||= compilePresets();
  const name = sub.replace(/[_-]/g, '');
  if (inList(mutes.keepSubs, sub) || isException(name, d)) return [];
  const hits = [];
  if (isPlace(name, d)) hits.push('places');
  if (d.airlines.has(name)) hits.push('airlines');
  if (d.identity.has(name) || d.identityForm.test(name)) hits.push('identity');
  if (name.startsWith('ask')) hits.push('ask');
  if (isNews(name, d)) hits.push('news');
  if (!hits.length && mutes.settings.keepMode && !matchesTopic(name, d)) hits.push('undecided');
  return hits;
}

function presetsOn() {
  return mutes.settings.keepMode || PRESETS.some((p) => mutes.settings[PRESET_SETTING[p]]);
}

function markPreset(post) {
  if (postScope(post) === 'popular' && post.localName === 'shreddit-post') return markPopular(post);
  const { sub, author } = isRecommended(post) && presetsOn() ? postInfo(post) : {};
  const hits = sub ? presetsFor(sub) : [];
  if (hits.length) post.dataset.rmutePreset = hits.join(' ');
  else delete post.dataset.rmutePreset;
  // No bar for posts the mute lists already hide.
  const muted = sub && (inList(mutes.subs, sub) || inList(mutes.recSubs, sub) ||
    userMuted(author, sub) || inList(mutes.recUsers, author));
  syncDecideBar(post, hits.includes('undecided') && !muted ? sub : null);
}

// r/popular: every post becomes a bar, except kept subs and posts the mute
// lists already hide. Topics don't apply here, and the built-in filters only
// with the popularFilters extra: what they catch is hidden, with no bar.
function markPopular(post) {
  const { sub, author } = postInfo(post);
  const hits = sub && mutes.settings.popularFilters
    ? presetsFor(sub).filter((p) => mutes.settings[PRESET_SETTING[p]]) : [];
  const bar = !hits.length && sub && mutes.settings.collapsePopular && !inList(mutes.keepSubs, sub) && !inList(mutes.subs, sub) && !userMuted(author, sub);
  if (hits.length) post.dataset.rmutePreset = hits.join(' ');
  else if (bar) post.dataset.rmutePreset = 'undecided';
  else delete post.dataset.rmutePreset;
  syncDecideBar(post, bar ? sub : null, true);
}

// Keep mode's one-line stand-in for an undecided recommended post: the sub
// name as a link (clicking the rest of the bar shows or hides the post itself) and a menu with Keep and Mute.
const hiddenNames = new WeakMap(); // post -> its own sub name link, hidden under a bar

function syncDecideBar(post, sub, popular = false) {
  const prev = post.previousElementSibling;
  const bar = prev?.classList.contains('rmute-decide') ? prev : null;
  if (bar?.dataset.sub === sub) return;
  bar?.remove();
  post.removeAttribute('data-rmute-open');
  hiddenNames.get(post)?.style.removeProperty('display');
  hiddenNames.delete(post);
  if (!sub) return;

  const el = document.createElement('div');
  el.className = 'rmute-decide';
  el.dataset.sub = sub;
  const label = document.createElement('span');
  // Reddit's own capitalization (r/30ROCK), not the lowercased name. The name
  // links to the sub, since the post's own link is hidden; the rest of the bar toggles.
  const link = document.createElement('a');
  link.href = `/r/${sub}/`;
  link.textContent = post.getAttribute('subreddit-prefixed-name') || `r/${sub}`;
  link.addEventListener('click', (e) => e.stopPropagation()); // not a toggle
  label.append(link);

  // The whole bar is the show/hide toggle; no icon for it.
  el.setAttribute('role', 'button');
  el.tabIndex = 0;
  el.setAttribute('aria-expanded', 'false');
  el.title = 'Show post';
  const toggle = () => {
    const open = post.toggleAttribute('data-rmute-open');
    if (!hiddenNames.has(post)) matchSubName(post, sub, label);
    el.setAttribute('aria-expanded', String(open));
    el.title = open ? 'Hide post' : 'Show post';
  };
  el.addEventListener('click', toggle);
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggle();
  });

  // r/popular: the same Mute r/ button as under a post's ⋯ (mutes everywhere,
  // since recommendation mutes only apply on the home feed). Elsewhere a menu.
  const menu = popular ? iconButton(ICONS.mute, `Mute r/${sub}`) : iconButton(ICONS.menu, `Options for r/${sub}`);
  if (popular) {
    menu.classList.add('rmute-faint');
    menu.addEventListener('click', (e) => {
      e.stopPropagation(); // not a toggle
      mute('subs', sub);
      markTitles();
    });
  } else {
    menu.setAttribute('aria-haspopup', 'menu');
    menu.addEventListener('click', (e) => {
      e.stopPropagation(); // not a toggle
      showFallbackMenu(menu, [
        { label: `Keep r/${sub} in recommendations`, icon: ICONS.keep, run: () => keepSub(sub) },
        { label: `Mute r/${sub} in recommendations`, icon: ICONS.mute, run: () => { mute('recSubs', sub); markTitles(); } }
      ]);
    });
  }

  el.append(label, menu);
  post.before(el);

  matchSubName(post, sub, label);
}

// The bar names the sub, so the post's own header doesn't repeat it, and the
// bar's name takes that link's font. Retried when the post is shown, in case
// its header wasn't rendered yet.
function matchSubName(post, sub, label) {
  const link = subNameLink(post, sub);
  if (!link) return;
  const style = getComputedStyle(link);
  for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color']) {
    label.style[prop] = style[prop];
  }
  link.style.setProperty('display', 'none', 'important');
  hiddenNames.set(post, link);
}

// The text link to the sub in a post's header (light DOM or open shadow
// root): a link to /r/<sub>/ whose text is the r/ name, not the avatar link.
function subNameLink(post, sub) {
  const path = new RegExp(`^/r/${sub}/?$`, 'i');
  for (const root of [post, post.shadowRoot]) {
    for (const a of root?.querySelectorAll('a[href]') || []) {
      if (path.test(new URL(a.href, location.href).pathname) && /^r\//i.test(a.textContent.trim())) return a;
    }
  }
  return null;
}

function iconButton(icon, title) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = button.ariaLabel = title;
  button.append(makeSvg(icon));
  // Keep the click from reaching Reddit's own post handlers.
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return button;
}

async function keepSub(sub) {
  if (!mutes.keepSubs.includes(sub)) mutes.keepSubs.push(sub);
  markTitles();
  showToast(`Keeping r/${sub} in recommendations`, async () => {
    mutes.keepSubs = mutes.keepSubs.filter((n) => n !== sub);
    markTitles();
    await MuteStore.remove('keepSubs', sub);
  });
  try {
    await MuteStore.add('keepSubs', sub);
  } catch (err) {
    showToast(err.message);
  }
}

const COMMENT_SELECTOR = 'shreddit-comment, .thing.comment';

function markTitles(root = document) {
  if (isOff()) {
    // Bars come off and their posts show again.
    document.querySelectorAll('.rmute-decide').forEach((bar) => {
      if (bar.nextElementSibling) syncDecideBar(bar.nextElementSibling, null);
      else bar.remove();
    });
    document.querySelectorAll('.rmute-cbar').forEach((bar) => syncCommentBar(bar.parentElement, null));
    return;
  }
  if (root.matches?.(`${POST_SELECTOR}, .thing.link`)) markTitle(root);
  root.querySelectorAll?.(`${POST_SELECTOR}, .thing.link`).forEach(markTitle);
  if (!wordMatchers.commentWords && !document.querySelector('.rmute-cbar')) return;
  if (root.matches?.(COMMENT_SELECTOR)) markComment(root);
  root.querySelectorAll?.(COMMENT_SELECTOR).forEach(markComment);
}

function updateWords() {
  wordMatchers = Object.fromEntries(MuteStore.WORD_KINDS.map((k) => [k, compileScoped(mutes[k])]));
  markTitles();
  updatePageScope();
}

// Whether posts need marking at all as they load.
const needsMarking = () => Object.values(wordMatchers).some(Boolean) || presetsOn() ||
  mutes.settings.collapsePopular || Number(mutes.settings.minScore) > 0 ||
  mutes.settings.hideSeen || mutes.settings.hideDuplicates || Number(mutes.settings.maxAgeHours) > 0 || mutes.settings.hideCrossposts ||
  mutes.settings.hideCommentsOnMutedPosts;

// "popular" on r/popular, "subs" on the home page of a subreddit that isn't
// joined or in any custom feed, otherwise nothing. Reddit navigates without reloading, so
// this reruns from the mutation observer whenever the URL changes.
let lastPath = null;
function updatePageScope(force = true) {
  if (!force && location.pathname === lastPath) return;
  if (location.pathname !== lastPath) document.documentElement.removeAttribute('data-rmute-muted-op');
  lastPath = location.pathname;
  const sub = location.pathname.match(LISTING_RE)?.[1].toLowerCase();
  let scope = '';
  if (sub === 'popular') scope = 'popular';
  else if (sub && sub !== 'all' && !sub.includes('+') && (mutes.subWords.length || mutes.bodyWords.length)) {
    if (!feedSubs) loadFeedSubs();
    else if (!feedSubs.has(sub)) scope = 'subs';
  }
  if (scope) document.documentElement.dataset.rmutePage = scope;
  else delete document.documentElement.dataset.rmutePage;
  // Home and r/popular bars need no re-marking here: each post keeps the
  // scope it was loaded with (postScope).
}

// The default feed: background.js redirects Reddit's loads of the home page to
// its own ?feed= address while Reddit's remembered feed isn't the default, and the
// address bar stays on plain / here. A full page load is cleaned before Reddit's
// scripts run. After an in-page load Reddit copies the redirected address to the
// bar, so that copy is cancelled; this listener is registered first, so Reddit's
// router doesn't see it either. Reddit remembers the last feed fetched, so
// background.js is told each time that changes.
const FEED_TABS = { 'feed-tab-1': 'for-you', 'feed-tab-2': 'following' };
function feedSeen(feed, served) {
  try {
    return chrome.runtime.sendMessage({ type: 'rmute:feedSeen', feed, served }).catch(() => ({}));
  } catch (_) { /* extension reloaded */ }
  return Promise.resolve({});
}
// The tab Reddit served for a plain /. Its pageindex is 1 For You, 2 Following.
function watchServedFeed() {
  const check = () => {
    const index = document.getElementById('feed-tab-group')?.getAttribute('pageindex');
    if (!index) return;
    observer.disconnect();
    const feed = FEED_TABS[`feed-tab-${index}`];
    if (feed) feedSeen(feed, true).then((r) => { if (r?.open) location.replace(`/?feed=${r.open}`); });
  };
  const observer = new MutationObserver(check);
  observer.observe(document, { childList: true, subtree: true });
  addEventListener('load', () => observer.disconnect(), { once: true });
}
if (location.hostname === 'www.reddit.com' && location.pathname === '/') {
  const asked = /^\?feed=(following|for-you)$/.exec(location.search);
  if (asked) feedSeen(asked[1]);
  else if (!location.search) watchServedFeed();
}
if (location.pathname === '/' && /^\?feed=(following|for-you)$/.test(location.search)) history.replaceState(history.state, '', '/');
document.addEventListener('click', (e) => {
  const feed = FEED_TABS[e.target.closest?.('[id^="feed-tab-"]')?.id];
  if (feed) feedSeen(feed);
}, true);
window.navigation?.addEventListener('navigate', (e) => {
  const url = new URL(e.destination.url);
  if (e.navigationType !== 'replace' || url.pathname !== '/' || !url.searchParams.has('feed') || !url.searchParams.has('screen_view_count')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  feedSeen(url.searchParams.get('feed'));
});

// The user's custom feeds and joined subs come from Reddit's own API (same
// site, using the signed-in session) and are cached in local storage for a
// few hours.
let feedsLoading = false;
async function loadFeedSubs() {
  if (feedsLoading) return;
  feedsLoading = true;
  try {
    let cached = (await chrome.storage.local.get(FEEDS_KEY))[FEEDS_KEY];
    // Caches from before joined subs were read have no joined list.
    if (!cached || !cached.joined || Date.now() - cached.at > FEEDS_MAX_AGE) cached = await fetchFeedSubs();
    feedSubs = new Set([...cached.subs, ...(cached.joined || [])]);
  } finally {
    feedsLoading = false;
  }
  updatePageScope();
}

async function fetchFeedSubs() {
  const result = { at: Date.now(), feeds: [], subs: [], joined: [], error: null, joinedError: null };
  try {
    const res = await fetch('/api/multi/mine.json', { credentials: 'include' });
    if (!res.ok) throw new Error(res.status === 403 || res.status === 401 ? 'Not signed in' : `HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Unexpected response');
    const subs = new Set();
    for (const { data: feed } of data) {
      result.feeds.push(feed.display_name || feed.name);
      for (const { name } of feed.subreddits || []) {
        const n = MuteStore.normalize(name);
        if (n) subs.add(n);
      }
    }
    result.subs = [...subs].sort();
  } catch (err) {
    // With no feed list, every subreddit counts as "not in a custom feed".
    result.error = err.message;
  }
  try {
    result.joined = await fetchJoined();
  } catch (err) {
    result.joinedError = err.message;
  }
  await chrome.storage.local.set({ [FEEDS_KEY]: result });
  return result;
}

// Joined subreddits, 100 per page.
async function fetchJoined() {
  const joined = new Set();
  let after = '';
  for (let page = 0; page < 50; page++) {
    const res = await fetch(`/subreddits/mine/subscriber.json?limit=100${after ? '&after=' + after : ''}`, { credentials: 'include' });
    if (!res.ok) throw new Error(res.status === 403 || res.status === 401 ? 'Not signed in' : `HTTP ${res.status}`);
    const data = (await res.json())?.data;
    if (!Array.isArray(data?.children)) throw new Error('Unexpected response');
    for (const { data: sub } of data.children) {
      const n = MuteStore.normalize(sub?.display_name);
      if (n) joined.add(n);
    }
    after = data.after;
    if (!after) break;
  }
  return [...joined].sort();
}

// Joining from the ⋯ menu adds the sub to the cached joined list at once.
async function rememberJoined(sub) {
  const cached = (await chrome.storage.local.get(FEEDS_KEY))[FEEDS_KEY];
  if (!cached || (cached.joined || []).includes(sub)) return;
  await chrome.storage.local.set({ [FEEDS_KEY]: { ...cached, joined: [...(cached.joined || []), sub].sort() } });
}

/* ---------- Signed-in user ---------- */

// Your own comments have a different ⋯ menu (Edit, Delete…) and muting
// yourself is pointless, so the comment menu and hover card skip this name.
// It comes from Reddit's /api/me.json, cached in local storage for an hour so
// an account switch is picked up. '' when signed out, null until known.
const ME_KEY = 'me';
const ME_MAX_AGE = 60 * 60 * 1000;

async function loadMe() {
  let cached = (await chrome.storage.local.get(ME_KEY))[ME_KEY];
  if (!cached || Date.now() - cached.at > ME_MAX_AGE) {
    cached = { at: Date.now(), name: '' };
    try {
      const res = await fetch('/api/me.json', { credentials: 'include' });
      if (res.ok) cached.name = MuteStore.normalize((await res.json())?.data?.name) || '';
    } catch (_) { /* treated as signed out; the Edit/Delete check still applies */ }
    await chrome.storage.local.set({ [ME_KEY]: cached });
  }
  me = cached.name;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(FEEDS_KEY in changes)) return;
  const next = changes[FEEDS_KEY].newValue;
  feedSubs = next ? new Set([...next.subs, ...(next.joined || [])]) : null;
  updatePageScope();
});

function observeTitles() {
  new MutationObserver((records) => {
    updatePageScope(false);
    if (isOff()) return;
    if (!needsMarking()) return;
    // A post's text or flair can arrive after the post itself.
    const late = wordMatchers.bodyWords || wordMatchers.flairWords;
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        markTitles(node);
        const post = late && node.closest('shreddit-post-text-body, shreddit-post-flair, .expando')?.closest(`${POST_SELECTOR}, .thing.link`);
        if (post) markTitle(post);
      }
      if (r.type === 'attributes' && r.target.matches(`${POST_SELECTOR}, .thing.link`)) markTitle(r.target);
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['post-title', 'recommendation-source', 'subreddit-name', 'subreddit-prefixed-name', 'score']
  });
}

/* ---------- Old Reddit ---------- */

function processOldPost(thing) {
  if (thing.querySelector('.rmute-old')) return;
  const buttons = thing.querySelector('ul.flat-list.buttons');
  if (!buttons) return;

  const sub = MuteStore.normalize(thing.dataset.subreddit);
  const author = MuteStore.normalize(thing.dataset.author);
  const links = [];
  const real = sub && !sub.startsWith('u_') ? sub : null; // u_name: a profile post
  if (real) links.push([`mute r/${sub}`, () => mute('subs', sub)]);
  if (author) links.push([`mute u/${author}`, () => mute('users', author, real)]);

  for (const [label, run] of links) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.className = 'rmute-old';
    a.textContent = label;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      run();
    });
    li.appendChild(a);
    buttons.appendChild(li);
  }
}

function processOld() {
  if (isOff()) return;
  document.querySelectorAll('.thing.link').forEach(processOldPost);
}

/* ---------- Driver ---------- */

// Timed mutes end on their own, so the list is applied again when the next
// one is due (at most a day ahead, as long timers aren't reliable).
let storedList = null;
let timedTimer = null;
function useList(list) {
  storedList = list;
  mutes = MuteStore.effective(list);
  clearTimeout(timedTimer);
  const end = MuteStore.nextEnd(list);
  if (!end) return;
  timedTimer = setTimeout(() => {
    useList(storedList);
    applyStyle();
    updateWords();
  }, Math.min(end - Date.now() + 50, 24 * 60 * 60 * 1000));
}

MuteStore.load().then((list) => {
  useList(list);
  applyStyle();
  updateWords();
  syncSeen();
  if (document.body) syncNativeButton();
});
MuteStore.onChange((list) => {
  useList(list);
  applyStyle();
  updateWords();
  syncSeen();
  // Turned back on: the ⋯ buttons and old-Reddit links come back.
  if (document.body) isOldReddit ? processOld() : (addMuteButtons(), syncNativeButton());
});
observeTitles();

function init() {
  applyStyle(); // move into <head> if it was created before head existed
  if (isOldReddit) {
    processOld();
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        processOld();
        scheduleCount();
      });
    }).observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('click', onDocumentClick, true);
    document.addEventListener('pointerover', onPointerOver, true);
    loadMe();
    runPendingBlock();
    addMuteButtons();
    watchToasts();
    syncNativeButton();
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        addMuteButtons();
        watchToasts();
        syncNativeButton();
        scheduleCount();
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

// Lets the worker notice a new build.txt during development (see background.js).
try { chrome.runtime.sendMessage('rmute:checkBuild').catch(() => {}); } catch (_) { /* extension reloaded */ }
