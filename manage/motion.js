// Popup motion trial: the tab drum (motion.css) and lists growing open.
// Nothing else depends on this file.
(() => {
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const tabs = document.querySelector('.tabs');
  const buttons = [...tabs.querySelectorAll('[role="tab"]')];
  const REACH = 1.1; // the far end of the longer side sits this far round the eye, in radians
  const VIEW = 290; // how far the viewer is from the front of the eye
  const GAP = 12; // between titles along the strip
  const BIG = 0.08; // extra size at the very middle
  const WORD_REACH = 0.5; // how far round its own little carousel the selected word's ends sit, in radians
  const WORD_VIEW = 0.6; // how far the viewer is from that carousel, per its radius
  const LINE = 11; // the line's distance below the middle of the title, in px
  const TIME = 450;
  const pen = document.createElement('canvas').getContext('2d');
  let strip = null; // [{ button, width, centre, letters: [{ el, at }] }]
  let end = 0; // the strip's length
  let pos = 0; // the point on the strip that's in the middle
  let lineWidth = 0;
  let frame = 0;
  let line = null;

  function build() {
    strip = buttons.map((button) => {
      pen.font = getComputedStyle(button).font;
      const text = button.textContent;
      const width = pen.measureText(text).width;
      button.setAttribute('aria-label', text);
      button.textContent = '';
      const letters = [];
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') continue;
        const from = pen.measureText(text.slice(0, i)).width;
        const wide = pen.measureText(text.slice(0, i + 1)).width - from;
        const el = document.createElement('span');
        el.className = 'letter';
        el.ariaHidden = 'true';
        el.textContent = text[i];
        button.append(el);
        letters.push({ el, at: from + wide / 2 - width / 2 });
      }
      const title = { button, width, centre: end + width / 2, letters };
      end += width + GAP;
      return title;
    });
    end -= GAP;
  }

  function draw() {
    // The title reaching the middle grows, so the others move out of its way.
    let before = 0;
    let centred = 0;
    for (const t of strip) {
      t.big = 1 + BIG * Math.max(0, 1 - Math.abs(t.centre - pos) / (t.width / 2 + GAP));
      const extra = t.width * (t.big - 1);
      t.shift = before + extra / 2;
      centred += extra * Math.max(0, Math.min(1, (pos - t.centre + t.width / 2) / t.width));
      before += extra;
    }
    // Tighter when the longer side is short, so the curve always reaches as far round.
    const round = Math.max(pos, end - pos, 200) * 1.08 / REACH;
    for (const { centre, width, big, shift, letters } of strip) {
      for (const { el, at } of letters) {
        // The title in the middle is a little carousel of its own: the main one carries
        // its centre, and its letters turn round a small one.
        const own = (big - 1) / BIG;
        const small = (width * big / 2) / WORD_REACH;
        const along = centre + at * big * (1 - own) + shift - pos - centred;
        el.style.transform = `perspective(${VIEW}px) translateZ(${-round}px) rotateY(${along / round}rad) translateZ(${round}px) perspective(${small * WORD_VIEW}px) translateZ(${-small}px) rotateY(${own * at * big / small}rad) translateZ(${small}px) scale(${big}) translate(-50%, -50%)`;
      }
    }
    drawLine();
  }

  // On the selected word's little carousel too, so its ends curve away with the letters.
  function drawLine() {
    const half = lineWidth / 2;
    const small = half / WORD_REACH;
    let path = '';
    for (let i = -16; i <= 16; i++) {
      const angle = WORD_REACH * i / 16;
      const near = 1 / (1 + (1 - Math.cos(angle)) / WORD_VIEW);
      const x = small * Math.sin(angle) * near;
      const y = LINE * near;
      path += `${i === -16 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    line.firstChild.setAttribute('d', path);
  }

  function place(animate) {
    const tab = strip.find((t) => t.button.getAttribute('aria-selected') === 'true');
    if (!tab) return;
    const toWidth = tab.width * (1 + BIG);
    cancelAnimationFrame(frame);
    if (!animate) {
      pos = tab.centre;
      lineWidth = toWidth;
      return draw();
    }
    const from = pos;
    const fromWidth = lineWidth;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / TIME);
      const eased = 1 - (1 - t) ** 3;
      pos = from + (tab.centre - from) * eased;
      lineWidth = fromWidth + (toWidth - fromWidth) * eased;
      draw();
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
  }

  tabs.dataset.ring = 'on'; // first, since the titles are measured at this size
  build();
  line = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  line.classList.add('line');
  line.setAttribute('aria-hidden', 'true');
  line.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
  tabs.append(line);
  new MutationObserver(() => place(true)).observe(tabs, { subtree: true, attributeFilter: ['aria-selected'] });
  new ResizeObserver(() => place(false)).observe(tabs);
  place(false);
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
