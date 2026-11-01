// Paste into the DevTools console on reddit.com (r/popular, a subreddit, or a
// post page with comments). It opens and closes one post ⋯ menu and one comment
// ⋯ menu, then copies a text report of Reddit's markup to the clipboard.
// Nothing is clicked inside the menus, and nothing leaves the page.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lines = [];
  const log = (...a) => lines.push(a.join(' '));
  const KEEP = /^(slot|role|id|name|type|href|aria-[\w-]+|data-testid|subscribed|author|post-title|subreddit-[\w-]+|permalink|depth|thingid|post-id|post-type|noun|is-[\w-]+|data-rmute[\w-]*|class)$/;
  const trunc = (s, n = 80) => (s.length > n ? s.slice(0, n) + '…' : s);

  function attrs(el, all = false) {
    return [...el.attributes]
      .filter((a) => all || KEEP.test(a.name))
      .map((a) => {
        let v = a.value;
        if (a.name === 'href') v = v.split('?')[0];
        return v === '' ? a.name : `${a.name}="${trunc(v, a.name === 'class' ? 50 : 80)}"`;
      })
      .join(' ');
  }
  const tagOf = (el) => {
    const a = attrs(el);
    return `<${el.localName}${a ? ' ' + a : ''}>`;
  };
  const ours = (el) => el.dataset.rmuteItem !== undefined || !!el.closest('.rmute-pop');

  // Indented outline of light DOM and open shadow roots.
  function skel(root, maxDepth, maxLines, skip = () => false) {
    const out = [];
    const visit = (node, depth) => {
      if (out.length >= maxLines) return;
      const pad = '  '.repeat(depth);
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.data.replace(/\s+/g, ' ').trim();
        if (t) out.push(pad + JSON.stringify(trunc(t, 60)));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE && !(node instanceof ShadowRoot)) return;
      if (node instanceof ShadowRoot) out.push(pad + '#shadow-root');
      else {
        if (['style', 'script', 'link', 'template'].includes(node.localName)) return;
        if (node.localName === 'svg') return out.push(pad + '<svg>');
        out.push(pad + tagOf(node));
        if (depth > 0 && skip(node)) return out.push(pad + '  …(skipped)');
      }
      if (depth >= maxDepth) {
        if (node.childNodes?.length || node.shadowRoot) out.push(pad + '  …');
        return;
      }
      if (node.shadowRoot) visit(node.shadowRoot, depth + 1);
      for (const c of node.childNodes) visit(c, depth + 1);
    };
    visit(root, 0);
    if (out.length >= maxLines) out.push('…(truncated)');
    return out.join('\n');
  }

  function* walk(root, skip = () => false) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      if (n !== root && skip(n)) continue;
      if (n.nodeType === Node.ELEMENT_NODE) yield n;
      if (n.shadowRoot) stack.push(n.shadowRoot);
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
  }

  // Ancestor chain up to the document, marking shadow-root hops.
  function chain(el, stopAt) {
    const out = [];
    for (let n = el; n && n !== stopAt; ) {
      if (n instanceof ShadowRoot) {
        out.push('#shadow-root');
        n = n.host;
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) break;
      const cs = getComputedStyle(n);
      out.push(`${tagOf(n)}  {display:${cs.display}${cs.display.includes('flex') ? `; dir:${cs.flexDirection}; align:${cs.alignItems}; justify:${cs.justifyContent}` : ''}}`);
      n = n.parentNode;
    }
    return out.map((s, i) => '  '.repeat(i) + s).join('\n');
  }

  const visible = (el) => el.getClientRects().length > 0;
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  function menuItems() {
    const items = [];
    for (const el of walk(document.body)) {
      if (el.matches('li, [role="menuitem"]') && visible(el) && text(el).length < 40) items.push(el);
    }
    return items;
  }
  function closeMenus() {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }
  const clickTrigger = (el) => (el.shadowRoot?.querySelector('button') || el.querySelector('button') || el).click();
  const scrollY = window.scrollY;

  // --- User card: the user clicks a commenter's name while this waits ---
  log('\n=== HOVER CARD (comment) ===');
  console.log('Now click a commenter\'s username so its card opens, and leave it open (10 s)…');
  const isChatText = (t) => /^(start chat|chat|message( mods?)?)$/i.test(t);
  let chatBtn = null;
  for (let i = 0; i < 100 && !chatBtn; i++) {
    await sleep(100);
    chatBtn = [...walk(document.body)].find((el) => el.matches('button, a') && visible(el) && isChatText(text(el)) && !el.closest('shreddit-post, shreddit-join-button'));
  }
  if (chatBtn) {
    const up = []; for (let n = chatBtn; n; n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentElement) up.push(n);
    const card = up.find((n) => n.localName?.includes('hovercard')) || up[8] || up[up.length - 1];
    const inComment = up.find((n) => n.localName === 'shreddit-comment');
    log('card root:', tagOf(card), '| inside shreddit-comment:', inComment ? tagOf(inComment) : 'no', '| inside shreddit-app:', !!up.find((n) => n.localName === 'shreddit-app'));
    log('buttons/links in card (raw text):');
    for (const el of walk(card)) if (el.matches('button, a') && visible(el)) log('  ', JSON.stringify(text(el)), tagOf(el), ours(el) ? '(extension)' : '');
    log('\nStart Chat button ancestors (with layout):');
    log(chain(chatBtn, null));
    log('\ncard outline:\n' + skel(card, 12, 160));
    log('\nstacking (button → document): tag | position | z-index | background | contain | transform | isolation');
    for (const n of up) {
      if (n.nodeType !== 1) continue;
      const cs = getComputedStyle(n);
      log('  ', n.localName, n.id ? '#' + n.id : '', '|', cs.position, '|', cs.zIndex, '|', cs.backgroundColor, '|', cs.contain, '|', cs.transform, '|', cs.isolation, n.matches(':popover-open') ? '| popover-open' : '');
    }
  } else log('(no card seen in 10 s)');

  log('\n=== PAGE ===');
  log('url:', location.pathname);
  log('extension loaded:', !!document.getElementById('rmute-style'), '| data-rmute-page:', document.documentElement.dataset.rmutePage || '-');
  log('counts: shreddit-post', document.querySelectorAll('shreddit-post').length,
    '| shreddit-ad-post', document.querySelectorAll('shreddit-ad-post').length,
    '| shreddit-comment', document.querySelectorAll('shreddit-comment').length,
    '| article>shreddit-post', document.querySelectorAll('article > shreddit-post').length);
  log('custom tags present:', [...new Set([...walk(document.body)].map((e) => e.localName).filter((t) => t.includes('-')))].sort().join(' '));

  // --- Post ---
  const posts = [...document.querySelectorAll('shreddit-post')].filter(visible);
  const post = posts.find((p) => p.querySelector('shreddit-post-overflow-menu')) || posts[0];
  if (post) {
    log('\n=== POST: all attributes ===');
    for (const a of post.attributes) log(`  ${a.name}="${trunc(a.value.split('?')[0], 120)}"`);
    log('parent:', tagOf(post.parentElement), '| next sibling:', post.parentElement.nextElementSibling ? tagOf(post.parentElement.nextElementSibling) : '-');
    log('\n=== POST: light DOM ===');
    log(skel(post, 7, 220));
    log('\n=== POST: own shadow root ===');
    log(post.shadowRoot ? skel(post.shadowRoot, 6, 120) : '(none or closed)');

    const menu = post.querySelector('shreddit-post-overflow-menu');
    log('\n=== POST: ⋯ menu element → post (ancestors, with layout) ===');
    log(menu ? chain(menu, post) : '(no shreddit-post-overflow-menu in the post light DOM)');
    if (menu) log('⋯ size:', JSON.stringify(menu.getBoundingClientRect().toJSON()));

    const join = post.querySelector('shreddit-join-button');
    log('\n=== POST: join button ===');
    log(join ? `${tagOf(join)} all attrs: ${attrs(join, true)}\ntext: ${JSON.stringify(text(join))} | shadow text: ${JSON.stringify(join.shadowRoot ? text(join.shadowRoot) : null)}` : '(none in this post)');

    if (menu) {
      const before = new Set(menuItems());
      clickTrigger(menu);
      await sleep(1200);
      const items = menuItems().filter((i) => !before.has(i));
      log('\n=== POST: ⋯ menu items after opening ===');
      log(items.map((i) => `${JSON.stringify(text(i))}${ours(i) ? ' (ours)' : ''}`).join('\n') || '(none found)');
      const native = items.find((i) => !ours(i));
      if (native) {
        log('\n--- first native item, ancestors up to document ---');
        log(chain(native, null));
        log('\n--- first native item outline ---');
        log(skel(native, 6, 40));
      }
      log('fallback popover shown:', !!document.querySelector('.rmute-pop'));
      closeMenus();
      await sleep(300);
    }
  } else log('\n(no visible shreddit-post)');

  // --- Signed-in user ---
  log('\n=== /api/me.json ===');
  let meName = '';
  try {
    const res = await fetch('/api/me.json', { credentials: 'include' });
    const data = await res.json().catch(() => null);
    meName = data?.data?.name || '';
    log('status:', res.status, '| top keys:', Object.keys(data || {}).join(','), '| data.name present:', !!meName);
  } catch (err) {
    log('error:', err.message);
  }

  // --- Comments: someone else's, then one of yours if on this page ---
  const ownWalk = (c) => [...walk(c, (n) => n.localName === 'shreddit-comment')];
  const triggerOf = (c) => {
    const own = ownWalk(c);
    return own.find((el) => el.localName.includes('overflow')) ||
      own.find((el) => el.matches('button') && (el.hasAttribute('aria-haspopup') || /more|option|overflow|actions/i.test(el.getAttribute('aria-label') || '')));
  };
  const usable = (c) => visible(c) && !c.hasAttribute('collapsed') && triggerOf(c);
  const all = [...document.querySelectorAll('shreddit-comment')];
  const others = all.filter((c) => usable(c) && c.getAttribute('author') !== 'AutoModerator' && c.getAttribute('author')?.toLowerCase() !== meName.toLowerCase());
  const mine = meName ? all.filter((c) => c.getAttribute('author')?.toLowerCase() === meName.toLowerCase()) : [];
  log('comments by you on this page:', mine.length, '| usable:', mine.filter(usable).length);
  for (const [label, comment] of [['COMMENT', others[0]], ['YOUR COMMENT', mine.find(usable)]]) {
  if (!comment) { log(`\n(${label}: none usable on this page)`); continue; }
  {
    log(`\n=== ${label}: all attributes ===`);
    log(attrs(comment, true));
    log(`\n=== ${label}: light DOM (nested replies skipped) ===`);
    log(skel(comment, 7, 160, (n) => n.localName === 'shreddit-comment'));
    log(`\n=== ${label}: own shadow root ===`);
    log(comment.shadowRoot ? skel(comment.shadowRoot, 5, 60) : '(none or closed)');

    const trigger = triggerOf(comment);
    log(`\n=== ${label}: ⋯ trigger ===`);
    if (trigger) {
      log(chain(trigger, comment));
      const before = new Set(menuItems());
      clickTrigger(trigger);
      await sleep(1200);
      const items = menuItems().filter((i) => !before.has(i));
      log(`\n=== ${label}: ⋯ menu items after opening ===`);
      log(items.map((i) => `${JSON.stringify(text(i))}${ours(i) ? ' (ours)' : ''}`).join('\n') || '(none found)');
      const report = items.find((i) => /^report\b/i.test(text(i)));
      if (report) {
        log('\n--- Report item, ancestors up to document ---');
        log(chain(report, null));
      }
      log('fallback popover shown:', !!document.querySelector('.rmute-pop'));
      closeMenus();
      await sleep(300);
    } else log('(not found)');
  }
  }

  // --- Custom feeds API (shape only; names are not copied) ---
  log('\n=== /api/multi/mine.json ===');
  try {
    const res = await fetch('/api/multi/mine.json', { credentials: 'include' });
    log('status:', res.status, res.headers.get('content-type'));
    const data = await res.json().catch(() => null);
    if (Array.isArray(data)) {
      log('feeds:', data.length, '| first item keys:', Object.keys(data[0] || {}).join(','),
        '| data keys:', Object.keys(data[0]?.data || {}).slice(0, 30).join(','),
        '| subreddits[0] keys:', Object.keys(data[0]?.data?.subreddits?.[0] || {}).join(','));
    } else log('not an array:', data && trunc(JSON.stringify(data), 200));
  } catch (err) {
    log('error:', err.message);
  }

  window.scrollTo(0, scrollY);
  const report = lines.join('\n');
  try {
    await navigator.clipboard.writeText(report);
    console.log(`Copied ${report.length} characters. Paste it to Claude.`);
  } catch {
    console.log(report);
    console.log('copy() unavailable: copy the text above.');
  }
})();
