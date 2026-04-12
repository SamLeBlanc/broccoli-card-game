// ── Animation engine ──────────────────────────────────────────────────────────
const ease = {
  cubicOut:   t => 1 - Math.pow(1 - t, 3),
  quintOut:   t => 1 - Math.pow(1 - t, 5),
  cubicInOut: t => t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2,
};

function animateTo(el, { delay=0, duration=300, x, y, rot, easing='cubicInOut', onComplete }) {
  let startX, startY, startRot, startTime, rafId;
  const tx = x   ?? (el._ax   ?? 0);
  const ty = y   ?? (el._ay   ?? 0);
  const tr = rot ?? (el._arot ?? 0);

  function run(ts) {
    if (!startTime) { startTime = ts; startX = el._ax??0; startY = el._ay??0; startRot = el._arot??0; }
    const t  = Math.min((ts - startTime) / duration, 1);
    const et = ease[easing](t);
    const cx = startX + (tx - startX)*et, cy = startY + (ty - startY)*et, cr = startRot + (tr - startRot)*et;
    el.style.transform = `translate(${cx}px,${cy}px) rotate(${cr}deg)`;
    el._ax = cx; el._ay = cy; el._arot = cr;
    if (t < 1) rafId = requestAnimationFrame(run);
    else onComplete?.();
  }
  delay > 0 ? setTimeout(() => { rafId = requestAnimationFrame(run); }, delay)
            : (rafId = requestAnimationFrame(run));
  return () => cancelAnimationFrame(rafId);
}

function plusminus(n) { return Math.random() < 0.5 ? -n : n; }

// ── Deck pile visual ──────────────────────────────────────────────────────────
const PILE_COUNT = 8;
let pileEls = [];

function buildDeckPile() {
  const $pile = $('#deck-pile').empty();
  pileEls = [];
  for (let i = 0; i < PILE_COUNT; i++) {
    const $el = $('<div>').addClass('pile-card');
    const off = (PILE_COUNT - i) * 0.6;
    $el.css('transform', `translate(${-off}px,${-off}px)`);
    const el = $el.get(0);
    el._ax = -off; el._ay = -off; el._arot = 0;
    $pile.append($el);
    pileEls.push(el);
  }
}

// ── Shuffle animation ─────────────────────────────────────────────────────────
let shuffling = false;

function playShuffleAnimation(onDone) {
  if (shuffling) { onDone?.(); return; }
  shuffling = true;
  pileEls.forEach((el, i) => animateTo(el, {
    delay: i*18, duration: 220,
    x: plusminus(Math.random()*60+30), y: (Math.random()-0.5)*20,
    rot: plusminus(Math.random()*25+5), easing: 'cubicOut',
  }));
  const phase2 = PILE_COUNT * 18 + 240;
  let done = 0;
  pileEls.forEach((el, i) => {
    const off = (PILE_COUNT - i) * 0.6;
    animateTo(el, {
      delay: phase2 + i*25, duration: 200, x: -off, y: -off, rot: 0, easing: 'quintOut',
      onComplete: () => { if (++done === PILE_COUNT) { shuffling = false; onDone?.(); } }
    });
  });
}
