// Places the sliding tab underline (motion.css). Nothing else depends on this file.
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
