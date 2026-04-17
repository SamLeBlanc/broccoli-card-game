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

// ── Slide definitions ─────────────────────────────────────────────────────────
// Slide 1: three sample cards
// Slide 2: full 52-card grid (generated dynamically — no static card list)

const SUITS_ORDER = ['spade', 'heart', 'club', 'diamond'];
const RANKS_ORDER = ['A', 2, 3, 4, 5, 6, 7, 8, 9, 10, 'J', 'Q', 'K'];

const INTRO_SLIDES = [
  {
    html: 'A normal deck of cards has <span class="intro-highlight">only two traits</span>: number and suit, boring!',
    cards: [
      { rank: 2,   suit: 'diamond', col: 0, row: 0 },
      { rank: 8,   suit: 'spade',   col: 2, row: 0 },
      { rank: 'Q', suit: 'club',    col: 4, row: 0 },
    ],
  },
  {
    html: '<span class="intro-highlight-green">Broccoli</span> cards are better —<br>they have <span class="intro-highlight">three traits</span>: color, number, and suit.',
    cards: [
      { id: 'intro-a', rank: 2,   suit: 'diamond', color: 'red',    col: 0, row: 0 },
      { id: 'intro-b', rank: 8,   suit: 'spade',   color: 'blue',   col: 2, row: 0 },
      { id: 'intro-c', rank: 'Q', suit: 'club',    color: 'green',  col: 4, row: 0 },
    ],
  },
  {
    type: 'sets',
    html: 'To score, group cards so each trait is <span class="intro-highlight">all the same</span> or <span class="intro-highlight">all different</span>.',
    sets: [
      {
        label: 'All traits\ndifferent',
        cards: [
          { id: 'is-a', rank: 1,   suit: 'spade',   color: 'red'    },
          { id: 'is-b', rank: 2,   suit: 'heart',   color: 'blue'   },
          { id: 'is-c', rank: 3,   suit: 'club',    color: 'green'  },
        ],
      },
      {
        label: 'All blues',
        cards: [
          { id: 'is-d', rank: 6,   suit: 'spade',   color: 'blue'   },
          { id: 'is-e', rank: 7,   suit: 'heart',   color: 'blue'   },
          { id: 'is-f', rank: 8,   suit: 'club',    color: 'blue'   },
        ],
      },
      {
        label: 'All spades\nAll 5s',
        cards: [
          { id: 'is-g', rank: 5,   suit: 'spade',   color: 'red'    },
          { id: 'is-h', rank: 5,   suit: 'spade',   color: 'blue'   },
          { id: 'is-i', rank: 5,   suit: 'spade',   color: 'green'  },
        ],
      },
      {
        label: 'All green\nAll clubs',
        cards: [
          { id: 'is-j', rank: 5,   suit: 'club',    color: 'green'  },
          { id: 'is-k', rank: 6,   suit: 'club',    color: 'green'  },
          { id: 'is-l', rank: 7,   suit: 'club',    color: 'green'  },
          { id: 'is-m', rank: 8,   suit: 'club',    color: 'green'  },
        ],
      },
    ],
  },
];

// Row on the table where the cards' centres land (slide 1 only).
const INTRO_CARD_ROW = 3;

// ── State ─────────────────────────────────────────────────────────────────────
let introVisible  = false;
let currentSlide  = 0;

// ── Place / clear ─────────────────────────────────────────────────────────────
function clearIntroCards() {
  $('#table .intro-el').remove();
  introVisible = false;
}

function showIntroSlide(idx) {
  clearIntroCards();
  const slide = INTRO_SLIDES[idx];
  if (!slide) return;
  introVisible  = true;
  currentSlide  = idx;

  const $table = $(tableEl());

  // ── Cards ─────────────────────────────────────────────────────────────────
  if (slide.cards) {
    // Slides with an explicit card list — centred horizontally, cards rendered
    // as traditional (idx 0) or real Broccoli cards (idx 2+)
    const maxRelCol = Math.max(...slide.cards.map(c => c.col));
    const groupSpan = maxRelCol + 1;
    const startCol  = Math.floor((GRID_COLS - groupSpan) / 2);

    for (const cardDef of slide.cards) {
      const absCol = startCol + cardDef.col;
      const absRow = INTRO_CARD_ROW + cardDef.row;
      const x = gridOffsetX + absCol * GRID_W + GRID_W / 2;
      const y = gridOffsetY + absRow * GRID_H + GRID_H / 2;

      // idx 0 → traditional white cards; idx 2+ → real Broccoli card style
      const el = (idx === 0)
        ? makeTradCardEl(cardDef.rank, cardDef.suit)
        : makeCardEl(cardDef, { faceUp: true });
      el.classList.add('intro-el', 'table-card');
      el.style.position  = 'absolute';
      el.style.transform = 'translate(-50%,-50%)';
      el.style.left      = x + 'px';
      el.style.top       = y + 'px';
      el.style.zIndex    = '50';
      el.style.pointerEvents = 'none';
      $table.append(el);
    }

    // Text label — one row above cards, centred over group
    const groupCentreX = gridOffsetX + (startCol + groupSpan / 2) * GRID_W;
    const labelY       = gridOffsetY + (INTRO_CARD_ROW - 1) * GRID_H + GRID_H / 2;
    $('<div>')
      .addClass('intro-el intro-label')
      .html(slide.html || $('<span>').text(slide.text).html())
      .css({ left: groupCentreX + 'px', top: labelY + 'px',
             transform: 'translate(-50%, -50%)', zIndex: 51 })
      .appendTo($table);

  }

  // ── Nav buttons ───────────────────────────────────────────────────────────
  const isFirst = idx === 0;
  const isLast  = idx === INTRO_SLIDES.length - 1;

  // Centre of the table bottom area — below the card grid
  const btnY = gridOffsetY + GRID_ROWS * GRID_H + 18;
  const btnX = gridOffsetX + (GRID_COLS / 2) * GRID_W;

  const $btnRow = $('<div>')
    .addClass('intro-el intro-nav')
    .css({ left: btnX + 'px', top: btnY + 'px', transform: 'translate(-50%, 0)' });

  if (!isFirst) {
    $('<button>').addClass('intro-nav-btn').text('← Back')
      .on('click', () => showIntroSlide(idx - 1))
      .appendTo($btnRow);
  }

  if (!isLast) {
    $('<button>').addClass('intro-nav-btn').text('Next →')
      .on('click', () => showIntroSlide(idx + 1))
      .appendTo($btnRow);
  } else {
    $('<button>').addClass('intro-nav-btn intro-nav-close').text('Close')
      .on('click', () => clearIntroCards())
      .appendTo($btnRow);
  }

  $table.append($btnRow);
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
  setTimeout(() => {
    // Intro elements survive state syncs automatically (not in tableCards).
  }, 0);
});                           