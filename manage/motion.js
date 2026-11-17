// Popup motion trial: the tab drum (motion.css) and lists growing open.
// Nothing else depends on this file.
(() => {
  if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
  const tabs = document.querySelector('.tabs');
  const buttons = [...tabs.querySelectorAll('[role="tab"]')];
  const REACH = 0.6; // the far end of the longer side sits this far round the eye, in radians
  const VIEW = 120; // how far the viewer is from the front of the eye
  const GAP = 5; // between titles along the strip
  const SIZES = [1.25, 1.06, 0.98, 0.94]; // a title's size by how many titles it is from the selected one
  const POP = 12; // how far a hovered title also comes out of the carousel, along the way it's facing, in px
  const GROW = 0.3; // how much bigger each letter of a hovered title gets; the word widens by its letters
  const RIPPLE = 0.7; // letters further from the title's middle start growing this much later (0 = all at once)
  const POP_ROOM = 14; // how far past the row's ends it can go, in px
  const HOVER_TIME = 70; // how quickly it gets there, in ms (about 3x this to settle)
  const WORD_REACH = 1.2; // how far round the selected word's ends sit, against the row's curve at that point
  const WORD_MIN = 0.25; // and at least this, in radians, so short words curve too
  const WORD_VIEW = 2; // how far the viewer is from the word's small carousel, per its radius
  const LINE_VIEW = 0.25; // the same for its line, closer so its curve shows
  const LINE = 11; // the line's distance below the middle of the title, in px
  const TIME = 450;
  const pen = document.createElement('canvas').getContext('2d');
  let strip = null; // [{ button, width, letters: [{ el, from, wide, d }], lift }]
  let pos = 0; // which title is in the middle; between two while moving
  let lineWidth = 0; // the shortest title's, whichever is selected
  let frame = 0;
  let moving = null; // { from, to, start } while the row turns to a new title
  let hovered = null;
  let last = 0;
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
        letters.push({ el, from, wide, d: Math.abs(from + wide / 2 - width / 2) / (width / 2 || 1) });
      }
      return { button, width, letters, lift: 0 };
    });
    lineWidth = Math.min(...strip.map((t) => t.width)) * SIZES[0];
  }

  // Between two steps while the row is moving, so sizes change smoothly.
  function sizeAt(away) {
    const step = Math.min(Math.floor(away), SIZES.length - 1);
    const next = SIZES[Math.min(step + 1, SIZES.length - 1)];
    return SIZES[step] + (next - SIZES[step]) * (away - step);
  }

  function draw() {
    // Laid out at each title's current size, so the titles make room for each other.
    let across = 0;
    strip.forEach((t, i) => {
      t.away = Math.abs(i - pos);
      t.size = sizeAt(t.away);
      t.rest = across + t.width * t.size / 2;
      across += t.width * t.size + GAP;
    });
    across -= GAP;
    const low = Math.floor(pos);
    const high = Math.min(low + 1, strip.length - 1);
    const between = (key) => strip[low][key] + (strip[high][key] - strip[low][key]) * (pos - low);
    const restMiddle = between('rest');
    // Tighter when the longer side is short, so the curve always reaches as far round.
    const round = Math.max(restMiddle, across - restMiddle, 200) * 1.08 / REACH;
    // A hovered title's letters each grow, from the middle out, pushing the next ones
    // along, and it comes out of the carousel; the titles round it, the selected one
    // too, move aside by as much, so nothing overlaps.
    let grown = 0;
    let hover = null;
    for (const t of strip) {
      let extra = 0;
      for (const l of t.letters) {
        const grow = 1 + GROW * Math.max(0, Math.min(1, t.lift * (1 + RIPPLE) - RIPPLE * l.d));
        l.grow = grow;
        l.mid = l.from + extra + l.wide * grow / 2;
        extra += l.wide * (grow - 1);
      }
      t.extra = extra;
      t.pop = POP * t.lift;
      t.mag = (1 + t.pop / round) * VIEW / (VIEW - t.pop);
      const wide = (t.width + extra) * t.size * t.mag;
      t.spot = grown + wide / 2;
      grown += wide + GAP;
      if (t.lift && t.lift > (hover?.lift ?? 0)) hover = t;
    }
    // The hovered title stays where it rests; everything else moves away from it.
    const middle = between('spot') + (hover ? (hover.spot - hover.rest) - (between('spot') - restMiddle) : 0);
    for (const t of strip) {
      const { width, away, size, lift, spot, rest, letters, extra, pop, mag } = t;
      // The title in the middle is a little carousel of its own: the main one carries
      // its centre, and its letters turn round a small one.
      const own = Math.max(0, 1 - away);
      const small = (width * size / 2) / wordReach(width * size / 2, round);
      // Where the title rests on the row, for finding the hovered one.
      const half = width * size / 2;
      t.left = project(rest - restMiddle - half, round, 0);
      t.right = project(rest - restMiddle + half, round, 0);
      // Coming out spreads it by mag, so its centre is set back to land on its spot,
      // and it slides back only as far as it would leave the page.
      const off = spot - middle;
      const outer = Math.abs(off) + (width + extra) * size * mag / 2;
      const slide = lift ? -Math.sign(off) * Math.max(0, project(outer, round, 0) - tabs.clientWidth / 2 - POP_ROOM) : 0;
      for (const { el, mid, grow } of letters) {
        const at = mid - (width + extra) / 2;
        const along = off / mag + at * size * (1 - own);
        el.style.transform = `translateX(${slide}px) perspective(${VIEW}px) translateZ(${-round}px) rotateY(${along / round}rad) translateZ(${round + pop}px) perspective(${small * WORD_VIEW}px) translateZ(${-small}px) rotateY(${own * at * size / small}rad) translateZ(${small}px) scale(${size * grow}) translate(-50%, -50%)`;
      }
    }
    // The line follows the selected title when a hover pushes it aside.
    line.style.translate = `${project(between('spot') - middle, round, 0)}px 0`;
    drawLine(round);
  }

  // A point on the row as it appears on screen, from the middle, out by pop along its facing.
  function project(along, round, pop) {
    const angle = along / round;
    return (round + pop) * Math.sin(angle) * VIEW / (VIEW + round - (round + pop) * Math.cos(angle));
  }

  // Kept to the row's curve, so the word carries on the curve of the titles beside it.
  const wordReach = (half, round) => Math.max(WORD_MIN, WORD_REACH * half / round);

  // On the selected word's little carousel too, so its ends curve away with the letters.
  function drawLine(round) {
    const half = lineWidth / 2;
    const reach = wordReach(half, round);
    const small = half / reach;
    let path = '';
    for (let i = -16; i <= 16; i++) {
      const angle = reach * i / 16;
      const near = 1 / (1 + (1 - Math.cos(angle)) / LINE_VIEW);
      const x = small * Math.sin(angle) * near;
      const y = LINE * near;
      path += `${i === -16 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }
    line.firstChild.setAttribute('d', path);
  }

  function step(now) {
    frame = 0;
    const passed = last ? now - last : 16;
    last = now;
    let busy = false;
    if (moving) {
      // A frame's time can be just before the click that started the turn.
      const t = Math.max(0, Math.min(1, (now - moving.start) / TIME));
      pos = moving.from + (moving.to - moving.from) * (1 - (1 - t) ** 3);
      if (t < 1) busy = true;
      else moving = null;
    }
    for (const t of strip) {
      const goal = t.button === hovered && t.button.getAttribute('aria-selected') !== 'true' ? 1 : 0;
      t.lift += (goal - t.lift) * (1 - Math.exp(-passed / HOVER_TIME));
      if (Math.abs(goal - t.lift) < 0.005) t.lift = goal;
      else busy = true;
    }
    draw();
    if (busy) run();
    else last = 0;
  }

  function run() {
    if (!frame) frame = requestAnimationFrame(step);
  }

  function place(animate) {
    const tab = strip.findIndex((t) => t.button.getAttribute('aria-selected') === 'true');
    if (tab < 0) return;
    if (animate) {
      moving = { from: pos, to: tab, start: performance.now() };
      return run();
    }
    moving = null;
    pos = tab;
    draw();
  }

  function hover(button) {
    if (button === hovered) return;
    hovered?.removeAttribute('data-hover');
    button?.setAttribute('data-hover', '');
    tabs.style.cursor = button ? 'pointer' : '';
    hovered = button;
    run();
  }

  // By where the titles rest, not the letters, so a title moving out from under the
  // pointer stays hovered.
  tabs.addEventListener('pointermove', (e) => {
    const box = tabs.getBoundingClientRect();
    const x = e.clientX - box.left - box.width / 2;
    hover(strip.find((t) => x >= t.left - GAP / 2 && x <= t.right + GAP / 2)?.button ?? null);
  });
  tabs.addEventListener('pointerleave', () => hover(null));
  tabs.addEventListener('click', (e) => {
    if (!e.target.closest('[role="tab"]')) hovered?.click();
  });

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
  const LISTS = '#main-group, #word-group, .presets details';
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
