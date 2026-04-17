// scoring-core.js — canonical set-validation logic.
// Single source of truth used by both server (require) and client (<script>).
//
// Exports one function:
//   validateAndScore(cards) → { valid, rank, color, suit, score, orderedCards }
//
// UMD wrapper: works as require('./public/scoring-core') in Node and as a
// plain <script> tag in the browser (adds validateAndScore to window).
(function (exports) {

  // Private copy — keeps this module self-contained for Node.
  // The browser already has SUIT_SYMBOLS from cards.js but we don't depend on it.
  const SUIT_SYMBOLS = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };

  function labelVal(key, v) {
    return key === 'suit' ? (SUIT_SYMBOLS[v] || v) : v;
  }

  // Validate a group of cards using a constraint-propagation approach.
  // Returns { valid, rank, color, suit, score, orderedCards }.
  //   valid        — boolean
  //   rank/color/suit — { ok, type, reason? }  (type: 'wild'|'same'|'diff'|'cycle'|'invalid')
  //   score        — integer, or null if invalid
  //   orderedCards — Card[] sorted by pinned rank (display order)
  function validateAndScore(cards) {
    const n = cards.length;

    // ── Step 1: rank trait & pin ─────────────────────────────────────────────
    const fixedRankCards = cards.filter(c => !c.wildRank);
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
        // Duplicate fixed ranks → invalid
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

    // ── Step 2: sort by pinned rank ──────────────────────────────────────────
    const getP    = c => pinnedRanks.get(c.id) ?? 0;
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

    // ── Step 3: color and suit traits on rank-ordered cards ──────────────────
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

      // Large set (n ≥ 5): period-4 cycle check on rank-ordered cards
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

  exports.validateAndScore = validateAndScore;

})(typeof module !== 'undefined' ? module.exports : window);
