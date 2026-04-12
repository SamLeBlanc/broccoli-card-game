// ── Debug flag ────────────────────────────────────────────────────────────────
// Controlled server-side: set DEBUG_MODE=true in env vars to enable.
// Falls back to false in production.
const DEBUG = !!(window.APP_DEBUG);

// ── Socket connection ─────────────────────────────────────────────────────────
const socket = io();

// ── Global game state ─────────────────────────────────────────────────────────
let myId             = null;
let mySeat           = 0;
let myHand           = [];
let maxPlayers       = 2;
let tableCards       = {};   // cardId → { el, data }
let deckCount        = 0;
let deckCards        = [];   // full array of cards currently in the draw pile
let selectedPlayerCount = 2;
let lastPlayers      = {};

// ── Hand selection ────────────────────────────────────────────────────────────
// When a cheat-panel row is clicked we store the card IDs in rank-sorted order.
// Play Selected uses this order so cards land on the table in a cycle-valid arrangement.
const selectedHandIds = new Set();
let cheatPlayOrder = null;

// Sorted array of hand indices where group boxes begin.
// e.g. [3, 6] → box for cards[0..2], box for cards[3..5], plain rest from 6 onward.
let isolateDividers = [];

function toggleHandSelect(cardId) {
  if (selectedHandIds.has(cardId)) selectedHandIds.delete(cardId);
  else selectedHandIds.add(cardId);
  cheatPlayOrder = null; // manual edit — forget the cheat order
  updateHandSelectUI();
  renderHand();
}

function clearHandSelection() {
  selectedHandIds.clear();
  cheatPlayOrder = null;
  updateHandSelectUI();
  renderHand();
}

function updateHandSelectUI() {
  const $btn         = $('#btn-play-selected');
  const $isoL        = $('#btn-isolate-left');
  const $isoR        = $('#btn-isolate-right');
  const $deselect    = $('#btn-deselect-hand');
  const $discard     = $('#btn-discard-hand');
  const $preview     = $('#hand-score-preview');
  const n            = selectedHandIds.size;
  const hasSelection = n > 0;
  $btn.toggleClass('hidden',      !hasSelection);
  $isoL.toggleClass('hidden',     !hasSelection);
  $isoR.toggleClass('hidden',     !hasSelection);
  $deselect.toggleClass('hidden', !hasSelection);
  $discard.toggleClass('hidden',  !hasSelection);
  $preview.toggleClass('hidden',  !hasSelection);
  if (!hasSelection) return;

  if (n < 3) {
    $preview.text(`select ${3 - n} more to score`);
    $preview.attr('class', 'hand-score-preview-neutral');
    return;
  }

  const cards  = myHand.filter(c => selectedHandIds.has(c.id));
  const result = validateAndScore(cards);
  if (result.valid) {
    $preview.text(`✓ ${result.score} pts`);
    $preview.attr('class', 'hand-score-preview-valid');
  } else {
    $preview.text('✗ ' + topFailReason(result));
    $preview.attr('class', 'hand-score-preview-invalid');
  }
}

// ── Score labels ──────────────────────────────────────────────────────────────
let scoreLabels = [];

function clearScoreLabels() {
  scoreLabels.forEach(el => $(el).remove());
  scoreLabels = [];
}

// ── Scored-sets history panel ─────────────────────────────────────────────────
function addScoredSet(orderedCards, score) {
  const $panel = $('#scored-sets-panel');
  const $row   = $('<div>').addClass('scored-set-row');
  const $cards = $('<div>').addClass('scored-set-cards');
  for (const card of orderedCards) {
    const el = makeCardEl(card, { faceUp: true });
    $(el).addClass('card-tiny');
    $cards.append(el);
  }
  const $pts = $('<div>').addClass('scored-set-pts').text(`${score} pts`);
  $row.append($cards, $pts);
  $panel.append($row);
  $row.addClass('scored-set-row-enter');
  requestAnimationFrame(() => $row.removeClass('scored-set-row-enter'));
}

// ── Scored-card guard ─────────────────────────────────────────────────────────
// Card IDs scored locally but not yet confirmed removed by the server.
// placeCardOnTable ignores these so stale `state` events can't resurrect cards.
const localScoredIds = new Set();

// ── Table card selection ──────────────────────────────────────────────────────
const selectedCardIds = new Set();

function selectCard(id) {
  selectedCardIds.add(id);
  if (tableCards[id]) $(tableCards[id].el).addClass('selected');
  updateScoreUI();
}

function deselectCard(id) {
  selectedCardIds.delete(id);
  if (tableCards[id]) $(tableCards[id].el).removeClass('selected');
  updateScoreUI();
}

function clearSelection() {
  for (const id of selectedCardIds) {
    if (tableCards[id]) $(tableCards[id].el).removeClass('selected');
  }
  selectedCardIds.clear();
  updateScoreUI();
}

function toggleSelect(id) {
  if (selectedCardIds.has(id)) deselectCard(id); else selectCard(id);
}

// ── z-index counter (cards brought to front get ever-increasing z) ─────────────
let zCounter = 100;

function bringToFront(el) {
  el.style.zIndex = ++zCounter;
}