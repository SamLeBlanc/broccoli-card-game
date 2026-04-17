// ── Snap grid ─────────────────────────────────────────────────────────────────
// Fixed grid: 15 columns × 7 rows (landscape).
// Cell size is computed dynamically by computeGridScale() to fill available space.
// The grid is centred in the table area; all card coordinates include the offset.
// Card centres land at: x = gridOffsetX + col*GRID_W + GRID_W/2
//                       y = gridOffsetY + row*GRID_H + GRID_H/2
const GRID_COLS = 15, GRID_ROWS = 7;
let GRID_W = 84, GRID_H = 116;       // updated by computeGridScale()
let gridOffsetX = 0, gridOffsetY = 0; // centering offsets (px from table top-left)

// ── Responsive grid scale ─────────────────────────────────────────────────────
function computeGridScale() {
  const tEl = tableEl();
  if (!tEl || !tEl.clientWidth) return;

  // Save every card's grid position before changing dimensions.
  const gridPos = {};
  for (const [id, { data }] of Object.entries(tableCards)) {
    gridPos[id] = cardGridPos(data);
  }

  // Pick the largest card that fits both axes, preserving the 5∶7 aspect ratio.
  const MAX_CARD_W = 80;
  const cardWFromWidth  = tEl.clientWidth  / GRID_COLS - 4;
  const cardWFromHeight = (tEl.clientHeight / GRID_ROWS - 4) / (112 / 80);
  const cardW = Math.max(8, Math.floor(Math.min(MAX_CARD_W, cardWFromWidth, cardWFromHeight)));
  const cardH = Math.round(cardW * (112 / 80));
  GRID_W = cardW + 4;
  GRID_H = cardH + 4;

  // Centre the grid in the available table space.
  gridOffsetX = Math.max(0, Math.floor((tEl.clientWidth  - GRID_COLS * GRID_W) / 2));
  gridOffsetY = Math.max(0, Math.floor((tEl.clientHeight - GRID_ROWS * GRID_H) / 2));

  const scale = cardW / 80;
  const root  = document.documentElement;
  root.style.setProperty('--card-w',            cardW + 'px');
  root.style.setProperty('--card-h',            cardH + 'px');
  root.style.setProperty('--grid-w',            GRID_W + 'px');
  root.style.setProperty('--grid-h',            GRID_H + 'px');
  root.style.setProperty('--grid-offset-x',     gridOffsetX + 'px');
  root.style.setProperty('--grid-offset-y',     gridOffsetY + 'px');
  root.style.setProperty('--table-rank-size',   (2.2 * scale).toFixed(3) + 'rem');
  root.style.setProperty('--table-suit-size',   (2.6 * scale).toFixed(3) + 'rem');
  root.style.setProperty('--table-card-radius', Math.max(3, Math.round(8 * scale)) + 'px');

  // Invisible spacer so the table knows its full scroll extent.
  let sizer = tEl.querySelector('.grid-sizer');
  if (!sizer) {
    sizer = document.createElement('div');
    sizer.className = 'grid-sizer';
    Object.assign(sizer.style, { position: 'absolute', pointerEvents: 'none', zIndex: '-1' });
    tEl.appendChild(sizer);
  }
  sizer.style.left   = gridOffsetX + 'px';
  sizer.style.top    = gridOffsetY + 'px';
  sizer.style.width  = (GRID_COLS * GRID_W) + 'px';
  sizer.style.height = (GRID_ROWS * GRID_H) + 'px';

  // Reposition every table card using the new scale + centering offset.
  for (const [id, { el, data }] of Object.entries(tableCards)) {
    const { col, row } = gridPos[id] || { col: 0, row: 0 };
    const newX = gridOffsetX + col * GRID_W + GRID_W / 2;
    const newY = gridOffsetY + row * GRID_H + GRID_H / 2;
    data.x = newX; data.y = newY;
    el.style.left = newX + 'px';
    el.style.top  = newY + 'px';
  }

  positionDeckPile();
  positionDiscardZone();
  scheduleRenderGroups();
}

function snapToGrid(x, y) {
  const col = Math.max(0, Math.min(GRID_COLS - 1,
    Math.round((x - gridOffsetX - GRID_W / 2) / GRID_W)));
  const row = Math.max(0, Math.min(GRID_ROWS - 1,
    Math.round((y - gridOffsetY - GRID_H / 2) / GRID_H)));
  return {
    x: gridOffsetX + col * GRID_W + GRID_W / 2,
    y: gridOffsetY + row * GRID_H + GRID_H / 2,
  };
}

function cardGridPos(data) {
  return {
    col: Math.max(0, Math.min(GRID_COLS - 1,
      Math.round((data.x - gridOffsetX - GRID_W / 2) / GRID_W))),
    row: Math.max(0, Math.min(GRID_ROWS - 1,
      Math.round((data.y - gridOffsetY - GRID_H / 2) / GRID_H))),
  };
}

// Discard zone: top-right cell (col = GRID_COLS-1, row = 0).
function discardZonePos() {
  return {
    x: gridOffsetX + (GRID_COLS - 1) * GRID_W + GRID_W / 2,
    y: gridOffsetY + GRID_H / 2,
  };
}

// Deck pile: bottom-left cell (col = 0, row = GRID_ROWS-1).
function deckPilePos() {
  return {
    x: gridOffsetX + GRID_W / 2,
    y: gridOffsetY + (GRID_ROWS - 1) * GRID_H + GRID_H / 2,
  };
}

// Position visual divs to match their grid cells.
// Called from computeGridScale() and on game-screen show.
function positionDiscardZone() {
  const { x, y } = discardZonePos();
  const cw = GRID_W - 4, ch = GRID_H - 4;
  $('#discard-zone').css({ left: (x - cw / 2) + 'px', top: (y - ch / 2) + 'px' });
}

function positionDeckPile() {
  const { x, y } = deckPilePos();
  const cw = GRID_W - 4, ch = GRID_H - 4;
  $('#deck-pile').css({ left: (x - cw / 2) + 'px', top: (y - ch / 2) + 'px' });
}

$(window).on('resize', () => { computeGridScale(); });

// ── Grid group detection ──────────────────────────────────────────────────────
// Find all horizontal or vertical runs of 3+ grid-aligned cards.
function findGridGroups() {
  const cellMap = new Map(); // "row,col" → cardData
  for (const { data } of Object.values(tableCards)) {
    const { col, row } = cardGridPos(data);
    cellMap.set(`${row},${col}`, data);
  }

  const groups = [];

  // Horizontal runs
  const visitedH = new Set();
  for (const [, data] of cellMap) {
    const { col, row } = cardGridPos(data);
    const key = `${row},${col}`;
    if (visitedH.has(key)) continue;
    let startCol = col;
    while (cellMap.has(`${row},${startCol - 1}`)) startCol--;
    const run = [];
    let c = startCol;
    while (cellMap.has(`${row},${c}`)) {
      run.push(cellMap.get(`${row},${c}`));
      visitedH.add(`${row},${c}`);
      c++;
    }
    if (run.length >= 3) groups.push(run);
  }

  // Vertical runs
  const visitedV = new Set();
  for (const [, data] of cellMap) {
    const { col, row } = cardGridPos(data);
    const key = `${row},${col}`;
    if (visitedV.has(key)) continue;
    let startRow = row;
    while (cellMap.has(`${startRow - 1},${col}`)) startRow--;
    const run = [];
    let r = startRow;
    while (cellMap.has(`${r},${col}`)) {
      run.push(cellMap.get(`${r},${col}`));
      visitedV.add(`${r},${col}`);
      r++;
    }
    if (run.length >= 3) groups.push(run);
  }

  return groups;
}

// Score buttons rendered above each qualifying group.
let groupScoreBtns = [];
let _groupRenderPending = false;

function scheduleRenderGroups() {
  if (_groupRenderPending) return;
  _groupRenderPending = true;
  requestAnimationFrame(() => {
    _groupRenderPending = false;
    renderGroupScoreBtns();
  });
}

// Auto-sort a detected group by rank order (same ordering as cheat window).
// Cards are swapped into the grid positions they already occupy — their
// logical grid slots don't change, only which card sits in which slot.
function autoSortGroup(run) {
  // sortSetCards is defined in state.js (loaded before grid.js).
  // It calls validateAndScore and returns orderedCards only if the set is valid.
  if (typeof sortSetCards !== 'function') return;
  const sorted = sortSetCards(run);
  if (!sorted || sorted.length !== run.length) return;

  // Nothing to do if already in the right order.
  if (sorted.every((card, i) => card.id === run[i].id)) return;

  // Snapshot target positions before any cards move.
  const positions = run.map(d => ({ x: d.x, y: d.y }));

  for (let i = 0; i < sorted.length; i++) {
    const card      = sorted[i];
    const { x, y } = positions[i];
    if (card.x === x && card.y === y) continue;

    const entry = tableCards[card.id];
    if (!entry) continue;
    entry.data.x = x;
    entry.data.y = y;
    entry.el.style.left = x + 'px';
    entry.el.style.top  = y + 'px';
    socket.emit('move-card', { cardId: card.id, x, y });
  }
}

function renderGroupScoreBtns() {
  groupScoreBtns.forEach(b => $(b).remove());
  groupScoreBtns = [];

  const groups = findGridGroups();
  const tEl = tableEl();

  for (const run of groups) {
    // Auto-sort valid sets into rank order before rendering the score button.
    autoSortGroup(run);

    const xs = run.map(d => d.x);
    const ys = run.map(d => d.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const ty = Math.min(...ys) - (GRID_H - 4) / 2 - 8;

    const $btn = $('<button>').addClass('grid-score-btn').text('SCORE');
    const btn = $btn.get(0);
    $btn.css({ left: cx + 'px', top: ty + 'px', transform: 'translate(-50%, -100%)' });

    $btn.on('click', (e) => {
      e.stopPropagation();
      clearSelection();
      for (const data of run) selectCard(data.id);
      scoreSelection();
    });

    $(tEl).append($btn);
    groupScoreBtns.push(btn);
  }
}

function updateScoreUI() {
  const n = selectedCardIds.size;
  const $btn = $('#btn-score');
  $btn.toggleClass('hidden', n < 3);
}

// ── Drag + box select system ──────────────────────────────────────────────────
let drag      = null;
let boxSelect = null;

const tableEl  = () => $('#table').get(0);
const handArea = () => $('#hand-area').get(0);

function isOverEl(e, el) {
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right &&
         e.clientY >= r.top  && e.clientY <= r.bottom;
}

function startTableDrag(e, cardId) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();

  const entry = tableCards[cardId];
  if (!entry) return;
  const rect = entry.el.getBoundingClientRect();

  const isSelected = selectedCardIds.has(cardId);
  const groupDrag  = isSelected && selectedCardIds.size > 1;

  if (groupDrag) {
    const startPositions = {};
    for (const id of selectedCardIds) {
      const tc = tableCards[id];
      if (tc) startPositions[id] = { x: tc.data.x, y: tc.data.y };
    }
    drag = {
      source: 'table-group',
      cardId,
      mouseStartX: e.clientX,
      mouseStartY: e.clientY,
      startPositions,
      moved: false,
    };
    for (const id of selectedCardIds) {
      if (tableCards[id]) bringToFront(tableCards[id].el);
    }
    for (const id of selectedCardIds) $(tableCards[id]?.el).addClass('dragging');
  } else {
    drag = {
      source: 'table',
      cardId,
      floatEl: entry.el,
      offsetX: e.clientX - rect.left - rect.width  / 2,
      offsetY: e.clientY - rect.top  - rect.height / 2,
      mouseStartX: e.clientX,
      mouseStartY: e.clientY,
      moved: false,
    };
    $(entry.el).addClass('dragging');
    bringToFront(entry.el);
  }
}

function startHandDrag(e, card) {
  if (e.button !== 0) return;
  e.preventDefault();

  const handIndex = myHand.findIndex(c => c.id === card.id);
  const sourceEl  = document.querySelector(`#hand-cards [data-card-id="${card.id}"]`);

  drag = {
    source: 'hand', cardId: card.id, card,
    floatEl: null, handIndex, sourceEl,
    mouseStartX: e.clientX, mouseStartY: e.clientY, moved: false,
  };
}

// Returns insert index among non-ghost hand cards for a given clientX
function handInsertIndex(clientX) {
  const cards = [...document.querySelectorAll('#hand-cards .hand-card:not(.hand-ghost)')];
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (clientX < r.left + r.width / 2) return i;
  }
  return cards.length;
}

function showHandGap(clientX) {
  const cards = [...document.querySelectorAll('#hand-cards .hand-card:not(.hand-ghost)')];
  cards.forEach(el => { el.style.marginLeft = ''; el.style.marginRight = ''; });
  const idx = handInsertIndex(clientX);
  if (cards[idx])            cards[idx].style.marginLeft  = '68px';
  else if (cards.length > 0) cards[cards.length-1].style.marginRight = '68px';
}

function clearHandGap() {
  document.querySelectorAll('#hand-cards .hand-card').forEach(el => {
    el.style.marginLeft = ''; el.style.marginRight = '';
  });
}

function moveFloat(e) {
  if (!drag) return;

  if (drag.source === 'hand') {
    if (!drag.moved && (
      Math.abs(e.clientX - drag.mouseStartX) > 4 ||
      Math.abs(e.clientY - drag.mouseStartY) > 4
    )) {
      drag.moved = true;
      const cw = GRID_W - 4, ch = GRID_H - 4;
      const f = makeCardEl(drag.card, { faceUp: true });
      $(f).addClass('table-card dragging float-drag');
      f.style.width         = cw + 'px';
      f.style.height        = ch + 'px';
      f.style.position      = 'fixed';
      f.style.pointerEvents = 'none';
      f.style.zIndex        = ++zCounter;
      document.body.appendChild(f);
      drag.floatEl = f;
      drag._cw = cw; drag._ch = ch;
      if (drag.sourceEl) drag.sourceEl.classList.add('hand-ghost');
    }
    if (!drag.moved) return;

    const _cw = drag._cw || (GRID_W - 4), _ch = drag._ch || (GRID_H - 4);
    drag.floatEl.style.left = (e.clientX - _cw / 2) + 'px';
    drag.floatEl.style.top  = (e.clientY - _ch / 2) + 'px';

    if (isOverEl(e, handArea())) {
      showHandGap(e.clientX);
      $(handArea()).addClass('drop-target');
    } else {
      clearHandGap();
      $(handArea()).removeClass('drop-target');
    }

  } else if (drag.source === 'table-group') {
    const dx = e.clientX - drag.mouseStartX;
    const dy = e.clientY - drag.mouseStartY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;

    for (const [idStr, start] of Object.entries(drag.startPositions)) {
      const id   = parseInt(idStr);
      const newX = start.x + dx;
      const newY = start.y + dy;
      const tc   = tableCards[id];
      if (tc) {
        tc.el.style.left = newX + 'px';
        tc.el.style.top  = newY + 'px';
        tc.data.x = newX;
        tc.data.y = newY;
      }
      socket.emit('move-card', { cardId: id, x: newX, y: newY });
    }

    $(handArea()).toggleClass('drop-target', isOverEl(e, handArea()));

  } else {
    // source === 'table' (single card)
    if (Math.abs(e.clientX - drag.mouseStartX) > 4 ||
        Math.abs(e.clientY - drag.mouseStartY) > 4) drag.moved = true;

    const _tEl = tableEl();
    const tr = _tEl.getBoundingClientRect();
    const x  = e.clientX - tr.left + _tEl.scrollLeft - drag.offsetX;
    const y  = e.clientY - tr.top  + _tEl.scrollTop  - drag.offsetY;
    drag.floatEl.style.left = x + 'px';
    drag.floatEl.style.top  = y + 'px';
    if (tableCards[drag.cardId]) {
      tableCards[drag.cardId].data.x = x;
      tableCards[drag.cardId].data.y = y;
    }
    if (drag.moved) socket.emit('move-card', { cardId: drag.cardId, x, y });
    $(handArea()).toggleClass('drop-target', isOverEl(e, handArea()));
  }
}

$(document).on('mousemove', (e) => {
  moveFloat(e);

  if (boxSelect) {
    const _bsEl2 = tableEl();
    const tr = _bsEl2.getBoundingClientRect();
    const x  = e.clientX - tr.left + _bsEl2.scrollLeft;
    const y  = e.clientY - tr.top  + _bsEl2.scrollTop;
    const l  = Math.min(boxSelect.startX, x);
    const t  = Math.min(boxSelect.startY, y);
    const w  = Math.abs(x - boxSelect.startX);
    const h  = Math.abs(y - boxSelect.startY);
    const $sel = $('#select-box');
    $sel.css('left', l + 'px').css('top', t + 'px').css('width', w + 'px').css('height', h + 'px');
    boxSelect.endX = x;
    boxSelect.endY = y;
  }
});

$(document).on('mouseup', (e) => {
  // Box select completion
  if (boxSelect) {
    $('#select-box').css('display', 'none');
    const { startX, startY } = boxSelect;
    const endX = boxSelect.endX ?? startX;
    const endY = boxSelect.endY ?? startY;
    boxSelect = null;

    const rectL = Math.min(startX, endX);
    const rectR = Math.max(startX, endX);
    const rectT = Math.min(startY, endY);
    const rectB = Math.max(startY, endY);

    if (rectR - rectL > 5 || rectB - rectT > 5) {
      for (const [idStr, entry] of Object.entries(tableCards)) {
        const { x, y } = entry.data;
        if (x >= rectL && x <= rectR && y >= rectT && y <= rectB) {
          selectCard(parseInt(idStr));
        }
      }
    }
    return;
  }

  if (!drag) return;
  $(handArea()).removeClass('drop-target');

  if (drag.source === 'hand') {
    if (!drag.moved) {
      const clickedId = drag.card.id;
      drag = null;
      toggleHandSelect(clickedId);
      return;
    }

    const inHand  = isOverEl(e, handArea());
    const inTable = isOverEl(e, tableEl());
    const nonGhostIdx = inHand ? handInsertIndex(e.clientX) : -1;

    clearHandGap();
    drag.floatEl?.remove();
    drag.sourceEl?.classList.remove('hand-ghost');

    if (inHand) {
      const from = drag.handIndex;
      const dividerRightCardIds = isolateDividers.map(p => myHand[p]?.id);
      const [card] = myHand.splice(from, 1);
      myHand.splice(nonGhostIdx, 0, card);
      if (isolateDividers.length > 0) {
        isolateDividers = dividerRightCardIds
          .map(id => myHand.findIndex(c => c.id === id))
          .filter(p => p > 0)
          .sort((a, b) => a - b);
        isolateDividers = [...new Set(isolateDividers)];
      }
      renderHand();
    } else if (inTable) {
      const _tEl = tableEl();
      const tr = _tEl.getBoundingClientRect();
      const raw = { x: e.clientX - tr.left + _tEl.scrollLeft, y: e.clientY - tr.top + _tEl.scrollTop };
      const snapped = snapToGrid(raw.x, raw.y);
      socket.emit('play-card', { cardId: drag.cardId, ...snapped, faceUp: true });
    }

  } else if (drag.source === 'table-group') {
    for (const id of selectedCardIds) $(tableCards[id]?.el).removeClass('dragging');
    if (!drag.moved) {
      toggleSelect(drag.cardId);
    } else if (isOverEl(e, handArea())) {
      for (const id of [...selectedCardIds]) socket.emit('pickup-card', { cardId: id });
      clearSelection();
    }

  } else {
    // source === 'table' (single)
    $(drag.floatEl).removeClass('dragging');
    if (!drag.moved) {
      toggleSelect(drag.cardId);
    } else if (isOverEl(e, handArea())) {
      socket.emit('pickup-card', { cardId: drag.cardId });
    } else {
      const _tEl2 = tableEl();
      const tr = _tEl2.getBoundingClientRect();
      const rawX = e.clientX - tr.left + _tEl2.scrollLeft - drag.offsetX;
      const rawY = e.clientY - tr.top  + _tEl2.scrollTop  - drag.offsetY;
      const { x, y } = snapToGrid(rawX, rawY);
      if (tableCards[drag.cardId]) {
        tableCards[drag.cardId].el.style.left = x + 'px';
        tableCards[drag.cardId].el.style.top  = y + 'px';
        tableCards[drag.cardId].data.x = x;
        tableCards[drag.cardId].data.y = y;
      }
      socket.emit('move-card', { cardId: drag.cardId, x, y });
    }
  }

  drag = null;
});

// ── Box select: start on empty table space ────────────────────────────────────
// Also wire up a ResizeObserver so the grid rescales whenever the table resizes.
$(document).ready(() => {
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => computeGridScale()).observe(tableEl());
  }

  $(tableEl()).on('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== tableEl()) return;
    e.preventDefault();
    clearSelection();

    const _bsEl = tableEl();
    const tr = _bsEl.getBoundingClientRect();
    const startX = e.clientX - tr.left + _bsEl.scrollLeft;
    const startY = e.clientY - tr.top  + _bsEl.scrollTop;

    const $sel = $('#select-box');
    $sel.css('display', 'block').css('left', startX + 'px').css('top', startY + 'px')
      .css('width', '0').css('height', '0');

    boxSelect = { startX, startY };
  });
});

// ── Table card lifecycle ──────────────────────────────────────────────────────
function placeCardOnTable(cardData) {
  if (localScoredIds.has(cardData.id)) return;

  const existing = tableCards[cardData.id];
  if (existing) {
    existing.el.style.left = cardData.x + 'px';
    existing.el.style.top  = cardData.y + 'px';
    existing.data = { ...existing.data, ...cardData };
    scheduleRenderGroups();
    return;
  }

  const el = makeCardEl(cardData, { faceUp: cardData.faceUp !== false });
  $(el).addClass('table-card').toggleClass('selected', selectedCardIds.has(cardData.id));
  const fallback = snapToGrid(
    gridOffsetX + Math.floor(GRID_COLS / 2) * GRID_W,
    gridOffsetY + Math.floor(GRID_ROWS / 2) * GRID_H
  ); // centre cell
  el.style.left = (cardData.x || fallback.x) + 'px';
  el.style.top  = (cardData.y || fallback.y) + 'px';
  el.style.transform = 'translate(-50%,-50%)';

  $(el).on('mousedown', (e) => startTableDrag(e, cardData.id));
  $(el).on('contextmenu', (e) => { e.preventDefault(); showCardMenu(e.clientX, e.clientY, cardData.id); });

  $(tableEl()).append(el);
  tableCards[cardData.id] = { el, data: cardData };
  bringToFront(el);
  scheduleRenderGroups();
}

function removeTableCard(cardId) {
  deselectCard(cardId);
  $(tableCards[cardId]?.el).remove();
  delete tableCards[cardId];
  localScoredIds.delete(cardId);
  scheduleRenderGroups();
}

// ── Context menu ──────────────────────────────────────────────────────────────
let menuEl = null;

function showCardMenu(px, py, cardId) {
  removeMenu();
  const $menuEl = $('<div>').addClass('ctx-menu').css('left', px + 'px').css('top', py + 'px');
  [
    { label: '↩ Pick up to hand',    fn: () => socket.emit('pickup-card', { cardId }) },
    { label: '🔄 Flip face up/down', fn: () => socket.emit('flip-card',   { cardId }) },
  ].forEach(({ label, fn }) => {
    const $btn = $('<button>').text(label);
    $btn.on('click', () => { fn(); removeMenu(); });
    $menuEl.append($btn);
  });
  $('body').append($menuEl);
  menuEl = $menuEl.get(0);
}

function removeMenu() {
  $(menuEl).remove();
  menuEl = null;
}

$(document).on('click', removeMenu);
