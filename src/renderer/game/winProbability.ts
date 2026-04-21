import { Card, createDeck } from './deck';
import { GameState } from './gameState';
import { evaluateBestHand } from './handEvaluator';

// ─── Simulation counts ────────────────────────────────────────────────────────
// Pre-flop: largest search space (45 unseen community cards × many opponent combos)
// Shrinks as more community cards are known.
const SIMS_PREFLOP = 2500;
const SIMS_FLOP    = 1800;
const SIMS_TURN    = 1200;
const SIMS_RIVER   =    0; // river is deterministic — exact eval, no sampling

function simCount(communityKnown: number): number {
  if (communityKnown === 0) return SIMS_PREFLOP;
  if (communityKnown === 3) return SIMS_FLOP;
  if (communityKnown === 4) return SIMS_TURN;
  return SIMS_RIVER; // 5 known
}

// Fold-decision simulations (used by AI, faster)
const FOLD_SIMS = 800;

// ─── Fisher-Yates shuffle (Math.random — fast, fine for MC) ──────────────────
function quickShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Card key helper ──────────────────────────────────────────────────────────
function cardKey(c: Card): string {
  return `${c.rank}-${c.suit}`;
}

// ─── Single-round evaluator ───────────────────────────────────────────────────
interface RoundResult {
  win:    boolean;
  equity: number; // 1 = sole winner, 1/N = N-way tie, 0 = loss
}

/**
 * Evaluate one simulated board. equity = 1/numWinners if user is among winners.
 */
function evalRound(
  userHole:     Card[],
  opponentHoles: Card[][],
  community:    Card[],
): RoundResult {
  const userScore = evaluateBestHand(userHole, community).score;
  const oppScores = opponentHoles.map(opp => evaluateBestHand(opp, community).score);

  const bestOpp = oppScores.length > 0 ? Math.max(...oppScores) : -Infinity;

  if (bestOpp > userScore) return { win: false, equity: 0 };

  // User is at least tied for best
  const tiedOpps  = oppScores.filter(s => s === userScore).length;
  const numWinners = 1 + tiedOpps;
  return { win: tiedOpps === 0, equity: 1 / numWinners };
}

// ─── Result types ─────────────────────────────────────────────────────────────
export interface SimResult {
  winPct:    number; // % of runs where user is sole winner
  equityPct: number; // expected pot share (win + split credit)
}

export interface WinOdds {
  fair:          SimResult; // opponent hands randomised (unknown)
  true:          SimResult; // opponent actual hole cards used where available
  activePlayers: number;    // non-folded, non-busted players including user
}

// ─── TRUE odds ────────────────────────────────────────────────────────────────
/**
 * Uses all known hole cards. Only the remaining community cards are randomised.
 * Pool for community cards = state.deck (cards left after dealing + burning).
 */
function simTrue(state: GameState): SimResult {
  const user            = state.players.find(p => p.isUser)!;
  const activeOpponents = state.players.filter(p => !p.isUser && !p.isFolded && !p.isBusted);
  const community       = state.communityCards;
  const remaining       = 5 - community.length;
  const oppHoles        = activeOpponents.map(o => o.holeCards);

  // River or showdown: deterministic — no sampling needed
  if (remaining === 0) {
    const r = evalRound(user.holeCards, oppHoles, community);
    return {
      winPct:    r.win ? 100 : 0,
      equityPct: Math.round(r.equity * 100),
    };
  }

  // state.deck is the live remaining deck (excludes all dealt & burned cards)
  const pool = state.deck;

  const n = simCount(community.length);
  let totalWins   = 0;
  let totalEquity = 0;

  for (let s = 0; s < n; s++) {
    const shuffled    = quickShuffle(pool);
    const simCommunity = [...community, ...shuffled.slice(0, remaining)];
    const r           = evalRound(user.holeCards, oppHoles, simCommunity);
    if (r.win) totalWins++;
    totalEquity += r.equity;
  }

  return {
    winPct:    Math.round((totalWins   / n) * 100),
    equityPct: Math.round((totalEquity / n) * 100),
  };
}

// ─── FAIR odds ────────────────────────────────────────────────────────────────
/**
 * Only user hole cards and community cards are treated as known.
 * Opponent hole cards + remaining community are drawn from the unseen deck.
 *
 * Unseen deck = originalDeck minus:
 *   - user's hole cards
 *   - community cards already on the board
 *   - burned cards (removed from play, should not be re-dealt)
 *
 * We do NOT exclude opponent hole cards here — that is the point of "fair" odds:
 * we assume opponents hold random cards from the unseen pool.
 */
function simFair(state: GameState): SimResult {
  const user                = state.players.find(p => p.isUser)!;
  const numActiveOpponents  = state.players.filter(p => !p.isUser && !p.isFolded && !p.isBusted).length;
  const community           = state.communityCards;
  const remainingCommunity  = 5 - community.length;

  // Build the unseen pool: originalDeck minus user cards, community, and burned cards
  const knownKeys = new Set<string>([
    ...user.holeCards.map(cardKey),
    ...community.map(cardKey),
    ...state.burnedCards.map(cardKey),
  ]);
  const unseenPool = state.originalDeck.filter(c => !knownKeys.has(cardKey(c)));

  // Deterministic river with zero-variance fair odds (no community randomness,
  // but still randomise opponent hands)
  const n = community.length === 5
    ? Math.max(SIMS_FLOP, 1200) // even on the river we need MC for opponent hands
    : simCount(community.length);

  // Sanity check: ensure enough unseen cards exist for one simulation
  const cardsNeeded = numActiveOpponents * 2 + remainingCommunity;
  if (unseenPool.length < cardsNeeded) {
    // Degenerate state — return zeroes
    return { winPct: 0, equityPct: 0 };
  }

  let totalWins   = 0;
  let totalEquity = 0;

  for (let s = 0; s < n; s++) {
    const shuffled = quickShuffle(unseenPool);
    let cursor     = 0;

    const oppHands: Card[][] = [];
    for (let o = 0; o < numActiveOpponents; o++) {
      oppHands.push([shuffled[cursor++], shuffled[cursor++]]);
    }

    const simCommunity = [...community, ...shuffled.slice(cursor, cursor + remainingCommunity)];
    const r            = evalRound(user.holeCards, oppHands, simCommunity);
    if (r.win) totalWins++;
    totalEquity += r.equity;
  }

  return {
    winPct:    Math.round((totalWins   / n) * 100),
    equityPct: Math.round((totalEquity / n) * 100),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function calcWinOdds(state: GameState): WinOdds {
  const user = state.players.find(p => p.isUser)!;
  if (!user || user.holeCards.length < 2) {
    const empty: SimResult = { winPct: 0, equityPct: 0 };
    return { fair: empty, true: empty, activePlayers: 0 };
  }

  return {
    fair:          simFair(state),
    true:          simTrue(state),
    // Count all non-folded, non-busted players (includes user)
    activePlayers: state.players.filter(p => !p.isFolded && !p.isBusted).length,
  };
}

// ─── Heads-up equity calculator (any two specific hands + optional board) ────
/**
 * Given two explicit 2-card hands and 0–5 board cards, run Monte Carlo to
 * determine the probability each hand wins / ties.  Used by the equity calculator panel.
 */
export function calcHeadsUpEquity(
  hand1: Card[], hand2: Card[], board: Card[], sims = 8000,
): { win1: number; win2: number; tie: number } {
  const knownKeys = new Set([...hand1, ...hand2, ...board].map(cardKey));
  const pool      = createDeck().filter(c => !knownKeys.has(cardKey(c)));
  const remaining = 5 - board.length;

  // Fully-known board: deterministic
  if (remaining === 0) {
    const s1 = evaluateBestHand(hand1, board).score;
    const s2 = evaluateBestHand(hand2, board).score;
    if (s1 > s2) return { win1: 100, win2: 0,   tie: 0   };
    if (s2 > s1) return { win1: 0,   win2: 100,  tie: 0   };
    return                { win1: 0,   win2: 0,    tie: 100 };
  }

  if (pool.length < remaining) return { win1: 0, win2: 0, tie: 0 };

  let w1 = 0, w2 = 0, t = 0;
  for (let s = 0; s < sims; s++) {
    const shuffled  = quickShuffle(pool);
    const simBoard  = [...board, ...shuffled.slice(0, remaining)];
    const s1        = evaluateBestHand(hand1, simBoard).score;
    const s2        = evaluateBestHand(hand2, simBoard).score;
    if      (s1 > s2) w1++;
    else if (s2 > s1) w2++;
    else              t++;
  }
  const r = (n: number) => Math.round(n / sims * 1000) / 10; // one decimal
  return { win1: r(w1), win2: r(w2), tie: r(t) };
}

// ─── AI equity: all active players ───────────────────────────────────────────
/**
 * Run FOLD_SIMS rounds using actual hole cards for all active players.
 * Returns each active player's expected equity fraction (0–1).
 * Pool = state.deck (remaining live deck, excludes dealt & burned cards).
 */
export function calcAllEquities(state: GameState): Map<number, number> {
  const activePlayers = state.players.filter(p => !p.isFolded && !p.isBusted);
  if (activePlayers.length <= 1) {
    return new Map(activePlayers.map(p => [p.id, 1]));
  }

  const community  = state.communityCards;
  const remaining  = 5 - community.length;
  const pool       = state.deck; // live deck: all dealt & burned cards already removed
  const equitySum  = new Map<number, number>(activePlayers.map(p => [p.id, 0]));

  const n = remaining === 0 ? 1 : FOLD_SIMS;

  for (let s = 0; s < n; s++) {
    const simCommunity = remaining > 0
      ? [...community, ...quickShuffle(pool).slice(0, remaining)]
      : [...community];

    const scores = activePlayers.map(p => ({
      id:    p.id,
      score: evaluateBestHand(p.holeCards, simCommunity).score,
    }));

    const best    = Math.max(...scores.map(sc => sc.score));
    const winners = scores.filter(sc => sc.score === best);
    const share   = 1 / winners.length;
    for (const w of winners) {
      equitySum.set(w.id, (equitySum.get(w.id) ?? 0) + share);
    }
  }

  const result = new Map<number, number>();
  for (const [id, sum] of equitySum) {
    result.set(id, sum / n);
  }
  return result;
}

// ─── Position awareness ───────────────────────────────────────────────────────
/**
 * Clockwise distance from the dealer button on screen.
 *   0 = BTN (dealer)     → best post-flop position, plays widest
 *   1 = SB               → worst post-flop, plays tight
 *   2 = BB               → invested 1BB, defends
 *   3 = UTG              → first pre-flop, plays tightest
 *   4 = UTG+1
 *   5 = MP
 *   6 = HJ  (Hijack)
 *   7 = CO  (Cutoff)     → second-best, plays wide
 */
export function positionFromDealer(playerSeat: number, dealerSeat: number): number {
  return ((dealerSeat - playerSeat) % 8 + 8) % 8;
}

export const POSITION_LABELS: Record<number, string> = {
  0: 'BTN', 1: 'SB', 2: 'BB', 3: 'UTG',
  4: 'UTG+1', 5: 'MP', 6: 'HJ', 7: 'CO',
};

/**
 * Multiplier applied to the base fold threshold.
 * < 1 → plays wider (harder to fold)
 * > 1 → plays tighter (easier to fold)
 */
function positionMultiplier(distFromDealer: number): number {
  switch (distFromDealer) {
    case 0: return 0.55;  // BTN — plays very wide, positional advantage
    case 1: return 1.25;  // SB  — worst post-flop position, plays tight
    case 2: return 0.90;  // BB  — invested, defends more
    case 3: return 1.35;  // UTG — first to act, must play premium hands
    case 4: return 1.20;  // UTG+1 — still early
    case 5: return 1.05;  // MP  — neutral
    case 6: return 0.85;  // HJ  — late-ish, plays wider
    case 7: return 0.70;  // CO  — second-best spot, plays wide
    default: return 1.00;
  }
}

/**
 * Absolute pre-flop hand quality (0–1), independent of opponents.
 * Used to dampen fish noise/variance for premium holdings.
 *
 * Examples: AA=1.0  AKs=0.95  AKo=0.87  KQs=0.80  AJo=0.71
 *           T9s=0.55  66=0.54  72o=0.10
 */
function preflopHandQuality(cards: Card[]): number {
  const [hi, lo] = [...cards].sort((a, b) => b.value - a.value);

  if (hi.value === lo.value) {
    // Pairs: 22→0.25, AA→1.0
    return 0.25 + ((hi.value - 2) / 12) * 0.75;
  }

  const isSuited  = hi.suit === lo.suit;
  const gap       = hi.value - lo.value;
  const connector = gap === 1;

  // Base: scale on the sum of card values (max = A+K = 27, min = 3+2 = 5)
  let q = (hi.value + lo.value - 5) / 22; // 0..1

  if (isSuited)  q = Math.min(1, q + 0.08);
  if (connector) q = Math.min(1, q + 0.05);
  else if (gap === 2) q = Math.min(1, q + 0.02);

  return Math.max(0, Math.min(1, q));
}

/**
 * Post-flop hand quality proxy: equity scaled to [0,1] treating 30%+ as "premium".
 */
function postflopHandQuality(equity: number): number {
  return Math.min(1, equity / 0.28);
}

/**
 * Fold probability incorporating equity, phase, position, skill, and hand quality.
 *
 * Skill (0 = fish, 1 = shark) affects:
 *  1. Position awareness  — fish don't exploit positional edges
 *  2. Equity perception   — fish misread hand strength (noise)
 *  3. Decision variance   — fish act randomly
 *
 * Hand quality dampens all three fish effects — even a fish can feel AK is strong.
 */
function foldProbability(
  equity:        number,
  phase:         string,
  distFromDealer: number,
  skill:         number,
  holeCards:     Card[],
): number {
  // Hand quality: how objectively strong is this holding?
  const quality = phase === 'preflop'
    ? preflopHandQuality(holeCards)
    : postflopHandQuality(equity);
  // Quality dampen factor (0 = no dampening for trash, 1 = full dampening for premium)
  const dampen     = Math.min(1, quality * 1.5);
  const fishFactor = 1 - skill; // 0 for shark, 1 for total fish

  // 1. Position effect — fish blend toward 1.0 (ignore positional edge)
  const rawMult = positionMultiplier(distFromDealer);
  const effMult = rawMult * skill + 1.0 * (1 - skill);

  const baseThreshold = phase === 'preflop' ? 0.14
                      : phase === 'flop'    ? 0.11
                      : phase === 'turn'    ? 0.09
                      :                      0.07;
  const threshold = baseThreshold * effMult;

  // 2. Equity perception noise — premium hands are harder to misread
  //    maxNoise: 12% for trash fish, ~1% for premium fish, 0% for any shark
  const maxNoise = fishFactor * 0.12 * (1 - dampen * 0.90);
  const perceivedEquity = Math.max(0, Math.min(1,
    equity + (Math.random() * 2 - 1) * maxNoise,
  ));

  // 3. Base fold probability from perceived equity vs threshold
  let prob: number;
  if (perceivedEquity >= threshold * 2.0) prob = 0.04;
  else if (perceivedEquity >= threshold * 1.2) prob = 0.22;
  else if (perceivedEquity >= threshold * 0.6) prob = 0.65;
  else prob = 0.92;

  // 4. Random variance — premium hands dampen this too
  //    maxVariance: 28% for trash fish, ~3% for premium fish, 0% for shark
  const maxVariance = fishFactor * 0.28 * (1 - dampen * 0.88);
  prob = prob * (1 - maxVariance) + Math.random() * maxVariance;

  return Math.max(0.02, Math.min(0.97, prob));
}

// ─── Action ordering ─────────────────────────────────────────────────────────
/**
 * Pre-flop action starts from UTG (dist 3) and goes up: 3,4,5,6,7,0,1,2
 * Post-flop action starts from SB (dist 1) and goes up: 1,2,3,4,5,6,7,0
 */
export function actionOrder(dist: number, phase: string): number {
  const start = phase === 'preflop' ? 3 : 1;
  return (dist - start + 8) % 8;
}

export interface PlayerAction {
  id:       number;
  folds:    boolean;
  position: string; // e.g. 'UTG', 'BTN'
}

/**
 * Decide all active opponents' actions in correct street order.
 * Returns every active opponent (not just folders) so the UI can animate each one.
 */
const MIN_PLAYERS = 2;

export function decideActions(state: GameState): PlayerAction[] {
  const equities   = calcAllEquities(state);
  const candidates = state.players
    .filter(p => !p.isUser && !p.isFolded && !p.isBusted)
    .sort((a, b) => {
      const dA = actionOrder(positionFromDealer(a.position, state.dealerButtonPosition), state.phase);
      const dB = actionOrder(positionFromDealer(b.position, state.dealerButtonPosition), state.phase);
      return dA - dB;
    });

  const actions: PlayerAction[] = [];
  let activeCount = state.players.filter(p => !p.isFolded && !p.isBusted).length;

  for (const player of candidates) {
    const dist  = positionFromDealer(player.position, state.dealerButtonPosition);
    const label = POSITION_LABELS[dist] ?? '';

    if (activeCount <= MIN_PLAYERS) {
      // Can't fold — must stay
      actions.push({ id: player.id, folds: false, position: label });
      continue;
    }

    const equity = equities.get(player.id) ?? 0;
    const folds  = Math.random() < foldProbability(equity, state.phase, dist, player.skill, player.holeCards);

    actions.push({ id: player.id, folds, position: label });
    if (folds) activeCount--;
  }

  return actions;
}
