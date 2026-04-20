import './styles.css';
import tableBg from './assets/bg.png';
import playerImg1 from './assets/player1.png';
import playerImg2 from './assets/player2.png';
import playerImg3 from './assets/player3.png';
import playerImg4 from './assets/player4.png';
import playerImg5 from './assets/player5.png';
import playerImg6 from './assets/player6.png';
import playerImg7 from './assets/player7.png';
import playerImg8 from './assets/player8.png';

// player images indexed by seat (0–7).
// Seat layout: 0=bottom-center, 1=bottom-right, 2=center-right, 3=top-right,
//              4=top-center,    5=top-left,     6=center-left,  7=bottom-left
// Image layout: player1=center-right, player2=top-right, player3=top-center,
//               player4=top-left, player5=center-left, player6=bottom-left,
//               player7=bottom-center, player8=bottom-right
const PLAYER_IMGS = [
  playerImg7,  // seat 0 — bottom-center (user)
  playerImg8,  // seat 1 — bottom-right
  playerImg1,  // seat 2 — center-right
  playerImg2,  // seat 3 — top-right
  playerImg3,  // seat 4 — top-center
  playerImg4,  // seat 5 — top-left
  playerImg5,  // seat 6 — center-left
  playerImg6,  // seat 7 — bottom-left
];
import {
  GameState, Player,
  BetAction,
  STARTING_CHIPS,
  initGame, initHand,
  dealHoleCards, dealFlop, dealTurn, dealRiver,
  evaluateHands, applyBetAction, postBlinds, awardPot,
  seatedPlayers,
  saveGame, loadGame, clearSave,
  advanceChallenge, awardXP,
  XP_LEVELS,
  getTodayChallenge,
} from './game/gameState';
import { Card, getSuitSymbol, getSuitColor } from './game/deck';
import {
  WinOdds, calcWinOdds,
  positionFromDealer, actionOrder,
} from './game/winProbability';
import { decideAIBet, calcAllEquities } from './game/bettingAI';

// ─── State ────────────────────────────────────────────────────────────────────
let state: GameState = initGame();
let dealingInProgress     = false;
let holeCardDealInProgress = false;
let winOdds: WinOdds | null = null;
let lastOddsPhase = '';
let revealedCards: Set<string> = new Set();
let thinkingPlayerId: number | null = null;
let lastActionResult: { id: number; label: string; color: string } | null = null;

// ── Deck panel UI state ──
let deckPanelExpanded = false;

// ── Hand history panel UI state ──
let historyPanelExpanded = false;

// ── Tracks whether a game has ever been started (cleared only on New Game) ──
let gameStarted = false;

// ── Animation overlay (persists across render() calls) ──
let animLayer: HTMLElement;

// ── Betting UI state ──
let isUserTurn  = false;
let raiseAmount = 0;
let userActionResolve: ((a: BetAction) => void) | null = null;

// ── Speech bubble timeouts ──
const speechBubbleTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();

// ── Hand history ──
interface HandRecord {
  handNum: number;
  winnerName: string;
  handDesc: string;
  potSize: number;
  wasUserWinner: boolean;
}
const handHistory: HandRecord[] = [];

// ── Achievements ──
const achievements: Set<string> = new Set();
let consecutiveWins = 0;

// ── Per-hand tracking ──
let userEquityAtLastStreet = 0;
let dealerJustMoved = false;

// ── Per-hand mistake / GTO tracking ──
interface HandDecision {
  street: string;
  action: 'call' | 'fold' | 'check' | 'raise' | 'bet' | 'allIn';
  potOdds: number;       // 0 if no bet to face
  equity: number;        // estimated win equity %
  potSize: number;       // pot size at time of decision
  betFacing: number;     // amount user had to call (0 if check/bet)
  raiseAmount: number;   // if user raised, by how much total
  communityCount: number; // 0=preflop,3=flop,4=turn,5=river
  wasAggressor: boolean; // was there an AI bet/raise that user faced?
}
let handDecisions: HandDecision[] = [];
let postHandNotes: string[] = [];
// Extra context captured once per hand for the teacher
let teacherCtx: {
  userHoleCards: string;
  finalHandDesc: string;
  userWon: boolean;
  finalEquity: number;
  potSize: number;
  foldedPreflop: boolean;
  wentToShowdown: boolean;
} | null = null;

// ── Time bank ──
let timeBankSeconds = 30;
let timeBankInterval: ReturnType<typeof setInterval> | null = null;

// ── Rabbit hunting ──
let rabbitCards: Card[] = [];
let showRabbit = false;

// ── Equity history (per-street, for sparkline) ──
let equityHistory: number[] = [];   // [preflop%, flop%, turn%, river%]

// ── Settings ──
let settingsOpen      = false;
type CardBack = 'blue' | 'red' | 'green' | 'purple';
let selectedCardBack: CardBack = (localStorage.getItem('cardBack') as CardBack) ?? 'blue';
type AnimSpeed = 'normal' | 'fast' | 'off';
let animSpeed: AnimSpeed = 'normal';
let masterVolume = 1.0;

// ─── Canvas dimensions (match PokerRoom.png exactly) ─────────────────────────
const BASE_W = 1366;
const BASE_H = 768;

// ─── Seat positions ───────────────────────────────────────────────────────────
const SEAT_POSITIONS = [
  { x: 683, y: 548 },  // 0 bottom-center  (user)
  { x: 958, y: 527 },  // 1 bottom-right
  { x: 1052, y: 422 }, // 2 right
  { x: 897, y: 268 },  // 3 top-right
  { x: 683, y: 222 },  // 4 top-center
  { x: 450, y: 268 },  // 5 top-left
  { x: 310, y: 388 },  // 6 left
  { x: 398, y: 527 },  // 7 bottom-left
];

const INFO_POSITIONS = [
  { x: 577, y: 568 },  // 0 bottom-center
  { x: 1098, y: 577 }, // 1 bottom-right
  { x: 1202, y: 422 }, // 2 right
  { x: 997, y: 168 },  // 3 top-right
  { x: 583, y: 122 },  // 4 top-center
  { x: 350, y: 168 },  // 5 top-left
  { x: 160, y: 388 },  // 6 left
  { x: 258, y: 577 },  // 7 bottom-left
];

const CHIP_POSITIONS = [
  { x: 695, y: 545 },  // 0 bottom-center  (↑30)
  { x: 948, y: 558 },  // 1 bottom-right   (←30)
  { x: 1058, y: 460 }, // 2 right
  { x: 848, y: 290 },  // 3 top-right      (←40)
  { x: 700, y: 292 },  // 4 top-center     (↓20)
  { x: 528, y: 290 },  // 5 top-left       (→40)
  { x: 322, y: 438 },  // 6 left
  { x: 462, y: 558 },  // 7 bottom-left    (→30)
];

// Dealer button positions — 65% interpolated from INFO_POSITIONS toward table centre (683,384)
const DEALER_CHIP_POSITIONS = [
  { x: 646, y: 448 },  // 0 bottom-center
  { x: 828, y: 452 },  // 1 bottom-right
  { x: 865, y: 397 },  // 2 right
  { x: 793, y: 308 },  // 3 top-right
  { x: 648, y: 292 },  // 4 top-center
  { x: 566, y: 308 },  // 5 top-left
  { x: 500, y: 385 },  // 6 left
  { x: 534, y: 452 },  // 7 bottom-left
];

// ─── Chip stack visualisation ─────────────────────────────────────────────────
const CHIP_DENOMS = [
  { value: 25_000, color: '#f59e0b', stripe: '#fef3c7', dark: '#92400e' },
  { value: 10_000, color: '#374151', stripe: '#d1d5db', dark: '#111827' },
  { value:  5_000, color: '#7c3aed', stripe: '#ede9fe', dark: '#4c1d95' },
  { value:  1_000, color: '#16a34a', stripe: '#dcfce7', dark: '#14532d' },
  { value:    500, color: '#1d4ed8', stripe: '#dbeafe', dark: '#1e3a8a' },
  { value:    100, color: '#dc2626', stripe: '#fee2e2', dark: '#7f1d1d' },
];

const CHIP_SIZE = 26;
const CHIP_LIFT = 5;

function makeChip(d: typeof CHIP_DENOMS[0], index: number): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:absolute;left:0;',
    `bottom:${index * CHIP_LIFT}px;`,
    `width:${CHIP_SIZE}px;height:${CHIP_SIZE}px;`,
    'border-radius:50%;',
    `background:conic-gradient(`,
    `  ${d.color} 0deg 25deg, ${d.stripe} 25deg 50deg,`,
    `  ${d.color} 50deg 115deg, ${d.stripe} 115deg 140deg,`,
    `  ${d.color} 140deg 205deg, ${d.stripe} 205deg 230deg,`,
    `  ${d.color} 230deg 295deg, ${d.stripe} 295deg 320deg,`,
    `  ${d.color} 320deg 360deg);`,
    `border:2px solid ${d.dark};`,
    `box-shadow:`,
    `  0 ${CHIP_LIFT}px 0 ${d.dark},`,
    `  0 ${CHIP_LIFT + 3}px 6px rgba(0,0,0,0.55),`,
    `  inset 0 2px 5px rgba(255,255,255,0.40),`,
    `  inset 0 -2px 4px rgba(0,0,0,0.30);`,
  ].join('');

  const ring = document.createElement('div');
  ring.style.cssText = [
    'position:absolute;border-radius:50%;pointer-events:none;',
    `top:4px;left:4px;`,
    `width:${CHIP_SIZE - 8}px;height:${CHIP_SIZE - 8}px;`,
    'border:1.5px solid rgba(255,255,255,0.28);',
    'box-shadow:inset 0 1px 3px rgba(0,0,0,0.35);',
  ].join('');
  el.appendChild(ring);

  const glint = document.createElement('div');
  glint.style.cssText = [
    'position:absolute;border-radius:50%;pointer-events:none;',
    'top:3px;left:5px;width:8px;height:5px;',
    'background:radial-gradient(ellipse at center,rgba(255,255,255,0.55) 0%,transparent 100%);',
    'transform:rotate(-30deg);',
  ].join('');
  el.appendChild(glint);

  return el;
}

function renderChipStack(chips: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:5px;align-items:flex-end;';

  let remaining = chips;
  for (const d of CHIP_DENOMS) {
    if (remaining <= 0) break;
    const count = Math.min(Math.floor(remaining / d.value), 8);
    if (count === 0) continue;
    remaining -= count * d.value;

    const stackH = CHIP_SIZE + (count - 1) * CHIP_LIFT + CHIP_LIFT + 3;
    const col = document.createElement('div');
    col.style.cssText = `position:relative;width:${CHIP_SIZE}px;height:${stackH}px;cursor:default;flex-shrink:0;`;
    col.title = `${count}× ${d.value.toLocaleString('en-US')}`;

    for (let i = 0; i < count; i++) col.appendChild(makeChip(d, i));
    wrap.appendChild(col);
  }
  return wrap;
}

function renderChipStackOnTable(player: Player, pos: { x: number; y: number }): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    `position:absolute;left:${pos.x}px;top:${pos.y}px;`,
    'transform:translate(-50%,-100%);',
    'display:flex;flex-direction:column;align-items:center;gap:2px;',
    'z-index:8;pointer-events:none;',
  ].join('');

  if (player.isBusted) return el;

  if (player.isAllIn) {
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:10px;color:#f97316;font-weight:700;background:rgba(0,0,0,0.6);padding:1px 5px;border-radius:4px;';
    lbl.textContent = 'ALL-IN';
    el.appendChild(lbl);
    return el;
  }

  el.appendChild(renderChipStack(player.chips));

  return el;
}

// ─── Canvas → screen coordinate helper ───────────────────────────────────────
function canvasToScreen(cx: number, cy: number): { x: number; y: number } {
  const scale = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
  const tx    = (window.innerWidth  - BASE_W * scale) / 2;
  const ty    = (window.innerHeight - BASE_H * scale) / 2;
  return { x: tx + cx * scale, y: ty + cy * scale };
}

const POT_CANVAS = { x: 683, y: 469 };

function animateChipsToPot(seatIdx: number, amount: number): void {
  if (amount <= 0 || !animLayer) return;

  const scale  = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
  const cSize  = Math.round(CHIP_SIZE * scale);

  const fromS  = canvasToScreen(CHIP_POSITIONS[seatIdx].x, CHIP_POSITIONS[seatIdx].y - CHIP_SIZE);
  const toS    = canvasToScreen(POT_CANVAS.x, POT_CANVAS.y);

  const denom  = CHIP_DENOMS.find(d => d.value <= amount) ?? CHIP_DENOMS[CHIP_DENOMS.length - 1];
  const nChips = Math.min(4, Math.max(1, Math.floor(Math.log2(amount / (denom.value / 2) + 1))));

  // Play chip sound
  playChipSound();

  const tokens: HTMLElement[] = [];

  for (let i = 0; i < nChips; i++) {
    const token = document.createElement('div');
    const spread = (i - (nChips - 1) / 2) * (cSize * 0.55);

    token.style.cssText = [
      'position:fixed;border-radius:50%;pointer-events:none;z-index:500;',
      `width:${cSize}px;height:${cSize}px;`,
      `left:${fromS.x - cSize / 2 + spread}px;`,
      `top:${fromS.y  - cSize / 2}px;`,
      `background:conic-gradient(`,
      `  ${denom.color} 0deg 25deg,  ${denom.stripe} 25deg 50deg,`,
      `  ${denom.color} 50deg 115deg, ${denom.stripe} 115deg 140deg,`,
      `  ${denom.color} 140deg 205deg,${denom.stripe} 205deg 230deg,`,
      `  ${denom.color} 230deg 295deg,${denom.stripe} 295deg 320deg,`,
      `  ${denom.color} 320deg 360deg);`,
      `border:${Math.max(1, Math.round(scale * 2))}px solid ${denom.dark};`,
      'box-shadow:0 2px 6px rgba(0,0,0,0.55);',
      'transition:none;will-change:transform,opacity;',
    ].join('');

    animLayer.appendChild(token);
    tokens.push(token);
  }

  requestAnimationFrame(() => requestAnimationFrame(() => {
    tokens.forEach((token, i) => {
      const spread = (i - (nChips - 1) / 2) * (cSize * 0.55);
      const dx = toS.x - (fromS.x + spread);
      const dy = toS.y - fromS.y;
      // Slide in (ease-out), then fade out quickly once landed so the static pot display shows through
      token.style.transition = 'transform 0.38s ease-out, opacity 0.2s 0.36s ease-in';
      token.style.transform  = `translate(${dx}px,${dy}px)`;
      token.style.opacity    = '0';
    });

    setTimeout(() => tokens.forEach(t => t.remove()), 600);
  }));
}

/** Animate chips from POT to a winner's seat position */
function animateChipsToWinner(winnerId: number, potAmount: number): void {
  if (potAmount <= 0 || !animLayer) return;

  const scale  = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
  const cSize  = Math.round(CHIP_SIZE * scale);

  const fromS  = canvasToScreen(POT_CANVAS.x, POT_CANVAS.y);
  const toS    = canvasToScreen(CHIP_POSITIONS[winnerId].x, CHIP_POSITIONS[winnerId].y - CHIP_SIZE);

  const denom  = CHIP_DENOMS.find(d => d.value <= potAmount) ?? CHIP_DENOMS[CHIP_DENOMS.length - 1];
  const nChips = Math.min(6, Math.max(4, Math.floor(Math.log2(potAmount / (denom.value / 2) + 1))));

  const tokens: HTMLElement[] = [];
  for (let i = 0; i < nChips; i++) {
    const token = document.createElement('div');
    const spread = (i - (nChips - 1) / 2) * (cSize * 0.55);

    token.style.cssText = [
      'position:fixed;border-radius:50%;pointer-events:none;z-index:500;',
      `width:${cSize}px;height:${cSize}px;`,
      `left:${fromS.x - cSize / 2 + spread}px;`,
      `top:${fromS.y  - cSize / 2}px;`,
      `background:conic-gradient(`,
      `  ${denom.color} 0deg 25deg,  ${denom.stripe} 25deg 50deg,`,
      `  ${denom.color} 50deg 115deg, ${denom.stripe} 115deg 140deg,`,
      `  ${denom.color} 140deg 205deg,${denom.stripe} 205deg 230deg,`,
      `  ${denom.color} 230deg 295deg,${denom.stripe} 295deg 320deg,`,
      `  ${denom.color} 320deg 360deg);`,
      `border:${Math.max(1, Math.round(scale * 2))}px solid ${denom.dark};`,
      'box-shadow:0 2px 6px rgba(0,0,0,0.55);',
      'transition:none;will-change:transform,opacity;',
    ].join('');
    animLayer.appendChild(token);
    tokens.push(token);
  }

  requestAnimationFrame(() => requestAnimationFrame(() => {
    tokens.forEach((token, i) => {
      const spread = (i - (nChips - 1) / 2) * (cSize * 0.55);
      const delay  = i * 30;
      const dx = toS.x - (fromS.x + spread);
      const dy = toS.y - fromS.y;
      token.style.transition = `transform 0.5s ${delay}ms cubic-bezier(0.2,0.8,0.3,1), opacity 0.15s ${delay + 400}ms`;
      token.style.transform  = `translate(${dx}px,${dy}px)`;
      token.style.opacity    = '0';
      // Chips stacking sound as each chip arrives
      setTimeout(() => playChipsStack(), delay + 500);
    });
    setTimeout(() => tokens.forEach(t => t.remove()), 650);
  }));
}

/** Burst confetti from pot centre when user wins */
function burstConfetti(): void {
  if (!animLayer) return;
  const potS = canvasToScreen(POT_CANVAS.x, POT_CANVAS.y);
  const colors = ['#f59e0b', '#374151', '#7c3aed', '#16a34a', '#1d4ed8', '#dc2626'];

  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'confetti-particle';
    const dx = (Math.random() - 0.5) * 300;
    const dy = -(Math.random() * 200 + 80);
    const color = colors[Math.floor(Math.random() * colors.length)];
    particle.style.cssText = [
      `left:${potS.x}px;top:${potS.y}px;`,
      `background:${color};`,
      `--confetti-end: translate(${dx}px, ${dy}px) rotate(${Math.random() * 720}deg);`,
      `animation-delay:${Math.random() * 0.3}s;`,
      `animation-duration:${0.9 + Math.random() * 0.6}s;`,
    ].join('');
    animLayer.appendChild(particle);
    setTimeout(() => particle.remove(), 1800);
  }
}

// ─── Speech bubbles ───────────────────────────────────────────────────────────
const SPEECH_PHRASES: Record<string, string[]> = {
  raise: ["Feeling lucky?", "Let's raise the stakes", "I like my hand"],
  fold:  ["Not my day", "I'll sit this one out"],
  call:  ["I'll see that", "Worth a look"],
  allIn: ["All in, baby!", "Everything on the line!", "Let's dance!"],
  check: ["Checking it over", "Let's see what comes"],
};

function showSpeechBubble(playerId: number, actionType: string): void {
  if (Math.random() > 0.30) return; // 30% chance
  const phrases = SPEECH_PHRASES[actionType] ?? SPEECH_PHRASES['call'];
  const text    = phrases[Math.floor(Math.random() * phrases.length)];

  // Clear existing bubble for this player
  const existing = document.getElementById(`speech-${playerId}`);
  if (existing) existing.remove();
  const existingTimer = speechBubbleTimers.get(playerId);
  if (existingTimer) clearTimeout(existingTimer);

  const infoPos = INFO_POSITIONS[playerId];
  const bubble  = document.createElement('div');
  bubble.id = `speech-${playerId}`;
  bubble.className = 'speech-bubble';
  bubble.textContent = text;
  bubble.style.left = `${infoPos.x}px`;
  bubble.style.top  = `${infoPos.y - 48}px`;
  bubble.style.transform = 'translate(-50%, -100%)';

  const canvas = document.getElementById('game-canvas');
  if (canvas) canvas.appendChild(bubble);

  const timer = setTimeout(() => {
    bubble.remove();
    speechBubbleTimers.delete(playerId);
  }, 1500);
  speechBubbleTimers.set(playerId, timer);
}

// ─── Achievement system ───────────────────────────────────────────────────────
function unlockAchievement(id: string, name: string): void {
  if (achievements.has(id)) return;
  achievements.add(id);
  showAchievementToast(`🏆 Achievement: ${name}!`);
}

function showToast(message: string, duration = 3000): void {
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function showAchievementToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'achievement-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function cardKey(card: Card): string { return `${card.rank}-${card.suit}`; }

function actionLabel(a: BetAction): string {
  switch (a.type) {
    case 'fold':  return 'FOLD';
    case 'check': return 'CHECK';
    case 'call':  return 'CALL';
    case 'raise': return `RAISE ${fmt(a.amount ?? 0)}`;
    case 'allIn': return 'ALL-IN';
  }
}

function actionColor(a: BetAction): string {
  switch (a.type) {
    case 'fold':  return '#ef4444';
    case 'check': return '#60a5fa';
    case 'call':  return '#4ade80';
    case 'raise': return '#f59e0b';
    case 'allIn': return '#f97316';
  }
}

// ─── Dynamic position labels ──────────────────────────────────────────────────
const DYNAMIC_POS_LABELS: Record<number, string[]> = {
  2: ['BTN/SB', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'UTG'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
};

const POS_COLOR: Record<string, string> = {
  'BTN': '#fbbf24', 'BTN/SB': '#fbbf24',
  'SB': '#f87171', 'BB': '#fb923c',
  'UTG': '#9ca3af', 'UTG+1': '#9ca3af', 'MP': '#9ca3af',
  'HJ': '#60a5fa', 'CO': '#34d399',
};

function getPositionLabel(player: Player, gs: GameState): string {
  if (player.isBusted) return '';
  const seated = gs.players
    .filter(p => !p.isBusted)
    .map(p => ({ p, d: positionFromDealer(p.position, gs.dealerButtonPosition) }))
    .sort((a, b) => (a.d === 0 ? 8 : a.d) - (b.d === 0 ? 8 : b.d));
  const n = seated.length;
  if (n < 2) return '';
  const labels = DYNAMIC_POS_LABELS[n] ?? DYNAMIC_POS_LABELS[8];
  const rank   = seated.findIndex(s => s.p.id === player.id);
  if (rank === -1) return '';
  return labels[rank === n - 1 ? 0 : rank + 1] ?? '';
}

// ─── Sound Engine ─────────────────────────────────────────────────────────────
// All sounds are generated via Web Audio API synthesis.
// To use real audio files instead, place .ogg/.mp3/.wav files in
//   src/renderer/assets/audio/
// with these names (all optional — synthesis is used as fallback):
//   card-deal.ogg  card-flip.ogg  chip-click.ogg  chip-shuffle.ogg
//   win-small.ogg  win-big.ogg    bust.ogg
//
// Free sound resources:
//   • kenney.nl/assets/casino-audio  — CC0, purpose-built poker/casino pack
//   • freesound.org                  — search "card deal", "poker chip", "casino"
//   • opengameart.org                — search "card game sounds"
//   • mixkit.co/free-sound-effects/casino/ — free, no attribution needed
//   • zapsplat.com                   — free account required
// ──────────────────────────────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null;
let _masterGain: GainNode | null   = null;

function audioCtx(): AudioContext {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx   = new AudioContext();
    _masterGain = _audioCtx.createGain();
    _masterGain.gain.value = 1;
    // Dynamics compressor prevents clipping when multiple sounds overlap
    const comp = _audioCtx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value      =  10;
    comp.ratio.value     =   4;
    comp.attack.value    = 0.003;
    comp.release.value   = 0.25;
    _masterGain.connect(comp);
    comp.connect(_audioCtx.destination);
  }
  return _audioCtx;
}

function masterOut(): AudioNode { audioCtx(); return _masterGain!; }

/** Oscillator tone — for melodic/tonal sounds */
function beep(freq: number, when: number, dur: number, vol = 0.24, type: OscillatorType = 'sine'): void {
  try {
    const ctx  = audioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime + when);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
    osc.connect(gain); gain.connect(masterOut());
    osc.start(ctx.currentTime + when);
    osc.stop(ctx.currentTime + when + dur + 0.06);
  } catch { /* AudioContext blocked */ }
}

/** White-noise burst through a biquad filter — for card/chip texture */
function noise(
  when: number, dur: number, vol: number,
  filterHz: number, Q = 4,
  filterType: BiquadFilterType = 'bandpass'
): void {
  try {
    const ctx = audioCtx();
    const len = Math.ceil(ctx.sampleRate * (dur + 0.07));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const src  = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType; filt.frequency.value = filterHz; filt.Q.value = Q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime + when);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);

    src.connect(filt); filt.connect(gain); gain.connect(masterOut());
    src.start(ctx.currentTime + when);
    src.stop(ctx.currentTime + when + dur + 0.08);
  } catch { /* ignore */ }
}

// ─── Optional file-based audio (graceful fallback to synthesis) ───────────────
const _bufCache = new Map<string, AudioBuffer | null>();

function _loadBuf(name: string): void {
  // Non-blocking: try ogg → mp3 → wav in order
  const exts = ['ogg', 'mp3', 'wav'];
  (async () => {
    for (const ext of exts) {
      try {
        const res = await fetch(`./assets/audio/${name}.${ext}`);
        if (!res.ok) continue;
        const ab  = await res.arrayBuffer();
        const buf = await audioCtx().decodeAudioData(ab);
        _bufCache.set(name, buf);
        return;
      } catch { /* try next ext */ }
    }
    _bufCache.set(name, null); // file not found — use synthesis
  })();
}

function tryBuf(name: string, vol = 1): boolean {
  const buf = _bufCache.get(name);
  if (!buf) return false; // null = failed, undefined = still loading → use synthesis
  try {
    const ctx = audioCtx();
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g   = ctx.createGain(); g.gain.value = vol;
    src.connect(g); g.connect(masterOut());
    src.start(ctx.currentTime);
  } catch { /* ignore */ }
  return true;
}

/** Play a random variant from an array of buffer names. Returns true if played. */
function tryBufPick(names: string[], vol = 1): boolean {
  const loaded = names.filter(n => _bufCache.get(n) != null);
  if (loaded.length === 0) return false;
  return tryBuf(loaded[Math.floor(Math.random() * loaded.length)], vol);
}

// Helper: expand "prefix-1" … "prefix-N" into an array of names
function _range(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`);
}

// Pre-warm cache — load all real asset files on startup
setTimeout(() => {
  const files = [
    'card-shuffle',
    ..._range('card-slide', 8),
    ..._range('card-place', 4),
    ..._range('card-fan', 2),
    ..._range('card-shove', 4),
    ..._range('chip-lay', 3),
    ..._range('chips-collide', 4),
    ..._range('chips-handle', 6),
    ..._range('chips-stack', 6),
  ];
  files.forEach(n => _loadBuf(n));
}, 800);

// ─── Sound functions ───────────────────────────────────────────────────────────

/** Single card deal — random card-slide variant */
function playCardDeal(): void {
  if (tryBufPick(_range('card-slide', 8), 0.8)) return;
  noise(0,  0.055, 0.30, 4500, 2, 'highpass');
  noise(0,  0.022, 0.16, 1400, 6);
  beep(105, 0.018, 0.06, 0.15, 'sine');
}

/** Community card placed on board — random card-place variant */
function playCardFlip(): void {
  if (tryBufPick(_range('card-place', 4), 0.82)) return;
  noise(0,     0.032, 0.24, 5500, 1.5, 'highpass');
  noise(0.015, 0.018, 0.12, 2000, 5);
  beep(90,     0.022, 0.05, 0.12, 'sine');
}

/** Showdown card reveal — random card-fan variant */
function playCardFanFlip(): void {
  if (tryBufPick(_range('card-fan', 2), 0.80)) return;
  playCardFlip();
}

/** Chip call — random chip-lay variant */
function playChipSound(): void {
  if (tryBufPick(_range('chip-lay', 3), 0.85)) return;
  noise(0,   0.026, 0.22, 2400, 10);
  beep(1900, 0,     0.010, 0.08, 'triangle');
  beep(950,  0.008, 0.016, 0.04, 'triangle');
}

/** Raise / aggressive bet — random chips-collide variant */
function playChipRaise(): void {
  if (tryBufPick(_range('chips-collide', 4), 0.85)) return;
  noise(0,   0.030, 0.28, 2800, 8);
  beep(1600, 0,     0.014, 0.10, 'triangle');
}

/** Chips being stacked by winner — random chips-stack variant */
function playChipsStack(): void {
  if (tryBufPick(_range('chips-stack', 6), 0.85)) return;
  noise(0, 0.06, 0.20, 2000, 6);
}

/** Card fold — random card-shove variant */
function playCardFold(): void {
  if (tryBufPick(_range('card-shove', 4), 0.72)) return;
  noise(0, 0.030, 0.18, 3500, 2, 'highpass');
}

/** Rapid card shuffle before dealing */
function playShuffleSound(): void {
  if (tryBuf('card-shuffle', 0.9)) return;
  for (let i = 0; i < 11; i++) {
    const t   = i * 0.052;
    const fHz = 3000 + Math.random() * 4000;
    noise(t,        0.040, 0.18 + Math.random() * 0.07, fHz, 2.5, 'highpass');
    noise(t + 0.01, 0.016, 0.10, 1400 + Math.random() * 600, 5);
    if (i % 4 === 0) beep(75 + Math.random() * 30, t + 0.012, 0.035, 0.09, 'sine');
  }
}

/** AI or non-user player wins — random chips-handle variant */
function playSoundWinner(): void {
  if (tryBufPick(_range('chips-handle', 6), 0.75)) return;
  beep(880,  0.00, 0.14, 0.20);
  beep(1047, 0.13, 0.18, 0.17);
  beep(1319, 0.28, 0.22, 0.14);
  noise(0, 0.06, 0.07, 7000, 1, 'highpass');
}

/** Player bust (knocked out) */
function playSoundBust(): void {
  [392, 330, 262, 196].forEach((freq, i) => {
    const t = i * 0.22;
    beep(freq,       t, 0.20, 0.24, 'sawtooth');
    beep(freq * 0.5, t, 0.20, 0.09, 'sine');
  });
  noise(0.88, 0.18, 0.12, 110, 3, 'lowpass');
  beep(62,    0.92, 0.42, 0.22, 'sine');
}

/** User wins a normal pot — chips-stack fanfare */
function playSoundUserWin(): void {
  if (tryBufPick(_range('chips-stack', 6), 0.95)) return;
  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((f, i) => {
    const t = i * 0.135;
    beep(f,       t,        0.26, 0.19);
    beep(f * 2,   t,        0.14, 0.05);
    beep(f * 1.5, t + 0.05, 0.10, 0.04);
  });
  [523, 659, 784, 1047].forEach(f => beep(f, 0.78, 0.65, 0.13));
  noise(0.76, 0.09, 0.06, 8000, 1, 'highpass');
}

/** Big win fanfare (pot > 50k) — two stacked chip sounds + synth */
function playBigWinSound(): void {
  // Layer two different chips-stack sounds for a bigger feel
  const stackNames = _range('chips-stack', 6);
  tryBufPick(stackNames, 1.0);
  setTimeout(() => tryBufPick(stackNames, 0.7), 180);
  const seq = [392, 494, 587, 698, 880, 1047, 1319, 1568];
  seq.forEach((f, i) => {
    const t = i * 0.085;
    beep(f,       t,        0.20, 0.20);
    beep(f * 1.5, t + 0.03, 0.12, 0.06);
    beep(f * 2,   t,        0.10, 0.04);
  });
  noise(0.50, 0.22, 0.10, 8000, 1, 'highpass');
  [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => beep(f, 0.82 + i * 0.015, 1.1, 0.13));
}

let ambientStarted = false;

function playHandEndSounds(winnerIds: number[], userPlayer: Player): void {
  const userWon  = winnerIds.includes(userPlayer.id);
  const userBust = !userWon && userPlayer.chips <= 0;
  if (userWon) {
    if (state.pot > 50000) playBigWinSound();
    else playSoundUserWin();
  } else if (userBust) playSoundBust();
  else                 playSoundWinner();
}

// ─── Betting round helpers ────────────────────────────────────────────────────
function getNextToAct(gs: GameState): Player | null {
  const candidates = gs.players.filter(p => !p.isFolded && !p.isBusted && !p.isAllIn && !p.hasActed);
  if (candidates.length === 0) return null;

  const withOrder = candidates.map(p => ({
    p,
    order: actionOrder(positionFromDealer(p.position, gs.dealerButtonPosition), gs.phase),
  }));

  if (gs.lastAggressorId !== null) {
    const agg = gs.players.find(p => p.id === gs.lastAggressorId);
    if (agg) {
      const aggOrder = actionOrder(positionFromDealer(agg.position, gs.dealerButtonPosition), gs.phase);
      withOrder.sort((a, b) => {
        const da = (a.order - aggOrder - 1 + 8) % 8;
        const db = (b.order - aggOrder - 1 + 8) % 8;
        return da - db;
      });
      return withOrder[0].p;
    }
  }

  withOrder.sort((a, b) => a.order - b.order);
  return withOrder[0].p;
}

function isRoundComplete(gs: GameState): boolean {
  const mustAct = gs.players.filter(p => !p.isFolded && !p.isBusted && !p.isAllIn);
  return mustAct.every(p => p.hasActed);
}

function activePlayers(gs: GameState): Player[] {
  return gs.players.filter(p => !p.isFolded && !p.isBusted);
}

// ─── Card rendering ───────────────────────────────────────────────────────────
const CARD_BACK_STYLES: Record<CardBack, string> = {
  blue:   'repeating-linear-gradient(45deg,#1e3a8a,#1e3a8a 3px,#1e40af 3px,#1e40af 6px)',
  red:    'repeating-linear-gradient(45deg,#7f1d1d,#7f1d1d 3px,#991b1b 3px,#991b1b 6px)',
  green:  'repeating-linear-gradient(45deg,#14532d,#14532d 3px,#15803d 3px,#15803d 6px)',
  purple: 'repeating-linear-gradient(45deg,#4c1d95,#4c1d95 3px,#6d28d9 3px,#6d28d9 6px)',
};
const CARD_BACK_BORDER: Record<CardBack, string> = {
  blue:'#93c5fd', red:'#fca5a5', green:'#86efac', purple:'#c4b5fd',
};

function createCardEl(card: Card, faceUp: boolean, extraClass = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `card ${faceUp ? 'card-face' : 'card-back'} ${extraClass}`;
  if (faceUp) {
    el.style.color = getSuitColor(card.suit);
    el.innerHTML = `
      <div style="position:absolute;top:3px;left:5px;font-size:13px;line-height:1;">${card.rank}</div>
      <div style="font-size:22px;">${getSuitSymbol(card.suit)}</div>
      <div style="position:absolute;bottom:3px;right:5px;font-size:13px;line-height:1;transform:rotate(180deg);">${card.rank}</div>`;
  } else {
    // Apply selected card back colour
    el.style.background = CARD_BACK_STYLES[selectedCardBack];
    el.style.border      = `2px solid ${CARD_BACK_BORDER[selectedCardBack]}`;
    el.innerHTML = `<div style="width:40px;height:60px;border:1px solid rgba(255,255,255,0.12);border-radius:3px;"></div>`;
  }
  return el;
}

// ─── Busted / empty seat ──────────────────────────────────────────────────────
function renderEmptySeat(player: Player, pos: typeof SEAT_POSITIONS[0]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:absolute;top:${pos.y}px;left:${pos.x}px;transform:translate(-50%,-50%);z-index:10;display:flex;flex-direction:column;align-items:center;gap:3px;opacity:0.25;pointer-events:none;`;
  const nameEl = document.createElement('div');
  nameEl.style.cssText = 'background:rgba(0,0,0,0.5);border:1px dashed rgba(255,255,255,0.2);color:#6b7280;padding:3px 8px;border-radius:6px;font-size:12px;white-space:nowrap;';
  nameEl.textContent = player.name;
  const outEl = document.createElement('div');
  outEl.style.cssText = 'font-size:10px;color:#ef4444;font-weight:700;letter-spacing:1px;';
  outEl.textContent = 'OUT';
  wrap.appendChild(nameEl);
  wrap.appendChild(outEl);
  return wrap;
}

// ─── Player cards rendering ───────────────────────────────────────────────────
function renderPlayerCards(player: Player, pos: typeof SEAT_POSITIONS[0]): HTMLElement {
  const wrap = document.createElement('div');
  if (player.isBusted) return wrap;

  const isWinner        = state.winnerIds.includes(player.id);
  const isLoser         = state.phase === 'showdown' && state.winnerIds.length > 0 && !isWinner && !player.isFolded;
  const foldedTransform = player.isFolded ? 'translate(-50%,-50%) scale(0.769)' : 'translate(-50%,-50%)';
  const foldedStyle     = player.isFolded ? 'opacity:0.4;filter:grayscale(0.8);' : '';
  wrap.style.cssText = `position:absolute;top:${pos.y}px;left:${pos.x}px;transform:${foldedTransform};z-index:10;pointer-events:none;transition:opacity 0.2s ease,filter 0.2s ease;${foldedStyle}`;

  // cardsEl is the container used by deal animation via ID
  const cardsEl = document.createElement('div');
  cardsEl.className = 'flex gap-1';
  cardsEl.id = `player-cards-${player.id}`;
  cardsEl.style.pointerEvents = 'auto';

  if (!holeCardDealInProgress && player.holeCards.length > 0) {
    if (player.isFolded && !player.isUser) {
      // ── AI folded: show card BACKS by default, reveal faces on hover ─────
      const backRow = document.createElement('div');
      backRow.className = 'flex gap-1';
      const faceRow = document.createElement('div');
      faceRow.className = 'flex gap-1';
      faceRow.style.display = 'none';

      for (const card of player.holeCards) {
        backRow.appendChild(createCardEl(card, false));  // back side
        faceRow.appendChild(createCardEl(card, true));   // face side
      }
      cardsEl.appendChild(backRow);
      cardsEl.appendChild(faceRow);

      cardsEl.addEventListener('mouseenter', () => {
        backRow.style.display = 'none';
        faceRow.style.display = 'flex';
        wrap.style.opacity = '0.9';
        wrap.style.filter  = 'none';
      });
      cardsEl.addEventListener('mouseleave', () => {
        backRow.style.display = 'flex';
        faceRow.style.display = 'none';
        wrap.style.opacity = '0.4';
        wrap.style.filter  = 'grayscale(0.8)';
      });
    } else {
      // ── Normal (non-folded) card rendering ───────────────────────────────
      const alwaysFaceUp = player.isUser || state.phase === 'showdown';
      for (const card of player.holeCards) {
        const key    = cardKey(card);
        const faceUp = alwaysFaceUp || revealedCards.has(key);
        const cardEl = createCardEl(card, faceUp);
        if (isLoser) cardEl.classList.add('card-loser');
        if (!player.isUser && state.phase !== 'idle' && state.phase !== 'showdown') {
          cardEl.style.cursor = 'pointer';
          cardEl.addEventListener('click', () => {
            revealedCards.has(key) ? revealedCards.delete(key) : revealedCards.add(key);
            render();
          });
        }
        cardsEl.appendChild(cardEl);
      }
      if (isWinner && state.phase === 'showdown') {
        cardsEl.querySelectorAll<HTMLElement>('.card').forEach(c => c.classList.add('card-winner'));
      }
    }
  }

  wrap.appendChild(cardsEl);
  return wrap;
}

// ─── Player info panel rendering ──────────────────────────────────────────────
function renderPlayerInfo(player: Player, pos: typeof INFO_POSITIONS[0]): HTMLElement {
  if (player.isBusted) return renderEmptySeat(player, pos);

  const isWinner   = state.winnerIds.includes(player.id);
  const isThinking = player.id === thinkingPlayerId;
  const isMyTurn   = isUserTurn && player.isUser;

  // Chip leader detection
  const maxChips = Math.max(...state.players.filter(p => !p.isBusted).map(p => p.chips));
  const isChipLeader = player.chips === maxChips && maxChips > 0;

  const wrap = document.createElement('div');
  // No 'folded' class on the info panel — folding only dims the card wrap, not the name/chips
  wrap.className = `player-seat absolute flex flex-col items-center gap-1 ${isWinner ? 'winner' : ''}`;
  wrap.id = `player-${player.id}`;
  wrap.style.cssText = `top:${pos.y}px;left:${pos.x}px;transform:translate(-50%,-50%);z-index:10;`;
  if (isMyTurn) wrap.style.cssText += 'filter:drop-shadow(0 0 14px #facc15);';

  const info = document.createElement('div');
  info.className = 'flex flex-col items-center';

  const posLabel = getPositionLabel(player, state);
  const posColor = POS_COLOR[posLabel] ?? '#9ca3af';
  const showPos  = state.phase !== 'idle';

  // Name row with tooltip for VPIP/PFR/Hands
  const nameEl = document.createElement('div');
  nameEl.className = 'player-name-badge';
  const border  = player.isUser
    ? 'background:rgba(37,99,235,0.8);border:2px solid #60a5fa;'
    : 'background:rgba(0,0,0,0.7);border:1px solid rgba(255,255,255,0.2);';
  nameEl.style.cssText = `${border}color:white;padding:3px 8px;border-radius:6px;font-size:13px;font-weight:600;white-space:nowrap;display:flex;align-items:center;gap:5px;position:relative;cursor:default;`;

  // Crown for chip leader
  if (isChipLeader && !player.isBusted && seatedPlayers(state).length > 1) {
    const crown = document.createElement('span');
    crown.textContent = '👑';
    crown.style.cssText = 'font-size:10px;';
    nameEl.appendChild(crown);
  }

  nameEl.appendChild(Object.assign(document.createElement('span'), { textContent: player.name }));

  if (showPos && posLabel) {
    const pb = document.createElement('span');
    pb.style.cssText = `font-size:9px;font-weight:700;color:${posColor};letter-spacing:0.5px;opacity:0.9;`;
    pb.textContent = posLabel;
    nameEl.appendChild(pb);
  }

  if (!player.isUser && showPos) {
    const skill = player.skill;
    const archIcon = player.archetype === 'shark' ? '🦈'
                   : player.archetype === 'maniac' ? '😈'
                   : player.archetype === 'balanced' ? '♠'
                   : '🐟';
    const col   = skill >= 0.85 ? '#34d399' : skill >= 0.65 ? '#60a5fa' : skill >= 0.35 ? '#9ca3af' : '#f87171';
    const sk = document.createElement('span');
    sk.style.cssText = `font-size:10px;color:${col};cursor:default;`;
    sk.title = `Skill ${Math.round(skill * 100)} | ${player.archetype}`;
    sk.textContent = archIcon;
    nameEl.appendChild(sk);
  }

  // Full HUD tooltip (VPIP / PFR / 3-Bet / Fold-to-CBet)
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  const vpip        = player.handsPlayed > 0 ? Math.round(player.vpipCount / player.handsPlayed * 100) : 0;
  const pfr         = player.handsPlayed > 0 ? Math.round(player.pfrCount  / player.handsPlayed * 100) : 0;
  const threeBetPct = player.threeBetOpps  > 3 ? Math.round(player.threeBetCount  / player.threeBetOpps  * 100) : null;
  const foldCBetPct = player.foldToCBetOpps > 3 ? Math.round(player.foldToCBetCount / player.foldToCBetOpps * 100) : null;
  const cBetPct     = player.cBetOpps > 3 ? Math.round(player.cBetCount / player.cBetOpps * 100) : null;
  tooltip.style.cssText += 'min-width:140px;text-align:left;line-height:1.6;';
  tooltip.innerHTML = `
    <div style="font-weight:700;margin-bottom:2px;">${player.name}</div>
    <div>VPIP: <b>${vpip}%</b> &nbsp; PFR: <b>${pfr}%</b></div>
    ${threeBetPct !== null ? `<div>3-Bet: <b>${threeBetPct}%</b> &nbsp; CBet: <b>${cBetPct ?? '?'}%</b></div>` : ''}
    ${foldCBetPct !== null ? `<div>F-CBet: <b style="color:${foldCBetPct > 65 ? '#4ade80' : foldCBetPct < 35 ? '#f87171' : '#e5e7eb'}">${foldCBetPct}%</b></div>` : ''}
    <div style="color:#4b5563;font-size:9px;margin-top:2px;">Hands: ${player.handsPlayed}</div>`;
  nameEl.appendChild(tooltip);

  // Compact always-visible HUD bar (once 6+ hands of data)
  if (!player.isUser && player.handsPlayed >= 6) {
    const hud = document.createElement('div');
    hud.style.cssText = 'font-size:9px;color:#4b5563;margin-top:1px;text-align:center;letter-spacing:0.3px;cursor:default;';
    const t3b = threeBetPct !== null ? `${threeBetPct}` : '?';
    const fcb = foldCBetPct !== null ? `${foldCBetPct}` : '?';
    hud.textContent = `${vpip}/${pfr}/${t3b} · F-CB:${fcb}%`;
    hud.title = 'VPIP / PFR / 3Bet · Fold-to-CBet';
    nameEl.appendChild(hud);
  }

  // Chips display
  const chipsEl = document.createElement('div');
  chipsEl.style.cssText = 'font-size:11px;color:#fbbf24;font-weight:600;letter-spacing:0.3px;margin-top:2px;';
  chipsEl.textContent = player.isAllIn ? '🟡 ALL-IN' : `💰 ${fmt(player.chips)}`;

  // Round bet badge
  let betBadge: HTMLElement | null = null;
  if (player.roundBet > 0 && state.phase !== 'showdown') {
    betBadge = document.createElement('div');
    betBadge.style.cssText = 'background:rgba(251,191,36,0.2);border:1px solid #fbbf24;color:#fbbf24;font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-top:1px;';
    betBadge.textContent = `Bet: ${fmt(player.roundBet)}`;
  }

  // Win odds (user only) — shown above the name row
  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex;align-items:center;gap:4px;';
  nameRow.appendChild(nameEl);

  if (player.isUser && winOdds !== null) {
    const c = (p: number) => p >= 50 ? '#4ade80' : p >= 30 ? '#facc15' : '#f87171';
    const od = document.createElement('div');
    od.style.cssText = 'display:flex;flex-direction:column;gap:1px;align-items:center;margin-bottom:3px;';
    od.innerHTML = `
      <div style="font-size:9px;background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:2px 5px;white-space:nowrap;display:flex;gap:5px;align-items:center;">
        <span style="color:#6b7280;width:26px;">Fair</span>
        <span style="color:#9ca3af;">Win</span><span style="color:${c(winOdds.fair.winPct)};font-weight:700;">${winOdds.fair.winPct}%</span>
        <span style="color:#4b5563;">|</span>
        <span style="color:#9ca3af;">Eq</span><span style="color:${c(winOdds.fair.equityPct)};font-weight:700;">${winOdds.fair.equityPct}%</span>
      </div>
      <div style="font-size:9px;background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:2px 5px;white-space:nowrap;display:flex;gap:5px;align-items:center;">
        <span style="color:#6b7280;width:26px;">True</span>
        <span style="color:#9ca3af;">Win</span><span style="color:${c(winOdds.true.winPct)};font-weight:700;">${winOdds.true.winPct}%</span>
        <span style="color:#4b5563;">|</span>
        <span style="color:#9ca3af;">Eq</span><span style="color:${c(winOdds.true.equityPct)};font-weight:700;">${winOdds.true.equityPct}%</span>
      </div>
      <div style="font-size:9px;color:#6b7280;text-align:center;">${winOdds.activePlayers} active</div>`;
    info.appendChild(od);
  }

  info.appendChild(nameRow);
  info.appendChild(chipsEl);
  if (betBadge) info.appendChild(betBadge);

  // ── XP bar (user only) ──────────────────────────────────────────────────────
  if (player.isUser && player.level !== undefined) {
    const xp     = player.xp   ?? 0;
    const lvl    = player.level ?? 1;
    const curr   = XP_LEVELS[lvl - 1] ?? 0;
    const next   = XP_LEVELS[lvl]     ?? XP_LEVELS[XP_LEVELS.length - 1];
    const pct    = next > curr ? Math.min(100, ((xp - curr) / (next - curr)) * 100) : 100;
    const xpBar  = document.createElement('div');
    xpBar.style.cssText = 'width:110px;margin-top:2px;';
    xpBar.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:8px;color:#6b7280;margin-bottom:1px;">
        <span style="color:#a78bfa;font-weight:700;">Lv ${lvl}</span>
        <span>${xp.toLocaleString()} XP</span>
      </div>
      <div style="background:#1f2937;border-radius:3px;height:3px;overflow:hidden;">
        <div style="background:linear-gradient(90deg,#a78bfa,#7c3aed);height:100%;width:${pct}%;transition:width 0.5s;"></div>
      </div>`;
    info.appendChild(xpBar);
  }

  // ── Equity sparkline (user only, when history exists) ──────────────────────
  if (player.isUser && equityHistory.length >= 2) {
    const W = 110; const H = 28;
    const pts = equityHistory.map((e, i) => {
      const x = Math.round((i / (equityHistory.length - 1)) * W);
      const y = Math.round((1 - e / 100) * H);
      return `${x},${y}`;
    }).join(' ');
    const last  = equityHistory[equityHistory.length - 1];
    const lc    = last >= 50 ? '#10b981' : last >= 30 ? '#fbbf24' : '#f87171';
    const dots  = equityHistory.map((e, i) => {
      const x = Math.round((i / (equityHistory.length - 1)) * W);
      const y = Math.round((1 - e / 100) * H);
      return `<circle cx="${x}" cy="${y}" r="2" fill="${lc}"/>`;
    }).join('');
    const labels = ['Pre','Flop','Turn','River'].slice(0, equityHistory.length);
    const spark = document.createElement('div');
    spark.style.cssText = 'width:110px;margin-top:3px;';
    spark.innerHTML = `
      <div style="font-size:8px;color:#4b5563;margin-bottom:1px;">Equity history</div>
      <svg width="${W}" height="${H + 4}" style="overflow:visible;">
        <polyline points="${pts}" fill="none" stroke="${lc}" stroke-width="1.5" stroke-linejoin="round"/>
        ${dots}
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:7px;color:#374151;">
        ${labels.map(l => `<span>${l}</span>`).join('')}
      </div>`;
    info.appendChild(spark);
  }

  if (isThinking) {
    const th = document.createElement('div');
    th.className = 'thinking-badge';
    th.textContent = '• • •';
    info.appendChild(th);
  }

  if (lastActionResult?.id === player.id) {
    const res = document.createElement('div');
    res.style.cssText = `background:${lastActionResult.color}22;border:1px solid ${lastActionResult.color};color:${lastActionResult.color};font-size:11px;font-weight:700;padding:2px 10px;border-radius:4px;letter-spacing:1px;margin-top:2px;`;
    res.textContent = lastActionResult.label;
    info.appendChild(res);
  }

  if (player.isFolded && !isThinking) {
    const fb = document.createElement('div');
    fb.style.cssText = 'background:rgba(239,68,68,0.25);border:1px solid #ef4444;color:#ef4444;font-size:10px;font-weight:700;padding:1px 8px;border-radius:4px;letter-spacing:1px;margin-top:2px;';
    fb.textContent = 'FOLDED';
    info.appendChild(fb);
  }

  if (state.phase === 'showdown' && player.handResult) {
    const hl = document.createElement('div');
    hl.className = 'hand-label';
    hl.textContent = player.handResult.description;
    info.appendChild(hl);
  }

  if (isWinner && state.phase === 'showdown') {
    const isTournamentWinner = seatedPlayers(state).length <= 1;
    const wb = document.createElement('div');
    wb.className = 'winner-badge';
    wb.textContent = isTournamentWinner
      ? '🏆 CHAMPION!'
      : state.splitPotWinnerIds.includes(player.id) ? 'TIE!' : 'WINNER!';
    if (isTournamentWinner) {
      wb.style.cssText += 'font-size:14px;padding:5px 14px;background:linear-gradient(135deg,#fbbf24,#f97316);';
    }
    info.appendChild(wb);
  }

  if (isMyTurn) {
    const beacon = document.createElement('div');
    beacon.style.cssText = 'font-size:11px;color:#facc15;font-weight:700;letter-spacing:1px;margin-top:2px;animation:thinking-pulse 0.7s ease-in-out infinite;';
    beacon.textContent = 'YOUR TURN';
    info.appendChild(beacon);
  }

  wrap.appendChild(info);
  return wrap;
}

// ─── Dealer button ────────────────────────────────────────────────────────────
// Rendered as a separate absolutely-positioned element at DEALER_CHIP_POSITIONS,
// which sit 40% of the way from each INFO_POSITION toward the table centre.
function renderDealerChip(player: Player, seatIdx: number): HTMLElement {
  const el = document.createElement('div');
  if (!player.isDealer || player.isBusted) return el;
  const pos = DEALER_CHIP_POSITIONS[seatIdx];
  const chip = document.createElement('div');
  chip.className = 'dealer-chip' + (dealerJustMoved ? ' dealer-moved' : '');
  chip.textContent = 'D';
  chip.style.cssText = [
    `position:absolute;top:${pos.y}px;left:${pos.x}px;`,
    'transform:translate(-50%,-50%);z-index:15;',
  ].join('');
  el.appendChild(chip);
  return el;
}

// ─── Pot chip pile ────────────────────────────────────────────────────────────
function renderPotOnTable(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = [
    `position:absolute;left:${POT_CANVAS.x}px;top:${POT_CANVAS.y}px;`,
    'transform:translate(-50%,-100%);',
    'display:flex;flex-direction:column;align-items:center;gap:3px;',
    'z-index:6;pointer-events:none;',
  ].join('');

  if (state.pot <= 0) return el;

  el.appendChild(renderChipStack(state.pot));

  const lbl = document.createElement('div');
  lbl.style.cssText = [
    'background:rgba(0,0,0,0.72);border:1px solid rgba(251,191,36,0.5);',
    'border-radius:12px;padding:2px 10px;',
    'font-size:12px;font-weight:700;color:#fbbf24;letter-spacing:0.8px;white-space:nowrap;',
  ].join('');
  lbl.textContent = `POT  ${fmt(state.pot)}`;
  el.appendChild(lbl);

  return el;
}

// ─── Community cards ──────────────────────────────────────────────────────────
function renderCommunityArea(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:8px;';

  if (state.currentBet > 0 && state.phase !== 'showdown') {
    const betEl = document.createElement('div');
    betEl.style.cssText = [
      'background:rgba(0,0,0,0.65);border:1px solid rgba(255,255,255,0.15);',
      'border-radius:10px;padding:3px 12px;',
      'font-size:12px;color:#d1d5db;letter-spacing:0.5px;white-space:nowrap;',
    ].join('');
    betEl.textContent = `Current bet: ${fmt(state.currentBet)}`;
    wrap.appendChild(betEl);
  }

  const perspective = document.createElement('div');
  perspective.style.cssText = 'perspective:500px;perspective-origin:50% -40%;';

  const container = document.createElement('div');
  container.className = 'flex items-center gap-2';
  container.id = 'community-cards';
  container.style.cssText = [
    'transform: rotateX(28deg);',
    'transform-origin: 50% 100%;',
    'transform-style: preserve-3d;',
  ].join('');

  for (let i = 0; i < 5; i++) {
    if (i < state.communityCards.length) {
      container.appendChild(createCardEl(state.communityCards[i], true, 'community-card'));
    } else {
      const slot = document.createElement('div');
      slot.style.cssText = 'width:56px;height:80px;border-radius:6px;border:2px dashed rgba(255,255,255,0.12);background:rgba(0,0,0,0.15);';
      container.appendChild(slot);
    }
  }
  perspective.appendChild(container);
  wrap.appendChild(perspective);

  return wrap;
}

// ─── Phase dots ───────────────────────────────────────────────────────────────
const PHASES = ['Deal', 'Flop', 'Turn', 'River', 'Showdown'];
const PHASE_MAP: Record<string, number> = {
  idle: -1, dealing: 0, preflop: 0, flop: 1, turn: 2, river: 3, showdown: 4,
};

function renderPhaseDots(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex items-center gap-3';
  const current = PHASE_MAP[state.phase] ?? -1;
  PHASES.forEach((label, i) => {
    const dot = document.createElement('div');
    dot.className = `phase-dot ${i < current ? 'done' : i === current ? 'active' : ''}`;
    dot.title = label;
    wrap.appendChild(dot);
  });
  return wrap;
}

// ─── User action panel ────────────────────────────────────────────────────────
function renderActionPanel(): HTMLElement {
  const panel = document.createElement('div');
  if (!isUserTurn) return panel;

  const user = state.players.find(p => p.isUser)!;
  const callAmount = Math.min(state.currentBet - user.roundBet, user.chips);
  const canCheck   = callAmount === 0;
  const minRaiseTotal = state.currentBet + state.minRaise;
  const canRaise   = user.chips + user.roundBet > minRaiseTotal && user.chips > callAmount;

  if (canRaise) {
    const maxTotal = user.chips + user.roundBet;
    if (raiseAmount < minRaiseTotal) raiseAmount = minRaiseTotal;
    if (raiseAmount > maxTotal)      raiseAmount = maxTotal;
  }

  panel.style.cssText = [
    'background:rgba(0,0,0,0.85)',
    'border:2px solid rgba(251,191,36,0.5)',
    'border-radius:12px',
    'padding:14px 20px',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:10px',
    'min-width:420px',
  ].join(';');

  // ── Time bank progress bar (single compact row) ──
  if (timeBankInterval !== null) {
    const pct    = (timeBankSeconds / 30) * 100;
    const tColor = timeBankSeconds > 15 ? '#10b981' : timeBankSeconds > 8 ? '#f59e0b' : '#ef4444';
    const tb = document.createElement('div');
    tb.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;';
    tb.innerHTML = `
      <span style="font-size:10px;color:${tColor};white-space:nowrap;">⏱ Time</span>
      <div style="flex:1;background:#1f2937;border-radius:4px;height:5px;overflow:hidden;">
        <div style="background:${tColor};height:100%;width:${pct}%;transition:width 0.9s linear;border-radius:4px;"></div>
      </div>
      <span style="font-size:10px;color:${tColor};font-weight:700;white-space:nowrap;">${timeBankSeconds}s</span>`;
    panel.appendChild(tb);
  }

  // ── Pot / call info ──
  const info = document.createElement('div');
  info.style.cssText = 'display:flex;gap:20px;font-size:12px;color:#9ca3af;';
  info.innerHTML = [
    `<span>Pot <b style="color:#fbbf24">${fmt(state.pot)}</b></span>`,
    canCheck
      ? `<span style="color:#4ade80">Free to check ✓</span>`
      : `<span>To call <b style="color:#f87171">${fmt(callAmount)}</b></span>`,
    `<span>Your chips <b style="color:#fbbf24">${fmt(user.chips)}</b></span>`,
  ].join('');
  panel.appendChild(info);

  // ── Pot odds + sizing presets combined row ──
  {
    const showOdds    = !canCheck && callAmount > 0;
    const showPresets = canRaise;
    if (showOdds || showPresets) {
      const comboRow = document.createElement('div');
      comboRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';

      if (showOdds) {
        const potOddsNeeded = Math.round(callAmount / (state.pot + callAmount) * 100);
        const userEquityNow = winOdds ? Math.round(winOdds.fair.equityPct) : null;
        const profitable    = userEquityNow !== null && userEquityNow > potOddsNeeded;
        const oddsColor     = userEquityNow !== null ? (profitable ? '#4ade80' : '#f87171') : '#9ca3af';
        const oddsSpan = document.createElement('span');
        oddsSpan.style.cssText = 'font-size:10px;color:#6b7280;white-space:nowrap;';
        oddsSpan.innerHTML = `Need <b>${potOddsNeeded}%</b>`
          + (userEquityNow !== null
            ? ` · <b style="color:${oddsColor}">${userEquityNow}%</b> ${profitable ? '✓' : '✗'}`
            : '');
        comboRow.appendChild(oddsSpan);
      }

      if (showPresets) {
        const maxTotal          = user.chips + user.roundBet;
        const potAfterCallFull  = state.pot + callAmount;
        const presetDefs: [string, number][] = [
          ['⅓', 0.33], ['½', 0.5], ['¾', 0.75], ['P', 1.0], ['2×', 2.0],
        ];
        const presetsWrap = document.createElement('div');
        presetsWrap.style.cssText = 'display:flex;gap:3px;flex-wrap:nowrap;margin-left:auto;';
        for (const [lbl, frac] of presetDefs) {
          const amount = Math.min(
            Math.max(minRaiseTotal, Math.round(state.currentBet + potAfterCallFull * frac)),
            maxTotal,
          );
          if (amount < minRaiseTotal) continue;
          const pb = document.createElement('button');
          pb.textContent = lbl;
          const active = raiseAmount === amount;
          pb.style.cssText = `background:${active ? '#78350f' : '#1f2937'};border:1px solid ${active ? '#f59e0b' : '#374151'};color:${active ? '#fbbf24' : '#9ca3af'};border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;`;
          pb.addEventListener('click', () => { raiseAmount = amount; render(); });
          presetsWrap.appendChild(pb);
        }
        comboRow.appendChild(presetsWrap);
      }

      panel.appendChild(comboRow);
    }
  }

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;';

  const mkBtn = (label: string, bg: string, onClick: () => void, disabled = false): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `background:${bg};color:white;border:none;border-radius:8px;padding:10px 20px;font-size:14px;font-weight:700;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? 0.4 : 1};letter-spacing:0.5px;transition:filter 0.15s;`;
    if (!disabled) btn.addEventListener('click', onClick);
    return btn;
  };

  row.appendChild(mkBtn('FOLD', 'linear-gradient(135deg,#7f1d1d,#dc2626)', () => {
    handleUserAction({ type: 'fold' });
  }));

  if (canCheck) {
    row.appendChild(mkBtn('CHECK', 'linear-gradient(135deg,#1e40af,#3b82f6)', () => {
      handleUserAction({ type: 'check' });
    }));
  } else {
    const callLabel = callAmount >= user.chips ? `ALL-IN  ${fmt(user.chips)}` : `CALL  ${fmt(callAmount)}`;
    row.appendChild(mkBtn(callLabel, 'linear-gradient(135deg,#065f46,#10b981)', () => {
      if (callAmount >= user.chips) handleUserAction({ type: 'allIn' });
      else handleUserAction({ type: 'call' });
    }));
  }

  if (canRaise) {
    const maxTotal = user.chips + user.roundBet;
    const step     = state.bigBlind;

    const raiseGroup = document.createElement('div');
    raiseGroup.style.cssText = 'display:flex;align-items:center;gap:4px;';

    const minusBtn = document.createElement('button');
    minusBtn.textContent = '−';
    minusBtn.style.cssText = 'background:#374151;color:white;border:none;border-radius:6px;width:28px;height:36px;font-size:16px;cursor:pointer;font-weight:700;';
    minusBtn.addEventListener('click', () => {
      raiseAmount = Math.max(minRaiseTotal, raiseAmount - step);
      render();
    });

    const input = document.createElement('input');
    input.type = 'number';
    input.min  = String(minRaiseTotal);
    input.max  = String(maxTotal);
    input.step = String(step);
    input.value = String(raiseAmount);
    input.style.cssText = 'width:90px;background:#1f2937;border:1px solid #4b5563;border-radius:6px;color:#fbbf24;font-size:13px;font-weight:700;text-align:center;padding:6px 4px;';
    input.addEventListener('change', () => {
      raiseAmount = Math.max(minRaiseTotal, Math.min(maxTotal, Number(input.value)));
      input.value = String(raiseAmount);
    });

    const plusBtn = document.createElement('button');
    plusBtn.textContent = '+';
    plusBtn.style.cssText = 'background:#374151;color:white;border:none;border-radius:6px;width:28px;height:36px;font-size:16px;cursor:pointer;font-weight:700;';
    plusBtn.addEventListener('click', () => {
      raiseAmount = Math.min(maxTotal, raiseAmount + step);
      render();
    });

    const potBtn = document.createElement('button');
    const potAfterCall = state.pot + callAmount;
    const potSized = Math.min(state.currentBet + potAfterCall, maxTotal);
    potBtn.textContent = 'Pot';
    potBtn.style.cssText = 'background:#78350f;color:#fbbf24;border:1px solid #92400e;border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;cursor:pointer;';
    potBtn.addEventListener('click', () => {
      raiseAmount = Math.min(potSized, maxTotal);
      render();
    });

    raiseGroup.append(minusBtn, input, plusBtn, potBtn);

    const raiseBtn = mkBtn('RAISE', 'linear-gradient(135deg,#92400e,#f59e0b)', () => {
      handleUserAction({ type: 'raise', amount: raiseAmount });
    });
    row.appendChild(raiseGroup);
    row.appendChild(raiseBtn);

    // (sizing presets are rendered in the combo row above the action buttons)
  }

  row.appendChild(mkBtn(`ALL-IN  ${fmt(user.chips)}`, 'linear-gradient(135deg,#7c2d12,#f97316)', () => {
    handleUserAction({ type: 'allIn' });
  }));

  panel.appendChild(row);

  return panel;
}

// ─── Settings panel ───────────────────────────────────────────────────────────
function renderSettingsPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:absolute;top:50px;right:16px;z-index:300;',
    'background:rgba(8,12,24,0.97);border:1px solid rgba(255,255,255,0.15);',
    'border-radius:12px;padding:16px;min-width:230px;',
    'box-shadow:0 8px 32px rgba(0,0,0,0.6);',
  ].join('');

  const title = document.createElement('div');
  title.style.cssText = 'color:#fbbf24;font-size:13px;font-weight:700;margin-bottom:12px;letter-spacing:1px;';
  title.textContent = '⚙ SETTINGS';
  panel.appendChild(title);

  const row = (label: string, child: HTMLElement) => {
    const d = document.createElement('div');
    d.style.cssText = 'margin-bottom:10px;';
    const l = document.createElement('label');
    l.style.cssText = 'color:#9ca3af;font-size:11px;display:block;margin-bottom:5px;';
    l.textContent = label;
    d.appendChild(l); d.appendChild(child);
    panel.appendChild(d);
  };

  // Volume
  const volInput = document.createElement('input');
  volInput.type = 'range'; volInput.min = '0'; volInput.max = '1'; volInput.step = '0.05';
  volInput.value = String(masterVolume);
  volInput.style.cssText = 'width:100%;accent-color:#fbbf24;cursor:pointer;';
  volInput.addEventListener('input', () => {
    masterVolume = Number(volInput.value);
    if (_masterGain) _masterGain.gain.value = masterVolume;
  });
  row('🔊 Volume', volInput);

  // Animation speed
  const animSel = document.createElement('select');
  animSel.style.cssText = 'background:#1f2937;border:1px solid #374151;color:#e5e7eb;border-radius:6px;padding:4px 8px;font-size:12px;width:100%;cursor:pointer;';
  [['normal','Normal'], ['fast','Fast'], ['off','Off']].forEach(([v, l]) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = l;
    if (v === animSpeed) opt.selected = true;
    animSel.appendChild(opt);
  });
  animSel.addEventListener('change', () => { animSpeed = animSel.value as AnimSpeed; });
  row('⚡ Animation Speed', animSel);

  // Card back selector
  const backWrap = document.createElement('div');
  backWrap.style.cssText = 'margin-bottom:10px;';
  const backLabel = document.createElement('div');
  backLabel.style.cssText = 'color:#9ca3af;font-size:11px;margin-bottom:6px;';
  backLabel.textContent = '🂠 Card Back';
  backWrap.appendChild(backLabel);
  const backGrid = document.createElement('div');
  backGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;';
  const BACK_DEFS: [CardBack, string, string][] = [
    ['blue','Blue','#1e40af'],['red','Red','#dc2626'],
    ['green','Green','#15803d'],['purple','Purple','#6d28d9'],
  ];
  for (const [id, lbl, color] of BACK_DEFS) {
    const b = document.createElement('button');
    b.style.cssText = `background:${color};border:2px solid ${selectedCardBack === id ? '#fbbf24' : 'transparent'};color:white;border-radius:6px;padding:5px;font-size:11px;cursor:pointer;transition:border 0.15s;`;
    b.textContent = lbl;
    b.addEventListener('click', () => { selectedCardBack = id; localStorage.setItem('cardBack', id); render(); });
    backGrid.appendChild(b);
  }
  backWrap.appendChild(backGrid);
  panel.appendChild(backWrap);

  // Save / Load
  const saveRow = document.createElement('div');
  saveRow.style.cssText = 'display:flex;gap:6px;margin-top:4px;';
  const mkSmallBtn = (text: string, bg: string, border: string, color: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = `flex:1;background:${bg};border:1px solid ${border};color:${color};border-radius:6px;padding:6px;font-size:11px;cursor:pointer;`;
    b.addEventListener('click', onClick);
    return b;
  };
  saveRow.appendChild(mkSmallBtn('💾 Save', '#1e3a5f', '#1e40af', '#93c5fd', () => {
    saveGame(state);
    showToast('Game saved ✓');
  }));
  saveRow.appendChild(mkSmallBtn('📂 Load', '#1f2937', '#374151', '#9ca3af', () => {
    const loaded = loadGame();
    if (loaded) {
      state = loaded; gameStarted = true; settingsOpen = false; render();
      showToast('Game resumed ✓');
    } else {
      showToast('No save found');
    }
  }));
  saveRow.appendChild(mkSmallBtn('🗑 Clear', '#3b1212', '#7f1d1d', '#f87171', () => {
    clearSave(); showToast('Save deleted');
  }));
  panel.appendChild(saveRow);

  return panel;
}

// ─── Admin panels ─────────────────────────────────────────────────────────────
function miniCard(card: Card, bg: string, title: string): HTMLElement {
  const el  = document.createElement('div');
  const red = card.suit === 'hearts' || card.suit === 'diamonds';
  const sym = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' }[card.suit];
  el.title = title;
  el.style.cssText = `display:inline-flex;align-items:center;justify-content:center;width:32px;height:44px;border-radius:4px;font-size:10px;font-weight:700;line-height:1;flex-direction:column;gap:1px;background:${bg};color:${red ? '#ef4444' : '#e5e7eb'};border:1px solid rgba(255,255,255,0.1);flex-shrink:0;`;
  el.innerHTML = `<span>${card.rank}</span><span style="font-size:11px;">${sym}</span>`;
  return el;
}

function renderHandHistoryPanel(): HTMLElement {
  const panel = document.createElement('div');
  // Stack order (right side, bottom→top): deck panel → phase indicator (~34px) → hand history
  const deckH      = state.phase !== 'idle' ? (deckPanelExpanded ? 180 : 44) : 0;
  const phaseRowH  = state.phase !== 'idle' ? 34 : 0;  // phase dots + label row height
  const bottomOff  = 12 + deckH + 8 + phaseRowH + 8;
  panel.style.cssText = `position:absolute;bottom:${bottomOff}px;right:12px;z-index:110;max-width:300px;`;

  if (handHistory.length === 0 || state.phase === 'idle') return panel;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'background:rgba(0,0,0,0.80);border:1px solid rgba(255,255,255,0.12);border-radius:8px;backdrop-filter:blur(4px);overflow:hidden;';

  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex;align-items:center;justify-content:space-between;',
    'padding:6px 10px;cursor:pointer;user-select:none;',
    'border-bottom:1px solid ' + (historyPanelExpanded ? 'rgba(255,255,255,0.10)' : 'transparent') + ';',
  ].join('');

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'color:#9ca3af;font-size:10px;letter-spacing:1px;text-transform:uppercase;';
  labelEl.textContent = `Hand History (${handHistory.length})`;

  const chevron = document.createElement('div');
  chevron.style.cssText = 'color:#6b7280;font-size:11px;transition:transform 0.2s;transform:rotate(' + (historyPanelExpanded ? '180deg' : '0deg') + ');';
  chevron.textContent = '▼';

  header.appendChild(labelEl);
  header.appendChild(chevron);
  header.addEventListener('click', () => {
    historyPanelExpanded = !historyPanelExpanded;
    render();
  });
  wrap.appendChild(header);

  if (historyPanelExpanded) {
    const body = document.createElement('div');
    body.style.cssText = 'padding:6px 8px;display:flex;flex-direction:column;gap:3px;';

    const last5 = handHistory.slice(-5).reverse();
    for (const rec of last5) {
      const row = document.createElement('div');
      row.style.cssText = `font-size:10px;padding:3px 5px;border-radius:4px;background:${rec.wasUserWinner ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'};color:${rec.wasUserWinner ? '#34d399' : '#9ca3af'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
      row.textContent = `Hand #${rec.handNum} — ${rec.winnerName} won ${fmt(rec.potSize)}${rec.handDesc ? ` with ${rec.handDesc}` : ''}`;
      row.title = row.textContent;
      body.appendChild(row);
    }
    wrap.appendChild(body);
  }

  panel.appendChild(wrap);
  return panel;
}

function renderDeckPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;bottom:12px;right:12px;z-index:110;max-width:268px;';
  if (state.phase === 'idle') return panel;

  const wrap = document.createElement('div');
  wrap.style.cssText = 'background:rgba(0,0,0,0.80);border:1px solid rgba(255,255,255,0.12);border-radius:8px;backdrop-filter:blur(4px);overflow:hidden;';

  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex;align-items:center;justify-content:space-between;',
    'padding:6px 10px;cursor:pointer;user-select:none;',
    'border-bottom:1px solid ' + (deckPanelExpanded ? 'rgba(255,255,255,0.10)' : 'transparent') + ';',
    'transition:border-color 0.2s;',
  ].join('');

  const labelEl = document.createElement('div');
  labelEl.style.cssText = 'color:#9ca3af;font-size:10px;letter-spacing:1px;text-transform:uppercase;';
  labelEl.textContent = 'Deck Order (shuffled)';

  const chevron = document.createElement('div');
  chevron.style.cssText = 'color:#6b7280;font-size:11px;transition:transform 0.2s;transform:rotate(' + (deckPanelExpanded ? '180deg' : '0deg') + ');';
  chevron.textContent = '▼';

  header.appendChild(labelEl);
  header.appendChild(chevron);
  header.addEventListener('click', () => {
    deckPanelExpanded = !deckPanelExpanded;
    render();
  });
  wrap.appendChild(header);

  if (deckPanelExpanded) {
    const body = document.createElement('div');
    body.style.cssText = 'padding:8px;';

    const holeSet  = new Set(state.players.flatMap(p => p.holeCards).map(cardKey));
    const burnSet  = new Set(state.burnedCards.map(cardKey));

    // Already-revealed community cards
    const revealedFlop  = state.communityCards.slice(0, 3);
    const revealedTurn  = state.communityCards.slice(3, 4);
    const revealedRiver = state.communityCards.slice(4, 5);

    // Peek ahead in the remaining deck to pre-color upcoming community cards.
    // The burn/deal pattern from the current deck position depends on how many
    // community cards have already been dealt:
    //   0 revealed → deck: [burn, F1, F2, F3, burn, T, burn, R, ...]
    //   3 revealed → deck: [burn, T,  burn, R, ...]
    //   4 revealed → deck: [burn, R, ...]
    const d = state.deck;
    const cc = state.communityCards.length;
    const upcomingFlop:  Card[] = cc === 0 ? d.slice(1, 4) : [];
    const upcomingTurn:  Card[] = cc === 0 ? d.slice(5, 6)
                                : cc === 3 ? d.slice(1, 2) : [];
    const upcomingRiver: Card[] = cc === 0 ? d.slice(7, 8)
                                : cc === 3 ? d.slice(3, 4)
                                : cc === 4 ? d.slice(1, 2) : [];

    const flopSet  = new Set([...revealedFlop,  ...upcomingFlop ].map(cardKey));
    const turnSet  = new Set([...revealedTurn,  ...upcomingTurn ].map(cardKey));
    const riverSet = new Set([...revealedRiver, ...upcomingRiver].map(cardKey));

    const grid = document.createElement('div');
    grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;';
    for (const card of state.originalDeck) {
      const key = cardKey(card);
      const sym = getSuitSymbol(card.suit);
      const bg  = burnSet.has(key)  ? 'rgba(239,68,68,0.28)'
                : riverSet.has(key) ? 'rgba(167,139,250,0.35)'
                : turnSet.has(key)  ? 'rgba(245,158,11,0.35)'
                : flopSet.has(key)  ? 'rgba(16,185,129,0.30)'
                : holeSet.has(key)  ? 'rgba(59,130,246,0.28)'
                :                     'rgba(255,255,255,0.05)';
      const label = burnSet.has(key)  ? `Burned: ${card.rank}${sym}`
                  : riverSet.has(key) ? `River: ${card.rank}${sym}`
                  : turnSet.has(key)  ? `Turn: ${card.rank}${sym}`
                  : flopSet.has(key)  ? `Flop: ${card.rank}${sym}`
                  : holeSet.has(key)  ? `Hole: ${card.rank}${sym}`
                  :                     `Remaining: ${card.rank}${sym}`;
      const border = riverSet.has(key) ? '1px solid rgba(167,139,250,0.7)'
                   : turnSet.has(key)  ? '1px solid rgba(245,158,11,0.7)'
                   : flopSet.has(key)  ? '1px solid rgba(16,185,129,0.5)'
                   :                     '';
      const el = miniCard(card, bg, label);
      if (border) el.style.outline = border;
      grid.appendChild(el);
    }
    body.appendChild(grid);

    const legend = document.createElement('div');
    legend.style.cssText = 'display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;';
    const legendItems = [
      { color: 'rgba(59,130,246,0.5)',  label: 'Hole' },
      { color: 'rgba(16,185,129,0.5)',  label: 'Flop' },
      { color: 'rgba(245,158,11,0.5)',  label: 'Turn' },
      { color: 'rgba(167,139,250,0.6)', label: 'River' },
      { color: 'rgba(239,68,68,0.5)',   label: 'Burned' },
      { color: 'rgba(255,255,255,0.1)', label: 'Remaining' },
    ].filter(({ label }) => {
      // only show legend entries that are relevant to the current phase
      if (label === 'Flop'   && flopSet.size  === 0) return false;
      if (label === 'Turn'   && turnSet.size  === 0) return false;
      if (label === 'River'  && riverSet.size === 0) return false;
      if (label === 'Burned' && burnSet.size  === 0) return false;
      return true;
    });
    legendItems.forEach(({ color, label }) => {
      const dot = document.createElement('div');
      dot.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:9px;color:#9ca3af;';
      dot.innerHTML = `<span style="width:8px;height:8px;border-radius:2px;background:${color};display:inline-block;"></span>${label}`;
      legend.appendChild(dot);
    });
    body.appendChild(legend);
    wrap.appendChild(body);
  }

  panel.appendChild(wrap);
  return panel;
}


// ─── Canvas scaling ───────────────────────────────────────────────────────────
function applyCanvasScale(): void {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) return;
  const scale = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
  const tx    = (window.innerWidth  - BASE_W * scale) / 2;
  const ty    = (window.innerHeight - BASE_H * scale) / 2;
  canvas.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
}

// ─── Main render ──────────────────────────────────────────────────────────────
function render(): void {
  const oddsPhases = new Set(['preflop', 'flop', 'turn', 'river']);
  const oddsKey    = `${state.phase}-${state.players.filter(p => p.isFolded).length}`;
  if (oddsPhases.has(state.phase) && oddsKey !== lastOddsPhase) {
    winOdds      = calcWinOdds(state);
    lastOddsPhase = oddsKey;
    // Track user equity for post-hand breakdown
    if (winOdds) userEquityAtLastStreet = winOdds.true.equityPct;
  }
  if (!oddsPhases.has(state.phase)) { winOdds = null; lastOddsPhase = ''; }

  const app = document.getElementById('app')!;
  app.innerHTML = '';

  const canvas = document.createElement('div');
  canvas.id = 'game-canvas';
  canvas.style.cssText = [
    `position:absolute;top:0;left:0;width:${BASE_W}px;height:${BASE_H}px;`,
    `transform-origin:top left;overflow:hidden;`,
    `background:url(${tableBg}) 0 0 / ${BASE_W}px ${BASE_H}px no-repeat;`,
  ].join('');

  // ── Per-seat player image layers (removed when player busts) ──
  if (gameStarted) {
    for (let i = 0; i < 8; i++) {
      const p = state.players[i];
      if (p.isBusted) continue;          // hide busted players
      const layer = document.createElement('div');
      layer.style.cssText = [
        'position:absolute;top:0;left:0;',
        `width:${BASE_W}px;height:${BASE_H}px;`,
        `background:url(${PLAYER_IMGS[i]}) 0 0 / ${BASE_W}px ${BASE_H}px no-repeat;`,
        'pointer-events:none;',
      ].join('');
      canvas.appendChild(layer);
    }
  }

  const centerArea = document.createElement('div');
  centerArea.style.cssText = 'position:absolute;top:358px;left:683px;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;z-index:5;';
  centerArea.appendChild(renderCommunityArea());
  canvas.appendChild(centerArea);

  if (gameStarted) {
    for (let i = 0; i < 8; i++) {
      canvas.appendChild(renderPlayerCards(state.players[i], SEAT_POSITIONS[i]));
    }
    for (let i = 0; i < 8; i++) {
      canvas.appendChild(renderPlayerInfo(state.players[i], INFO_POSITIONS[i]));
    }
    for (let i = 0; i < 8; i++) {
      canvas.appendChild(renderChipStackOnTable(state.players[i], CHIP_POSITIONS[i]));
    }
    // Dealer button rendered at inward positions (independent of info panel)
    for (let i = 0; i < 8; i++) {
      canvas.appendChild(renderDealerChip(state.players[i], i));
    }
  }

  canvas.appendChild(renderPotOnTable());

  // Title
  const titleEl = document.createElement('div');
  titleEl.style.cssText = [
    'position:absolute;top:14px;left:16px;z-index:100;pointer-events:none;',
    'color:#fff;font-size:16px;font-weight:bold;letter-spacing:4px;font-family:serif;',
    'text-shadow:0 0 16px rgba(251,191,36,0.6);',
  ].join('');
  titleEl.textContent = "TEXAS HOLD'EM";
  canvas.appendChild(titleEl);

  const subtitleEl = document.createElement('div');
  subtitleEl.style.cssText = [
    'position:absolute;top:34px;left:16px;z-index:100;pointer-events:none;',
    'color:#f59e0b;font-size:9px;font-weight:700;letter-spacing:3px;font-family:serif;',
    'text-shadow:0 0 10px rgba(251,191,36,0.4);',
  ].join('');
  subtitleEl.textContent = 'GOD MODE EDITION - Becoming a Gran Master';
  canvas.appendChild(subtitleEl);

  // New Game button (showdown only)
  if (state.phase === 'showdown') {
    const newGameTopBtn = document.createElement('button');
    newGameTopBtn.textContent = 'New Game  ↺';
    newGameTopBtn.style.cssText = [
      'position:absolute;top:52px;left:16px;z-index:100;',
      'background:linear-gradient(135deg,#1e3a5f,#2563eb);border:1px solid #1e40af;',
      'color:white;border-radius:6px;padding:4px 10px;',
      'font-size:11px;font-weight:600;cursor:pointer;letter-spacing:0.5px;',
      'transition:filter 0.15s;',
    ].join('');
    newGameTopBtn.addEventListener('click', newGame);
    canvas.appendChild(newGameTopBtn);
  }

  // ── Settings gear button ──
  const gearBtn = document.createElement('button');
  gearBtn.textContent = '⚙';
  gearBtn.title = 'Settings';
  gearBtn.style.cssText = [
    'position:absolute;top:14px;right:16px;z-index:200;',
    'background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.2);',
    'color:#9ca3af;border-radius:8px;width:28px;height:28px;',
    'font-size:14px;cursor:pointer;',
  ].join('');
  gearBtn.addEventListener('click', () => { settingsOpen = !settingsOpen; render(); });
  canvas.appendChild(gearBtn);
  if (settingsOpen) canvas.appendChild(renderSettingsPanel());

  // ── Daily challenge banner ──
  const dc = state.dailyChallenge;
  if (gameStarted) {
    const dcEl = document.createElement('div');
    const dcPct = Math.min(100, Math.round(dc.progress / dc.goal * 100));
    dcEl.style.cssText = [
      'position:absolute;top:14px;right:54px;z-index:150;',
      'background:rgba(0,0,0,0.7);border:1px solid rgba(251,191,36,0.3);',
      'border-radius:8px;padding:4px 10px;max-width:200px;',
    ].join('');
    dcEl.innerHTML = `
      <div style="font-size:9px;color:#fbbf24;font-weight:700;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        🎯 ${dc.desc}
      </div>
      <div style="display:flex;align-items:center;gap:4px;margin-top:2px;">
        <div style="flex:1;background:#1f2937;border-radius:3px;height:3px;overflow:hidden;">
          <div style="background:${dc.completed ? '#10b981' : '#fbbf24'};height:100%;width:${dcPct}%;"></div>
        </div>
        <span style="font-size:9px;color:${dc.completed ? '#10b981' : '#9ca3af'};">
          ${dc.completed ? '✓ Done!' : `${dc.progress}/${dc.goal}`}
        </span>
      </div>`;
    canvas.appendChild(dcEl);
  }

  // Blinds — top-right (shifted left to make room for gear)
  if (state.phase !== 'idle') {
    const blindsEl = document.createElement('div');
    const isEscalated = state.smallBlind > 1_000;
    const handsToNext = state.nextBlindHandNumber - state.handNumber;
    blindsEl.style.cssText = [
      'position:absolute;top:50px;right:16px;z-index:100;pointer-events:none;',
      'background:rgba(0,0,0,0.60);border:1px solid rgba(255,255,255,0.12);',
      'border-radius:10px;padding:4px 12px;',
      `color:${isEscalated ? '#f59e0b' : '#9ca3af'};font-size:12px;letter-spacing:0.8px;`,
      'white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;gap:1px;',
    ].join('');
    const blindLine = document.createElement('div');
    blindLine.textContent = `Blinds  ${fmt(state.smallBlind)} / ${fmt(state.bigBlind)}`;
    blindsEl.appendChild(blindLine);

    if (handsToNext > 0 && state.blindLevel < 7) {
      const nextLine = document.createElement('div');
      nextLine.style.cssText = 'font-size:9px;color:#6b7280;';
      nextLine.textContent = `Next level in ${handsToNext} hand${handsToNext === 1 ? '' : 's'}`;
      blindsEl.appendChild(nextLine);
    }
    canvas.appendChild(blindsEl);
  }

  // Hand number (near phase indicator, bottom right)
  if (state.handNumber > 0 && state.phase !== 'idle') {
    const handNumEl = document.createElement('div');
    handNumEl.style.cssText = [
      'position:absolute;bottom:12px;left:12px;z-index:100;pointer-events:none;',
      'background:rgba(0,0,0,0.55);border:1px solid rgba(255,255,255,0.10);',
      'border-radius:8px;padding:3px 10px;font-size:10px;color:#6b7280;',
    ].join('');
    handNumEl.textContent = `Hand #${state.handNumber}`;
    canvas.appendChild(handNumEl);
  }

  // Hand history panel (above deck panel)
  canvas.appendChild(renderHandHistoryPanel());

  // Deck panel
  canvas.appendChild(renderDeckPanel());

  const phaseNames: Record<string, string> = {
    idle: 'Ready to Deal', dealing: 'Dealing...',
    preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn',
    river: 'River', showdown: 'Showdown',
  };
  // Phase indicator sits above the deck panel (collapsed ≈44px, expanded ≈180px)
  const deckH2      = state.phase !== 'idle' ? (deckPanelExpanded ? 180 : 44) : 0;
  const phaseCorner = document.createElement('div');
  phaseCorner.style.cssText = [
    `position:absolute;bottom:${12 + deckH2 + 8}px;right:12px;z-index:100;pointer-events:none;`,
    'display:flex;align-items:center;gap:6px;',
  ].join('');
  const phaseLbl = document.createElement('div');
  phaseLbl.className = 'phase-indicator';
  phaseLbl.textContent = phaseNames[state.phase] ?? state.phase;
  phaseCorner.appendChild(renderPhaseDots());
  phaseCorner.appendChild(phaseLbl);
  canvas.appendChild(phaseCorner);

  // Bottom HUD
  const bottomHUD = document.createElement('div');
  bottomHUD.id = 'bottom-hud';
  bottomHUD.style.cssText = [
    'position:absolute;bottom:-6px;left:0;right:0;z-index:100;',
    'display:flex;flex-direction:column;align-items:center;',
    'padding:8px 0 4px;gap:6px;',
    'background:linear-gradient(to top,rgba(0,0,0,0.80) 0%,transparent 100%);',
    'pointer-events:none;',
  ].join('');
  const hudStyle = document.createElement('style');
  hudStyle.textContent = '#bottom-hud > * { pointer-events: auto; }';
  document.head.appendChild(hudStyle);

  if (isUserTurn) bottomHUD.appendChild(renderActionPanel());

  if (state.phase === 'showdown' && state.winnerIds.length > 0) {
    const winnerNames = state.winnerIds.map(id => state.players[id].name).join(' & ');
    const hand = state.players[state.winnerIds[0]].handResult?.description ?? '';
    const winEl = document.createElement('div');
    winEl.style.cssText = 'background:linear-gradient(135deg,rgba(251,191,36,0.2),rgba(245,158,11,0.2));border:2px solid #fbbf24;border-radius:12px;padding:6px 20px;color:#fbbf24;font-size:17px;font-weight:bold;text-align:center;';
    winEl.innerHTML = `🏆 ${winnerNames} wins${hand ? ` with <em>${hand}</em>` : ''}!`;
    bottomHUD.appendChild(winEl);

    // Post-hand breakdown for user
    const user = state.players.find(p => p.isUser)!;
    const userWon = state.winnerIds.includes(user.id);
    if (userEquityAtLastStreet > 0) {
      const breakdown = document.createElement('div');
      breakdown.style.cssText = 'font-size:11px;padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.5);color:#9ca3af;';
      if (userWon && userEquityAtLastStreet < 30) {
        breakdown.style.color = '#fbbf24';
        breakdown.textContent = `You won with only ${userEquityAtLastStreet}% equity — lucky!`;
      } else if (!userWon && userEquityAtLastStreet > 60) {
        breakdown.style.color = '#f87171';
        breakdown.textContent = `You had ${userEquityAtLastStreet}% equity — bad beat!`;
      } else if (!userWon) {
        breakdown.textContent = `You had ${userEquityAtLastStreet}% equity — tough spot.`;
      }
      if (breakdown.textContent) bottomHUD.appendChild(breakdown);
    }

    const userBusted  = user.chips <= 0;
    const seated      = seatedPlayers(state).length;
    const gameOver    = seated <= 1;
    const userIsChamp = gameOver && !userBusted;

    const msgRow = document.createElement('div');
    msgRow.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px;';
    if (userIsChamp) {
      const m = document.createElement('div');
      m.style.cssText = 'background:linear-gradient(135deg,rgba(251,191,36,0.25),rgba(249,115,22,0.25));border:2px solid #f59e0b;border-radius:10px;padding:6px 18px;color:#fbbf24;font-size:15px;font-weight:700;animation:winnerBounce 0.8s ease-in-out infinite;';
      m.textContent = '🏆 You won the tournament!'; msgRow.appendChild(m);
    } else if (userBusted) {
      const m = document.createElement('div');
      m.style.cssText = 'background:rgba(239,68,68,0.15);border:1px solid #ef4444;border-radius:8px;padding:5px 14px;color:#f87171;font-size:13px;font-weight:600;';
      m.textContent = "💸 You're out of chips!"; msgRow.appendChild(m);
      // New Game button directly in the actions area
      const bustBtn = document.createElement('button');
      bustBtn.className = 'btn-action';
      bustBtn.style.cssText = [
        'background:linear-gradient(135deg,#7f1d1d,#dc2626);border-color:#b91c1c;',
        'margin-top:6px;padding-bottom:12px;margin-bottom:20px;',
      ].join('');
      bustBtn.textContent = 'New Game  ↺';
      bustBtn.addEventListener('click', newGame);
      msgRow.appendChild(bustBtn);
    } else if (gameOver) {
      const m = document.createElement('div');
      m.style.cssText = 'font-size:13px;color:#fbbf24;font-weight:600;';
      m.textContent = '🏆 Tournament over!'; msgRow.appendChild(m);
    } else {
      const m = document.createElement('div');
      m.style.cssText = 'font-size:11px;color:#9ca3af;';
      m.textContent = `${seated} players remaining`; msgRow.appendChild(m);
    }
    // ── Poker Teacher analysis panel ─────────────────────────────────────────
    if (postHandNotes.length > 0) {
      interface TeacherNoteObj { icon: string; text: string; detail?: string; }
      const parsed: TeacherNoteObj[] = [];
      for (const raw of postHandNotes) {
        try { parsed.push(JSON.parse(raw)); } catch { parsed.push({ icon: '📖', text: raw }); }
      }

      const teachPanel = document.createElement('div');
      teachPanel.style.cssText = [
        'background:linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.95));',
        'border:1px solid rgba(99,102,241,0.35);border-radius:12px;',
        'padding:12px 14px;max-width:420px;text-align:left;',
        'box-shadow:0 4px 24px rgba(0,0,0,0.5);',
        'margin-top:4px;',
      ].join('');

      // Header
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:10px;border-bottom:1px solid rgba(99,102,241,0.25);padding-bottom:7px;';
      hdr.innerHTML = `
        <span style="font-size:15px;">🎓</span>
        <span style="font-size:11px;font-weight:700;color:#a5b4fc;letter-spacing:1.2px;text-transform:uppercase;">Poker Teacher</span>
        ${teacherCtx ? `<span style="font-size:10px;color:#6b7280;margin-left:auto;">${teacherCtx.userHoleCards}</span>` : ''}
      `;
      teachPanel.appendChild(hdr);

      // Notes
      const iconColor: Record<string, string> = {
        '✅': '#4ade80',
        '⚠️': '#fb923c',
        '❌': '#f87171',
        '💡': '#fbbf24',
        '🍀': '#34d399',
        '💔': '#f472b6',
        '📖': '#93c5fd',
      };

      for (const note of parsed) {
        const color = iconColor[note.icon] ?? '#d1d5db';
        const row = document.createElement('div');
        row.style.cssText = [
          `border-left:3px solid ${color};`,
          'padding:7px 10px;margin-bottom:7px;border-radius:0 6px 6px 0;',
          'background:rgba(0,0,0,0.25);',
        ].join('');

        const headline = document.createElement('div');
        headline.style.cssText = `font-size:12px;font-weight:700;color:${color};margin-bottom:${note.detail ? '4px' : '0'};`;
        headline.textContent = `${note.icon}  ${note.text}`;
        row.appendChild(headline);

        if (note.detail) {
          const det = document.createElement('div');
          det.style.cssText = 'font-size:11px;color:#94a3b8;line-height:1.5;';
          det.textContent = note.detail;
          row.appendChild(det);
        }

        teachPanel.appendChild(row);
      }

      // Footer hint
      const foot = document.createElement('div');
      foot.style.cssText = 'font-size:10px;color:#4b5563;text-align:right;margin-top:2px;';
      foot.textContent = 'Analysis resets each hand';
      teachPanel.appendChild(foot);

      msgRow.appendChild(teachPanel);
    }

    // ── Session dashboard (shown at game end) ────────────────────────────────
    if (userBusted || userIsChamp) {
      const ss = state.sessionStats;
      const userNow = state.players.find(p => p.isUser)!;
      const winRate = ss.handsPlayed > 0 ? Math.round(ss.handsWon / ss.handsPlayed * 100) : 0;
      const dash = document.createElement('div');
      dash.style.cssText = [
        'background:rgba(0,0,0,0.75);border:1px solid rgba(255,255,255,0.1);',
        'border-radius:12px;padding:12px 18px;max-width:340px;text-align:center;margin-top:6px;',
      ].join('');
      dash.innerHTML = `
        <div style="color:#fbbf24;font-weight:700;font-size:12px;margin-bottom:8px;letter-spacing:1px;">📊 SESSION SUMMARY</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11px;margin-bottom:6px;">
          <div><div style="color:#6b7280;">Hands</div><div style="color:#e5e7eb;font-weight:700;">${ss.handsPlayed}</div></div>
          <div><div style="color:#6b7280;">Won</div><div style="color:#4ade80;font-weight:700;">${ss.handsWon}</div></div>
          <div><div style="color:#6b7280;">Win Rate</div><div style="color:#fbbf24;font-weight:700;">${winRate}%</div></div>
          <div><div style="color:#6b7280;">Best Pot</div><div style="color:#fbbf24;font-weight:700;">${fmt(ss.biggestPot)}</div></div>
          <div><div style="color:#6b7280;">Net Chips</div><div style="color:${ss.netChips >= 0 ? '#4ade80' : '#f87171'};font-weight:700;">${ss.netChips >= 0 ? '+' : ''}${fmt(ss.netChips)}</div></div>
          <div><div style="color:#6b7280;">Level</div><div style="color:#a78bfa;font-weight:700;">Lv ${userNow.level}</div></div>
        </div>
        <div style="font-size:10px;color:#4b5563;">${userNow.xp.toLocaleString()} total XP</div>`;
      msgRow.appendChild(dash);

      // ── Session leak finder (20+ hands) ────────────────────────────────────
      if (ss.handsPlayed >= 20) {
        const leaks: string[] = [];
        const u = userNow;
        const uVpip = u.handsPlayed > 0 ? u.vpipCount / u.handsPlayed : 0;
        const uFCB  = u.foldToCBetOpps > 5 ? u.foldToCBetCount / u.foldToCBetOpps : null;
        const u3b   = u.threeBetOpps   > 5 ? u.threeBetCount   / u.threeBetOpps   : null;

        if (uVpip > 0.48)       leaks.push('📉 Playing too many hands preflop (VPIP ' + Math.round(uVpip*100) + '% — tighten up UTG/MP)');
        if (uVpip < 0.14)       leaks.push('📉 Playing too tight preflop (VPIP ' + Math.round(uVpip*100) + '% — open wider from late position)');
        if (uFCB !== null && uFCB > 0.72) leaks.push('📉 Folding to c-bets too often (' + Math.round(uFCB*100) + '%) — float more on good textures');
        if (uFCB !== null && uFCB < 0.28) leaks.push('📉 Calling c-bets too liberally (' + Math.round(uFCB*100) + '%) — tighten your flop defence range');
        if (u3b !== null && u3b < 0.04)   leaks.push('📉 Almost never 3-betting (' + Math.round(u3b*100) + '%) — add more 3-bets for value and as bluffs');
        if (winRate < 25 && ss.handsPlayed >= 30) leaks.push('📉 Win rate ' + winRate + '% — review pot odds decisions (use the Hand Analysis hints each hand)');

        if (leaks.length > 0) {
          const leakEl = document.createElement('div');
          leakEl.style.cssText = 'margin-top:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;text-align:left;';
          leakEl.innerHTML = `<div style="font-size:10px;color:#6b7280;letter-spacing:1px;margin-bottom:4px;text-transform:uppercase;">🔍 Session Leaks</div>`
            + leaks.map(l => `<div style="font-size:10px;color:#fbbf24;margin-bottom:3px;">${l}</div>`).join('');
          dash.appendChild(leakEl);
        }
      }
    }

    bottomHUD.appendChild(msgRow);

    if (!gameOver && !userBusted && !userIsChamp) {
      const actionRow = document.createElement('div');
      actionRow.style.cssText = 'display:flex;gap:12px;';
      const newHandBtn = document.createElement('button');
      newHandBtn.className = 'btn-action btn-new-game';
      newHandBtn.style.paddingBottom = '12px';
      newHandBtn.style.marginBottom  = '20px';
      newHandBtn.textContent = 'New Hand  ♻';
      newHandBtn.addEventListener('click', newHand);
      actionRow.appendChild(newHandBtn);
      bottomHUD.appendChild(actionRow);
    }
  }

  // ── Rabbit hunting button (shown while hand is live and user has folded) ──
  const userFolded = state.players.find(p => p.isUser)?.isFolded ?? false;
  if (rabbitCards.length > 0 && userFolded && state.phase !== 'showdown' && state.phase !== 'idle') {
    const rabbitWrap = document.createElement('div');
    rabbitWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:6px;';
    const rabbitBtn = document.createElement('button');
    rabbitBtn.textContent = showRabbit ? '🃏 Hide rabbit cards' : '🐇 What if? (rabbit hunt)';
    rabbitBtn.style.cssText = 'background:#1e3a5f;border:1px solid #1e40af;color:#93c5fd;border-radius:8px;padding:6px 14px;font-size:11px;cursor:pointer;letter-spacing:0.5px;';
    rabbitBtn.addEventListener('click', () => { showRabbit = !showRabbit; render(); });
    rabbitWrap.appendChild(rabbitBtn);
    if (showRabbit) {
      const rabbitRow = document.createElement('div');
      rabbitRow.style.cssText = 'display:flex;gap:6px;align-items:center;';
      const lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:10px;color:#6b7280;margin-right:4px;';
      lbl.textContent = 'Would have come:';
      rabbitRow.appendChild(lbl);
      for (const card of rabbitCards) rabbitRow.appendChild(createCardEl(card, true));
      rabbitWrap.appendChild(rabbitRow);
    }
    bottomHUD.appendChild(rabbitWrap);
  }

  canvas.appendChild(bottomHUD);

  // Deal Cards button
  if (state.phase === 'idle' && !dealingInProgress && !gameStarted) {
    const btn = document.createElement('button');
    btn.className = 'btn-action btn-new-game';
    btn.textContent = 'Deal Cards';
    btn.style.cssText += [
      'position:absolute;top:calc(50% + 76px);left:50%;',
      'transform:translate(-50%,-50%);',
      'z-index:200;font-size:20px;padding:16px 48px;',
    ].join('');
    btn.addEventListener('click', playHand);
    canvas.appendChild(btn);
  }
  app.appendChild(canvas);

  applyCanvasScale();
}

// ─── Time bank ────────────────────────────────────────────────────────────────
function startTimeBank(): void {
  timeBankSeconds = 30;
  if (timeBankInterval) clearInterval(timeBankInterval);
  timeBankInterval = setInterval(() => {
    timeBankSeconds--;
    render();
    if (timeBankSeconds <= 0) {
      stopTimeBank();
      const u = state.players.find(p => p.isUser)!;
      const ca = Math.min(state.currentBet - u.roundBet, u.chips);
      handleUserAction(ca === 0 ? { type: 'check' } : { type: 'fold' });
    }
  }, 1000);
}

function stopTimeBank(): void {
  if (timeBankInterval !== null) { clearInterval(timeBankInterval); timeBankInterval = null; }
}

// ─── User action resolution ───────────────────────────────────────────────────
function handleUserAction(action: BetAction): void {
  if (!userActionResolve) return;
  stopTimeBank();
  isUserTurn = false;
  const resolve = userActionResolve;
  userActionResolve = null;
  resolve(action);
}

async function waitForUserAction(): Promise<BetAction> {
  const user = state.players.find(p => p.isUser)!;
  const minRaiseTotal = state.currentBet + state.minRaise;
  raiseAmount = Math.min(minRaiseTotal, user.chips + user.roundBet);
  isUserTurn = true;
  render();
  startTimeBank();
  return new Promise(resolve => { userActionResolve = resolve; });
}

// ─── Timing tells: compute think time based on hand strength ─────────────────
export function computeThinkTime(player: Player, equities: Map<number, number>): number {
  const equity = equities.get(player.id) ?? 0.5;
  // Monster hand or easy fold: snap (near 0ms)
  if (equity > 0.75 || equity < 0.10) {
    return 50 + Math.random() * 150;
  }
  // Marginal/difficult spot: long think
  if (equity > 0.30 && equity < 0.55) {
    return 800 + Math.random() * 400;
  }
  // Default range
  return 175 + (1 - player.skill) * 325 + Math.random() * 200;
}

// ─── Betting round ────────────────────────────────────────────────────────────
async function runBettingRound(): Promise<boolean> {
  while (true) {
    const active = activePlayers(state);
    if (active.length <= 1) return false;

    if (isRoundComplete(state)) break;

    // If every active opponent is all-in and there is no outstanding bet to
    // call, no meaningful betting is possible — deal the remaining streets out.
    const notAllIn     = active.filter(p => !p.isAllIn);
    const pendingCall  = notAllIn.some(p => p.roundBet < state.currentBet);
    if (notAllIn.length <= 1 && !pendingCall) break;

    const next = getNextToAct(state);
    if (!next) break;

    if (next.isUser) {
      const action = await waitForUserAction();

      // ── Track decision for post-hand GTO analysis ──
      {
        const equity        = winOdds ? Math.round(winOdds.fair.equityPct) : 50;
        const facing        = Math.max(0, state.currentBet - next.roundBet);
        const callAmt       = facing;
        const potOdds       = callAmt > 0 ? Math.round(callAmt / (state.pot + callAmt) * 100) : 0;
        const wasAggressor  = facing > 0;
        const raiseTot      = (action.type === 'raise' && action.amount != null) ? action.amount : 0;
        let decAction: HandDecision['action'] = action.type as HandDecision['action'];
        if (action.type === 'allIn' && facing === 0) decAction = 'bet';
        handDecisions.push({
          street: state.phase,
          action: decAction,
          potOdds,
          equity,
          potSize: state.pot,
          betFacing: callAmt,
          raiseAmount: raiseTot,
          communityCount: state.communityCards.length,
          wasAggressor,
        });
      }

      // Rabbit hunting: compute remaining community cards before applying fold
      if (action.type === 'fold') {
        const remaining = 5 - state.communityCards.length;
        if (remaining > 0) {
          const deckCopy = [...state.deck];
          const rCards: Card[] = [];
          for (let i = 0; i < remaining && deckCopy.length > 0; i++) {
            deckCopy.shift(); // burn card
            const c = deckCopy.shift();
            if (c) rCards.push(c);
          }
          rabbitCards = rCards;
        } else {
          rabbitCards = [];
        }
        showRabbit = false;
        // Track daily challenge
        state = { ...state, dailyChallenge: advanceChallenge(state.dailyChallenge, 'fold') };
        // Track user profile: was facing a raise?
        if (state.currentBet > next.roundBet) {
          state = { ...state, userProfile: { ...state.userProfile, foldToThreeBetOpps: state.userProfile.foldToThreeBetOpps + 1, foldToThreeBetCount: state.userProfile.foldToThreeBetCount + 1 } };
        }
      } else if (action.type === 'raise' || action.type === 'allIn') {
        // Track preflop open for user profile
        if (state.phase === 'preflop') {
          state = { ...state, userProfile: { ...state.userProfile, openCount: state.userProfile.openCount + 1 } };
        }
        // Was facing a raise → track opportunity but NOT count as fold
        if (state.currentBet > next.roundBet) {
          state = { ...state, userProfile: { ...state.userProfile, foldToThreeBetOpps: state.userProfile.foldToThreeBetOpps + 1 } };
        }
        rabbitCards = [];
      } else {
        rabbitCards = [];
      }

      const prevBet = next.roundBet;
      state = applyBetAction(state, next.id, action);
      lastActionResult = { id: next.id, label: actionLabel(action), color: actionColor(action) };
      const added = state.players[next.id].roundBet - prevBet;
      if (added > 0) {
        if (action.type === 'raise' || action.type === 'allIn') playChipRaise();
        animateChipsToPot(next.id, added);
      }
      if (action.type === 'fold') playCardFold();

      // Check achievements
      checkAchievements();
      render();
      await sleep(400);
      lastActionResult = null;
    } else {
      // AI turn
      thinkingPlayerId = next.id;
      render();

      const equities  = calcAllEquities(state);
      const thinkTime = computeThinkTime(next, equities);
      await sleep(thinkTime);
      thinkingPlayerId = null;

      const action   = decideAIBet(state, next, equities);
      const prevBet  = next.roundBet;
      state = applyBetAction(state, next.id, action);
      lastActionResult = { id: next.id, label: actionLabel(action), color: actionColor(action) };
      const added = state.players[next.id].roundBet - prevBet;
      if (added > 0) {
        if (action.type === 'raise' || action.type === 'allIn') playChipRaise();
        animateChipsToPot(next.id, added);
      }
      if (action.type === 'fold') playCardFold();

      // Speech bubble
      showSpeechBubble(next.id, action.type);

      render();
      await sleep(action.type === 'fold' ? 600 : 350);
      lastActionResult = null;
    }

    if (activePlayers(state).length <= 1) return false;
  }

  render();
  return activePlayers(state).length > 1;
}

// ─── Community card animations ────────────────────────────────────────────────
async function animateFlop(): Promise<void> {
  await sleep(50);
  const el = document.getElementById('community-cards');
  if (el) {
    const cards = el.querySelectorAll<HTMLElement>('.community-card');
    for (let i = 0; i < cards.length; i++) {
      await sleep(i * 150);
      cards[i].classList.add('slide-in');
      playCardFlip();
    }
  }
  await sleep(500);
}

async function animateOneCard(): Promise<void> {
  await sleep(80);
  const el = document.getElementById('community-cards');
  if (el) {
    const cards = el.querySelectorAll<HTMLElement>('.community-card');
    if (cards.length > 0) {
      cards[cards.length - 1].classList.add('slide-in');
      playCardFlip();
    }
  }
  await sleep(400);
}

// ─── Deal animation ───────────────────────────────────────────────────────────
async function animateDealCards(): Promise<void> {
  dealingInProgress     = true;
  holeCardDealInProgress = true;
  state = dealHoleCards(state);
  render();

  const nonBustedCount = state.players.filter(p => !p.isBusted).length;
  const dealStartSeat  = nonBustedCount === 2
    ? state.dealerButtonPosition
    : (state.dealerButtonPosition - 1 + 8) % 8;

  const dealOrder: number[] = [];
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 8; i++) {
      dealOrder.push(((dealStartSeat - i) % 8 + 8) % 8);
    }
  }

  const visualCards = new Map(state.players.map(p => [p.id, [] as Card[]]));
  for (const seatId of dealOrder) {
    const player = state.players[seatId];
    if (player.isBusted) continue;
    const dealt = visualCards.get(seatId)!;
    const card  = player.holeCards[dealt.length];
    if (!card) continue;
    dealt.push(card);
    const container = document.getElementById(`player-cards-${seatId}`);
    if (container) container.appendChild(createCardEl(card, player.isUser, 'dealing'));
    playCardDeal();
    await sleep(80);
  }

  holeCardDealInProgress = false;
  dealingInProgress      = false;
}

// ─── Showdown ─────────────────────────────────────────────────────────────────
async function doShowdown(): Promise<void> {
  const potBeforeAward = state.pot;
  state = evaluateHands(state);
  state = awardPot(state);

  // Record hand history
  const winner   = state.players[state.winnerIds[0]];
  const handDesc = winner.handResult?.description ?? '';
  const user     = state.players.find(p => p.isUser)!;
  handHistory.push({
    handNum:      state.handNumber,
    winnerName:   winner.name,
    handDesc,
    potSize:      potBeforeAward,
    wasUserWinner: state.winnerIds.includes(user.id),
  });

  render();
  await sleep(600); // dramatic pause before reveal

  // Reveal opponent cards one at a time with flip animation
  const opponentsToReveal = state.players.filter(
    p => !p.isUser && !p.isBusted && !p.isFolded
  );
  for (const player of opponentsToReveal) {
    document.getElementById(`player-cards-${player.id}`)
      ?.querySelectorAll<HTMLElement>('.card')
      .forEach(c => c.classList.add('flip-in'));
    playCardFanFlip();
    await sleep(300);
  }

  await sleep(200);

  // Chip slide to winner
  if (state.winnerIds.length > 0) {
    animateChipsToWinner(state.winnerIds[0], potBeforeAward);
  }

  // Confetti for user win
  if (state.winnerIds.includes(user.id)) {
    burstConfetti();
  }

  // Play sound
  playHandEndSounds(state.winnerIds, user);

  // ── Session stats, XP, daily challenge ─────────────────────────────────────
  const userWonHand = state.winnerIds.includes(user.id);
  const ss = state.sessionStats;
  state = {
    ...state,
    sessionStats: {
      handsPlayed: ss.handsPlayed + 1,
      handsWon:    ss.handsWon + (userWonHand ? 1 : 0),
      biggestPot:  Math.max(ss.biggestPot, potBeforeAward),
      netChips:    state.players.find(p => p.isUser)!.chips - STARTING_CHIPS,
      byPosition:  ss.byPosition,
    },
  };

  if (userWonHand) {
    const xpGain = potBeforeAward > 50_000 ? 250 : 100;
    state = awardXP(state, user.id, xpGain);
  }
  if (seatedPlayers(state).length <= 3 && !user.isBusted) {
    state = awardXP(state, user.id, 50); // survival bonus
  }

  let dc = state.dailyChallenge;
  if (userWonHand) {
    dc = advanceChallenge(dc, 'win');
    if (potBeforeAward > 50_000) dc = advanceChallenge(dc, 'bigpot');
    if (user.isAllIn)            dc = advanceChallenge(dc, 'allin-win');
  }
  dc = advanceChallenge(dc, 'survive');
  state = { ...state, dailyChallenge: dc };

  // ── GTO / mistake analysis ──────────────────────────────────────────────────
  const userFresh = state.players.find(p => p.isUser)!;
  teacherCtx = {
    userHoleCards: user.holeCards.map(c => `${c.rank}${getSuitSymbol(c.suit)}`).join(' '),
    finalHandDesc: userFresh.handResult?.description ?? (user.isFolded ? 'Folded' : 'Unknown'),
    userWon: state.winnerIds.includes(user.id),
    finalEquity: userEquityAtLastStreet,
    potSize: potBeforeAward,
    foldedPreflop: user.isFolded && state.communityCards.length === 0,
    wentToShowdown: state.phase === 'showdown' && !user.isFolded,
  };
  postHandNotes = buildPostHandAnalysis(potBeforeAward, user, state);

  render(); // re-render so the teacher panel appears

  saveGame(state);

  // Check and update achievements
  checkAndGrantHandEndAchievements(potBeforeAward, user);
}

// ─── Post-hand GTO analysis (Poker Teacher) ──────────────────────────────────
interface TeacherNote {
  icon: '✅' | '⚠️' | '❌' | '💡' | '🍀' | '💔' | '📖';
  text: string;
  detail?: string; // optional "why" explanation
}

function buildPostHandAnalysis(potSize: number, user: Player, gs: GameState): string[] {
  // We encode notes as JSON strings so the UI can parse them into TeacherNote objects.
  const notes: TeacherNote[] = [];
  const userWon = gs.winnerIds.includes(user.id);
  const ctx = teacherCtx;

  // ── Decision-by-decision review ───────────────────────────────────────────
  for (const d of handDecisions) {
    const street = d.street.charAt(0).toUpperCase() + d.street.slice(1);
    const eq     = d.equity;
    const po     = d.potOdds;
    const diff   = eq - po; // positive = had more equity than needed

    if (d.action === 'fold' && d.betFacing > 0) {
      if (eq > po + 10) {
        notes.push({
          icon: '❌',
          text: `${street}: Folded too often`,
          detail: `You folded with ${eq}% equity but only needed ${po}% to call profitably. The pot was offering you good odds — this was a –EV fold. Next time, call here.`,
        });
      } else if (eq > po + 3) {
        notes.push({
          icon: '⚠️',
          text: `${street}: Marginal fold`,
          detail: `You had ${eq}% equity vs ${po}% needed. This is borderline — a call would have been slightly +EV. Consider calling in similar spots.`,
        });
      } else if (eq <= po) {
        notes.push({
          icon: '✅',
          text: `${street}: Good fold`,
          detail: `With only ${eq}% equity you needed ${po}% to break even. Folding was the correct +EV decision. Well done.`,
        });
      }
    }

    if (d.action === 'call' && d.betFacing > 0) {
      if (eq < po - 8) {
        notes.push({
          icon: '❌',
          text: `${street}: –EV call`,
          detail: `You called needing ${po}% equity to break even, but only had ~${eq}%. Over time these calls lose money. Consider folding here.`,
        });
      } else if (eq < po - 2) {
        notes.push({
          icon: '⚠️',
          text: `${street}: Slightly –EV call`,
          detail: `Close spot: ${eq}% equity vs ${po}% needed. Marginally unprofitable, but if you have implied odds or a draw, it can be okay.`,
        });
      } else if (diff >= 0) {
        notes.push({
          icon: '✅',
          text: `${street}: Correct call`,
          detail: `${eq}% equity vs ${po}% needed — you had a clear +EV call. The math supported calling.`,
        });
      }
    }

    if ((d.action === 'raise' || d.action === 'allIn') && d.betFacing > 0) {
      if (eq >= 55) {
        notes.push({
          icon: '✅',
          text: `${street}: Good re-raise`,
          detail: `Re-raising with ${eq}% equity is correct — you had a strong hand and built the pot for value.`,
        });
      } else if (eq >= 35) {
        notes.push({
          icon: '💡',
          text: `${street}: Semi-bluff raise`,
          detail: `Raising with ${eq}% equity can be a fine semi-bluff (fold equity + draw). Just make sure the bet size is correct.`,
        });
      } else if (eq < 25) {
        notes.push({
          icon: '⚠️',
          text: `${street}: Risky raise`,
          detail: `Raising with only ${eq}% equity without a clear draw is dangerous. Make sure you have strong fold equity or a backdoor draw.`,
        });
      }
    }

    if (d.action === 'check' && !d.wasAggressor) {
      if (eq >= 65 && d.communityCount >= 3) {
        notes.push({
          icon: '💡',
          text: `${street}: Consider betting for value`,
          detail: `With ${eq}% equity you had a strong hand — checking lets opponents see free cards and may miss value. Bet 50–70% of the pot here.`,
        });
      }
    }

    if ((d.action === 'raise' || d.action === 'bet') && !d.wasAggressor) {
      if (eq >= 60) {
        notes.push({
          icon: '✅',
          text: `${street}: Good value bet`,
          detail: `Betting with ${eq}% equity is correct — build the pot while you're ahead.`,
        });
      }
    }
  }

  // ── Hand outcome notes ─────────────────────────────────────────────────────
  const finalEq = ctx?.finalEquity ?? 0;
  if (userWon && finalEq > 0 && finalEq < 25) {
    notes.push({
      icon: '🍀',
      text: 'Lucky win!',
      detail: `You won with only ${Math.round(finalEq)}% equity before the final card. Sometimes you get lucky — but don't rely on it.`,
    });
  }
  if (!userWon && finalEq > 70) {
    notes.push({
      icon: '💔',
      text: 'Bad beat',
      detail: `You had ${Math.round(finalEq)}% equity and still lost — that's a bad beat. Your play was likely correct; variance happens.`,
    });
  }

  // ── General poker tips when no specific mistakes ───────────────────────────
  if (notes.length === 0) {
    if (ctx?.foldedPreflop) {
      notes.push({
        icon: '📖',
        text: 'You folded pre-flop',
        detail: 'No decisions to review. If you folded a marginal hand to a raise, that is usually correct. Focus on starting hand selection.',
      });
    } else if (ctx?.wentToShowdown && userWon) {
      notes.push({
        icon: '✅',
        text: 'Clean hand — no major mistakes',
        detail: `You held ${ctx?.userHoleCards ?? 'your hand'} and won with ${ctx?.finalHandDesc ?? 'a strong hand'}. Your decisions aligned with the math.`,
      });
    } else if (ctx?.wentToShowdown && !userWon) {
      notes.push({
        icon: '📖',
        text: 'Reached showdown and lost',
        detail: `You finished with ${ctx?.finalHandDesc ?? 'a hand'} — sometimes the opponent simply has a better hand. Review if any calls were –EV.`,
      });
    }
  }

  // ── Preflop aggressor c-bet tip ────────────────────────────────────────────
  if (user.wasPreFlopAggressor && gs.communityCards.length >= 3) {
    const hasCbetOnFlop = handDecisions.some(d => d.street === 'flop' && (d.action === 'raise' || d.action === 'bet' || (d.action === 'allIn' && !d.wasAggressor)));
    if (!hasCbetOnFlop) {
      notes.push({
        icon: '💡',
        text: 'Missed c-bet opportunity',
        detail: 'As the pre-flop aggressor you should continuation-bet (~60% pot) on most flops. It represents range advantage and forces opponents to defend.',
      });
    }
  }

  // Serialize to strings so existing infrastructure works
  return notes.map(n => JSON.stringify(n));
}

// ─── Achievement checks ───────────────────────────────────────────────────────
function checkAchievements(): void {
  // nothing to check mid-action currently
}

function checkAndGrantHandEndAchievements(potSize: number, user: Player): void {
  const userWon = state.winnerIds.includes(user.id);

  if (userWon) {
    // First Blood
    unlockAchievement('first_blood', 'First Blood');

    // Track consecutive wins
    consecutiveWins++;
    if (consecutiveWins >= 3) {
      unlockAchievement('bully', 'Bully');
    }

    // Lucky Draw: won with equity < 30%
    if (userEquityAtLastStreet > 0 && userEquityAtLastStreet < 30) {
      unlockAchievement('lucky_draw', 'Lucky Draw');
    }

    // Big Bluff: won a pot of 50,000+ (achievement tracks pots won)
    if (potSize >= 50_000) {
      // We can't reliably know if it was "without best hand pre-river",
      // so we award for winning a big pot
      unlockAchievement('big_bluff', 'Big Bluff');
    }
  } else {
    consecutiveWins = 0;
  }

  // Survivor: only 1 seated player left (tournament win)
  if (seatedPlayers(state).length <= 1 && !user.isBusted) {
    unlockAchievement('survivor', 'Survivor');
  }
}

// ─── Early-exit showdown (everyone folded) ────────────────────────────────────
async function endByFold(): Promise<void> {
  const winner = activePlayers(state)[0];

  await sleep(500);

  const potBeforeAward = state.pot;
  state = { ...state, winnerIds: [winner.id], phase: 'showdown' };
  state = awardPot(state);

  // Record hand history
  const user = state.players.find(p => p.isUser)!;
  handHistory.push({
    handNum:      state.handNumber,
    winnerName:   winner.name,
    handDesc:     'fold',
    potSize:      potBeforeAward,
    wasUserWinner: winner.isUser,
  });

  render();

  await sleep(300);
  document
    .getElementById(`player-cards-${winner.id}`)
    ?.querySelectorAll<HTMLElement>('.card')
    .forEach(c => c.classList.add('flip-in'));

  await sleep(800);

  if (state.winnerIds.includes(user.id)) {
    burstConfetti();
  }

  playHandEndSounds(state.winnerIds, user);

  // Session stats + XP + challenge (fold win)
  const userWonFold = state.winnerIds.includes(user.id);
  const ssf = state.sessionStats;
  state = {
    ...state,
    sessionStats: {
      handsPlayed: ssf.handsPlayed + 1,
      handsWon:    ssf.handsWon + (userWonFold ? 1 : 0),
      biggestPot:  Math.max(ssf.biggestPot, potBeforeAward),
      netChips:    state.players.find(p => p.isUser)!.chips - STARTING_CHIPS,
      byPosition:  ssf.byPosition,
    },
  };
  if (userWonFold) {
    state = awardXP(state, user.id, 100);
    let dc2 = state.dailyChallenge;
    dc2 = advanceChallenge(dc2, 'win');
    state = { ...state, dailyChallenge: dc2 };
  }
  state = { ...state, dailyChallenge: advanceChallenge(state.dailyChallenge, 'survive') };

  // ── GTO / mistake analysis (fold path) ─────────────────────────────────────
  const userFreshF = state.players.find(p => p.isUser)!;
  teacherCtx = {
    userHoleCards: user.holeCards.map(c => `${c.rank}${getSuitSymbol(c.suit)}`).join(' '),
    finalHandDesc: 'Folded',
    userWon: userWonFold,
    finalEquity: userEquityAtLastStreet,
    potSize: potBeforeAward,
    foldedPreflop: user.isFolded && state.communityCards.length === 0,
    wentToShowdown: false,
  };
  postHandNotes = buildPostHandAnalysis(potBeforeAward, userFreshF, state);

  render(); // re-render so the teacher panel appears

  saveGame(state);

  checkAndGrantHandEndAchievements(potBeforeAward, user);
}

// ─── Full hand orchestration ──────────────────────────────────────────────────
async function playHand(): Promise<void> {
  if (seatedPlayers(state).length < 2) {
    render();
    return;
  }

  gameStarted = true;
  equityHistory = [];
  rabbitCards   = [];
  showRabbit    = false;
  render();

  await sleep(700);

  dealingInProgress = true;
  render();

  // Shuffle sound before dealing
  playShuffleSound();
  await sleep(400);

  const preBlindBets = state.players.map(p => p.roundBet);
  state = postBlinds(state);
  render();
  state.players.forEach((p, i) => {
    const added = p.roundBet - preBlindBets[i];
    if (added > 0) animateChipsToPot(i, added);
  });
  await sleep(500);

  await animateDealCards();
  render();

  // Pre-flop betting — snapshot equity for sparkline
  { const user = state.players.find(p => p.isUser)!;
    if (winOdds) equityHistory.push(winOdds.fair.equityPct);
    state = { ...state, userProfile: { ...state.userProfile, handsDealt: state.userProfile.handsDealt + 1 } };
  }
  if (!(await runBettingRound())) { await endByFold(); return; }

  // Flop
  dealingInProgress = true;
  state = dealFlop(state);
  render();
  await animateFlop();
  dealingInProgress = false;
  render();
  if (winOdds) equityHistory.push(winOdds.fair.equityPct);
  if (!(await runBettingRound())) { await endByFold(); return; }

  // Turn
  dealingInProgress = true;
  state = dealTurn(state);
  render();
  await animateOneCard();
  dealingInProgress = false;
  render();
  if (winOdds) equityHistory.push(winOdds.fair.equityPct);
  if (!(await runBettingRound())) { await endByFold(); return; }

  // River
  dealingInProgress = true;
  state = dealRiver(state);
  render();
  await animateOneCard();
  dealingInProgress = false;
  render();
  if (winOdds) equityHistory.push(winOdds.fair.equityPct);
  if (!(await runBettingRound())) { await endByFold(); return; }

  await doShowdown();
}

// ─── New hand / new game ──────────────────────────────────────────────────────
function newHand(): void {
  dealerJustMoved      = true;
  userEquityAtLastStreet = 0;
  rabbitCards          = [];
  showRabbit           = false;
  equityHistory        = [];
  handDecisions        = [];
  postHandNotes        = [];
  teacherCtx           = null;
  stopTimeBank();

  state = initHand(state);
  revealedCards.clear();
  thinkingPlayerId  = null;
  lastActionResult  = null;
  isUserTurn        = false;
  userActionResolve = null;
  render();

  setTimeout(() => { dealerJustMoved = false; }, 600);
  playHand();
}

function newGame(): void {
  clearSave();
  state = initGame();
  gameStarted          = false;
  revealedCards.clear();
  thinkingPlayerId     = null;
  lastActionResult     = null;
  isUserTurn           = false;
  userActionResolve    = null;
  consecutiveWins      = 0;
  userEquityAtLastStreet = 0;
  handHistory.length   = 0;
  rabbitCards          = [];
  showRabbit           = false;
  equityHistory        = [];
  settingsOpen         = false;
  stopTimeBank();
  render();
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
animLayer = document.createElement('div');
animLayer.id = 'anim-layer';
animLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:500;overflow:hidden;';
document.body.appendChild(animLayer);

// Try to resume a saved game
const _saved = loadGame();
if (_saved) {
  state = _saved;
  gameStarted = seatedPlayers(_saved).length < 8 || _saved.phase !== 'idle';
  showToast('Saved game loaded — press New Hand to continue');
}

render();
window.addEventListener('resize', applyCanvasScale);

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
window.addEventListener('keydown', (e: KeyboardEvent) => {
  // Close settings on Escape
  if (e.key === 'Escape' && settingsOpen) { settingsOpen = false; render(); return; }

  if (!isUserTurn || !userActionResolve) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;

  const u  = state.players.find(p => p.isUser)!;
  const ca = Math.min(state.currentBet - u.roundBet, u.chips);

  switch (e.key.toLowerCase()) {
    case 'f': handleUserAction({ type: 'fold' }); break;
    case 'c':
      handleUserAction(ca === 0 ? { type: 'check' } : ca >= u.chips ? { type: 'allIn' } : { type: 'call' });
      break;
    case 'r': {
      const maxT = u.chips + u.roundBet;
      const minT = state.currentBet + state.minRaise;
      if (maxT > minT) handleUserAction({ type: 'raise', amount: raiseAmount });
      break;
    }
    case 'a': handleUserAction({ type: 'allIn' }); break;
  }
});
