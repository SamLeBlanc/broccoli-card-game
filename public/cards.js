// ── Card rendering ────────────────────────────────────────────────────────────
const SUIT_SYMBOLS = { spade: '♠', heart: '♥', club: '♣', diamond: '♦' };
const HEX_COLORS   = { blue: '#2d5be3', red: '#d42b2b', green: '#1e8c3a', purple: '#7b2de3' };

function makeCardEl(card, opts = {}) {
  const { faceUp = true, small = false } = opts;
  const $el = $('<div>').addClass('card').toggleClass('card-small', small).attr('data-card-id', card.id);

  if (!faceUp) {
    return $el.html('<div class="card-back"></div>').get(0);
  }

  if (card.isJoker) return makeJokerEl($el, card);

  const bg  = HEX_COLORS[card.color] || '#555';
  const sym = SUIT_SYMBOLS[card.suit] || '?';
  $el.css('background', bg).css('color', '#fff');
  $el.html(`
    <div class="card-face">
      <div class="c-face-rank">${card.rank}</div>
      <div class="c-face-suit">${sym}</div>
    </div>`);
  return $el.get(0);
}

// Joker display: wild traits are left blank; wild-color jokers get a grey background
function makeJokerEl($el, card) {
  $el.addClass('joker-card');

  // All three traits wild → grey background, centered star
  if (card.wildRank && card.wildSuit && card.wildColor) {
    $el.addClass('joker-colorless');
    $el.html('<div class="card-face joker-all-wild"><span class="joker-star">★</span></div>');
    return $el.get(0);
  }

  // Colored joker: background = card's color; colorless joker: grey background
  if (card.wildColor) {
    $el.addClass('joker-colorless');
  } else {
    $el.css('background', HEX_COLORS[card.color] || '#555').css('color', '#fff');
  }

  // Wild traits render as empty; fixed traits render normally
  const rankStr = card.wildRank ? '' : card.rank;
  const suitStr = card.wildSuit ? '' : (SUIT_SYMBOLS[card.suit] || '');

  $el.html(`<div class="card-face">
    <div class="c-face-rank">${rankStr}</div>
    <div class="c-face-suit">${suitStr}</div>
  </div>`);
  return $el.get(0);
}
