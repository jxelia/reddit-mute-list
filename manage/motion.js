// Popup motion trial: the sliding tab underline (motion.css) and lists growing open.
// Nothing else depends on this file.
(() => {
  const tabs = document.querySelector('.tabs');

  function place() {
    const tab = tabs.querySelector('[aria-selected="true"]');
    if (!tab || !tab.offsetWidth) return;
    tabs.style.setProperty('--tab-x', `${tab.offsetLeft}px`);
    tabs.style.setProperty('--tab-w', `${tab.offsetWidth}px`);
    // No slide for the first placement, only from then on.
    if (!tabs.dataset.slide) {
      tabs.dataset.slide = 'ready';
      requestAnimationFrame(() => requestAnimationFrame(() => { tabs.dataset.slide = 'on'; }));
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
