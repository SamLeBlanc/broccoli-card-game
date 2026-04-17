// ── Scoring helpers ───────────────────────────────────────────────────────────

// Helper: label a color/suit value for display
function labelVal(key, v) {
  return key === 'suit' ? (SUIT_SYMBOLS[v] || v) : v;
}

// validateAndScore is defined in scoring-core.js (loaded before this file).
// See scoring-core.js for the full implementation.

// Return a short natural-language phrase for one trait, e.g. "all red", "5–7"
function describeTraitValue(result, key, cards) {
  if (result.type === 'wild') return null;
  const wildKey = key === 'rank' ? 'wildRank' : key === 'color' ? 'wildColor' : 'wildSuit';
  if (result.type === 'same') {
    const first = cards.find(c => !c[wildKey]);
    if (!first) return null;
    if (key === 'rank')  return `all ${first.rank}s`;
    if (key === 'color') return `all ${first.color}`;
    if (key === 'suit')  return `all ${SUIT_SYMBOLS[first.suit] || first.suit}`;
  }
  if (result.type === 'diff') {
    if (key === 'rank') {
      const fixed = cards.filter(c => !c.wildRank).map(c => c.rank).sort((a, b) => a - b);
      return fixed.length >= 2 ? `${fixed[0]}–${fixed[fixed.length - 1]}` : 'consecutive';
    }
    return key === 'color' ? 'all different colors' : 'all different suits';
  }
  if (result.type === 'cycle')  return key === 'color' ? 'cycling all colors' : 'cycling all suits';
  return null;
}

// Commit a validated set: remove cards from table via server, add to history panel.
function commitScore(orderedCards, score) {
  const cardIds = orderedCards.map(c => c.id);

  // Mark these IDs as locally scored so placeCardOnTable ignores them even if
  // a stale `state` event arrives before the server confirms their removal.
  for (const id of cardIds) localScoredIds.add(id);

  // Tell the server: remove these cards, auto-draw replacements.
  socket.emit('score-set', { cardIds, score });

  // Add the set to the scored-sets history panel immediately (optimistic UI).
  // Use the player's display name; fall back to 'You'.
  const myName = lastPlayers[myId]?.name || 'You';
  addScoredSet(orderedCards, score, myName);

  // Remove card elements locally right away so there's no visual lag.
  for (const card of orderedCards) {
    const entry = tableCards[card.id];
    if (entry) {
      $(entry.el).remove();
      delete tableCards[card.id];
    }
  }
  clearSelection();
  scheduleRenderGroups();
}

// scoreSelection: validate the currently selected table cards.
function scoreSelection() {
  const ids = [...selectedCardIds];
  if (ids.length < 3) return;
  const cards = ids.map(id => tableCards[id]?.data).filter(Boolean);
  if (cards.length !== ids.length) return;

  const result = validateAndScore(cards);

  const xs = cards.map(c => c.x);
  const ys = cards.map(c => c.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const topY = Math.min(...ys) - 56;

  showScoreResult(result, cards, cx, topY);

  if (result.valid) {
    commitScore(result.orderedCards, result.score);
  }
}

// ── Cheat: find all valid sets in hand ───────────────────────────────────────
//
// Pruning strategy (rank-only — color/suit still fully validated by validateAndScore):
//
//   1. Duplicate fixed rank → prune entire subtree.
//      Two cards sharing the same non-wild rank make rank invalid, and adding more
//      cards cannot remove that duplicate, so we skip the branch entirely.
//
//   2. Span > MAX_SIZE − 1 → prune entire subtree.
//      The span of fixed ranks only grows as we add cards, so if it already
//      exceeds what the largest allowed set (MAX_SIZE) could accommodate, no
//      deeper branch will ever pass the rank check.
//
//   3. Skip validateAndScore when span > current size − 1.
//      We still recurse (a larger set might pass), but we know this combo is
//      rank-invalid so we skip the full validation call.
//
// All three checks are maintained incrementally — no re-scanning of the combo.
function findAllValidSets() {
  const n        = myHand.length;
  const results  = [];
  const MAX_SIZE = Math.min(n, 13);

  // fixedRanks: Set of non-wild ranks already in current combo
  // minFixed / maxFixed: current span bounds of fixed ranks
  function combine(start, current, fixedRanks, minFixed, maxFixed) {
    const size = current.length;

    if (size >= 3) {
      // Only call validateAndScore when rank span fits this size
      // (if not, rank will definitely fail — but we still recurse deeper)
      const spanOk = fixedRanks.size === 0 || (maxFixed - minFixed <= size - 1);
      if (spanOk) {
        const res = validateAndScore(current);
        if (res.valid) results.push({ cards: res.orderedCards, score: res.score, result: res });
      }
    }

    if (size >= MAX_SIZE) return;

    for (let i = start; i < n; i++) {
      const card = myHand[i];

      if (card.wildRank) {
        // Wild-rank cards never affect fixed-rank state
        current.push(card);
        combine(i + 1, current, fixedRanks, minFixed, maxFixed);
        current.pop();
      } else {
        // Prune 1: duplicate fixed rank — entire subtree stays rank-invalid
        if (fixedRanks.has(card.rank)) continue;

        const newMin = fixedRanks.size === 0 ? card.rank : Math.min(minFixed, card.rank);
        const newMax = fixedRanks.size === 0 ? card.rank : Math.max(maxFixed, card.rank);

        // Prune 2: span already too wide even for MAX_SIZE cards
        if (newMax - newMin > MAX_SIZE - 1) continue;

        fixedRanks.add(card.rank);
        current.push(card);
        combine(i + 1, current, fixedRanks, newMin, newMax);
        current.pop();
        fixedRanks.delete(card.rank);
      }
    }
  }

  combine(0, [], new Set(), 0, 0);
  results.sort((a, b) => b.score - a.score);
  return results;
}

function renderCheatPanel() {
  const $list  = $('#cheat-list').empty();
  const $title = $('#cheat-title');

  if (myHand.length < 3) {
    $title.text('Valid sets in hand');
    $list.html('<div class="cheat-empty">Need at least 3 cards in hand</div>');
    return;
  }

  const sets = findAllValidSets();
  $title.text(`${sets.length} valid set${sets.length !== 1 ? 's' : ''} in hand`);

  if (sets.length === 0) {
    $list.html('<div class="cheat-empty">No valid sets in your hand</div>');
    return;
  }

  let lastScore = null;
  sets.forEach(({ cards, score, result }) => {
    if (score !== lastScore) {
      const $sep = $('<div>').addClass('cheat-score-group').text(`${score} pts`);
      $list.append($sep);
      lastScore = score;
    }

    const $row = $('<div>').addClass('cheat-set');
    const $cardRow = $('<div>').addClass('cheat-cards');

    for (const card of cards) {
      const el = makeCardEl(card, { faceUp: true });
      $(el).addClass('card-tiny');
      $cardRow.append(el);
    }

    $row.append($cardRow);

    $row.on('click', () => {
      selectedHandIds.clear();
      cheatPlayOrder = cards.map(c => c.id);
      for (const card of cards) selectedHandIds.add(card.id);
      updateHandSelectUI();
      renderHand();
      $row.addClass('cheat-set-active');
      setTimeout(() => $row.removeClass('cheat-set-active'), 300);
    });

    $list.append($row);
  });
}

// Pick the single most obvious failure reason from a result object.
function topFailReason({ rank, color, suit }) {
  const candidates = [
    { r: rank,  label: 'Number' },
    { r: color, label: 'Color' },
    { r: suit,  label: 'Suit' },
  ];
  for (const { r, label } of candidates) {
    if (!r.ok) return `${label}: ${r.reason || 'invalid'}`;
  }
  return 'invalid set';
}

// showScoreResult — display validation feedback anchored above the card group.
function showScoreResult({ valid, rank, color, suit, score }, cards, cx, topY) {
  const $el    = $('#score-result');
  const tEl    = tableEl();
  const tRect  = tEl.getBoundingClientRect();

  const vpX = tRect.left + cx;
  const vpY = tRect.top  + topY;

  $el.css({
    position:  'fixed',
    left:      vpX + 'px',
    top:       (vpY - 12) + 'px',
    transform: 'translate(-50%, -100%)',
    bottom:    'auto',
  });

  function traitLine(r, name) {
    if (r.type === 'wild')   return `<div><span class="trait-wild">★ ${name}: all wild</span></div>`;
    if (r.type === 'same')   return `<div><span class="trait-ok">✓ ${name}: all same</span></div>`;
    if (r.type === 'diff')   return `<div><span class="trait-ok">✓ ${name}: ${name === 'Number' ? 'consecutive' : 'all different'}</span></div>`;
    if (r.type === 'cycle')  return `<div><span class="trait-ok">✓ ${name}: full cycle</span></div>`;
    return `<div><span class="trait-bad">✗ ${name}</span></div>`;
  }

  if (!valid) {
    $el.html(`
      <div class="score-title">❌ ${topFailReason({ rank, color, suit })}</div>
      <div class="score-traits">
        ${traitLine(color, 'Color')}
        ${traitLine(suit,  'Suit')}
        ${traitLine(rank,  'Number')}
      </div>`);
    $el.attr('class', 'score-result score-invalid').removeClass('hidden');
    clearTimeout($el.get(0)._timer);
    $el.get(0)._timer = setTimeout(() => $el.addClass('hidden'), 4500);
    return;
  }

  const n         = cards.length;
  const jokers    = cards.filter(c => c.isJoker).length;
  const sameCount = [rank, color, suit].filter(r => r.type === 'same' || r.type === 'wild').length;
  const base      = 3 + sameCount;
  const mult      = n - 2;
  const baseTotal = base * mult;

  const traitParts = [
    describeTraitValue(color, 'color', cards),
    describeTraitValue(suit,  'suit',  cards),
    describeTraitValue(rank,  'rank',  cards),
  ].filter(Boolean);

  let sentence = traitParts.length ? traitParts.join(', ') + ' — ' : '';
  sentence += `base ${base} × ${mult} = ${baseTotal}`;
  if (jokers > 0) sentence += `, −${jokers} joker${jokers > 1 ? 's' : ''} = ${score}`;

  $el.html(`
    <div class="score-title">✅ VALID SET!</div>
    <div class="score-natural">${sentence}</div>
    <div class="score-points">${score} pts</div>`);
  $el.attr('class', 'score-result score-valid').removeClass('hidden');
  clearTimeout($el.get(0)._timer);
  $el.get(0)._timer = setTimeout(() => $el.addClass('hidden'), 1800);
}

// ── Opponent hand rendering ───────────────────────────────────────────────────
const POSITIONS = ['top', 'left', 'right'];

function renderOpponentHands(players, seats) {
  const n = maxPlayers;
  const seatToPos = {};
  const relMap = { 2: 'top', 1: 'left', 3: 'right' };
  for (const [offset, pos] of Object.entries(relMap)) {
    seatToPos[(mySeat + parseInt(offset)) % n] = pos;
  }

  for (const pos of POSITIONS) {
    $(`#opp-${pos}`).addClass('hidden');
    $(`#opp-${pos}-cards`).empty();
    $(`#opp-${pos}-name`).text('');
  }

  const source = seats
    ? Object.entries(seats).map(([seatStr, s]) => ({ seat: parseInt(seatStr), ...s }))
    : Object.entries(players).map(([id, p]) => ({ seat: p.seat, name: p.name, handCount: p.handCount, socketId: id, empty: false }));

  for (const entry of source) {
    if (entry.seat === mySeat) continue;
    const pos = seatToPos[entry.seat];
    if (!pos) continue;
    const $area    = $(`#opp-${pos}`);
    const $cardsEl = $(`#opp-${pos}-cards`);
    const $nameEl  = $(`#opp-${pos}-name`);
    if ($area.length === 0) continue;

    $area.removeClass('hidden');
    $nameEl.text(entry.empty
      ? `${entry.name} — waiting…`
      : `${entry.name} (${entry.handCount})`);
    $nameEl.css('opacity', entry.empty ? '0.45' : '0.75');

    for (let i = 0; i < entry.handCount; i++) {
      const $c = $('<div>').addClass('card opp-card').html('<div class="card-back"></div>');
      $cardsEl.append($c);
    }

    if (entry.handCount > 0) {
      const $badge = $('<div>').addClass('opp-count-badge')
        .text(`${entry.handCount} card${entry.handCount !== 1 ? 's' : ''}`);
      $cardsEl.append($badge);
    }
  }
}
