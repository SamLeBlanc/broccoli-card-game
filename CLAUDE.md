# CLAUDE.md — Broccoli Card Game

> Architecture guide for AI assistants. Read this instead of exploring files.
> Source of truth for structure, data flow, and "where does X live."

---

## Stack & Entry Point

```
Node.js + Express + Socket.io (server)
Vanilla JS + jQuery + Socket.io (client, no bundler)

npm start  →  node server.js  →  serves /public on :3000
GET /config.js  →  dynamically injected by server (not a static file)
```

---

## File Map & Responsibilities

### Server
| File | Lines | What lives here |
|------|-------|-----------------|
| `server.js` | 355 | Everything server-side: deck build, room state, all socket events, AI logic |

### Client (`public/`)
| File | Lines | What lives here |
|------|-------|-----------------|
| `state.js` | 202 | Global variables, hand/table selection helpers, scored-sets panel, z-index |
| `cards.js` | 53 | `makeCardEl()` — only place that renders card DOM |
| `animation.js` | 69 | `animateTo()`, `playShuffleAnimation()`, deck pile visuals |
| `grid.js` | 521 | Table grid, drag/drop, group detection, score buttons |
| `hand.js` | 217 | Hand render, sort, isolate group boxes |
| `scoring.js` | 438 | Set validation, scoring formula, cheat panel |
| `ui.js` | 397 | All socket event handlers, join screen, topbar controls |
| `index.html` | ~200 | DOM skeleton only — no logic |
| `style.css` | 32KB | All styling |

---

## Module Load Order & Dependencies

```
index.html loads scripts in this order:
  state.js        ← no deps, defines globals
  cards.js        ← no deps
  animation.js    ← no deps
  grid.js         ← uses: state, cards, animation, scoring
  hand.js         ← uses: state, cards, scoring
  scoring.js      ← uses: state, cards
  ui.js           ← uses: all of the above; handles all socket events
```

**Key rule:** `state.js` exports globals (no imports). Everything else reads from those globals.
`ui.js` is the integration layer — it wires socket events to the render functions in other files.

---

## Data Shapes

### Server room (`rooms[roomId]`)
```js
{
  maxPlayers: 2–4,
  deck: [],              // shuffled Card[]
  table: {               // cardId → TableCard
    [cardId]: { ...card, x, y, rot, faceUp, movedBy }
  },
  players: {             // socketId → Player
    [socketId]: { name, hand: Card[], score: 0 }
  },
  seatOrder: [],         // [socketId] indexed by seat number
  pendingHands: {},      // { [seatIndex]: Card[] } for unfilled seats
  aiScores: {},          // { [seatIndex]: cumulativeScore }
  aiTurnRunning: false,
}
```

### Card object
```js
// Regular card
{ id, rank, suit, color }

// Joker (any combination of wild traits)
{ id, isJoker: true, wildRank, wildSuit, wildColor,
  color?,   // present unless wildColor
  suit?,    // present unless wildSuit
  rank?     // present unless wildRank
}
// All-wild joker has all three wild flags true and no fixed traits
```

### Client globals (`state.js`)
```js
myId, mySeat, myHand, maxPlayers
tableCards          // { cardId: { el: DOMElement, data: Card } }
deckCards           // Card[] currently in draw pile
deckCount           // number
selectedCardIds     // Set<cardId> — table selection
selectedHandIds     // Set<cardId> — hand selection
cheatPlayOrder      // Card[] | null — cheat-panel play ordering
isolateDividers     // number[] — hand group box boundaries
localScoredIds      // Set<cardId> — prevents ghost resurrection
zCounter            // ever-increasing z-index
allScoredSets       // [{ cards, score, playerName }] — session history
```

---

## Socket Event Reference

### Client → Server
| Event | Payload | Server action |
|-------|---------|---------------|
| `join` | `{roomId, name, maxPlayers}` | Create/join room, assign seat |
| `shuffle` | — | Reshuffle deck in place |
| `deal` | `{count}` | Deal N cards to all seats (including pending) |
| `draw` | `{count}` | Draw N cards to own hand |
| `play-card` | `{cardId, x, y, faceUp}` | Hand → table |
| `pickup-card` | `{cardId}` | Table → hand |
| `flip-card` | `{cardId}` | Toggle faceUp on table |
| `move-card` | `{cardId, x, y}` | Reposition on table |
| `flip-to-table` | `{x, y}` | Deck top → table face-up |
| `score-set` | `{cardIds, score}` | Remove set, auto-draw, trigger AI turns |
| `collect` | — | All cards → deck → reshuffle |
| `chat` | `{text}` | Broadcast chat message |
| `debug-add-card` | cardData | Inject card into hand (DEBUG only) |

### Server → Client
| Event | Payload | Client action (in ui.js) |
|-------|---------|--------------------------|
| `your-seat` | seat number | Set `mySeat` |
| `your-hand` | Card[] | Update `myHand`, call `renderHand()` |
| `state` | roomState snapshot | Sync table, deck, player list |
| `card-placed` | TableCard | `placeCardOnTable()` |
| `card-moved` | `{cardId, x, y}` | Reposition card element |
| `card-removed` | `{cardId}` | `removeTableCard()` |
| `card-flipped` | `{cardId, faceUp}` | Update card face |
| `shuffled` | — | `playShuffleAnimation()` |
| `chat` | `{name?, text}` or `{system, text}` | Append to chat panel |
| `ai-turn` | `{phase, seat, name, ...}` | Show AI thinking/play indicator |

---

## Key Functions — Where to Find Them

### Rendering
```js
// cards.js
makeCardEl(card, { faceUp, small })     // → DOM element; ONLY card renderer

// hand.js
renderHand()                            // full hand re-render with group boxes
toggleHandSelect(cardId)

// grid.js
placeCardOnTable(cardData)              // add card DOM to #table
removeTableCard(cardId)                 // remove from DOM + tableCards
findGridGroups()                        // → horizontal/vertical 3+ runs
renderGroupScoreBtns()                  // auto-score overlays above groups

// animation.js
animateTo(el, {delay, duration, x, y, rot, easing, onComplete})  // rAF animation
playShuffleAnimation(onDone)
buildDeckPile()                         // rebuild #deck-pile visual
```

### Scoring & Validation
```js
// scoring.js
validateAndScore(cards)     // → {valid, rank, color, suit, score, orderedCards}
findAllValidSets()          // brute-force all 3–7 card combos in myHand
renderCheatPanel()          // populate cheat panel with grouped valid sets
topFailReason(result)       // → human-readable failure string

// server.js (mirrors client logic)
validateSet(cards)          // → {valid, score}  (AI uses this)
findBestPlay(hand)          // → {cards, score} | null
```

### State helpers (`state.js`)
```js
toggleHandSelect(cardId)    // toggles selectedHandIds, calls renderHand
clearHandSelection()
selectCard(id) / deselectCard(id) / toggleSelect(id) / clearSelection()
addScoredSet(cards, score, playerName)   // push to history + re-render panel
bringToFront(el)            // increment zCounter
```

---

## Scoring Formula

```
score = max(0, (3 + sameCount) × (numCards − 2) − jokerCount)

sameCount = number of traits (rank / color / suit) that are "same" or "wild"
```

### Valid set rules (3+ cards)
- **Rank:** all wild, OR all same, OR all different with no gaps wider than (n−1)
- **Color / Suit (n < 5):** all wild, OR all same, OR all different (no dupes)
- **Color / Suit (n ≥ 5):** all wild, OR all same, OR period-4 cycle on rank-order

---

## Grid System (`grid.js`)

```js
GRID_W = 84   // cell width  (80px card + 4px gutter)
GRID_H = 116  // cell height (112px card + 4px gutter)

// Card center coords:
//   x = col * 84 + 42
//   y = row * 116 + 58

snapToGrid(x, y)        // → snapped {x, y}
cardGridPos(cardData)   // → {col, row}
```

---

## AI System (`server.js`)

AI players occupy seats 1–3 (seat 0 is always human). They are triggered after a human scores.

```
triggerAiTurns(roomId)
  └── for each empty seat with cards in pendingHands:
        1. emit ai-turn { phase: 'thinking' }  (after THINK_MS = 800ms)
        2. findBestPlay(hand)
        3. emit ai-turn { phase: 'play' | 'pass' }
        4. emit state
        Seats are staggered by STAGGER_MS = 2400ms
```

AI names: `AI_NAMES = ['', 'Broc', 'Oli', 'Cauli']` (index = seat).

---

## HTML Layout

```
#join-screen
#game-screen
  #topbar              ← shuffle / deal / draw / collect / deck-count / chat toggle
  #table-row           ← 3-col flex layout
    #opp-left
    #center-col
      #opp-top
      #table           ← card grid (position:relative, overflow:auto)
        #deck-pile     ← visual stack (buildDeckPile)
        #discard-zone
      #hand-area       ← renderHand target
    #opp-right         ← 4-player only, class .opp-side (hidden in 2–3p)
    #right-sidebar     ← permanent 280px sidebar (flex column)
      #sidebar-tabs    ← Cheat / Deck / History tabs (switchSidebarTab in ui.js)
      #pane-cheat      ← .sidebar-pane; cheat helper (renderCheatPanel)
        #cheat-header / #cheat-list
      #pane-deck       ← .sidebar-pane; deck browser (renderDeckPanel)
        #deck-panel-header / #deck-panel-controls / #deck-panel-content
      #pane-history    ← .sidebar-pane; scoreboard + set history (active by default)
        #history-scores / #history-filter-row / #history-rows
  #deal-modal
  #score-result
  #chat-panel
```

Opponent layout by player count: 2p = top only, 3p = top + left, 4p = top + left + right (in sidebar).
Tab switching: `switchSidebarTab(name)` in `ui.js` — hides all `.sidebar-pane`, shows `#pane-{name}`.

---

## Dev / Debug

```bash
DEBUG_MODE=true node server.js
# Auto-joins 4 players, deals 20 cards, enables deck browser + card injector
```

- `window.APP_DEBUG` is injected via `GET /config.js` (not a static file — don't look in /public).
- `localScoredIds` (Set in state.js) prevents scored cards from reappearing on late `state` broadcasts.
- `debug-add-card` socket event injects a card additively (does not remove from deck).

---

## Where to Look for X

| Task | File(s) |
|------|---------|
| Add a socket event | `server.js` (emit) + `ui.js` (handler) |
| Change card visuals | `cards.js` → `makeCardEl` / `makeJokerEl` |
| Change scoring rules | `scoring.js` → `validateAndScore` AND `server.js` → `validateSet` (keep in sync) |
| Change grid snap or grouping | `grid.js` → `GRID_W/H`, `snapToGrid`, `findGridGroups` |
| Change hand rendering / isolate boxes | `hand.js` → `renderHand` |
| Change AI behavior | `server.js` → `findBestPlay`, `triggerAiTurns` |
| Change deal/draw/collect logic | `server.js` socket handlers |
| Change animations | `animation.js` → `animateTo`, `playShuffleAnimation` |
| Change deck composition | `server.js` → `buildDeck` |
| Add new global state | `state.js` (declare at top) |
| Change UI controls / topbar | `ui.js` + `index.html` + `style.css` |
