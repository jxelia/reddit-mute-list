// Stand-in for the chrome.* APIs the popup uses, so manage.html runs in the
// design editor's frame. Storage lives in the editor (parent.__mem), so it
// survives the frame reloading.
(() => {
  const P = parent;
  const mem = P.__mem ||= structuredClone(P.__seed || { sync: {}, local: {} });
  const listeners = [];
  const fire = (changes, name) => listeners.forEach((l) => l(changes, name));
  const area = (name) => ({
    async get(keys) {
      const all = mem[name];
      if (keys == null) return structuredClone(all);
      const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
      const out = {};
      for (const k of list) if (k in all) out[k] = structuredClone(all[k]);
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: mem[name][k], newValue: v };
        mem[name][k] = structuredClone(v);
      }
      fire(changes, name);
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        changes[k] = { oldValue: mem[name][k] };
        delete mem[name][k];
      }
      fire(changes, name);
    },
    getBytesInUse: async () => JSON.stringify(mem[name]).length,
  });

  // On http pages storage.js hands mutes to the background worker; do its part here.
  async function mutate({ op, kind, name, sub }) {
    const list = await MuteStore.load();
    if (op === 'add') {
      list[kind] = [...new Set([...(list[kind] || []), name])];
      if (kind === 'users' && sub) list.userSubs = [...(list.userSubs || []).filter((n) => !n.startsWith(name + ':')), `${name}:${sub}`];
    } else {
      list[kind] = (list[kind] || []).filter((n) => n !== name);
    }
    await MuteStore.save(list);
    return {};
  }

  window.chrome = {
    storage: { sync: area('sync'), local: area('local'), session: area('local'), onChanged: { addListener: (f) => listeners.push(f) } },
    runtime: {
      id: 'designer',
      lastError: undefined,
      getURL: (p) => '/' + p,
      sendMessage: async (msg) => (msg?.type === 'rmute:mutate' ? mutate(msg) : {}),
      onMessage: { addListener() {} },
      onConnect: { addListener() {} },
    },
    extension: { getViews: () => (window.__dz?.popup ? [window] : []) },
    tabs: {
      query: async () => [{ id: 1, index: 0 }],
      create() {},
      sendMessage: async () => ({}),
      // The "Mute all on this page" card: the editor sends it sample subs.
      connect: () => ({ onDisconnect: { addListener() {} }, onMessage: { addListener(f) { P.__portMsg = f; } } }),
    },
  };
})();
