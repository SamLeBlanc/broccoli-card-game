// ── Join screen: host/join mode + player count picker ────────────────────────
let joinMode = 'host';   // 'host' | 'join'

$('.mode-btn').on('click', function() {
  $('.mode-btn').removeClass('active');
  $(this).addClass('active');
  joinMode = $(this).attr('data-mode');
  if (joinMode === 'host') {
    $('#host-options').removeClass('hidden');
    $('#join-options').addClass('hidden');
    $('#join-btn').text('Host Table');
  } else {
    $('#host-options').addClass('hidden');
    $('#join-options').removeClass('hidden');
    $('#join-btn').text('Join Table');
  }
});

$('.count-btn').on('click', function() {
  $('.count-btn').removeClass('active');
  $(this).addClass('active');
  selectedPlayerCount = parseInt($(this).attr('data-count'));
});

$('#join-btn').on('click', () => {
  const name   = $('#player-name').val().trim() || 'Player';
  const roomId = (joinMode === 'host'
                    ? $('#room-id-host').val().trim()
                    : $('#room-id-join').val().trim()) || Math.random().toString(36).slice(2, 7);
  // Only the host dictates maxPlayers; joiners send undefined so the server
  // keeps whatever the room was created with.
  if (joinMode === 'host') {
    maxPlayers = selectedPlayerCount;
    socket.emit('join', { roomId, name, maxPlayers });
  } else {
    socket.emit('join', { roomId, name });
  }
  $('#join-screen').addClass('hidden');
  $('#game-screen').removeClass('hidden');
  $('#room-label').text(`Room: ${roomId}`);
  buildDeckPile();
  computeGridScale();   // sizes cards and positions deck/discard for current viewport
  setTimeout(() => playShuffleAnimation(null), 300);
});


$('#btn-debug').on('click', () => {
  maxPlayers = 4;
  selectedPlayerCount = 4;
  const roomId = 'debug-' + Math.random().toString(36).slice(2, 7);
  socket.emit('join', { roomId, name: 'You', maxPlayers: 4 });
  $('#join-screen').addClass('hidden');
  $('#game-screen').removeClass('hidden');
  $('#room-label').text(`Room: ${roomId} [DEBUG]`);
  buildDeckPile();
  computeGridScale();   // sizes cards and positions deck/discard for current viewport
  setTimeout(() => playShuffleAnimation(null), 300);
  setTimeout(() => socket.emit('deal', { count: 20 }), 700);
});

$('#player-name').on('keydown', (e) => {
  if (e.key === 'Enter') {
    if (joinMode === 'host') $('#room-id-host').focus();
    else                     $('#room-id-join').focus();
  }
});

$('#room-id-host, #room-id-join').on('keydown', (e) => {
  if (e.key === 'Enter') $('#join-btn').click();
});

// ── Deck / table controls ─────────────────────────────────────────────────────
$('#btn-shuffle').on('click', () =>
  playShuffleAnimation(() => socket.emit('shuffle')));

$('#btn-collect').on('click', () => socket.emit('collect'));

$('#btn-recall').on('click', () => {
  for (const id of Object.keys(tableCards)) {
    socket.emit('pickup-card', { cardId: parseInt(id) });
  }
  clearSelection();
});

$('#btn-draw').on('click', () => socket.emit('draw', { count: 1 }));

$('#btn-flip-table').on('click', () => {
  // Snap to centre of visible table area (scroll-space)
  const tEl = tableEl();
  const cx = Math.round(tEl.scrollLeft + tEl.clientWidth  / 2);
  const cy = Math.round(tEl.scrollTop  + tEl.clientHeight / 2);
  const snapped = snapToGrid(cx, cy);
  socket.emit('flip-to-table', snapped);
});

$('#deck-pile').on('click', () => {
  if (shuffling) return;
  // Place in col 1 (just right of deck pile at col 0), visible row centre
  const tEl = tableEl();
  const cy = Math.round(tEl.scrollTop + tEl.clientHeight / 2);
  const snapped = snapToGrid(GRID_W + GRID_W / 2, cy);
  socket.emit('flip-to-table', snapped);
});

// ── Chat ──────────────────────────────────────────────────────────────────────
$('#chat-send').on('click', sendChat);
$('#chat-input').on('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const $input = $('#chat-input');
  const text  = $input.val().trim();
  if (!text) return;
  socket.emit('chat', { text });
  $input.val('');
}

// ── Socket events ─────────────────────────────────────────────────────────────
socket.on('connect', () => {
  myId = socket.id;
  if (DEBUG) $('#btn-debug').click();
});

socket.on('your-seat', (seat) => { mySeat = seat; });

socket.on('state', ({ deck, table, players, seats, maxPlayers: mp }) => {
  if (mp) maxPlayers = mp;
  lastPlayers = players;
  deckCards = deck;                  // store full draw-pile for deck browser
  clearScoreLabels();
  updateDeckCount(deck.length);
  renderOpponentHands(players, seats);
  updateScoreboard(seats);
  // Reposition discard zone after opp panels may have shown/hidden (changes table width)
  setTimeout(() => { positionDiscardZone(); positionDeckPile(); }, 0);

  const incoming = new Set(Object.keys(table).map(Number));
  for (const id of Object.keys(tableCards).map(Number)) {
    if (!incoming.has(id)) removeTableCard(id);
  }
  for (const id of localScoredIds) {
    if (!incoming.has(id)) localScoredIds.delete(id);
  }
  for (const cardData of Object.values(table)) placeCardOnTable(cardData);
});

socket.on('shuffled', () => playShuffleAnimation(null));

socket.on('your-hand', (hand) => {
  const incomingIds = new Set(hand.map(c => c.id));
  const localIds    = new Set(myHand.map(c => c.id));

  if (isolateDividers.length > 0) {
    const removedFlags = myHand.map(c => (!incomingIds.has(c.id) ? 1 : 0));
    let cum = 0;
    const prefixRemoved = removedFlags.map(f => (cum += f, cum));
    isolateDividers = isolateDividers
      .map(p => p - (prefixRemoved[p - 1] ?? 0))
      .filter(p => p > 0 && p < myHand.length);
    isolateDividers = [...new Set(isolateDividers)].sort((a, b) => a - b);
  }
  myHand = myHand.filter(c => incomingIds.has(c.id));

  for (const card of hand) {
    if (!localIds.has(card.id)) myHand.push(card);
  }

  for (const id of [...selectedHandIds]) {
    if (!incomingIds.has(id)) selectedHandIds.delete(id);
  }
  updateHandSelectUI();

  renderHand();
});

socket.on('card-placed', placeCardOnTable);

socket.on('card-moved', ({ cardId, x, y }) => {
  const entry = tableCards[cardId];
  if (!entry) return;
  entry.el.style.left = x + 'px';
  entry.el.style.top  = y + 'px';
  entry.data.x = x;
  entry.data.y = y;
});

socket.on('card-flipped', ({ cardId, faceUp }) => {
  const entry = tableCards[cardId];
  if (!entry) return;
  const newEl = makeCardEl(entry.data, { faceUp });
  newEl.className = entry.el.className;
  newEl.style.cssText = entry.el.style.cssText;
  $(newEl).on('mousedown', (e) => startTableDrag(e, cardId));
  $(newEl).on('contextmenu', (e) => { e.preventDefault(); showCardMenu(e.clientX, e.clientY, cardId); });
  $(entry.el).replaceWith(newEl);
  entry.el = newEl;
  entry.data.faceUp = faceUp;
});

socket.on('card-removed', ({ cardId }) => removeTableCard(cardId));


// ── Deck browser panel ────────────────────────────────────────────────────────

const DECK_COLORS = ['blue', 'red', 'green', 'purple'];
const DECK_SUITS  = ['spade', 'heart', 'club', 'diamond'];

// Build the complete theoretical 350-card deck (same structure as server buildDeck).
function buildFullDeck() {
  const cards = [];
  let id = 0;
  for (const color of DECK_COLORS) {
    for (const suit of DECK_SUITS) {
      for (let rank = 1; rank <= 13; rank++) cards.push({ id: id++, suit, rank, color });
      cards.push({ id: id++, isJoker: true, wildRank: true,  wildSuit: false, wildColor: false, color, suit });
    }
    for (let rank = 1; rank <= 13; rank++)
      cards.push({ id: id++, isJoker: true, wildRank: false, wildSuit: true,  wildColor: false, color, rank });
    cards.push({ id: id++, isJoker: true, wildRank: true, wildSuit: true, wildColor: false, color });
  }
  for (const suit of DECK_SUITS) {
    for (let rank = 1; rank <= 13; rank++)
      cards.push({ id: id++, isJoker: true, wildRank: false, wildSuit: false, wildColor: true, suit, rank });
    cards.push({ id: id++, isJoker: true, wildRank: true, wildSuit: false, wildColor: true, suit });
  }
  for (let rank = 1; rank <= 13; rank++)
    cards.push({ id: id++, isJoker: true, wildRank: false, wildSuit: true, wildColor: true, rank });
  cards.push({ id: id++, isJoker: true, wildRank: true, wildSuit: true, wildColor: true });
  return cards;
}

// ── Search ────────────────────────────────────────────────────────────────────
// Parse a query like "13 red spade" into { ranks[], colors[], suits[] }.
function parseSearchQuery(query) {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const ranks = [], colors = [], suits = [];
  const suitAliases = { spades: 'spade', hearts: 'heart', clubs: 'club', diamonds: 'diamond' };
  for (const t of tokens) {
    const n = parseInt(t, 10);
    if (!isNaN(n) && n >= 1 && n <= 13) { ranks.push(n); continue; }
    if (DECK_COLORS.includes(t))                { colors.push(t); continue; }
    if (DECK_SUITS.includes(t))                 { suits.push(t);  continue; }
    if (suitAliases[t])                         { suits.push(suitAliases[t]); continue; }
    // Partial color match (e.g. "bl" → blue)
    const colorMatch = DECK_COLORS.find(c => c.startsWith(t));
    if (colorMatch)  { colors.push(colorMatch); continue; }
    // Partial suit match (e.g. "sp" → spade)
    const suitMatch = DECK_SUITS.find(s => s.startsWith(t));
    if (suitMatch)   { suits.push(suitMatch); continue; }
  }
  return { ranks, colors, suits };
}

// Does a card (regular or joker) satisfy ALL dimensions of the parsed query?
// Wild dimensions on a joker count as matching anything in that dimension.
function cardMatchesQuery(card, { ranks, colors, suits }) {
  if (ranks.length  && !card.wildRank  && !ranks.includes(card.rank))   return false;
  if (colors.length && !card.wildColor && !colors.includes(card.color)) return false;
  if (suits.length  && !card.wildSuit  && !suits.includes(card.suit))   return false;
  return true;
}

// ── Grouping ──────────────────────────────────────────────────────────────────
// Returns the bucket key for a card given the current groupBy dimension.
// For jokers: uses their fixed attribute if they have one, otherwise returns null
// (caller places them in a '★ Wild' overflow bucket).
function cardBucketKey(card, groupBy) {
  if (groupBy === 'color') return card.wildColor ? null : card.color;
  if (groupBy === 'suit')  return card.wildSuit  ? null : card.suit;
  // rank
  return card.wildRank ? null : (card.rank ?? null);
}

// Sort comparator within a bucket (secondary axes after the primary group key).
// Wild dimensions sort after fixed ones (index 99 / Infinity).
function bucketSort(groupBy) {
  if (groupBy === 'color') return (a, b) => {
    const si = DECK_SUITS;
    const sd = (a.wildSuit  ? 99 : si.indexOf(a.suit))  - (b.wildSuit  ? 99 : si.indexOf(b.suit));
    return sd !== 0 ? sd : (a.wildRank ? 99 : a.rank)   - (b.wildRank ? 99 : b.rank);
  };
  if (groupBy === 'suit') return (a, b) => {
    const ci = DECK_COLORS;
    const cd = (a.wildColor ? 99 : ci.indexOf(a.color)) - (b.wildColor ? 99 : ci.indexOf(b.color));
    return cd !== 0 ? cd : (a.wildRank ? 99 : a.rank)   - (b.wildRank ? 99 : b.rank);
  };
  // rank — sort by color then suit
  return (a, b) => {
    const ci = DECK_COLORS;
    const cd = (a.wildColor ? 99 : ci.indexOf(a.color)) - (b.wildColor ? 99 : ci.indexOf(b.color));
    const si = DECK_SUITS;
    return cd !== 0 ? cd : (a.wildSuit ? 99 : si.indexOf(a.suit)) - (b.wildSuit ? 99 : si.indexOf(b.suit));
  };
}

// Comparator for the standalone Jokers / ★ Wild sections:
// color → rank → suit, with each wild dimension sorting last.
function jokerSort(a, b) {
  const ci = DECK_COLORS, si = DECK_SUITS;
  const cd = (a.wildColor ? 99 : ci.indexOf(a.color)) - (b.wildColor ? 99 : ci.indexOf(b.color));
  if (cd !== 0) return cd;
  const rd = (a.wildRank  ? 99 : a.rank)              - (b.wildRank  ? 99 : b.rank);
  if (rd !== 0) return rd;
  return     (a.wildSuit  ? 99 : si.indexOf(a.suit))  - (b.wildSuit  ? 99 : si.indexOf(b.suit));
}

// Build ordered bucket definitions for the primary grouping dimension.
function bucketDefs(groupBy) {
  if (groupBy === 'color') return DECK_COLORS.map(k => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1) }));
  if (groupBy === 'suit')  return DECK_SUITS.map(k  => ({ key: k, label: (SUIT_SYMBOLS[k] || k) + ' ' + k.charAt(0).toUpperCase() + k.slice(1) }));
  return Array.from({ length: 13 }, (_, i) => ({ key: i + 1, label: String(i + 1) }));
}

// Returns an ordered array of { label, cards[] } sections.
// When separateJokers is false, jokers are sorted into their fixed-attribute bucket
// (or a '★ Wild' section for wild-on-that-dimension jokers).
function groupCards(allCards, groupBy, separateJokers) {
  const regular = allCards.filter(c => !c.isJoker);
  const jokers  = allCards.filter(c =>  c.isJoker);
  const cmp     = bucketSort(groupBy);
  const defs    = bucketDefs(groupBy);

  // Build main sections from regular cards
  const sections = defs.map(({ key, label }) => ({
    key, label,
    cards: regular.filter(c => cardBucketKey(c, groupBy) === key).sort(cmp),
  }));

  if (separateJokers) {
    // Jokers always in one sorted block at the end
    if (jokers.length > 0)
      sections.push({ key: '__jokers__', label: 'Jokers', cards: [...jokers].sort(jokerSort) });
  } else {
    // Place each joker in the bucket matching its fixed attribute for this dimension,
    // or into a '★ Wild' overflow bucket if it's wild on this dimension.
    const wildJokers = [];
    for (const j of jokers) {
      const key = cardBucketKey(j, groupBy);
      const sec = key != null ? sections.find(s => s.key === key) : null;
      if (sec) sec.cards.push(j);
      else     wildJokers.push(j);
    }
    // Re-sort each section (jokers appended after regular cards)
    for (const sec of sections) sec.cards.sort(cmp);
    if (wildJokers.length > 0)
      sections.push({ key: '__wild__', label: '★ Wild', cards: wildJokers.sort(jokerSort) });
  }

  return sections.filter(s => s.cards.length > 0);
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderDeckPanel() {
  const $content = $('#deck-panel-content').empty();
  const rawCards = deckPanelTab === 'remaining' ? deckCards : buildFullDeck();
  const query    = $('#deck-search').val() || '';
  const parsed   = parseSearchQuery(query);
  const hasQuery = parsed.ranks.length || parsed.colors.length || parsed.suits.length;

  const cards = hasQuery ? rawCards.filter(c => cardMatchesQuery(c, parsed)) : rawCards;

  if (cards.length === 0) {
    const msg = hasQuery ? 'No cards match that search' : 'Deck is empty';
    $content.html(`<div style="padding:24px 8px;text-align:center;opacity:0.45;font-size:0.85rem;">${msg}</div>`);
    return;
  }

  $content.append(
    $('<div>').addClass('deck-match-count').text(`${cards.length} card${cards.length !== 1 ? 's' : ''}`)
  );

  const sections = groupCards(cards, deckGroupBy, deckSeparateJokers);
  for (const { label, cards: group } of sections) {
    $content.append($('<div>').addClass('deck-section-header').text(`${label} (${group.length})`));
    const $grid = $('<div>').addClass('deck-card-grid');
    for (const card of group) {
      const $card = $(makeCardEl(card, { faceUp: true })).addClass('card-tiny');
      if (DEBUG) {
        $card.addClass('deck-card-clickable')
             .attr('title', 'Click to add to hand')
             .on('click', () => {
               socket.emit('debug-add-card', card);
               // Flash the card briefly to confirm
               $card.css('outline', '2px solid #7fff7f');
               setTimeout(() => $card.css('outline', ''), 400);
             });
      }
      $grid.append($card);
    }
    $content.append($grid);
  }
}

// ── State & handlers ──────────────────────────────────────────────────────────
let deckPanelTab      = 'remaining';
let deckGroupBy       = 'color';
let deckSeparateJokers = true;

// ── Right sidebar resize ──────────────────────────────────────────────────
(function() {
  const STORAGE_KEY = 'sidebarWidth';
  const $sidebar    = $('#right-sidebar');
  const $handle     = $('#sidebar-resize-handle');
  const MIN_W = 160, MAX_W = 520;

  // Restore saved width
  const saved = parseInt(localStorage.getItem(STORAGE_KEY));
  if (saved >= MIN_W && saved <= MAX_W) $sidebar.css('width', saved + 'px');

  let startX, startW;

  $handle.on('mousedown', function(e) {
    e.preventDefault();
    startX = e.clientX;
    startW = $sidebar.outerWidth();
    $handle.addClass('dragging');
    $('body').css('user-select', 'none').css('cursor', 'ew-resize');

    $(document).on('mousemove.sidebarResize', function(e) {
      const delta = startX - e.clientX;          // dragging left = grow
      const newW  = Math.min(MAX_W, Math.max(MIN_W, startW + delta));
      $sidebar.css('width', newW + 'px');
      syncHandMaxWidth();
    });

    $(document).on('mouseup.sidebarResize', function() {
      $handle.removeClass('dragging');
      $('body').css('user-select', '').css('cursor', '');
      $(document).off('.sidebarResize');
      localStorage.setItem(STORAGE_KEY, $sidebar.outerWidth());
      syncHandMaxWidth();
    });
  });

  // Also sync on window resize
  $(window).on('resize', syncHandMaxWidth);
})();

// Keep #hand-cards max-width equal to the center column width
function syncHandMaxWidth() {
  const w = document.getElementById('center-col').clientWidth;
  const padding = 24; // 0.75rem * 2 sides = ~12px each side
  document.getElementById('hand-cards').style.maxWidth = (w - padding) + 'px';
}
// Run once after layout settles
$(function() { setTimeout(syncHandMaxWidth, 0); });

// ── Right sidebar tab switching ───────────────────────────────────────────
function switchSidebarTab(name) {
  $('.sidebar-tab').removeClass('active');
  $(`.sidebar-tab[data-pane="${name}"]`).addClass('active');
  $('.sidebar-pane').addClass('hidden');
  $(`#pane-${name}`).removeClass('hidden');
}

$(document).on('click', '.sidebar-tab', function() {
  const pane = $(this).attr('data-pane');
  switchSidebarTab(pane);
  if (pane === 'deck') renderDeckPanel();
  if (pane === 'cheat' && typeof renderCheatPanel === 'function') renderCheatPanel();
});

$('.deck-tab').on('click', function() {
  deckPanelTab = $(this).attr('data-tab');
  $('.deck-tab').removeClass('active');
  $(this).addClass('active');
  renderDeckPanel();
});

$('.deck-group-btn').on('click', function() {
  deckGroupBy = $(this).attr('data-group');
  $('.deck-group-btn').removeClass('active');
  $(this).addClass('active');
  renderDeckPanel();
});

$('#deck-separate-jokers').on('change', function() {
  deckSeparateJokers = $(this).prop('checked');
  renderDeckPanel();
});

// Live search — debounced slightly so typing feels snappy
let _deckSearchTimer = null;
$('#deck-search').on('input', () => {
  clearTimeout(_deckSearchTimer);
  _deckSearchTimer = setTimeout(renderDeckPanel, 120);
});

// Scores now live on the player chips in #opp-top (via renderOpponentHands).
function updateScoreboard() {}

// ── AI turn visualization ─────────────────────────────────────────────────────
// Each AI seat maps to a fixed grid row so cards always land on the snap grid.
// All AI seats play to the middle row (row 3 of 0–6).
const AI_GRID_ROWS = [0, 3, 3, 3];

// Convert a table-relative grid cell centre to a viewport (fixed) coordinate.
function gridCellToScreen(col, row) {
  const tEl   = tableEl();
  const tRect = tEl.getBoundingClientRect();
  return {
    x: Math.round(tRect.left + gridOffsetX + col * GRID_W + GRID_W / 2 - tEl.scrollLeft),
    y: Math.round(tRect.top  + gridOffsetY + row * GRID_H + GRID_H / 2 - tEl.scrollTop),
  };
}

socket.on('ai-turn', ({ phase, seat, name, cards, score }) => {
  console.log('[ai-turn]', phase, seat, name, score);
  const cardW  = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-w')) || 80;
  const cardH  = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--card-h')) || 112;
  const scale  = cardW / 80;
  const aiRow  = AI_GRID_ROWS[seat] ?? 0;

  if (phase === 'thinking') {
    const $badge = $('<div>').addClass('ai-think-badge').attr('data-ai-seat', seat)
                             .text(`${name} is thinking…`);
    $('body').append($badge);
    // Position centred horizontally at the AI's grid row
    const centre = gridCellToScreen(Math.floor(GRID_COLS / 2), aiRow);
    const bw = $badge.outerWidth() || 150;
    $badge.css({
      top:  (centre.y - 28) + 'px',
      left: (centre.x - bw / 2) + 'px',
    });
    setTimeout(() => $badge.remove(), 1100);

  } else if (phase === 'play' && cards && cards.length) {
    $(`.ai-think-badge[data-ai-seat="${seat}"]`).remove();

    // Sort cards the same way as the cheat panel (rank order via validateAndScore).
    const sortedCards = sortSetCards(cards) || cards;

    // Centre the set horizontally in the grid.
    const startCol = Math.max(0, Math.min(
      GRID_COLS - sortedCards.length,
      Math.floor((GRID_COLS - sortedCards.length) / 2)
    ));

    // Unique class groups all cards so we can remove them together.
    const groupCls = 'ai-play-grp-' + Date.now();

    for (let i = 0; i < sortedCards.length; i++) {
      const { x: cx, y: cy } = gridCellToScreen(startCol + i, aiRow);
      const el = makeCardEl(sortedCards[i], { faceUp: true });
      el.style.setProperty('--table-rank-size', (2.2 * scale).toFixed(3) + 'rem');
      el.style.setProperty('--table-suit-size', (2.6 * scale).toFixed(3) + 'rem');
      Object.assign(el.style, {
        position:      'fixed',
        width:         cardW + 'px',
        height:        cardH + 'px',
        left:          (cx - cardW / 2) + 'px',
        top:           (cy - cardH / 2) + 'px',
        borderRadius:  Math.max(3, Math.round(8 * scale)) + 'px',
        zIndex:        '600',
        pointerEvents: 'none',
        boxShadow:     '2px 6px 18px rgba(0,0,0,0.55)',
      });
      el.classList.add('ai-play-card', groupCls);
      document.body.appendChild(el);
    }

    // Record in the scored-sets history panel.
    addScoredSet(sortedCards, score, name);

    // Score toast above the card group.
    const leftPt  = gridCellToScreen(startCol, aiRow);
    const rightPt = gridCellToScreen(startCol + sortedCards.length - 1, aiRow);
    const midX    = Math.round((leftPt.x + rightPt.x) / 2);
    const topY    = leftPt.y - cardH / 2;
    const $toast  = $('<div>').addClass('ai-score-toast ai-toast-score')
                              .text(`${name}  +${score} pts`);
    $('body').append($toast);
    $toast.css({
      top:  (topY - 18) + 'px',
      left: (midX - ($toast.outerWidth() || 110) / 2) + 'px',
    });
    setTimeout(() => $toast.remove(), 2000);

    // Fade cards out after display.
    setTimeout(() => {
      $(`.${groupCls}`).addClass('ai-play-out');
      setTimeout(() => $(`.${groupCls}`).remove(), 420);
    }, 1600);

  } else if (phase === 'pass') {
    $(`.ai-think-badge[data-ai-seat="${seat}"]`).remove();
    const centre  = gridCellToScreen(Math.floor(GRID_COLS / 2), aiRow);
    const $toast  = $('<div>').addClass('ai-score-toast ai-toast-pass').text(`${name} passes`);
    $('body').append($toast);
    $toast.css({
      top:  centre.y + 'px',
      left: (centre.x - ($toast.outerWidth() || 110) / 2) + 'px',
    });
    setTimeout(() => $toast.remove(), 1500);
  }
});