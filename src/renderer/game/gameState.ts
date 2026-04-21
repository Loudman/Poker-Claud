import { Card, createDeck, shuffleDeck } from './deck';
import { HandResult, evaluateBestHand } from './handEvaluator';

export const SMALL_BLIND   = 1_000;
export const BIG_BLIND     = 2_000;
export const STARTING_CHIPS = 100_000;

// ─── Blind levels ──────────────────────────────────────────────────────────────
export const BLIND_LEVELS: Array<[number, number]> = [
  [1_000,  2_000],
  [2_000,  4_000], // adjusted from 25/50 to match existing SMALL/BIG_BLIND values
  [5_000, 10_000],
  [10_000, 20_000],
  [20_000, 40_000],  // ante starts here
  [40_000, 80_000],
  [75_000, 150_000],
  [150_000, 300_000],
];

// ─── Types ─────────────────────────────────────────────────────────────────────
export type BetActionType = 'fold' | 'check' | 'call' | 'raise' | 'allIn';

export interface SessionStats {
  handsPlayed:  number;
  handsWon:     number;
  biggestPot:   number;
  netChips:     number;  // chips gained vs STARTING_CHIPS
  byPosition:   Record<string, { played: number; won: number }>;
}

export interface UserProfile {
  // Tracks user tendencies so AI can adapt
  foldToThreeBetOpps: number;  // times user faced a 3-bet
  foldToThreeBetCount: number; // times user folded to 3-bet
  openCount:   number;   // times user voluntarily opened preflop
  handsDealt:  number;   // total hands dealt to user
}

export type DailyChallenge = {
  id:        string;
  desc:      string;
  goal:      number;   // target count
  progress:  number;
  completed: boolean;
};

export interface BetAction {
  type: BetActionType;
  /** For 'raise': the player's NEW total roundBet (not just the increment). */
  amount?: number;
}

export type PlayerArchetype = 'shark' | 'balanced' | 'fish' | 'maniac';

export interface Player {
  id:       number;
  name:     string;
  isUser:   boolean;
  position: number;   // seat 0-7
  holeCards: Card[];
  handResult?: HandResult;
  isDealer: boolean;
  isFolded: boolean;
  isBusted: boolean;  // ran out of chips — sits out future hands
  skill:    number;   // 0=fish, 1=shark
  archetype: PlayerArchetype;
  // ── Chips / betting ──
  chips:    number;   // current stack
  roundBet: number;   // total committed this street
  hasActed: boolean;  // voluntarily acted this round (not just posted blinds)
  isAllIn:  boolean;
  // ── AI memory & stats ──
  bluffCount:  number;   // times caught bluffing this session
  handsPlayed: number;
  vpipCount:   number;   // voluntarily put chips in pre-flop
  pfrCount:    number;   // pre-flop raise count
  handContribution: number;   // total chips put into pot this hand (all streets combined), reset each hand
  cBetOpps:         number;   // times was preflop aggressor and saw the flop
  cBetCount:        number;   // times made a continuation bet (first bet on flop as preflop aggressor)
  foldToCBetOpps:   number;   // times faced a c-bet on flop as non-aggressor
  foldToCBetCount:  number;   // times folded to a c-bet
  threeBetCount:    number;   // preflop 3-bets made
  threeBetOpps:     number;   // times faced a preflop open raise (could have 3-bet)
  aggressionCount:  number;   // bets + raises made (all streets)
  aggressionOpps:   number;   // times could bet or raise (not all-in, not facing a raise with no option)
  // ── Per-hand state ──
  wasPreFlopAggressor: boolean;  // raised pre-flop this hand
  // ── Progression ──
  xp:    number;
  level: number;  // 1-10
}

export type GamePhase =
  | 'idle' | 'dealing' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface GameState {
  players:   Player[];
  deck:      Card[];
  originalDeck: Card[];
  communityCards: Card[];
  burnedCards: Card[];
  phase:     GamePhase;
  dealerButtonPosition: number;
  winnerIds: number[];
  /** Players who genuinely split the SAME pot (same score). Distinct from winnerIds
   *  which also includes players who each won a *different* side pot. */
  splitPotWinnerIds: number[];
  // ── Betting ──
  pot:            number;
  currentBet:     number;  // highest total bet this street
  minRaise:       number;  // minimum raise increment
  lastAggressorId: number | null;
  // ── Blind level ──
  smallBlind: number;
  bigBlind:   number;
  blindLevel:          number;
  handNumber:          number;
  nextBlindHandNumber: number;
  // ── Session / profile ──
  sessionStats:   SessionStats;
  userProfile:    UserProfile;
  dailyChallenge: DailyChallenge;
}

// ─── XP levels ────────────────────────────────────────────────────────────────
export const XP_LEVELS = [0, 500, 1500, 3000, 5000, 8000, 12_000, 18_000, 25_000, 35_000];
export function xpLevel(xp: number): number {
  let lvl = 1;
  for (let i = 1; i < XP_LEVELS.length; i++) {
    if (xp >= XP_LEVELS[i]) lvl = i + 1; else break;
  }
  return lvl;
}

// ─── Daily challenge ──────────────────────────────────────────────────────────
const CHALLENGE_DEFS: Array<{ id: string; desc: string; goal: number }> = [
  { id: 'win3',      desc: 'Win 3 hands',                      goal: 3 },
  { id: 'bigpot',    desc: 'Win a pot over 50,000 chips',       goal: 1 },
  { id: 'survive5',  desc: 'Survive 5 hands without busting',   goal: 5 },
  { id: 'fold10',    desc: 'Fold 10 hands',                     goal: 10 },
  { id: 'allin',     desc: 'Win an all-in hand',                goal: 1 },
  { id: 'bluff',     desc: 'Win a hand after a raise was made (bluff won)', goal: 1 },
];

export function getTodayChallenge(): DailyChallenge {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000);
  const def = CHALLENGE_DEFS[dayOfYear % CHALLENGE_DEFS.length];
  // Load progress from localStorage
  const key = `challenge-${new Date().toISOString().slice(0, 10)}-${def.id}`;
  const saved = localStorage.getItem(key);
  const progress = saved ? parseInt(saved, 10) : 0;
  return { ...def, progress, completed: progress >= def.goal };
}

export function advanceChallenge(challenge: DailyChallenge, event: string): DailyChallenge {
  if (challenge.completed) return challenge;
  const matches = (
    (challenge.id === 'win3'     && event === 'win') ||
    (challenge.id === 'bigpot'   && event === 'bigpot') ||
    (challenge.id === 'survive5' && event === 'survive') ||
    (challenge.id === 'fold10'   && event === 'fold') ||
    (challenge.id === 'allin'    && event === 'allin-win') ||
    (challenge.id === 'bluff'    && event === 'bluff-win')
  );
  if (!matches) return challenge;
  const progress = challenge.progress + 1;
  const completed = progress >= challenge.goal;
  const key = `challenge-${new Date().toISOString().slice(0, 10)}-${challenge.id}`;
  localStorage.setItem(key, String(progress));
  return { ...challenge, progress, completed };
}

// ─── Save / load game state ───────────────────────────────────────────────────
export function saveGame(state: GameState): void {
  try {
    localStorage.setItem('pokerSave', JSON.stringify(state));
  } catch { /* ignore quota errors */ }
}

export function loadGame(): GameState | null {
  try {
    const raw = localStorage.getItem('pokerSave');
    if (!raw) return null;
    return JSON.parse(raw) as GameState;
  } catch { return null; }
}

export function clearSave(): void {
  localStorage.removeItem('pokerSave');
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
/** Clockwise distance from the dealer button on screen (same formula as winProbability). */
function distFromDealer(seat: number, dealerSeat: number): number {
  return ((dealerSeat - seat) % 8 + 8) % 8;
}

function randomSkill(): number {
  const r = Math.random();
  if (r < 0.25) return 0.10 + Math.random() * 0.25;
  if (r < 0.60) return 0.35 + Math.random() * 0.30;
  if (r < 0.85) return 0.65 + Math.random() * 0.20;
  return              0.85 + Math.random() * 0.15;
}

function archetypeFromSkill(skill: number): PlayerArchetype {
  // Add some variety for maniac archetype
  if (skill >= 0.85) return 'shark';
  if (skill >= 0.65) return 'balanced';
  if (skill >= 0.35) return 'fish';
  // Very low skill: sometimes maniac
  return Math.random() < 0.5 ? 'maniac' : 'fish';
}

const PLAYER_NAMES = ['Alex', 'Blake', 'Casey', 'Dana', 'Eli', 'Finn', 'Grace', 'Hunter'];

function blankPlayer(i: number, isUser: boolean, dealerPos: number, chips: number): Player {
  const skill = isUser ? 1.0 : randomSkill();
  return {
    id: i, name: isUser ? 'You' : '', isUser,
    position: i, holeCards: [],
    isDealer:  i === dealerPos,
    isFolded:  false,
    isBusted:  false,
    skill,
    archetype: isUser ? 'shark' : archetypeFromSkill(skill),
    chips, roundBet: 0, hasActed: false, isAllIn: false,
    bluffCount: 0, handsPlayed: 0, vpipCount: 0, pfrCount: 0,
    handContribution: 0,
    cBetOpps: 0, cBetCount: 0,
    foldToCBetOpps: 0, foldToCBetCount: 0,
    threeBetCount: 0, threeBetOpps: 0,
    aggressionCount: 0, aggressionOpps: 0,
    wasPreFlopAggressor: false,
    xp: 0, level: 1,
  };
}

function assignNames(players: Player[]): void {
  const queue = [...PLAYER_NAMES];
  for (const p of players) {
    if (!p.isUser) p.name = queue.shift() ?? `P${p.id}`;
  }
}

// ─── initGame ─────────────────────────────────────────────────────────────────
export function initGame(): GameState {
  const userPos   = Math.floor(Math.random() * 8);
  const dealerPos = Math.floor(Math.random() * 8);

  const players = Array.from({ length: 8 }, (_, i) =>
    blankPlayer(i, i === userPos, dealerPos, STARTING_CHIPS),
  );
  assignNames(players);

  const deck = shuffleDeck(createDeck());
  return {
    players, deck, originalDeck: [...deck],
    communityCards: [], burnedCards: [],
    phase: 'idle', dealerButtonPosition: dealerPos, winnerIds: [], splitPotWinnerIds: [],
    pot: 0, currentBet: 0, minRaise: BIG_BLIND, lastAggressorId: null,
    smallBlind: SMALL_BLIND, bigBlind: BIG_BLIND,
    blindLevel: 0, handNumber: 0, nextBlindHandNumber: 5,
    sessionStats: { handsPlayed: 0, handsWon: 0, biggestPot: 0, netChips: 0, byPosition: {} },
    userProfile:  { foldToThreeBetOpps: 0, foldToThreeBetCount: 0, openCount: 0, handsDealt: 0 },
    dailyChallenge: getTodayChallenge(),
  };
}

// ─── initHand (keep chips, advance dealer, bust 0-chip players) ───────────────
export function initHand(state: GameState): GameState {
  // Advance dealer to the next player who still has chips
  let nextDealer = (state.dealerButtonPosition - 1 + 8) % 8;
  for (let tries = 0; tries < 8; tries++) {
    if (state.players[nextDealer].chips > 0) break;
    nextDealer = (nextDealer - 1 + 8) % 8;
  }

  const deck = shuffleDeck(createDeck());

  // Increment hand number and check blind escalation
  const handNumber = state.handNumber + 1;
  let blindLevel = state.blindLevel;
  let nextBlindHandNumber = state.nextBlindHandNumber;
  let smallBlind = state.smallBlind;
  let bigBlind   = state.bigBlind;

  if (handNumber >= nextBlindHandNumber && blindLevel < BLIND_LEVELS.length - 1) {
    blindLevel++;
    nextBlindHandNumber = handNumber + 5;
    [smallBlind, bigBlind] = BLIND_LEVELS[blindLevel];
  }

  const players = state.players.map(p => {
    const isBusted = p.chips <= 0;
    return {
      ...p,
      holeCards:   [],
      handResult:  undefined,
      isBusted,
      isFolded:    isBusted,
      isDealer:    p.position === nextDealer,
      roundBet:    0,
      hasActed:    isBusted,
      isAllIn:     false,
      wasPreFlopAggressor: false,
      handContribution: 0,
    };
  });

  // Collect antes from blind level 4 (index 4) onwards
  let pot = 0;
  const anteAmount = blindLevel >= 4 ? Math.floor(bigBlind * 0.1) : 0;
  if (anteAmount > 0) {
    for (const p of players) {
      if (!p.isBusted) {
        const paid = Math.min(anteAmount, p.chips);
        p.chips   -= paid;
        p.roundBet += paid; // roundBet will be reset after blinds are posted, use pot directly
        pot       += paid;
        if (p.chips === 0) p.isAllIn = true;
      }
    }
    // Reset roundBet after antes (antes go into pot, not credited to street bet)
    for (const p of players) {
      p.roundBet = 0;
    }
  }

  return {
    players, deck, originalDeck: [...deck],
    communityCards: [], burnedCards: [],
    phase: 'idle', dealerButtonPosition: nextDealer, winnerIds: [], splitPotWinnerIds: [],
    pot, currentBet: 0, minRaise: bigBlind, lastAggressorId: null,
    smallBlind, bigBlind,
    blindLevel, handNumber, nextBlindHandNumber,
    sessionStats: state.sessionStats,
    userProfile:  state.userProfile,
    dailyChallenge: state.dailyChallenge,
  };
}

// ─── postBlinds ───────────────────────────────────────────────────────────────
export function postBlinds(state: GameState): GameState {
  const players = state.players.map(p => ({ ...p }));
  let pot = state.pot;

  const seated = players
    .filter(p => !p.isBusted)
    .map(p => ({ p, d: distFromDealer(p.position, state.dealerButtonPosition) }))
    .sort((a, b) => (a.d === 0 ? 8 : a.d) - (b.d === 0 ? 8 : b.d));

  const post = (idx: number, amount: number) => {
    const entry = seated[idx];
    if (!entry) return null;
    const p = entry.p;
    const paid = Math.min(amount, p.chips);
    p.chips    -= paid;
    p.roundBet += paid;
    pot        += paid;
    p.handContribution += paid;
    if (p.chips === 0) p.isAllIn = true;
    return p;
  };

  const isHeadsUp = seated.length === 2;
  const sbIdx = isHeadsUp ? 1 : 0;
  const bbIdx = isHeadsUp ? 0 : 1;
  post(sbIdx, state.smallBlind);
  const bb = post(bbIdx, state.bigBlind);

  return {
    ...state, players, pot,
    currentBet: state.bigBlind, minRaise: state.bigBlind,
    lastAggressorId: bb?.id ?? null,
  };
}

// ─── applyBetAction ───────────────────────────────────────────────────────────
export function applyBetAction(
  state: GameState, playerId: number, action: BetAction,
): GameState {
  const players = state.players.map(p => ({ ...p }));
  const player  = players.find(p => p.id === playerId)!;
  let { pot, currentBet, minRaise, lastAggressorId } = state;

  switch (action.type) {

    case 'fold':
      player.isFolded = true;
      player.hasActed = true;
      // Track fold to c-bet
      if (state.phase === 'flop' &&
          state.players.find(p => p.id === state.lastAggressorId)?.wasPreFlopAggressor) {
        player.foldToCBetCount++;
      }
      break;

    case 'check':
      player.hasActed = true;
      player.aggressionOpps++;
      break;

    case 'call': {
      const call = Math.min(currentBet - player.roundBet, player.chips);
      player.chips   -= call;
      player.roundBet += call;
      pot            += call;
      player.handContribution += call;
      player.hasActed = true;
      player.aggressionOpps++;
      if (player.chips === 0) player.isAllIn = true;
      // Track VPIP
      if (state.phase === 'preflop' && call > 0) player.vpipCount++;
      // Facing an open raise preflop — could have 3-bet but called instead
      if (state.phase === 'preflop' && state.currentBet > state.bigBlind) {
        player.threeBetOpps++;
      }
      break;
    }

    case 'raise': {
      const totalBet = Math.min(action.amount ?? currentBet + minRaise, player.chips + player.roundBet);
      const increment = totalBet - player.roundBet;
      const raiseSize = totalBet - currentBet;

      player.chips    -= increment;
      player.roundBet  = totalBet;
      pot             += increment;
      player.handContribution += increment;
      minRaise         = Math.max(minRaise, raiseSize);
      currentBet       = totalBet;
      lastAggressorId  = player.id;
      player.hasActed  = true;
      if (player.chips === 0) player.isAllIn = true;

      // Track VPIP + PFR + pre-flop aggressor flag
      if (state.phase === 'preflop') {
        player.vpipCount++;
        player.pfrCount++;
        player.wasPreFlopAggressor = true;
      }

      // Aggression tracking
      player.aggressionCount++;
      player.aggressionOpps++;

      // 3-bet tracking: facing a raise preflop
      if (state.currentBet > 0 && state.phase === 'preflop') {
        player.threeBetCount++;
        player.threeBetOpps++;
      }

      // C-bet tracking: first bet on flop as preflop aggressor
      if (state.phase === 'flop' && player.wasPreFlopAggressor && state.currentBet === 0) {
        player.cBetCount++;
      }

      // Update opponents' opportunity counters
      for (const p of players) {
        if (p.id !== playerId && !p.isFolded && !p.isAllIn) {
          p.hasActed = false;
          // Opponents faced a re-raise preflop
          if (state.phase === 'preflop' && state.currentBet > 0) {
            p.threeBetOpps++;
          }
          // Opponents faced a c-bet on the flop
          if (state.phase === 'flop' && player.wasPreFlopAggressor) {
            p.foldToCBetOpps++;
          }
        }
      }
      break;
    }

    case 'allIn': {
      const allIn = player.chips;
      pot            += allIn;
      player.roundBet += allIn;
      player.handContribution += allIn;
      player.chips    = 0;
      player.isAllIn  = true;
      player.hasActed = true;

      if (player.roundBet > currentBet) {
        const raiseSize = player.roundBet - currentBet;
        minRaise        = Math.max(minRaise, raiseSize);
        currentBet      = player.roundBet;
        lastAggressorId = player.id;
        // Track VPIP + PFR
        if (state.phase === 'preflop') {
          player.vpipCount++;
          player.pfrCount++;
          player.wasPreFlopAggressor = true;
        }
        player.aggressionCount++;
        for (const p of players) {
          if (p.id !== playerId && !p.isFolded && !p.isAllIn) p.hasActed = false;
        }
      } else if (state.phase === 'preflop') {
        player.vpipCount++;
      }
      break;
    }
  }

  return { ...state, players, pot, currentBet, minRaise, lastAggressorId };
}

// ─── collectBets (reset per-street counters, keep pot) ───────────────────────
function collectBets(state: GameState): GameState {
  const players = state.players.map(p => ({
    ...p,
    roundBet: 0,
    hasActed: false,
    // isAllIn stays — they're still all-in
  }));
  return { ...state, players, currentBet: 0, minRaise: state.bigBlind, lastAggressorId: null };
}

// ─── SidePot & buildSidePots ──────────────────────────────────────────────────
export interface SidePot {
  amount: number;
  eligibleIds: number[];  // player IDs who contributed enough and are not folded
}

export function buildSidePots(players: Player[]): SidePot[] {
  // Use handContribution to build correct side pots
  let entries = players
    .filter(p => !p.isBusted && p.handContribution > 0)
    .map(p => ({ id: p.id, contrib: p.handContribution, canWin: !p.isFolded }))
    .sort((a, b) => a.contrib - b.contrib);

  const pots: SidePot[] = [];
  let carryover = 0;

  while (entries.length > 0) {
    const level = entries[0].contrib;
    const potSlice = level * entries.length + carryover;
    carryover = 0;
    const eligibleIds = entries.filter(e => e.canWin).map(e => e.id);

    if (potSlice > 0) {
      if (eligibleIds.length > 0) {
        pots.push({ amount: potSlice, eligibleIds });
      } else {
        // Everyone at this level folded — carry chips forward to next pot
        carryover = potSlice;
      }
    }

    for (const e of entries) e.contrib -= level;
    entries = entries.filter(e => e.contrib > 0);
  }

  // Any remaining carryover (extremely rare) goes to last pot
  if (carryover > 0 && pots.length > 0) {
    pots[pots.length - 1].amount += carryover;
  }

  return pots;
}

// ─── awardPot (with side pots) ────────────────────────────────────────────────
export function awardPot(state: GameState): GameState {
  if (state.pot === 0) return state;

  const players = state.players.map(p => ({ ...p }));
  const pots = buildSidePots(players);
  const allWinnerIds: number[] = [];
  // Tracks players who GENUINELY SPLIT the same pot (same score) — distinct from
  // players who each won a different side pot, which is NOT a tie.
  const splitIds: number[] = [];

  for (const pot of pots) {
    const eligible = players.filter(p => pot.eligibleIds.includes(p.id));
    if (eligible.length === 0) continue;

    let bestScore = -Infinity;
    for (const p of eligible) {
      if (p.handResult && p.handResult.score > bestScore) bestScore = p.handResult.score;
    }

    let potWinners: Player[];
    if (bestScore === -Infinity) {
      // Fold-win path (endByFold): no hand evaluation done yet.
      // Award to the pre-set winnerIds sole survivor; never use eligible[0] as
      // that could hand chips to the wrong player.
      potWinners = eligible.filter(p => state.winnerIds.includes(p.id));
      if (potWinners.length === 0) {
        // Last resort: the only non-folded player (should always be length 1 here)
        potWinners = eligible.filter(p => !p.isFolded);
        if (potWinners.length === 0) potWinners = [eligible[0]];
      }
    } else {
      potWinners = eligible.filter(p => p.handResult?.score === bestScore);
    }

    const share     = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;

    // A pot with only 1 eligible player is an uncontested refund (the player's own
    // uncovered chips returned to them). Don't treat this as a "win" in the UI —
    // only add to allWinnerIds when the pot was contested (2+ eligible) or when
    // this is the fold-win path (bestScore === -Infinity, where pre-set winnerIds
    // already identifies the correct sole winner).
    const isContested  = eligible.length > 1;
    const isFoldPath   = bestScore === -Infinity;

    potWinners.forEach((w, i) => {
      const p = players.find(pl => pl.id === w.id)!;
      p.chips += share + (i === 0 ? remainder : 0);
      if ((isContested || isFoldPath) && !allWinnerIds.includes(p.id)) {
        allWinnerIds.push(p.id);
      }
    });

    // If this pot had multiple winners with the SAME score, they truly split it.
    if (potWinners.length > 1) {
      for (const w of potWinners) {
        if (!splitIds.includes(w.id)) splitIds.push(w.id);
      }
    }
  }

  return { ...state, players, pot: 0, winnerIds: allWinnerIds, splitPotWinnerIds: splitIds };
}

// ─── Dealing ──────────────────────────────────────────────────────────────────
export function dealHoleCards(state: GameState): GameState {
  const deck    = [...state.deck];
  const players = state.players.map(p => ({ ...p, holeCards: [] as Card[], handsPlayed: p.isBusted ? p.handsPlayed : p.handsPlayed + 1 }));

  const nonBustedCount = players.filter(p => !p.isBusted).length;
  const dealStartSeat  = nonBustedCount === 2
    ? state.dealerButtonPosition
    : (state.dealerButtonPosition - 1 + 8) % 8;

  const dealOrder: number[] = [];
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 8; i++) {
      dealOrder.push(((dealStartSeat - i) % 8 + 8) % 8);
    }
  }
  for (const seat of dealOrder) {
    if (players[seat].isBusted) continue;
    players[seat].holeCards.push(deck.shift()!);
  }

  return { ...state, players, deck, phase: 'preflop' };
}

export function dealFlop(state: GameState): GameState {
  const s    = collectBets(state);
  const deck = [...s.deck];
  const burn = deck.shift()!;
  const flop = [deck.shift()!, deck.shift()!, deck.shift()!];
  return { ...s, deck, communityCards: flop, burnedCards: [...s.burnedCards, burn], phase: 'flop' };
}

export function dealTurn(state: GameState): GameState {
  const s    = collectBets(state);
  const deck = [...s.deck];
  const burn = deck.shift()!;
  const card = deck.shift()!;
  return { ...s, deck, communityCards: [...s.communityCards, card], burnedCards: [...s.burnedCards, burn], phase: 'turn' };
}

export function dealRiver(state: GameState): GameState {
  const s    = collectBets(state);
  const deck = [...s.deck];
  const burn = deck.shift()!;
  const card = deck.shift()!;
  return { ...s, deck, communityCards: [...s.communityCards, card], burnedCards: [...s.burnedCards, burn], phase: 'river' };
}

// ─── Seat / player count helpers ─────────────────────────────────────────────
export function seatedPlayers(state: GameState): Player[] {
  return state.players.filter(p => !p.isBusted && p.chips > 0);
}

// ─── applyFolds (legacy / kept for compatibility) ─────────────────────────────
export function applyFolds(state: GameState, foldedIds: number[]): GameState {
  return {
    ...state,
    players: state.players.map(p => ({
      ...p, isFolded: p.isFolded || foldedIds.includes(p.id),
    })),
  };
}

// ─── awardXP ──────────────────────────────────────────────────────────────────
export function awardXP(state: GameState, playerId: number, amount: number): GameState {
  const players = state.players.map(p => {
    if (p.id !== playerId) return p;
    const newXp = p.xp + amount;
    return { ...p, xp: newXp, level: xpLevel(newXp) };
  });
  return { ...state, players };
}

// ─── evaluateHands ────────────────────────────────────────────────────────────
export function evaluateHands(state: GameState): GameState {
  const players = state.players.map(p => ({
    ...p,
    handResult: p.holeCards.length >= 2
      ? evaluateBestHand(p.holeCards, state.communityCards)
      : undefined,
  }));

  let best = -1;
  for (const p of players) {
    if (!p.isFolded && p.handResult && p.handResult.score > best) best = p.handResult.score;
  }
  const winnerIds = players
    .filter(p => !p.isFolded && p.handResult?.score === best)
    .map(p => p.id);

  return { ...state, players, phase: 'showdown', winnerIds, splitPotWinnerIds: [] };
}
