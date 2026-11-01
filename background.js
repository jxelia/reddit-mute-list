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
checkBuild();
