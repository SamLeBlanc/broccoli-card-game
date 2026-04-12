// ── Scoring helpers ───────────────────────────────────────────────────────────

// Helper: label a color/suit value for display
function labelVal(key, v) {
  return key === 'suit' ? (SUIT_SYMBOLS[v] || v) : v;
}

// Validate a group of cards using a constraint-propagation approach.
// Returns { valid, rank, color, suit, score, orderedCards }.
function validateAndScore(cards) {
  const n = cards.length;

  // ── Step 1: rank trait & pin ───────────────────────────────────────────────
  const fixedRankCards = cards.filter(c => !c.wildRank);
  const wildRankCards  = cards.filter(c =>  c.wildRank);
  const pinnedRanks    = new Map(); // card.id → concrete rank value

  let rankResult;

  if (fixedRankCards.length === 0) {
    // All wildRank jokers — valid (type 'wild'), pin all to rank 0 for ordering
    rankResult = { ok: true, type: 'wild' };
    cards.forEach(c => pinnedRanks.set(c.id, 0));

  } else {
    const fixedVals = fixedRankCards.map(c => c.rank);
    const uniq      = new Set(fixedVals);

    if (uniq.size === 1) {
      // All fixed ranks identical → "same"
      rankResult = { ok: true, type: 'same' };
      const r = fixedVals[0];
      cards.forEach(c => pinnedRanks.set(c.id, c.wildRank ? r : c.rank));

    } else if (uniq.size < fixedVals.length) {
      // Duplicate fixed ranks → impossible to form a valid set
      const counts = {};
      fixedVals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
      const dups = Object.entries(counts)
        .filter(([, c]) => c > 1).map(([v]) => Number(v))
        .sort((a, b) => a - b);
      const reason = dups.length === 1
        ? `duplicate ${dups[0]}s`
        : `duplicate numbers (${dups.join(', ')})`;
      rankResult = { ok: false, type: 'invalid', reason };

    } else {
      // All fixed ranks distinct — check span fits within n consecutive slots
      const min = Math.min(...fixedVals);
      const max = Math.max(...fixedVals);
      if (max - min > n - 1) {
        rankResult = { ok: false, type: 'invalid',
          reason: `${min}–${max} is a span of ${max - min + 1}, too wide for ${n} cards` };
      } else {
        rankResult = { ok: true, type: 'diff' };
        fixedRankCards.forEach(c => pinnedRanks.set(c.id, c.rank));
        const fixedSet = new Set(fixedVals);
        const gaps = [];
        for (let r = min; r <= min + n - 1; r++) {
          if (!fixedSet.has(r)) gaps.push(r);
        }
        let gi = 0;
        for (const card of cards) {
          if (card.wildRank) pinnedRanks.set(card.id, gaps[gi++] ?? (min + n + gi));
        }
      }
    }
  }

  if (!rankResult.ok) {
    return {
      valid: false,
      rank:  rankResult,
      color: { ok: true, type: 'wild' },
      suit:  { ok: true, type: 'wild' },
      score: null,
      orderedCards: [...cards],
    };
  }

  // ── Step 2: sort by pinned rank ────────────────────────────────────────────
  const getP = c => pinnedRanks.get(c.id) ?? 0;
  const ordered = [...cards].sort((a, b) => {
    const rd = getP(a) - getP(b);
    if (rd !== 0) return rd;
    const ca = a.wildColor ? '' : (a.color || '');
    const cb = b.wildColor ? '' : (b.color || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    const sa = a.wildSuit ? '' : (a.suit || '');
    const sb = b.wildSuit ? '' : (b.suit || '');
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });

  // ── Step 3: color and suit traits on rank-ordered cards ────────────────────
  const isLarge = n >= 5;

  function checkTrait(key) {
    const wildKey    = key === 'color' ? 'wildColor' : 'wildSuit';
    const fixedInOrd = ordered.filter(c => !c[wildKey]);
    if (fixedInOrd.length === 0) return { ok: true, type: 'wild' };

    const fixedVals = fixedInOrd.map(c => c[key]);
    const uniq      = new Set(fixedVals);

    if (uniq.size === 1) return { ok: true, type: 'same' };

    if (!isLarge) {
      if (uniq.size === fixedVals.length) return { ok: true, type: 'diff' };
      const counts = {};
      fixedVals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
      const dups = Object.entries(counts)
        .filter(([, c]) => c > 1)
        .map(([v, c]) => `${c}× ${labelVal(key, v)}`);
      return { ok: false, type: 'invalid', reason: dups.join(', ') };
    }

    // Large set (n ≥ 5): period-4 cycle check on rank-ordered cards.
    const pattern = [null, null, null, null];
    const slotOf  = {};

    for (let i = 0; i < n; i++) {
      const card = ordered[i];
      if (card[wildKey]) continue;
      const v    = card[key];
      const slot = i % 4;

      if (pattern[slot] !== null && pattern[slot] !== v) {
        return { ok: false, type: 'invalid',
          reason: `${labelVal(key, v)} at position ${i + 1} conflicts — cycle slot ${slot + 1} already has ${labelVal(key, pattern[slot])}` };
      }
      if (v in slotOf && slotOf[v] !== slot) {
        return { ok: false, type: 'invalid',
          reason: `${labelVal(key, v)} appears in two different cycle slots (${slotOf[v] + 1} and ${slot + 1})` };
      }
      pattern[slot] = v;
      slotOf[v]     = slot;
    }
    return { ok: true, type: 'cycle' };
  }

  const colorResult = checkTrait('color');
  const suitResult  = checkTrait('suit');
  const valid       = colorResult.ok && suitResult.ok;

  let score = null;
  if (valid) {
    const sameCount = [rankResult, colorResult, suitResult]
      .filter(r => r.type === 'same' || r.type === 'wild').length;
    const jokers = cards.filter(c => c.isJoker).length;
    score = (3 + sameCount) * (n - 2) - jokers;
  }

  return { valid, rank: rankResult, color: colorResult, suit: suitResult, score, orderedCards: ordered };
}

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
  addScoredSet(orderedCards, score);

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
function findAllValidSets() {
  const n       = myHand.length;
  const results = [];
  const MAX_SIZE = Math.min(n, 7);

  function combine(start, current) {
    if (current.length >= 3) {
      const res = validateAndScore(current);
      if (res.valid) results.push({ cards: res.orderedCards, score: res.score, result: res });
    }
    if (current.length >= MAX_SIZE) return;
    for (let i = start; i < n; i++) {
      current.push(myHand[i]);
      combine(i + 1, current);
      current.pop();
    }
  }

  combine(0, []);
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

$('#btn-cheat').on('click', () => {
  const $panel = $('#cheat-panel');
  const isHidden = $panel.hasClass('hidden');
  if (isHidden) {
    renderCheatPanel();
    $panel.removeClass('hidden');
  } else {
    $panel.addClass('hidden');
  }
});

$('#cheat-close').on('click', () => $('#cheat-panel').addClass('hidden'));

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
