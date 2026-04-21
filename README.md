# Texas Hold'em Poker — Gran Masters Edition

> **GOD MODE EDITION — Becoming a Gran Master**

A fully-featured Texas Hold'em poker simulator built with **Electron**, **TypeScript**, and **TailwindCSS v4**. Designed as a single-page, offline desktop game with a fixed-canvas layout, multi-archetype AI opponents, real-time equity calculation, rich visual/audio feedback, XP progression, daily challenges, persistent save state, and a post-hand **Poker Teacher** analysis panel.

---

## Screenshots

### Gameplay — Action Panel
![Gameplay screenshot showing action panel with pot odds, equity display, and betting controls](screenshots/gameplay.png)

*Pre-flop action with A♣ Q♦. The bottom HUD shows pot odds (need 17%, you have 47% ✓), quick bet-size presets, and the 30-second time bank. Player badges show VPIP/PFR stats and position labels. The chip-leader crown (👑) marks the current stack leader.*

### Post-Hand — Poker Teacher Panel
![Post-hand analysis showing the Poker Teacher panel with a "Good fold" note](screenshots/poker-teacher.png)

*After folding on the flop, the 🎓 Poker Teacher panel appears above the "New Hand" button. It confirms the fold was correct (+EV), shows the user's hole cards in the header, and explains the reasoning. The community cards and winner announcement remain visible.*

---

## Table of Contents

- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Architecture Overview](#architecture-overview)
- [Game Engine](#game-engine)
- [AI System](#ai-system)
- [Equity Engine](#equity-engine)
- [Rendering System](#rendering-system)
- [Animation System](#animation-system)
- [Audio System](#audio-system)
- [UI Panels & Controls](#ui-panels--controls)
- [Poker Teacher Analysis](#poker-teacher-analysis)
- [Progression & Achievements](#progression--achievements)
- [Statistics Tracking](#statistics-tracking)
- [Save & Resume](#save--resume)
- [Settings Panel](#settings-panel)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Build & Run](#build--run)
- [Configuration & Constants](#configuration--constants)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 41 |
| Language | TypeScript 6 (strict mode) |
| Bundler | Webpack 5 (3 separate configs for main, preload, renderer) |
| Styling | TailwindCSS v4 + custom CSS (animations, 3D effects) |
| Randomness | `crypto.getRandomValues` (CSPRNG) for deck shuffles |
| Audio | Web Audio API (no external audio files — all generated programmatically) |
| Equity | Monte Carlo simulation (up to 2,500 iterations) |
| Persistence | `localStorage` (save/resume, card back preference, daily challenge) |

---

## Project Structure

```
src/
├── main/
│   └── main.ts                  # Electron main process — window creation, aspect ratio
├── preload/
│   └── preload.ts               # Context bridge (contextIsolation: true)
└── renderer/
    ├── index.ts                 # Full UI engine (~3,400+ lines)
    ├── index.html               # Single-div shell
    ├── styles.css               # TailwindCSS import + custom keyframes/classes
    ├── assets.d.ts              # PNG asset type declarations
    └── game/
        ├── deck.ts              # Card types, CSPRNG shuffle, suit/rank utilities
        ├── gameState.ts         # Full game state model, blind logic, bet application
        ├── bettingAI.ts         # Multi-archetype AI decision engine
        └── winProbability.ts    # Monte Carlo equity + position/fold probability
```

---

## Architecture Overview

### Fixed-Canvas Scaling

The renderer renders into a **1366×768 fixed canvas** (`#game-canvas`) that is CSS-transformed to fill the window while preserving the 16:9 aspect ratio. The Electron window enforces this ratio via `win.setAspectRatio(1366/768)` and `useContentSize: true`.

```typescript
// Canvas scale formula (applied on every resize)
const scale = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
const tx = (window.innerWidth - BASE_W * scale) / 2;
const ty = (window.innerHeight - BASE_H * scale) / 2;
canvas.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
```

All pixel positions in the game (seat positions, chip positions, pot position) are defined in **canvas-space coordinates** and converted to screen coordinates via `canvasToScreen(cx, cy)` for overlay elements that live outside the canvas (chip flight animations, confetti).

### Render Cycle

The entire UI is rebuilt on every `render()` call — there is no virtual DOM or diffing. The canvas `innerHTML` is cleared and rebuilt from scratch each frame. This keeps state management trivial at the cost of some raw DOM work.

The single exception is the **`#anim-layer`** — a `position:fixed` overlay appended to `document.body` (not inside the canvas) that persists across `render()` calls. All flying-chip and confetti animations live here.

### State Architecture

All game state lives in a single **`GameState`** object (defined in `gameState.ts`). UI-only state (deck panel expanded, history panel expanded, thinking player ID, user action resolver, per-hand teacher context, etc.) lives as module-level variables in `index.ts`. There is no external state library.

---

## Game Engine

### GameState Interface (`gameState.ts`)

Key fields:

```typescript
interface GameState {
  players: Player[];               // Always 8 — busted players remain as ghosts
  deck: Card[];                    // Live remaining deck (decreases as cards dealt)
  originalDeck: Card[];            // Full shuffled order (for deck panel display)
  communityCards: Card[];          // 0–5 community cards
  burnedCards: Card[];             // 0–3 burned cards
  phase: GamePhase;                // idle | dealing | preflop | flop | turn | river | showdown
  dealerButtonPosition: number;    // Seat index 0–7
  pot: number;
  currentBet: number;
  minRaise: number;
  lastAggressorId: number | null;  // For action ordering
  winnerIds: number[];             // All pot winners (including different side-pot winners)
  splitPotWinnerIds: number[];     // Only players who genuinely split the *same* pot
  smallBlind: number;
  bigBlind: number;
  blindLevel: number;              // 0–7
  handNumber: number;              // Increments each hand
  nextBlindHandNumber: number;     // Hand at which next escalation fires
  sessionStats: SessionStats;      // Running session totals
  userProfile: UserProfile;        // Opponent profiling data
  dailyChallenge: DailyChallenge;  // Today's rotating goal
}
```

### Player Interface

```typescript
interface Player {
  id: number;
  name: string;
  position: number;               // Seat 0–7
  skill: number;                  // 0.0–1.0
  archetype: PlayerArchetype;     // shark | balanced | fish | maniac
  chips: number;
  holeCards: Card[];
  roundBet: number;               // Bet amount this street
  hasActed: boolean;
  isFolded: boolean;
  isBusted: boolean;
  isAllIn: boolean;
  isDealer: boolean;
  isUser: boolean;
  handResult?: HandResult;
  wasPreFlopAggressor: boolean;   // Tracks c-bet eligibility
  bluffCount: number;             // Bluffs caught at showdown
  handsPlayed: number;
  vpipCount: number;              // Pre-flop voluntary investment count
  pfrCount: number;               // Pre-flop raise count
  xp: number;                     // Accumulated XP (user only)
  level: number;                  // Current level 1–10 (user only)
}
```

### Blind Escalation

Blinds escalate every **5 hands** through 8 levels:

| Level | Small Blind | Big Blind |
|---|---|---|
| 0 | 1,000 | 2,000 |
| 1 | 2,500 | 5,000 |
| 2 | 5,000 | 10,000 |
| 3 | 10,000 | 20,000 |
| 4 | 20,000 | 40,000 |
| 5 | 40,000 | 80,000 |
| 6 | 75,000 | 150,000 |
| 7 | 150,000 | 300,000 |

From **level 4+**, an **ante** equal to 10% of the big blind is collected from all non-busted players before blinds are posted.

### Heads-Up Rules

When exactly 2 players remain, standard heads-up rules apply:
- The **dealer posts the Small Blind** and acts first pre-flop
- The **non-dealer posts the Big Blind** and acts second pre-flop

### Hand Evaluation

`evaluateHands()` scores each non-folded player's best 5-card hand from 7 available cards (2 hole + 5 community). Hand ranks (high card → royal flush) are scored as integers for direct comparison.

### Side Pot Calculation

`buildSidePots()` uses a **level-peeling algorithm** with `carryover` to correctly handle all-in players:

1. Entries are sorted by `handContribution` ascending
2. At each level, chips are peeled off proportionally across all players at that level
3. A `carryover` accumulator prevents chip loss when the lowest-contribution player is folded — the orphaned chips roll into the next eligible pot
4. Players eligible to win each pot are tracked separately, allowing correct multi-way side pot resolution

```
Main pot  → eligible: all non-folded players
Side pot  → eligible: players who matched the all-in amount
```

### Winner Banner Disambiguation

The winner announcement distinguishes four cases:

| Scenario | Banner Style |
|---|---|
| **Genuine tie** (`splitPotWinnerIds.length > 1`) | Indigo — "🤝 Split pot! A & B tie with [hand]" |
| **Multi-pot** (different side-pot winners) | Lists each winner with their pot label |
| **Solo winner** | Gold — "🏆 [Name] wins with [hand]!" |
| **1v1 showdown** | Shows both hands: "[PlayerA]: [hand] vs [PlayerB]: [hand]" with green/red colouring |

`splitPotWinnerIds` tracks only players who **genuinely tied the same pot** (identical hand score). `winnerIds` may include multiple players who each won a *different* side pot. The UI uses `splitPotWinnerIds` to decide whether to display "TIE!" or "WINNER!" on each player's badge.

### Chip Animation to All Winners

After `awardPot()`, chip tokens animate from `POT_CANVAS` to **every winner's** chip position staggered 180ms apart. For split pots each winner receives `pot / n` chips; for side pots each winner receives their individual pot share.

### Session Stats (`SessionStats`)

```typescript
interface SessionStats {
  handsPlayed: number;
  handsWon: number;
  biggestPot: number;
  netChips: number;
  byPosition: Record<string, { played: number; won: number }>;
}
```

Updated after each hand. Displayed in the **session dashboard** when the user busts or wins the tournament.

### Daily Challenge (`DailyChallenge`)

A rotating daily goal cycles every 24 hours. There are 6 challenge types, selected by `day-of-year mod 6`:

| Type | Description | Goal |
|---|---|---|
| `win_hands` | Win N hands today | 3 |
| `survive_rounds` | Play N hands without busting | 10 |
| `big_pot` | Win a pot over N chips | 50,000 |
| `bluff_win` | Win a hand where you had < 30% equity | 1 |
| `allin_win` | Win an all-in confrontation | 1 |
| `level_up` | Reach level N | 3 |

Progress is shown in the top-right banner. Completing a challenge awards **500 bonus XP** and a toast notification.

---

## AI System

### Player Archetypes (`bettingAI.ts`)

Each AI player is assigned an archetype based on their `skill` value:

| Archetype | Skill Range | Behaviour |
|---|---|---|
| `shark` | ≥ 0.85 | Bluffs 25%, position-aware, pot-odds-accurate, adapts to user profile |
| `balanced` | ≥ 0.65 | Bluffs 12%, moderate variance |
| `fish` | ≥ 0.35 | Bluffs 3%, ignores position, ±10% equity noise |
| `maniac` | < 0.35 | Bluffs 40%, raises randomly 30% of the time |

### Decision Pipeline (`decideAIBet`)

For each AI turn, the following pipeline runs in order:

1. **Equity lookup** — fetch pre-computed equity from `calcAllEquities()`
2. **Pot odds** — `callAmount / (pot + callAmount)` — fold if equity < pot odds
3. **SPR calculation** — `effectiveStack / pot`
   - SPR < 2: commit more readily with top pair+
   - SPR > 10: fold marginal hands more
4. **Position bonus** — sharks get +0.07 equity bonus on BTN, +0.05 on CO
5. **Fish noise** — ±10% random equity variance for fish
6. **Opponent profiling** — sharks 3-bet the user more lightly when `foldToThreeBetRate > 60%`
7. **Board texture** — post-flop bet sizing adapts to `dry / semi-wet / wet` boards
8. **GTO preflop thresholds** — position-keyed open/fold thresholds (82% fold compliance)
9. **Short-stack push/fold** — < 15 BB: only jam (if perceived equity > 44%) or fold pre-flop
10. **Maniac overrides** — 30% chance of raise regardless of hand strength
11. **Fish randomness** — 12% chance of completely random action
12. **Continuation bet** — pre-flop aggressors bet flop 60% of the time
13. **Semi-bluff** — flush draw or straight draw detected → raise 40%
14. **Pure bluff** — missed draw + ≤ 2 opponents + in position → raise at archetype bluff frequency
15. **Equity thresholds** — check/call/raise decision tree with pot-odds comparison

### GTO Preflop Open Thresholds

Position-keyed minimum equity to open, implementing a simplified range chart:

| Position | Dist | Equity Threshold | ~Open % |
|---|---|---|---|
| BTN | 0 | 0.28 | ~50% |
| CO | 7 | 0.32 | ~35% |
| HJ | 6 | 0.36 | ~25% |
| MP | 5 | 0.39 | ~18% |
| UTG+1 | 4 | 0.41 | ~14% |
| UTG | 3 | 0.43 | ~12% |
| SB | 1 | 0.30 | ~55% |
| BB | 2 | 0.22 | ~75% defend |

### Board Texture Bet Sizing

Post-flop bet sizes are scaled by board texture, measured as a fraction of pot:

| Phase / Texture | Fraction |
|---|---|
| Dry board | 0.33× pot |
| Semi-wet board | 0.55× pot |
| Wet board | 0.75× pot |
| River (strong hand) | 1.2× pot (overbet) |
| River (medium hand) | 0.75× pot |
| River (thin value) | 0.50× pot |

### Opponent Profiling

The AI tracks the user's `foldToThreeBetRate` via the `UserProfile` object in `GameState`:

```typescript
interface UserProfile {
  foldToThreeBetOpps: number;   // Times user faced a 3-bet
  foldToThreeBetCount: number;  // Times user folded to a 3-bet
  openCount: number;            // Times user raised first-in preflop
  handsDealt: number;
}
```

When the sample size exceeds 3 hands and the fold-to-3-bet rate exceeds 60%, sharks boost their 3-bet frequency by +12% against the user.

### Timing Tells

Think time is computed by `computeThinkTime()` based on the player's equity:

| Hand Strength | Think Time |
|---|---|
| Very strong (equity > 0.75) | 80–200ms (snap) |
| Very weak (equity < 0.15) | 100–250ms (snap fold) |
| Marginal (0.3–0.5 equity) | 700–1,200ms (long think) |
| Otherwise | Interpolated + skill variance |

### Speech Bubbles

On 30% of AI actions, a speech bubble appears near the player's info panel for 1.5 seconds, chosen from action-specific phrase pools:

- **Raise**: "Feeling lucky?", "Let's raise the stakes", "I like my hand"
- **Fold**: "Not my day", "I'll sit this one out"
- **Call**: "I'll see that", "Worth a look"
- **All-in**: "All in, baby!", "Everything on the line!", "Let's dance!"

### AI Memory

`bluffCount` on each `Player` tracks how many times they've been caught bluffing at showdown. AI opponents reduce their fold threshold against high-bluff players, effectively calling them lighter (`-0.02` fold chance per bluff caught, capped at `-0.10`).

---

## Equity Engine

### Monte Carlo Simulation (`winProbability.ts`)

Two simulation modes are used:

**`simFair()`** — for display equity (user vs unknown opponent hands):
- Unseen pool: `originalDeck` minus user hole cards, community cards, and burned cards
- Randomly assigns opponent hands from the unseen pool
- Simulation counts: pre-flop 2,500 | flop 1,800 | turn 1,200 | river 1,200

**`simTrue()`** — for display equity (using actual revealed opponent cards):
- Uses `state.deck` (live remaining deck) for community card completion
- Simulation counts: pre-flop 2,500 | flop 1,800 | turn 1,200 | **river: deterministic (0 sims)**

**`calcAllEquities()`** — for AI decisions:
- Runs 800 simulations with all active players' actual hole cards
- River: 1 deterministic evaluation (no sampling needed)
- Returns `Map<playerId, equityFraction>`

### Metrics Reported

- **`winPct`**: percentage of simulations where the user wins outright
- **`equityPct`**: win + (tie share × 1/n) — expected value fraction

Both `fair` (unknown opponents) and `true` (known opponents) are calculated and displayed in the user's info panel simultaneously.

### Position & Fold Probability

`foldProbability()` combines multiple factors into a 0–1 fold score:

- **Base threshold** by street: pre-flop 14%, flop 11%, turn 9%, river 7%
- **Position multiplier**: BTN 0.55× (looser), UTG 1.35× (tighter)
- **Hand quality**: `preflopHandQuality()` and `postflopHandQuality()`
- **Fish blending**: fish partially ignore position
- **Skill noise**: up to ±28% random variance for fish, 0% for sharks

---

## Rendering System

### Seat & Info Panel Layout

Cards and player info panels are rendered at **separate pixel positions**:

```typescript
const SEAT_POSITIONS: {x,y}[]  // Where hole cards render
const INFO_POSITIONS: {x,y}[]  // Where name/chip panels render
const CHIP_POSITIONS: {x,y}[]  // Where 3D chip stack visualisations render
```

### 3D Chip Stacks

Chip stacks are rendered as **individual DOM elements** with:
- Conic-gradient CSS stripes (8-segment casino pattern)
- Per-chip `box-shadow` bottom face simulating 3D depth
- Inner debossed ring + specular glint highlight
- 6 denominations: gold (25K), black (10K), purple (5K), green (1K), blue (500), red (100)

### Pot Display

The pot chip stack is rendered as soon as `pot > 0` and remains visible through all phases including blind posting. Chips animate from each player's position to the pot center with a `cubic-bezier` ease-out transition, then fade out — the static pot label and chip pile appear immediately, driven by `renderPotOnTable()`.

### Equity Sparkline

For the user's info panel, an inline SVG **equity sparkline** renders when equity data from ≥ 2 streets is available. Each street's `fair.equityPct` value is plotted as a polyline (80×24px SVG), with the current value highlighted as a coloured dot (green if > 50%, red if < 30%, yellow otherwise).

### XP Bar

The user's info panel shows a progress bar for the current XP level. The bar fills proportionally between the XP threshold for the current level and the next level. The level badge and XP/needed text are displayed inline.

```
Level 4  ████████░░  2,340 / 5,000 XP
```

### Backgrounds

Two background images are swapped at runtime:

| State | Image |
|---|---|
| Idle (before first deal) | `PokerRoom.png` — empty table, no players |
| Active game | `poker_table_players.png` — table with 3D seated players |

### Community Cards — 3D Perspective

Community cards are rendered in a CSS 3D perspective wrapper:
```css
perspective: 500px;
perspective-origin: 50% -40%;
transform: rotateX(28deg);
```

---

## Animation System

All flying animations use the **`#anim-layer`** — a `position:fixed; z-index:500` overlay appended to `document.body`, outside the canvas.

### Chip Flight to Pot (`animateChipsToPot`)

Triggered after every blind post, call, raise, or all-in:
1. Chip tokens created at screen-space position of `CHIP_POSITIONS[seatIdx]`
2. CSS `transition: transform 0.42s cubic-bezier` moves them to `POT_CANVAS`
3. Tokens fade out and self-remove after 560ms

The static pot chip stack is rendered immediately by `renderPotOnTable()` (which displays as soon as `pot > 0`), so the pot always looks correct after the animation completes.

### Chip Slide to Winner (`animateChipsToWinner`)

After `awardPot()`, 4–6 chip tokens animate from `POT_CANVAS` to the winner's `CHIP_POSITIONS` entry.

### Confetti Burst

On user win: 30 `div` particles, 6×6px, random chip colors, animate with CSS `--confetti-end` over 1.2s.

### Deal Animation

Cards are dealt one at a time to each seat using the `dealCard` keyframe:
```css
@keyframes dealCard {
  from { opacity: 0; transform: translateY(-120px) rotate(-15deg) scale(0.5); }
  to   { opacity: 1; transform: translateY(0) rotate(0deg) scale(1); }
}
```

### Showdown Reveal

At showdown, opponent cards flip in sequence with 300ms delays using the `flipCard` keyframe (rotateY 0° → 90° → 0°).

### Best-Hand Card Glow (`card-best-hand`)

At showdown, the **winning 5 cards** (the exact combination forming the best hand, from `HandResult.bestHand`) are highlighted with a pulsing gold-to-orange glow and lifted slightly. All other cards in the winner's hand dim to a secondary style.

Cards are matched by `data-rank` / `data-suit` HTML attributes against a `Set<string>` of `rank-suit` keys. Community cards that are part of the best hand are highlighted in the same pass.

```css
@keyframes bestHandPulse {
  0%, 100% { box-shadow: 0 0 0 2px #fbbf24, 0 0 14px 4px rgba(251,191,36,0.7); }
  50%       { box-shadow: 0 0 0 3px #f97316, 0 0 24px 8px rgba(249,115,22,0.8); }
}
.card-best-hand {
  animation: bestHandPulse 1.2s ease-in-out infinite;
  transform: translateY(-6px) scale(1.07);
}
```

### Bust Shake Animation (`player-busting`)

When a player's chip count reaches 0 after `awardPot()`, they are added to `recentlyBustedIds`. On the next `render()` their info panel receives the `player-busting` class, triggering a dramatic shake:

```css
@keyframes bustShake {
  0%   { transform: translate(-50%,-50%) translateX(0); }
  15%  { transform: translate(-50%,-50%) translateX(-8px) rotate(-3deg); }
  30%  { transform: translate(-50%,-50%) translateX(8px) rotate(3deg); }
  ...
}
```

The bust sound plays simultaneously. After 700ms the class is removed and the player disappears at `initHand` as normal.

---

## Audio System

All audio is synthesised via the **Web Audio API** — no audio files are loaded or bundled. Audio routes through a `DynamicsCompressorNode` → `_masterGain` → `AudioContext.destination`, and the master gain is adjustable in the settings panel.

Optional replacement audio files can be dropped into `src/renderer/assets/audio/`. See that directory's `README.md` for expected filenames and supported formats (`ogg → mp3 → wav` fallback chain).

| Sound | Trigger | Description |
|---|---|---|
| Card shuffle | Before dealing | 8–9 rapid clicks, 800–1200Hz, 30ms each |
| Chip click | Every bet/call/raise | 1200Hz triangle wave, 20ms |
| User win | User wins hand | Ascending C5→E5→G5→C6→E6 arpeggio |
| Other win | AI wins | Two-note ding (A5, C6) |
| Tie / split pot | Genuine pot split | Dual chip clinks 120ms apart (680Hz + 900Hz) |
| Bust | Player eliminated | Descending sawtooth G4→E4→C4→G3 |
| Big win cheer | User wins pot > 50K | Ascending noise burst |
| Time bank tick | ≤ 5 seconds remaining | 880Hz square-wave click each second |
| Ambient casino | First user interaction | Low-pass filtered noise loop + randomised chip sounds, runs continuously in background |

---

## UI Panels & Controls

### All-In Runout Banner

When all active (non-folded) players are all-in, an animated orange banner appears in the centre of the table:

```
🔥 All-in — Running it out
```

This persists across the Flop, Turn, and River phases until the showdown resolves.

### Action Panel

Shown only on the user's turn. Contains:

- **Time bank bar** — 30-second countdown progress bar; auto check/fold on expiry; emits a tick sound each second when ≤ 5 seconds remain
- **Pot odds row** — shown when facing a bet: "Pot odds: need X% equity · Yours: Y% ✓/✗"
- **Position badge** — displays the user's current table position (UTG, HJ, CO, BTN, SB, BB) in colour next to the stack info
- **Info line** — current pot, amount to call (or "Free to check"), user stack
- **FOLD** button
- **CHECK** or **CALL** button (label reflects call amount; upgrades to ALL-IN if stack ≤ call)
- **Bet sizing presets** — ⅓ pot, ½ pot, ¾ pot, Pot, 2× pot quick-set buttons (only shown when raising)
- **Raise group** — − button, numeric input, + button, **Pot** shortcut
- **ALL-IN** button
- Keyboard hint row: `[F] Fold  [C] Check/Call  [R] Raise  [A] All-in`

### Pre-Flop Hand Strength Hint

During the pre-flop phase, the user's hole cards display a **colour-coded strength badge** based on Monte Carlo equity:

| Label | Equity Threshold | Colour |
|---|---|---|
| Premium | ≥ 65% | Gold |
| Strong | ≥ 55% | Green |
| Playable | ≥ 45% | Blue |
| Marginal | ≥ 35% | Orange |
| Trash | < 35% | Red |

The badge disappears once community cards are dealt.

### Time Bank

A 30-second countdown starts when it is the user's turn. A yellow progress bar depletes left-to-right. When **5 seconds or fewer** remain, an 880Hz tick sound plays each second. On expiry:
- If check is available → auto check
- Otherwise → auto fold

The bank is reset and stopped immediately on any user action.

### Pot Odds Display

When the user faces a bet, the action panel shows a real-time comparison:
- **Needed equity** = `callAmount / (pot + callAmount) × 100`
- **Your equity** = current `winOdds.fair.equityPct` from Monte Carlo
- Profitable calls shown in green (✓), losing calls in red (✗)

### Bet Sizing Presets

Five quick-set buttons above the raise input snap the raise amount to a fraction or multiple of the current pot:

| Button | Raise to |
|---|---|
| ⅓ | currentBet + pot × 0.33 |
| ½ | currentBet + pot × 0.50 |
| ¾ | currentBet + pot × 0.75 |
| Pot | currentBet + pot × 1.00 |
| 2× | currentBet + pot × 2.00 |

All values are clamped to `[minRaise, player.chips]`.

### Rabbit Hunting

After folding, the **🐇 Rabbit Hunt** feature automatically reveals what cards would have come on the remaining streets:
- Cards are shown automatically 600ms after the fold, with no button press needed
- They remain visible for **3.5 seconds**, then disappear automatically
- The user can also toggle them manually via the "🐇 Rabbit Hunt" button
- Revealed cards are displayed in a dimmed, greyed overlay and do **not** affect game state — the deck is only read, not modified

### Deck Panel (collapsible, bottom-right)

Shows all 52 cards in shuffled deck order, colour-coded:
- 🔵 Blue: dealt as hole cards
- 🟢 Green: community cards
- 🔴 Red: burned cards
- ⬜ Grey: remaining in deck

> **Note**: The separate Burned Cards panel was removed. All burn card information is visible in the Deck Order panel.

### Phase Indicator (bottom-right, above Deck panel)

A row of step indicators showing the current street: Pre-Flop → Flop → Turn → River → Showdown. Highlighted in gold for the active phase. Stacked above the Deck panel with a consistent gap to avoid overlap.

### Hand History Panel (collapsible, bottom-right, above Phase Indicator)

Stores the last 5 completed hands, stacked above the Phase Indicator:
- Hand number, winner name, winning hand description, pot size
- User wins highlighted in gold

The bottom offset is computed dynamically:
```
bottomOffset = 12 + deckPanelHeight + 8 + phaseRowHeight + 8
```

### Hand Number Badge (top-left)

Displays the current hand number. Positioned at the top-left of the canvas to avoid overlap with right-side panels.

### Session Dashboard

Shown at game end (user busts or wins the tournament). Displays a 3-column stats grid:

| Hands Played | Hands Won | Win Rate |
| Best Pot | Net Chips | Level |

---

## Poker Teacher Analysis

After each hand — whether it ended at showdown or by everyone folding — a **🎓 Poker Teacher** panel appears above the "New Hand" button. It reviews every decision made during the hand and provides concrete, educational feedback.

### Decision Tracking

Every user action during the hand is recorded as a `HandDecision`:

```typescript
interface HandDecision {
  street: string;          // 'preflop' | 'flop' | 'turn' | 'river'
  action: 'call' | 'fold' | 'check' | 'raise' | 'bet' | 'allIn';
  potOdds: number;         // % equity needed to break even (0 if no bet facing)
  equity: number;          // Estimated win equity %
  potSize: number;         // Pot size at time of decision
  betFacing: number;       // Amount user had to call (0 if check/bet)
  raiseAmount: number;     // User's total raise amount (if applicable)
  communityCount: number;  // Cards on board: 0=preflop, 3=flop, 4=turn, 5=river
  wasAggressor: boolean;   // Whether user faced a bet or raise
}
```

### Analysis Rules

For each recorded decision, the teacher applies the following rules:

| Situation | Rule | Icon |
|---|---|---|
| Always (first note) | Pre-flop hand category + hole cards (Premium/Strong/Playable/Marginal/Trash) | 📖 |
| Folded with equity > needed + 10% | "Folded too often" — –EV fold | ❌ |
| Folded with equity marginally > needed | "Marginal fold" | ⚠️ |
| Folded with equity < needed | "Good fold" | ✅ |
| Called with equity < needed − 8% | "–EV call" | ❌ |
| Called with equity slightly below needed | "Slightly –EV call" | ⚠️ |
| Called with equity ≥ needed | "Correct call" | ✅ |
| Re-raised with equity ≥ 55% | "Good re-raise for value" | ✅ |
| Re-raised with equity 35–55% | "Semi-bluff raise" | 💡 |
| Re-raised with equity < 25% | "Risky raise" | ⚠️ |
| Checked with ≥ 65% equity post-flop | "Consider betting for value" | 💡 |
| Won with equity < 25% at end | "Lucky win!" | 🍀 |
| Lost with equity > 70% at end | "Bad beat" | 💔 |
| Pre-flop aggressor who missed c-bet | "Missed c-bet opportunity" | 💡 |
| No mistakes found, went to showdown | "Clean hand" | ✅ or 📖 |

The **pre-flop hand strength note** is always prepended as the first note, even when no mistakes were made. It shows the hole cards, the strength category, and a brief coaching tip on how to play that class of hand.

### Teacher Panel UI

The panel uses a dark gradient card with an indigo border:

```
┌───────────────────────────────────────────┐
│ 🎓 POKER TEACHER                  A♠ K♦  │
├───────────────────────────────────────────┤
│ ❌  Flop: –EV call                        │
│    You called needing 42% equity but had  │
│    ~28%. Over time these calls lose money. │
├───────────────────────────────────────────┤
│ 💡  Missed c-bet opportunity              │
│    As the pre-flop aggressor you should   │
│    c-bet ~60% pot to deny equity.         │
└───────────────────────────────────────────┘
```

Each note card has a **colour-coded left border** (red = mistake, green = correct, amber = tip) with a bold **headline** and a plain-English **detail explanation**. The user's hole cards are shown in the panel header for context.

### Coverage

The teacher panel is generated for **all hand endings**:
- ✅ Regular showdown (`doShowdown`)
- ✅ Hand ended by fold (`endByFold`) — reviews any decisions made before the fold

---

## Progression & Achievements

### XP & Levelling

The user earns XP for game events:

| Event | XP Awarded |
|---|---|
| Winning a hand | 100 XP |
| Winning a pot > 50,000 chips | 250 XP |
| Surviving to 3 players or fewer | 50 XP (survival bonus) |
| Completing the daily challenge | 500 XP |

XP thresholds for levels 1–10:

```typescript
const XP_LEVELS = [0, 500, 1_500, 3_000, 5_000, 8_000, 12_000, 18_000, 25_000, 35_000];
```

Level-ups trigger a toast notification. The current level and XP progress bar are always visible in the user's info panel.

### Daily Challenge

A rotating challenge refreshes each day (keyed to `day-of-year mod 6`). The current challenge title and a `X/Y` progress indicator appear in the top-right banner. Completing the challenge awards 500 bonus XP and marks the challenge as done for the day (persisted in `localStorage`).

### Achievement System

Five achievements can be unlocked during play. Each triggers a 3-second animated toast notification:

| Achievement | Trigger |
|---|---|
| 🏆 First Blood | Win your first hand |
| 🍀 Lucky Draw | Win with < 30% equity going into the river |
| 💪 Bully | Win 3 consecutive hands |
| 🎖️ Survivor | Be the last player standing (tournament win) |
| 🎭 Big Bluff | Win a pot of 50,000+ chips without the best pre-river hand |

### Chip Leader Crown

The player holding the most chips at any given moment displays a 👑 icon next to their name badge.

---

## Statistics Tracking

### VPIP / PFR (per player)

Tracked in `gameState.ts` via `applyBetAction()`:
- **VPIP** (Voluntarily Put money In Pot): incremented on any pre-flop call, raise, or all-in
- **PFR** (Pre-Flop Raise): incremented on any pre-flop raise or all-in

Displayed as a tooltip on hover over any player's name badge:
```
VPIP: 42%  |  PFR: 18%  |  Hands: 12
```

### Equity Sparkline

The user's info panel renders a live SVG sparkline of `fair.equityPct` sampled at the end of each street (pre-flop, flop, turn, river). The line shows the trend of hand strength across the hand.

### Post-Hand Equity Breakdown

After each showdown, a contextual message is shown:
- **Bad beat**: "You had X% equity — bad luck!" (user had > 60% and lost)
- **Lucky win**: "You won with only X% equity!" (user had < 30% and won)
- **Tough spot**: Shown for close-equity losses

### Session Leak Finder

After 20+ hands, the session dashboard shows a **Session Leaks** section highlighting persistent strategic mistakes:

| Leak | Threshold |
|---|---|
| Playing too many hands | VPIP > 48% |
| Playing too tight | VPIP < 14% |
| Folding to c-bets too often | Fold-to-c-bet > 72% |
| Calling c-bets too liberally | Fold-to-c-bet < 28% |
| Almost never 3-betting | 3-bet % < 4% |
| Low win rate | Win rate < 25% after 30+ hands |

---

## Save & Resume

Game state is automatically saved to `localStorage` after each hand. On startup, if a save is detected, the game resumes from where it left off and shows a toast notification confirming the resume.

```typescript
// Exposed functions from gameState.ts
saveGame(state: GameState): void    // Serialise to localStorage
loadGame(): GameState | null        // Deserialise from localStorage
clearSave(): void                   // Delete save on new game
```

Save data includes: all player chip counts, blind level, hand number, session stats, user profile, daily challenge progress, XP and level. The full deck and hand-in-progress state are **not** saved — on resume, a new hand is dealt automatically.

The **New Game** button clears the save (`clearSave()`) before resetting state.

---

## Settings Panel

The ⚙ gear button (top-right of canvas) opens an overlay settings panel:

### Volume

A slider (0–100%) controls the `_masterGain` node on the Web Audio graph, affecting all synthesised sounds in real time.

### Animation Speed

Three modes:
- **Normal** — default timing (400ms deals, 420ms chip flights)
- **Fast** — all delays halved
- **Off** — animations disabled; chips and cards appear instantly

### Card Back Style

Four card back colour themes, selectable via a 2×2 grid:

| Theme | Pattern |
|---|---|
| 🔵 Blue | `repeating-linear-gradient(45deg, #1e3a8a …)` |
| 🔴 Red | `repeating-linear-gradient(45deg, #7f1d1d …)` |
| 🟢 Green | `repeating-linear-gradient(45deg, #14532d …)` |
| 🟣 Purple | `repeating-linear-gradient(45deg, #581c87 …)` |

The selected theme is persisted in `localStorage` under the key `cardBack` and applied to all face-down cards immediately.

### Muck Losing Hands

A checkbox toggle — **Muck losing hands** — hides AI opponents' losing hole cards at showdown, replacing them with face-down card backs and a "mucked" label. This mirrors real-world etiquette where the losing player mucks without showing. The setting is persisted in `localStorage` under the key `muckLosers`.

### Save / Load / Clear

- **Save Now** — manual `saveGame()` trigger with a confirmation toast
- **Load Save** — reloads from `localStorage` (page reload)
- **Clear Save** — deletes save data with a confirmation toast

---

## Keyboard Shortcuts

When it is the user's turn, the following keys are active:

| Key | Action |
|---|---|
| `F` | Fold |
| `C` | Check (if free) or Call |
| `R` | Raise (submits current raise input amount) |
| `A` | All-in |

Keyboard hints are shown in the bottom row of the action panel.

---

## Build & Run

```bash
# Install dependencies
npm install

# Build all three Webpack targets (main, preload, renderer) and launch
npm start

# Build only
npm run build

# Individual builds
npm run build:main
npm run build:preload
npm run build:renderer
```

**Requirements**: Node.js 18+, npm 9+

---

## Configuration & Constants

Key constants in `index.ts`:

```typescript
const BASE_W = 1366;          // Canvas width (px)
const BASE_H = 768;           // Canvas height (px)
const POT_CANVAS = { x: 683, y: 469 };  // Pot chip pile anchor
const CHIP_SIZE = 26;         // Chip token diameter (px)
const CHIP_LIFT = 5;          // Vertical offset per chip in a stack (px)
const TIME_BANK_SECONDS = 30; // Auto check/fold countdown
```

Key constants in `gameState.ts`:

```typescript
const STARTING_CHIPS = 100_000;
const BLIND_LEVELS = [/* 8 levels */];
const NAMES = [/* 20 AI player name pool */];
const XP_LEVELS = [0, 500, 1_500, 3_000, 5_000, 8_000, 12_000, 18_000, 25_000, 35_000];
```

Simulation counts in `winProbability.ts`:

```typescript
const SIM_COUNTS = { preflop: 2500, flop: 1800, turn: 1200 };
const FOLD_SIMS  = 800;   // AI equity decisions
```

---

## Key Design Decisions

- **No framework** — the renderer is plain TypeScript DOM manipulation. `render()` rebuilds the entire canvas each call. Simple to reason about, no reconciliation overhead.
- **Single GameState object** — carries all session state including stats, user profile, daily challenge and XP/level. Easy to snapshot for save/resume.
- **`localStorage` persistence** — no server or file system APIs needed. Save/load is instant and survives Electron restarts.
- **`#anim-layer` persistence** — chip and confetti animations survive `render()` by living in `document.body` outside the canvas.
- **Procedural audio only** — zero audio file dependencies; all sounds are Web Audio oscillators/noise, keeping the bundle clean. Optional file-based overrides are supported.
- **GTO-inspired AI** — AI combines equity thresholds, position-aware open ranges, board texture sizing, short-stack push/fold, and opponent profiling for a realistic and adaptive challenge.
- **CSPRNG shuffle** — `crypto.getRandomValues` ensures the deck shuffle is not predictable from timing or seed attacks.
- **Rabbit hunting non-destructive** — peeking at future cards copies and slices the deck array without mutating live game state, so the hand can always continue normally.
- **Side pot carryover** — `buildSidePots()` uses a `carryover` accumulator so chips from folded all-in players are never silently dropped; they roll into the next eligible pot.
- **splitPotWinnerIds vs winnerIds** — `winnerIds` may contain multiple players who each won a *different* side pot; `splitPotWinnerIds` tracks only genuine same-pot ties, ensuring the "TIE!" badge is never shown incorrectly.
- **Poker Teacher panel** — every decision is tracked with equity and pot-odds context so the post-hand analysis can give specific, actionable feedback rather than generic tips. The first note always shows the pre-flop hand category (Premium → Trash) with coaching on how to play that class of hand.
- **Winner banner disambiguation** — three distinct banner styles (tie/split-pot, multi-pot, solo) plus a 1v1 side-by-side hand comparison eliminate ambiguity at showdown.
- **Best-hand card glow** — `HandResult.bestHand` is matched against `data-rank`/`data-suit` DOM attributes to highlight exactly the 5 cards forming the winning combination, across both hole and community cards.
- **Ambient casino audio** — a continuous low-pass noise loop with randomised chip sounds starts on first user interaction (satisfying the AudioContext autoplay policy) and runs for the duration of the session.
- **Muck losing hands** — an optional setting hides AI losing hole cards at showdown, matching real-world table etiquette, persisted in `localStorage`.
