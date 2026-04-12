// ── Snap grid ─────────────────────────────────────────────────────────────────
// Card slots: 80×112px cards with 4px gutters → 84×116px per cell.
// Card centres land at: x = col*84 + 42,  y = row*116 + 58
const GRID_W = 84, GRID_H = 116;

function snapToGrid(x, y) {
  const col = Math.round((x - GRID_W / 2) / GRID_W);
  const row = Math.round((y - GRID_H / 2) / GRID_H);
  return { x: col * GRID_W + GRID_W / 2, y: row * GRID_H + GRID_H / 2 };
}

function cardGridPos(data) {
  return {
    col: Math.round((data.x - GRID_W / 2) / GRID_W),
    row: Math.round((data.y - GRID_H / 2) / GRID_H),
  };
}

// Returns the table-space position (card center) where discarded cards land.
// Snaps to the rightmost column whose card fully fits inside the table (with 4px margin).
function discardZonePos() {
  const tEl = tableEl();
  const tW  = tEl ? tEl.offsetWidth : 1200;
  // Card right edge = x + 40.  Need x + 40 ≤ tW - 4  →  x ≤ tW - 44
  // x = col * GRID_W + GRID_W/2  →  col ≤ (tW - 44 - GRID_W/2) / GRID_W
  const maxCol = Math.floor((tW - 44 - GRID_W / 2) / GRID_W);
  const x = maxCol * GRID_W + GRID_W / 2;
  const y = GRID_H / 2;   // row 0 center = 58px from top
  return { x, y };
}

// Returns the table-space position (card center) for the deck pile: bottom-left cell.
function deckPilePos() {
  const tEl = tableEl();
  const tH  = tEl ? tEl.offsetHeight : 600;
  // Card bottom edge = y + 56.  Need y + 56 ≤ tH - 4  →  y ≤ tH - 60
  // y = row * GRID_H + GRID_H/2  →  row ≤ (tH - 60 - GRID_H/2) / GRID_H
  const maxRow = Math.floor((tH - 60 - GRID_H / 2) / GRID_H);
  const y = maxRow * GRID_H + GRID_H / 2;
  const x = GRID_W / 2;   // col 0 center = 42px from left
  return { x, y };
}

// Position visual divs to match their computed grid cells.
// Called on game-screen show, on state update, and on window resize.
function positionDiscardZone() {
  const { x, y } = discardZonePos();
  $('#discard-zone').css({ left: (x - 40) + 'px', top: (y - 56) + 'px' });
}

function positionDeckPile() {
  const { x, y } = deckPilePos();
  $('#deck-pile').css({ left: (x - 40) + 'px', top: (y - 56) + 'px' });
}

$(window).on('resize', () => { positionDiscardZone(); positionDeckPile(); });

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

function renderGroupScoreBtns() {
  groupScoreBtns.forEach(b => $(b).remove());
  groupScoreBtns = [];

  const groups = findGridGroups();
  const tEl = tableEl();

  for (const run of groups) {
    const xs = run.map(d => d.x);
    const ys = run.map(d => d.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const ty = Math.min(...ys) - 56 - 8;

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
      const f = makeCardEl(drag.card, { faceUp: true });
      $(f).addClass('table-card dragging float-drag');
      f.style.width         = '80px';
      f.style.height        = '112px';
      f.style.position      = 'fixed';
      f.style.pointerEvents = 'none';
      f.style.zIndex        = ++zCounter;
      document.body.appendChild(f);
      drag.floatEl = f;
      if (drag.sourceEl) drag.sourceEl.classList.add('hand-ghost');
    }
    if (!drag.moved) return;

    drag.floatEl.style.left = (e.clientX - 40) + 'px';
    drag.floatEl.style.top  = (e.clientY - 56) + 'px';

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

    const tr = tableEl().getBoundingClientRect();
    const x  = e.clientX - tr.left - drag.offsetX;
    const y  = e.clientY - tr.top  - drag.offsetY;
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
    const tr = tableEl().getBoundingClientRect();
    const x  = e.clientX - tr.left;
    const y  = e.clientY - tr.top;
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
      const tr = tableEl().getBoundingClientRect();
      const raw = { x: e.clientX - tr.left, y: e.clientY - tr.top };
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
      const tr = tableEl().getBoundingClientRect();
      const rawX = e.clientX - tr.left - drag.offsetX;
      const rawY = e.clientY - tr.top  - drag.offsetY;
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
$(document).ready(() => {
  $(tableEl()).on('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== tableEl()) return;
    e.preventDefault();
    clearSelection();

    const tr = tableEl().getBoundingClientRect();
    const startX = e.clientX - tr.left;
    const startY = e.clientY - tr.top;

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
  el.style.left = (cardData.x || 200) + 'px';
  el.style.top  = (cardData.y || 200) + 'px';
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
