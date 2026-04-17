const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { validateAndScore } = require('./public/scoring-core');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Client config injection ───────────────────────────────────────────────────
// Debug is off on Railway (RAILWAY_ENVIRONMENT is always set there), on everywhere else.
// Uses RAILWAY_ENVIRONMENT instead of NODE_ENV to avoid local env pollution.
app.get('/config.js', (req, res) => {
  const debug = process.env.RAILWAY_ENVIRONMENT != null ? false : true;
  res.type('application/javascript')
     .send(`window.DEBUG = ${debug};`);
});

// ── Card data ────────────────────────────────────────────────────────────────
const SUITS     = ['spade', 'heart', 'club', 'diamond'];
const COLORS    = ['blue', 'red', 'green', 'purple'];
const AI_NAMES  = ['', 'Broc', 'Oli', 'Cauli'];  // index = seat (seat 0 = human)

// Regular: 13 ranks × 4 suits × 4 colors = 208 cards
// Jokers:  all 2³-1 = 7 wild-trait combinations, one card per unique fixed-trait combo
//   1 wild  (2 fixed traits): wildRank(16) + wildSuit(52) + wildColor(52) = 120
//   2 wilds (1 fixed trait):  wildRank+wildSuit(4) + wildRank+wildColor(4) + wildSuit+wildColor(13) = 21
//   3 wilds (0 fixed traits): 1 star joker
// Grand total: 208 + 142 = 350 cards
function buildDeck() {
  const deck = [];
  let id = 0;

  // ── Regular cards ───────────────────────────────────────────────────────────
  for (const color of COLORS)
    for (const suit of SUITS)
      for (let rank = 1; rank <= 13; rank++)
        deck.push({ id: id++, suit, rank, color });

  // ── Jokers: 1 wild trait (2 fixed) ─────────────────────────────────────────
  // wildRank — has color + suit (no rank): 4×4 = 16
  for (const color of COLORS)
    for (const suit of SUITS)
      deck.push({ id: id++, isJoker: true, wildRank: true,  wildSuit: false, wildColor: false, color, suit });

  // wildSuit — has color + rank (no suit): 4×13 = 52
  for (const color of COLORS)
    for (let rank = 1; rank <= 13; rank++)
      deck.push({ id: id++, isJoker: true, wildRank: false, wildSuit: true,  wildColor: false, color, rank });

  // wildColor — has suit + rank (no color): 4×13 = 52
  for (const suit of SUITS)
    for (let rank = 1; rank <= 13; rank++)
      deck.push({ id: id++, isJoker: true, wildRank: false, wildSuit: false, wildColor: true,  suit,  rank });

  // ── Jokers: 2 wild traits (1 fixed) ────────────────────────────────────────
  // wildRank+wildSuit — has color only: 4
  for (const color of COLORS)
    deck.push({ id: id++, isJoker: true, wildRank: true,  wildSuit: true,  wildColor: false, color });

  // wildRank+wildColor — has suit only: 4
  for (const suit of SUITS)
    deck.push({ id: id++, isJoker: true, wildRank: true,  wildSuit: false, wildColor: true,  suit  });

  // wildSuit+wildColor — has rank only: 13
  for (let rank = 1; rank <= 13; rank++)
    deck.push({ id: id++, isJoker: true, wildRank: false, wildSuit: true,  wildColor: true,  rank  });

  // ── Jokers: 3 wild traits (0 fixed) — the star joker ───────────────────────
  deck.push({ id: id++, isJoker: true, wildRank: true, wildSuit: true, wildColor: true });

  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Rooms ────────────────────────────────────────────────────────────────────
// rooms[roomId] = { maxPlayers, deck, table, players, seatOrder }
// seatOrder: [socketId, ...] in join order — index = seat number
const rooms = {};

function getOrCreateRoom(roomId, maxPlayers) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      maxPlayers: maxPlayers || 4,
      deck: shuffle(buildDeck()),  // pre-shuffled at game start
      table: {},
      players: {},
      seatOrder: [],      // [socketId] in join order
      pendingHands: {},   // { [seatIndex]: [card, ...] } for seats not yet occupied
      aiScores: {},       // { [seatIndex]: cumulativeScore }
      aiTurnRunning: false,
    };
  }
  return rooms[roomId];
}

function roomState(room) {
  // Build per-seat entries for all maxPlayers slots so clients always see the full table
  const seats = {};
  for (let seat = 0; seat < room.maxPlayers; seat++) {
    const sid = room.seatOrder[seat];
    if (sid && room.players[sid]) {
      seats[seat] = {
        name: room.players[sid].name,
        handCount: room.players[sid].hand.length,
        socketId: sid,
        empty: false,
        score: room.players[sid].score || 0,
      };
    } else {
      const pending = (room.pendingHands[seat] || []).length;
      seats[seat] = {
        name: AI_NAMES[seat] || `CPU ${seat}`,
        handCount: pending,
        socketId: null,
        empty: true,
        score: room.aiScores[seat] || 0,
      };
    }
  }
  return {
    maxPlayers: room.maxPlayers,
    deck: room.deck,
    table: room.table,
    players: Object.fromEntries(
      Object.entries(room.players).map(([id, p]) => [id, {
        name: p.name,
        handCount: p.hand.length,
        seat: room.seatOrder.indexOf(id),
      }])
    ),
    seats, // full picture of all seats including empty ones
  };
}

// ── AI helpers ───────────────────────────────────────────────────────────────
// validateAndScore is shared with the client via scoring-core.js (required above).

// Brute-force all combinations of size k from arr.
function getCombinations(arr, k) {
  const result = [], combo = new Array(k);
  function go(start, depth) {
    if (depth === k) { result.push(combo.slice()); return; }
    for (let i = start; i <= arr.length - (k - depth); i++) {
      combo[depth] = arr[i]; go(i + 1, depth + 1);
    }
  }
  go(0, 0);
  return result;
}

// Return the highest-scoring valid set from hand (3–13 cards).
function findBestPlay(hand) {
  let best = null;
  const max = Math.min(13, hand.length);
  for (let k = 3; k <= max; k++) {
    for (const combo of getCombinations(hand, k)) {
      const { valid, score } = validateAndScore(combo);
      if (valid && score != null && (!best || score > best.score)) best = { cards: combo, score };
    }
  }
  return best;
}

// Trigger AI turns for all empty seats, staggered so humans can follow along.
const THINK_MS   = 800;   // "thinking" indicator duration
const STAGGER_MS = 2400;  // gap between consecutive AI turns (think + display)

function triggerAiTurns(roomId) {
  const room = rooms[roomId];
  console.log('[AI] triggerAiTurns called, roomId:', roomId, 'aiTurnRunning:', room?.aiTurnRunning);
  if (!room || room.aiTurnRunning) return;

  // Find seats that are AI-controlled (no connected socket, has cards).
  const aiSeats = [];
  for (let seat = 1; seat < room.maxPlayers; seat++) {
    const hasSid    = !!room.seatOrder[seat];
    const cardCount = (room.pendingHands[seat] || []).length;
    console.log(`[AI]  seat ${seat}: hasSid=${hasSid}, pendingCards=${cardCount}`);
    if (!hasSid && cardCount > 0) aiSeats.push(seat);
  }
  console.log('[AI] aiSeats:', aiSeats);
  if (!aiSeats.length) return;

  room.aiTurnRunning = true;
  const totalMs = 600 + (aiSeats.length - 1) * STAGGER_MS + THINK_MS + 1600;
  setTimeout(() => { if (rooms[roomId]) rooms[roomId].aiTurnRunning = false; }, totalMs);

  let delay = 600;
  for (const seat of aiSeats) {
    const name = AI_NAMES[seat] || `CPU ${seat}`;

    // Thinking phase
    const thinkAt = delay;
    setTimeout(() => {
      if (!rooms[roomId]) return;
      io.to(roomId).emit('ai-turn', { phase: 'thinking', seat, name });
    }, thinkAt);

    // Play phase
    const playAt = delay + THINK_MS;
    setTimeout(() => {
      if (!rooms[roomId]) return;
      const r    = rooms[roomId];
      const hand = r.pendingHands[seat] || [];

      if (!hand.length) {
        io.to(roomId).emit('ai-turn', { phase: 'pass', seat, name });
        return;
      }

      const best = findBestPlay(hand);
      if (!best) {
        io.to(roomId).emit('ai-turn', { phase: 'pass', seat, name });
        return;
      }

      // Remove scored cards from AI hand.
      const scoredIds = new Set(best.cards.map(c => c.id));
      r.pendingHands[seat] = hand.filter(c => !scoredIds.has(c.id));

      // Tally cumulative score.
      r.aiScores[seat] = (r.aiScores[seat] || 0) + best.score;

      // Auto-draw replacements from deck.
      const draw = Math.min(best.cards.length, r.deck.length);
      for (let i = 0; i < draw; i++) r.pendingHands[seat].push(r.deck.shift());

      console.log(`[AI] seat ${seat} playing ${best.cards.length} cards for ${best.score} pts`);
      io.to(roomId).emit('ai-turn', {
        phase:      'play',
        seat,
        name,
        cards:      best.cards,
        score:      best.score,
        totalScore: r.aiScores[seat],
        handCount:  r.pendingHands[seat].length,
      });
      io.to(roomId).emit('state', roomState(r));
      io.to(roomId).emit('chat', { system: true, text: `${name} scored ${best.score} pts!` });
    }, playAt);

    delay += STAGGER_MS;
  }
}

// ── Socket handlers ──────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join', ({ roomId, name, maxPlayers }) => {
    currentRoom = roomId;
    socket.join(roomId);
    const room = getOrCreateRoom(roomId, maxPlayers);

    // Assign next available seat
    if (!room.seatOrder.includes(socket.id)) {
      room.seatOrder.push(socket.id);
    }
    const seat = room.seatOrder.indexOf(socket.id);
    // Pick up any cards dealt to this seat while it was empty
    const pending = room.pendingHands[seat] || [];
    delete room.pendingHands[seat];
    room.players[socket.id] = { name: name || 'Player', hand: pending };

    socket.emit('your-seat', seat);
    socket.emit('your-hand', room.players[socket.id].hand);
    io.to(roomId).emit('state', roomState(room));
    io.to(roomId).emit('chat', { system: true, text: `${room.players[socket.id].name} joined.` });
  });

  socket.on('shuffle', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    room.deck = shuffle(room.deck);
    io.to(currentRoom).emit('shuffled');
    io.to(currentRoom).emit('state', roomState(room));
    io.to(currentRoom).emit('chat', { system: true, text: `${room.players[socket.id]?.name} shuffled the deck.` });
  });

  socket.on('collect', () => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    // Collect table cards
    const tableCards = Object.values(room.table);
    room.deck = [...room.deck, ...tableCards.map(({ x, y, rot, faceUp, movedBy, ...card }) => card)];
    room.table = {};
    // Collect all connected players' hands
    for (const p of Object.values(room.players)) {
      room.deck = [...room.deck, ...p.hand];
      p.hand = [];
    }
    // Collect pending hands (dealt to empty seats)
    for (const cards of Object.values(room.pendingHands)) {
      room.deck = [...room.deck, ...cards];
    }
    room.pendingHands = {};
    room.deck = shuffle(room.deck);
    for (const sid of Object.keys(room.players)) io.to(sid).emit('your-hand', []);
    io.to(currentRoom).emit('state', roomState(room));
    io.to(currentRoom).emit('chat', { system: true, text: `${room.players[socket.id]?.name} collected all cards and reshuffled.` });
  });

  socket.on('deal', ({ count }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    // Deal to all maxPlayers seats, whether or not the player has joined yet
    for (let i = 0; i < count; i++) {
      for (let seat = 0; seat < room.maxPlayers; seat++) {
        const card = room.deck.shift();
        if (!card) break;
        const sid = room.seatOrder[seat];
        if (sid && room.players[sid]) {
          room.players[sid].hand.push(card);
        } else {
          // Hold for when this seat's player joins
          if (!room.pendingHands[seat]) room.pendingHands[seat] = [];
          room.pendingHands[seat].push(card);
        }
      }
    }
    for (const [sid, p] of Object.entries(room.players)) io.to(sid).emit('your-hand', p.hand);
    io.to(currentRoom).emit('state', roomState(room));
    io.to(currentRoom).emit('chat', { system: true, text: `${room.players[socket.id]?.name} dealt ${count} card(s) to all ${room.maxPlayers} players.` });
  });

  socket.on('draw', ({ count }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    const player = room.players[socket.id];
    for (let i = 0; i < count; i++) {
      const card = room.deck.shift();
      if (!card) break;
      player.hand.push(card);
    }
    socket.emit('your-hand', player.hand);
    io.to(currentRoom).emit('state', roomState(room));
  });

  socket.on('play-card', ({ cardId, x, y, faceUp }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    const player = room.players[socket.id];
    const idx = player.hand.findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const [card] = player.hand.splice(idx, 1);
    room.table[cardId] = { ...card, x, y, rot: 0, faceUp: faceUp !== false, movedBy: socket.id };
    socket.emit('your-hand', player.hand);
    io.to(currentRoom).emit('state', roomState(room));
    io.to(currentRoom).emit('card-placed', room.table[cardId]);
  });

  socket.on('flip-to-table', ({ x, y }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    const card = room.deck.shift();
    if (!card) return;
    room.table[card.id] = { ...card, x: x || 300, y: y || 300, rot: 0, faceUp: true };
    io.to(currentRoom).emit('state', roomState(room));
    io.to(currentRoom).emit('card-placed', room.table[card.id]);
  });

  socket.on('move-card', ({ cardId, x, y }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room.table[cardId]) return;
    room.table[cardId].x = x;
    room.table[cardId].y = y;
    room.table[cardId].movedBy = socket.id;
    socket.to(currentRoom).emit('card-moved', { cardId, x, y });
  });

  socket.on('flip-card', ({ cardId }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    if (!room.table[cardId]) return;
    room.table[cardId].faceUp = !room.table[cardId].faceUp;
    io.to(currentRoom).emit('card-flipped', { cardId, faceUp: room.table[cardId].faceUp });
  });

  socket.on('pickup-card', ({ cardId }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    const card = room.table[cardId];
    if (!card) return;
    delete room.table[cardId];
    const { x, y, rot, faceUp, movedBy, ...cardData } = card;
    room.players[socket.id].hand.push(cardData);
    socket.emit('your-hand', room.players[socket.id].hand);
    io.to(currentRoom).emit('state', roomState(room));
    io.to(currentRoom).emit('card-removed', { cardId });
  });

  // score-set: commit a validated set — remove cards from table, auto-deal
  // replacement cards from the deck to the scoring player, broadcast everything.
  socket.on('score-set', ({ cardIds, score }) => {
    if (!currentRoom) return;
    const room = rooms[currentRoom];
    const player = room.players[socket.id];
    if (!player) return;

    // Remove each card from the table (they leave the game / go to discard).
    const removed = [];
    for (const cardId of cardIds) {
      if (room.table[cardId]) {
        removed.push(cardId);
        delete room.table[cardId];
      }
    }
    if (removed.length === 0) return;

    // Broadcast removal to all clients.
    for (const cardId of removed) {
      io.to(currentRoom).emit('card-removed', { cardId });
    }

    // Auto-draw the same number of cards scored, if the deck has enough.
    const drawCount = Math.min(removed.length, room.deck.length);
    for (let i = 0; i < drawCount; i++) {
      const card = room.deck.shift();
      player.hand.push(card);
    }

    // Record the score on the player.
    player.score = (player.score || 0) + score;

    // Notify the scoring player of their updated hand and everyone of room state.
    socket.emit('your-hand', player.hand);
    io.to(currentRoom).emit('state', roomState(room));
    io.to(currentRoom).emit('chat', {
      system: true,
      text: `${player.name} scored ${score} pts! (deck: ${room.deck.length} remaining)`,
    });

    // Kick off staggered AI turns after the human scores.
    triggerAiTurns(currentRoom);
  });

  socket.on('chat', ({ text }) => {
    if (!currentRoom) return;
    const name = rooms[currentRoom]?.players[socket.id]?.name || 'Unknown';
    io.to(currentRoom).emit('chat', { name, text });
  });

  // ── Debug: inject a card directly into the requesting player's hand ──────────
  // Accepts any card object (from the deck browser). Does not remove the card
  // from the deck/table — purely additive, so it's only safe in debug mode.
  socket.on('debug-add-card', (cardData) => {
    if (!currentRoom) return;
    const player = rooms[currentRoom]?.players[socket.id];
    if (!player) return;
    player.hand.push(cardData);
    socket.emit('your-hand', player.hand);
  });

  socket.on('disconnect', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const name = room.players[socket.id]?.name;
    if (room.players[socket.id]) {
      room.deck = [...room.players[socket.id].hand, ...room.deck];
      delete room.players[socket.id];
    }
    room.seatOrder = room.seatOrder.filter(id => id !== socket.id);
    io.to(currentRoom).emit('state', roomState(room));
    if (name) io.to(currentRoom).emit('chat', { system: true, text: `${name} left.` });
    if (Object.keys(room.players).length === 0) delete rooms[currentRoom];
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
