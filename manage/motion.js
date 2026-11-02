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

// The mute list and built-in filter lists grow open, contents fixed in place. The
// popup window follows the page's height and resizing it every frame judders, so the
// page takes its final height at once and the box grows inside that. Opening only.
(() => {
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const page = document.documentElement;
  let running = null;

  const stop = () => {
    running?.cancel();
    running = null;
    page.style.minHeight = '';
  };

  // Runs after manage.js's own observer has built a list that fills in on opening.
  new MutationObserver((records) => {
    stop();
    const el = records.map((r) => r.target).find((t) => t.open && t.matches('#main-group, .presets details') && t.offsetHeight);
    if (!el) return;
    const box = getComputedStyle(el);
    const edges = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, side) => sum + parseFloat(box[side]), 0);
    page.style.minHeight = `${page.scrollHeight}px`;
    running = el.animate(
      { height: [`${el.querySelector(':scope > summary').offsetHeight + edges}px`, `${el.offsetHeight}px`], overflow: ['hidden', 'hidden'] },
      { duration: 300, easing: 'ease-out' }
    );
    running.onfinish = stop;
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
})();
