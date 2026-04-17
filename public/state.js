// ── Debug flag ────────────────────────────────────────────────────────────────
// window.DEBUG is injected by the server via /config.js.
// On in local dev (NODE_ENV != 'production'), off on Railway automatically.
// Falls back to false so a config.js load failure never enables debug in prod.
const DEBUG = window.DEBUG ?? false;

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

// ── History panel (scoreboard + scored-sets log) ──────────────────────────────
// In-memory list of every set scored this session (all players), insertion order.
let allScoredSets = [];   // [{ cards, score, playerName }]

// Sort cards within a set by rank (same ordering as cheat window).
// NOTE: validateAndScore is defined in scoring.js which loads after state.js,
// but this is only ever called at runtime so it's always available by then.
function sortSetCards(cards) {
  if (!cards || !cards.length) return cards;
  const result = validateAndScore(cards);
  return (result && result.orderedCards) ? result.orderedCards : cards;
}

function renderHistoryPanel() {
  const $rows   = $('#history-rows').empty();
  const $filter = $('#history-player-filter');

  // Rebuild dropdown options from players who have ever scored
  const allPlayers = [...new Set(allScoredSets.map(s => s.playerName))];
  const prevVal    = $filter.val() || 'all';
  $filter.empty().append($('<option>').val('all').text('All Players'));
  for (const p of allPlayers) $filter.append($('<option>').val(p).text(p));
  // Restore selection if still valid, otherwise fall back to "all"
  $filter.val(allPlayers.includes(prevVal) ? prevVal : 'all');

  // Show filter row only when there are scored sets
  $('#history-filter-row').toggleClass('hidden', allScoredSets.length === 0);

  // Determine which rows to show
  const selected = $filter.val();
  const visible  = selected === 'all'
    ? allScoredSets
    : allScoredSets.filter(s => s.playerName === selected);

  // Render rows newest-first
  let newestShown = true;
  for (let i = visible.length - 1; i >= 0; i--) {
    const { cards, score, playerName } = visible[i];
    const $row   = $('<div>').addClass('history-row');
    const $name  = $('<div>').addClass('history-player').text(playerName);
    const $cards = $('<div>').addClass('history-cards');
    for (const card of cards) {
      const el = makeCardEl(card, { faceUp: true });
      $(el).addClass('card-tiny');
      $cards.append(el);
    }
    const $pts = $('<div>').addClass('history-pts').text('+' + score);
    $row.append($name, $cards, $pts);

    // Slide-in animation only for the very newest visible row
    if (newestShown) {
      $row.addClass('history-row-enter');
      requestAnimationFrame(() => $row.removeClass('history-row-enter'));
      newestShown = false;
    }
    $rows.append($row);
  }
}

// Wire dropdown — event delegation works regardless of DOM ready timing
$(document).on('change', '#history-player-filter', renderHistoryPanel);

function addScoredSet(cards, score, playerName = 'You') {
  const orderedCards = sortSetCards(cards);
  allScoredSets.push({ cards: orderedCards, score, playerName });
  renderHistoryPanel();
}

function clearScoredSets() {
  allScoredSets = [];
  $('#history-rows').empty();
  $('#history-filter-row').addClass('hidden');
  $('#history-player-filter').val('all').empty()
    .append($('<option>').val('all').text('All Players'));
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