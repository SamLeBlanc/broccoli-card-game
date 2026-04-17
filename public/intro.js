// ── Rules Intro ───────────────────────────────────────────────────────────────
// Renders illustrated rule slides directly onto the game table, exactly like
// real cards are placed.  No overlay — intro elements sit on #table and are
// cleared when dismissed or when the game resets.
//
// Intro cards use class  .intro-el   (easy to bulk-remove).
// They also carry        .table-card  so the CSS sizing variables apply.
// pointer-events: none  prevents drag/context-menu handlers from firing.

// ── Traditional card renderer ─────────────────────────────────────────────────
// White background, red (♥ ♦) or black (♠ ♣) text — distinct from game cards.
const TRAD_SUIT_SYMBOLS = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const TRAD_SUIT_COLORS  = { spade: '#111', heart: '#c41c1c', club: '#111', diamond: '#c41c1c' };

function makeTradCardEl(rank, suit) {
  const sym   = TRAD_SUIT_SYMBOLS[suit] || '?';
  const color = TRAD_SUIT_COLORS[suit]  || '#111';
  const el = $('<div>')
    .addClass('card table-card intro-el intro-trad-card')
    .css({ background: '#fff', color, pointerEvents: 'none', cursor: 'default' })
    .html(`<div class="card-face">
      <div class="c-face-rank">${rank}</div>
      <div class="c-face-suit">${sym}</div>
    </div>`)
    .get(0);
  el.style.transform = 'translate(-50%,-50%)';
  return el;
}

// ── Intro slides ──────────────────────────────────────────────────────────────
// col / row are relative to the slide group.
// showIntroSlide() auto-centres the group horizontally; ROW_CENTER sets vertical.
// Leave col gaps of 1 between cards (e.g. cols 0, 2, 4) for breathing room.

const INTRO_SLIDES = [
  {
    text: 'A normal deck of cards has two traits, number and suit.',
    cards: [
      { rank: 2,   suit: 'diamond', col: 0, row: 0 },
      { rank: 8,   suit: 'spade',   col: 2, row: 0 },
      { rank: 'Q', suit: 'club',    col: 4, row: 0 },
    ],
  },
];

// Row on the table where the cards' centres land.
const INTRO_CARD_ROW = 3;

// ── Place / clear ─────────────────────────────────────────────────────────────
let introVisible = false;

function clearIntroCards() {
  $('#table .intro-el').remove();
  introVisible = false;
}

function showIntroSlide(idx) {
  clearIntroCards();
  const slide = INTRO_SLIDES[idx];
  if (!slide) return;
  introVisible = true;

  const $table = $(tableEl());

  // ── Cards ─────────────────────────────────────────────────────────────────
  const maxRelCol = Math.max(...slide.cards.map(c => c.col));
  const groupSpan = maxRelCol + 1;                            // in grid-cells
  // Centre the group horizontally in the grid.
  const startCol  = Math.floor((GRID_COLS - groupSpan) / 2);

  for (const { rank, suit, col, row } of slide.cards) {
    const absCol = startCol + col;
    const absRow = INTRO_CARD_ROW + row;
    const x = gridOffsetX + absCol * GRID_W + GRID_W / 2;
    const y = gridOffsetY + absRow * GRID_H + GRID_H / 2;

    const el = makeTradCardEl(rank, suit);
    el.style.left   = x + 'px';
    el.style.top    = y + 'px';
    el.style.zIndex = 50;
    $table.append(el);
  }

  // ── Text label ────────────────────────────────────────────────────────────
  // Centred horizontally over the card group, one row above.
  const groupCentreX = gridOffsetX + (startCol + groupSpan / 2) * GRID_W;
  const labelY       = gridOffsetY + (INTRO_CARD_ROW - 1) * GRID_H + GRID_H / 2;

  const $label = $('<div>')
    .addClass('intro-el intro-label')
    .text(slide.text)
    .css({
      left:      groupCentreX + 'px',
      top:       labelY + 'px',
      transform: 'translate(-50%, -50%)',
      zIndex:    51,
    });
  $table.append($label);
}

// ── Button wiring ─────────────────────────────────────────────────────────────
// Rules button toggles the intro on/off.
$('#btn-rules').on('click', () => {
  if (introVisible) {
    clearIntroCards();
  } else {
    showIntroSlide(0);
  }
});

// Clear intro if the game collects / reshuffles cards (table is about to be wiped).
socket.on('state', () => {
  // Only auto-clear if the server removed all table cards (collect / new game).
  // We do this after the normal state handler runs.
  setTimeout(() => {
    if (!introVisible) return;
    // Re-append intro elements so they sit above any newly placed game cards.
    // (They were not removed by the state handler since they aren't in tableCards.)
    // Nothing to do — they survive the state sync automatically.
  }, 0);
});
