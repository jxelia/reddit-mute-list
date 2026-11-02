// Popup motion trial: the tab carousel (motion.css) and lists growing open.
// Nothing else depends on this file.
(() => {
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const tabs = document.querySelector('.tabs');
  const buttons = [...tabs.querySelectorAll('[role="tab"]')];
  // By steps from the selected title: size, turn round the drum, opacity.
  const SIZE = [1.1, 0.82, 0.66, 0.56];
  const TURN = [0, 16, 28, 38];
  const FADE = [1, 0.75, 0.55, 0.42];
  const OVERHANG = 8; // past the page's edge on each side, still inside its padding
  const MIN_GAP = 3;
  const MAX_GAP = 14;
  const textWidth = (b) => {
    const box = getComputedStyle(b);
    return b.offsetWidth - parseFloat(box.paddingLeft) - parseFloat(box.paddingRight);
  };
  const setPlace = (b, x, d, side, fit = 1) => {
    b.style.setProperty('--x', `${x}px`);
    b.style.setProperty('--s', SIZE[d] * fit);
    b.style.setProperty('--r', `${side * TURN[d]}deg`);
    b.style.setProperty('--o', FADE[d]);
  };

  function place() {
    const tab = buttons.find((b) => b.getAttribute('aria-selected') === 'true');
    if (!tab || !tab.offsetWidth) return;
    const middle = buttons.indexOf(tab);
    const front = textWidth(tab) * SIZE[0];
    const room = tabs.clientWidth / 2 + OVERHANG - front / 2;

    // Each side shares out its own room: spaced out when it has few or short titles,
    // shrunk a little when its titles wouldn't otherwise fit.
    [-1, 1].forEach((side) => {
      const row = [];
      for (let d = 1, b; (b = buttons[middle + side * d]); d++) {
        row.push({ b, d, wide: textWidth(b) * SIZE[d] * Math.cos(TURN[d] * Math.PI / 180) });
      }
      const total = row.reduce((sum, t) => sum + t.wide, 0);
      const fit = Math.min(1, (room - MIN_GAP * row.length) / total);
      const gap = Math.min(MAX_GAP, (room - total * fit) / row.length);
      let edge = front / 2;
      for (const { b, d, wide } of row) {
        edge += gap + wide * fit / 2;
        setPlace(b, side * edge, d, side, fit);
        edge += wide * fit / 2;
      }
    });
    setPlace(tab, 0, 0, 1);
    tabs.style.setProperty('--tab-w', `${front}px`);
    // No movement for the first placement, only from then on.
    if (!tabs.dataset.ring) {
      tabs.dataset.ring = 'ready';
      requestAnimationFrame(() => requestAnimationFrame(() => { tabs.dataset.ring = 'on'; }));
    }
  }

  new MutationObserver(place).observe(tabs, { subtree: true, attributeFilter: ['aria-selected'] });
  new ResizeObserver(place).observe(tabs);
  place();
})();

// The mute list and built-in filter lists grow open and shrink closed, contents fixed
// in place. The popup window follows the page's height and resizing it every frame
// judders, so the page keeps its tall height throughout: the window grows once before
// opening and shrinks once after closing.
(() => {
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const LISTS = '#main-group, .presets details';
  const page = document.documentElement;
  let running = null;
  let lifting = null;
  let closing = null;

  const stop = () => {
    running?.cancel();
    lifting?.cancel();
    lifting = null;
    closing?.removeAttribute('data-closing');
    running = closing = null;
    page.style.minHeight = '';
  };

  const closedHeight = (el) => {
    const box = getComputedStyle(el);
    return ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth']
      .reduce((sum, side) => sum + parseFloat(box[side]), el.querySelector(':scope > summary').offsetHeight);
  };

  const lift = (el) => getComputedStyle(el, '::details-content').marginTop;

  // liftFrom, liftTo: the mute list's rows rise over its bar's empty part as it opens
  // (manage.css) and leave it as it closes, so none shows in the bar.
  function resize(el, from, to, liftFrom, liftTo, duration, end) {
    page.style.minHeight = `${page.scrollHeight}px`;
    const timing = { duration, easing: 'ease-out', fill: 'forwards' };
    running = el.animate({ height: [`${from}px`, `${to}px`], overflow: ['hidden', 'hidden'] }, timing);
    if (liftFrom !== liftTo) lifting = el.animate({ marginTop: [liftFrom, liftTo] }, { ...timing, pseudoElement: '::details-content' });
    running.onfinish = end;
  }

  // Runs after manage.js's own observer has built a list that fills in on opening.
  new MutationObserver((records) => {
    stop();
    const el = records.map((r) => r.target).find((t) => t.open && t.matches(LISTS) && t.offsetHeight);
    if (el) resize(el, closedHeight(el), el.offsetHeight, '0px', lift(el), 300, stop);
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });

  // A summary click would close at once, so the close is held until the box has shrunk.
  // A click partway through turns it round from the height it's at.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('summary')?.parentElement;
    if (!el?.open || !el.matches(LISTS)) return;
    e.preventDefault();
    const from = el.offsetHeight;
    const liftFrom = lift(el);
    if (closing === el) {
      stop();
      return resize(el, from, el.offsetHeight, liftFrom, lift(el), 300, stop);
    }
    stop();
    closing = el;
    el.setAttribute('data-closing', ''); // the bar's shade comes back as it starts (motion.css)
    resize(el, from, closedHeight(el), liftFrom, '0px', 200, () => {
      el.open = false;
      stop();
    });
  }, true);
})();
