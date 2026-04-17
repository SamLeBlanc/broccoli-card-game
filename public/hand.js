// ── Hand rendering ────────────────────────────────────────────────────────────
function renderHand() {
  const $area = $('#hand-cards').empty();
  $('#hand-count').text(`(${myHand.length})`);

  const dividerSet = new Set(isolateDividers);

  // Render cards flat with divider slots between every adjacent pair.
  // Slots that coincide with an isolateDivider are rendered as visible gaps.
  for (let i = 0; i < myHand.length; i++) {
    // Insert a divider slot BEFORE each card except the first
    if (i > 0) {
      const slotIndex = i; // divider at index i means "gap before card i"
      const isDiv = dividerSet.has(slotIndex);
      const $slot = $('<div>')
        .addClass(isDiv ? 'hand-divider-slot is-divider' : 'hand-divider-slot')
        .attr('data-slot', slotIndex)
        .on('mouseenter', function() { $(this).addClass('hovered'); })
        .on('mouseleave', function() { $(this).removeClass('hovered'); })
        .on('click', function(e) {
          e.stopPropagation();
          if ($(this).hasClass('is-divider')) {
            isolateDividers = isolateDividers.filter(d => d !== slotIndex);
          } else {
            isolateDividers = [...new Set([...isolateDividers, slotIndex])].sort((a,b) => a-b);
          }
          renderHand();
        });
      $area.append($slot);
    }

    const card = myHand[i];
    const el = makeCardEl(card, { faceUp: true, small: true });
    $(el).addClass('hand-card')
      .toggleClass('selected', selectedHandIds.has(card.id))
      .attr('title', 'Click to select · Drag to table to play')
      .on('mousedown', (e) => startHandDrag(e, card))
      .appendTo($area);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function updateDeckCount(count) {
  deckCount = count;
  $('#deck-remaining-count').text(count);
  $('#deck-pile').css('opacity', count > 0 ? '1' : '0.3');
}

// ── Hand sort ─────────────────────────────────────────────────────────────────
const COLOR_ORDER = { blue: 0, red: 1, green: 2, purple: 3 };
const SUIT_ORDER  = { spade: 0, heart: 1, club: 2, diamond: 3 };

const SORT_FNS = {
  rank:  (a, b) => {
    const av = a.wildRank  ? Infinity : a.rank;
    const bv = b.wildRank  ? Infinity : b.rank;
    return av - bv;
  },
  color: (a, b) => {
    const av = a.wildColor ? Infinity : (COLOR_ORDER[a.color] ?? Infinity);
    const bv = b.wildColor ? Infinity : (COLOR_ORDER[b.color] ?? Infinity);
    return av - bv;
  },
  suit:  (a, b) => {
    const av = a.wildSuit  ? Infinity : (SUIT_ORDER[a.suit]   ?? Infinity);
    const bv = b.wildSuit  ? Infinity : (SUIT_ORDER[b.suit]   ?? Infinity);
    return av - bv;
  },
};

$('.sort-btn').on('click', function() {
  const key = $(this).attr('data-sort');
  if (isolateDividers.length === 0) {
    myHand = [...myHand].sort(SORT_FNS[key]);
  } else {
    const sorted = [...isolateDividers].sort((a, b) => a - b);
    const restStart = sorted[sorted.length - 1];
    const boxed = myHand.slice(0, restStart);
    const rest  = myHand.slice(restStart).sort(SORT_FNS[key]);
    myHand = [...boxed, ...rest];
  }
  renderHand();
  $('.sort-btn').removeClass('active');
  $(this).addClass('active');
});

// ── Isolate Left ──────────────────────────────────────────────────────────────
$('#btn-isolate-left').on('click', () => {
  if (selectedHandIds.size === 0) return;
  const n = selectedHandIds.size;
  isolateDividers = isolateDividers.map(p => {
    const removedBefore = myHand.slice(0, p).filter(c => selectedHandIds.has(c.id)).length;
    return p - removedBefore + n;
  });
  isolateDividers.unshift(n);
  const selected    = myHand.filter(c =>  selectedHandIds.has(c.id));
  const nonSelected = myHand.filter(c => !selectedHandIds.has(c.id));
  myHand = [...selected, ...nonSelected];
  clearHandSelection();
});

// ── Isolate Right ─────────────────────────────────────────────────────────────
$('#btn-isolate-right').on('click', () => {
  if (selectedHandIds.size === 0) return;
  const selected    = myHand.filter(c =>  selectedHandIds.has(c.id));
  const nonSelected = myHand.filter(c => !selectedHandIds.has(c.id));
  const dividerAnchors = isolateDividers.map(p => myHand[p]?.id);
  myHand = [...nonSelected, ...selected];
  isolateDividers = dividerAnchors
    .map(id => myHand.findIndex(c => c.id === id))
    .filter(p => p > 0)
    .sort((a, b) => a - b);
  isolateDividers = [...new Set(isolateDividers)];
  const newDiv = nonSelected.length;
  if (newDiv > 0 && newDiv < myHand.length) {
    isolateDividers.push(newDiv);
    isolateDividers = [...new Set(isolateDividers)].sort((a, b) => a - b);
  }
  clearHandSelection();
});

// ── Deselect ──────────────────────────────────────────────────────────────────
$('#btn-deselect-hand').on('click', () => clearHandSelection());

// ── Discard: play selected hand cards to the discard pile ─────────────────────
$('#btn-discard-hand').on('click', () => {
  if (selectedHandIds.size === 0) return;
  const discardX = discardZonePos().x;
  const discardY = discardZonePos().y;
  const toDiscard = myHand.filter(c => selectedHandIds.has(c.id));
  for (const card of toDiscard) {
    socket.emit('play-card', { cardId: card.id, x: discardX, y: discardY, faceUp: true });
  }
  clearHandSelection();
});

// ── Play Selected ─────────────────────────────────────────────────────────────
$('#btn-play-selected').on('click', () => {
  if (selectedHandIds.size === 0) return;
  const tEl = tableEl();
  const tr  = tEl.getBoundingClientRect();
  const ids = cheatPlayOrder
    ? cheatPlayOrder.filter(id => selectedHandIds.has(id))
    : myHand.filter(c => selectedHandIds.has(c.id)).map(c => c.id);
  const n = ids.length;
  // Snap the visible centre of the table (scroll-adjusted) to the grid
  const anchor    = snapToGrid(tEl.scrollLeft + tr.width / 2, tEl.scrollTop + tr.height / 2);
  const anchorCol = Math.round((anchor.x - gridOffsetX - GRID_W / 2) / GRID_W);
  const startCol  = Math.max(0, Math.min(GRID_COLS - n, anchorCol - Math.floor(n / 2)));
  ids.forEach((cardId, i) => {
    const x = gridOffsetX + (startCol + i) * GRID_W + GRID_W / 2;
    socket.emit('play-card', { cardId, x, y: anchor.y, faceUp: true });
  });
  clearHandSelection();
});

// ── Score button ──────────────────────────────────────────────────────────────
$('#btn-score').on('click', scoreSelection);

// ── Deal modal ────────────────────────────────────────────────────────────────
let dealCount = 20;
let playerCount = 1;

function updateDealModal() {
  $('#deal-display').text(dealCount);
  $('#deal-desc').text(`Deal to all ${playerCount} player${playerCount !== 1 ? 's' : ''}`);
  $('#deal-sub').text(`${dealCount} card${dealCount !== 1 ? 's' : ''} each  (${dealCount * playerCount} total from deck)`);
  $('#deal-minus').prop('disabled', dealCount <= 1);
  $('#deal-plus').prop('disabled', dealCount >= 40);
}

$('#btn-deal').on('click', () => {
  playerCount = maxPlayers;
  updateDealModal();
  $('#deal-modal').removeClass('hidden');
});

$('#deal-cancel').on('click', () => $('#deal-modal').addClass('hidden'));

$('#deal-confirm').on('click', () => {
  socket.emit('deal', { count: dealCount });
  $('#deal-modal').addClass('hidden');
});

$('#deal-minus').on('click', () => {
  if (dealCount > 1) { dealCount--; updateDealModal(); }
});

$('#deal-plus').on('click', () => {
  if (dealCount < 40) { dealCount++; updateDealModal(); }
});

$('#deal-modal').on('click', (e) => {
  if (e.target === $('#deal-modal').get(0))
    $('#deal-modal').addClass('hidden');
});
