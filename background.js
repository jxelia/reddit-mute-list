// Development: when loaded unpacked (no update_url), reload when build.txt changes,
// so edits on disk take effect without a trip to chrome://extensions. Each page load
// pings the worker to trigger the check. The stamp seen at load is kept in session
// storage, which outlives the worker going idle but is cleared by a reload.
async function checkBuild() {
  if ('update_url' in chrome.runtime.getManifest()) return;
  try {
    const stamp = (await (await fetch(chrome.runtime.getURL('build.txt'), { cache: 'no-store' })).text()).trim();
    const { build } = await chrome.storage.session.get('build');
    if (build === undefined) await chrome.storage.session.set({ build: stamp });
    else if (stamp !== build) {
      await MuteStore.idle(); // don't cut off a mute being saved
      chrome.runtime.reload();
    }
  } catch (_) { /* no build.txt */ }
}
importScripts('presets/presets.js', 'storage.js');

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg === 'rmute:checkBuild') checkBuild();
  // Mutes from Reddit pages are saved here, so leaving the page can't cut them off.
  if (msg?.type === 'rmute:mutate') {
    const { op, kind, name, sub } = msg;
    (op === 'add' ? MuteStore.add(kind, name, sub) : MuteStore.remove(kind, name))
      .then(() => reply({}), (err) => reply({ error: err.message }));
    return true;
  }
});

// The hidden-post count from a Reddit tab (content.js), on the toolbar icon.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'rmute:badge' || !sender.tab) return;
  chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#576f76' });
  chrome.action.setBadgeText({ tabId: sender.tab.id, text: msg.text });
});

// Running total of posts hidden, for the popup: { count, since }. Adds are
// chained so tabs counting at once don't overwrite each other.
let totalChain = Promise.resolve();
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'rmute:addHidden') return;
  totalChain = totalChain.then(async () => {
    const { hiddenTotal } = await chrome.storage.local.get('hiddenTotal');
    const total = hiddenTotal || { count: 0, since: Date.now() };
    await chrome.storage.local.set({ hiddenTotal: { ...total, count: total.count + (msg.count || 0) } });
  }).catch(() => {});
});

// Posts seen in feeds (content.js), oldest first, as space-joined ids. Local
// only, and capped so it can't grow forever.
const SEEN_MAX = 5000;
let seenChain = Promise.resolve();
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'rmute:addSeen') return;
  seenChain = seenChain.then(async () => {
    const { seenPosts } = await chrome.storage.local.get('seenPosts');
    const ids = new Set([...(seenPosts ? seenPosts.split(' ') : []), ...msg.ids]);
    await chrome.storage.local.set({ seenPosts: [...ids].slice(-SEEN_MAX).join(' ') });
  }).catch(() => {});
});
checkBuild();
