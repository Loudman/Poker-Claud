import { GameState, Player, BetAction } from './gameState';
import { Card } from './deck';
import { calcAllEquities, positionFromDealer } from './winProbability';

// ─── Re-export for convenience ────────────────────────────────────────────────
export { calcAllEquities };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a pot-sized or multiplied raise.
 * Returns the new total roundBet for the player (not the increment).
 */
function buildRaise(state: GameState, player: Player, potFrac?: number): BetAction {
  const minTotal = state.currentBet + state.minRaise;
  const maxTotal = player.chips + player.roundBet; // all-in ceiling

  if (maxTotal <= minTotal) return { type: 'allIn' };

  const potAfterCall = state.pot + (state.currentBet - player.roundBet);
  const frac   = potFrac ?? (0.5 + Math.random() * 0.7); // 0.5–1.2× pot if no override
  const target = Math.max(minTotal, Math.round(state.currentBet + potAfterCall * frac));
  const capped = Math.min(target, maxTotal);

  if (capped >= maxTotal) return { type: 'allIn' };
  return { type: 'raise', amount: capped };
}

// ─── GTO-inspired equity thresholds for opening preflop, keyed by dist from dealer
// dist 0 = BTN, 7 = CO, 6 = HJ, 5 = MP, 4 = UTG+1, 3 = UTG, 1 = SB, 2 = BB
const PREFLOP_OPEN_THRESHOLD: Record<number, number> = {
  0: 0.28,  // BTN  — open ~50% of hands
  7: 0.32,  // CO   — open ~35%
  6: 0.36,  // HJ   — open ~25%
  5: 0.39,  // MP   — open ~18%
  4: 0.41,  // UTG+1— open ~14%
  3: 0.43,  // UTG  — open ~12%
  1: 0.30,  // SB   — complete/raise ~55%
  2: 0.22,  // BB   — defend ~75% of hands vs raise
};

// ─── Board-texture helpers ────────────────────────────────────────────────────

type BoardTexture = 'dry' | 'semi-wet' | 'wet';

function getBoardTexture(communityCards: Card[]): BoardTexture {
  if (communityCards.length === 0) return 'dry';
  const suitCounts: Record<string, number> = {};
  for (const c of communityCards) suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1;
  const flushDraw = Object.values(suitCounts).some(n => n >= 2);
  const vals = [...new Set(communityCards.map(c => c.value))].sort((a, b) => a - b);
  let maxGap = 1;
  for (let i = 1; i < vals.length; i++) maxGap = Math.max(maxGap, vals[i] - vals[i - 1]);
  const connected = maxGap <= 2;
  if (flushDraw && connected) return 'wet';
  if (flushDraw || connected) return 'semi-wet';
  return 'dry';
}

function textureSizingFrac(texture: BoardTexture, phase: string, perceived: number): number {
  if (phase === 'river') {
    if (perceived > 0.82) return 1.2;   // overbet for value
    if (perceived > 0.68) return 0.75;
    return 0.50;
  }
  switch (texture) {
    case 'dry':      return 0.33;
    case 'semi-wet': return 0.55;
    case 'wet':      return 0.75;
    default:         return 0.50;
  }
}

// ─── Draw detection helpers ───────────────────────────────────────────────────

/** Check if player has a flush draw (4 cards to same suit) */
function hasFlushDraw(holeCards: Card[], communityCards: Card[]): boolean {
  const allCards = [...holeCards, ...communityCards];
  const suitCounts: Record<string, number> = {};
  for (const c of allCards) {
    suitCounts[c.suit] = (suitCounts[c.suit] ?? 0) + 1;
  }
  return Object.values(suitCounts).some(count => count === 4);
}

/** Check if player has a straight draw (4 to a straight) */
function hasStraightDraw(holeCards: Card[], communityCards: Card[]): boolean {
  const allCards = [...holeCards, ...communityCards];
  const values = [...new Set(allCards.map(c => c.value))].sort((a, b) => a - b);
  // Check for 4-card straight (any 4 consecutive values within window of 5)
  for (let i = 0; i <= values.length - 4; i++) {
    const window = values.slice(i, i + 5);
    // Count how many consecutive values we have within any 5-value span
    for (let start = values[i]; start <= values[i] + 1; start++) {
      let count = 0;
      for (let v = start; v < start + 5; v++) {
        if (values.includes(v)) count++;
      }
      if (count >= 4) return true;
    }
  }
  return false;
}

/** Check if AI has a missed draw (had draw but community is complete and no flush/straight made) */
function hasMissedDraw(holeCards: Card[], communityCards: Card[], equity: number): boolean {
  if (communityCards.length < 4) return false; // only post-turn/river
  // Consider a missed draw: equity is low, and they had some draw potential
  return equity < 0.2;
}

// ─── Bluff frequency by archetype ─────────────────────────────────────────────
function bluffFrequency(player: Player): number {
  switch (player.archetype) {
    case 'shark':   return 0.25;
    case 'maniac':  return 0.40;
    case 'balanced': return 0.12;
    case 'fish':    return 0.03;
    default:        return 0.10;
  }
}

// ─── Player stats helper ──────────────────────────────────────────────────────

function getPlayerStats(player: Player) {
  const vpip         = player.handsPlayed > 5 ? player.vpipCount  / player.handsPlayed : 0.25;
  const pfr          = player.handsPlayed > 5 ? player.pfrCount   / player.handsPlayed : 0.15;
  const threeBetRate = player.threeBetOpps  > 3 ? player.threeBetCount  / player.threeBetOpps  : 0.07;
  const foldToCBet   = player.foldToCBetOpps > 3 ? player.foldToCBetCount / player.foldToCBetOpps : 0.50;
  const cBetRate     = player.cBetOpps > 3 ? player.cBetCount / player.cBetOpps : 0.55;
  const aggression   = player.aggressionOpps > 5 ? player.aggressionCount / player.aggressionOpps : 0.25;
  return { vpip, pfr, threeBetRate, foldToCBet, cBetRate, aggression };
}

// ─── Opponent equity modifier ─────────────────────────────────────────────────

function estimateOpponentEquityModifier(
  opponents: Player[], state: GameState, phase: string,
): number {
  if (opponents.length === 0) return 0;
  let mod = 0;
  for (const opp of opponents) {
    const stats = getPlayerStats(opp);
    if (stats.vpip < 0.18) mod -= 0.04;
    else if (stats.vpip > 0.40) mod += 0.03;
    if (opp.wasPreFlopAggressor) mod -= 0.03;
    // If preflop aggressor checked flop — likely weak/missed
    if (opp.wasPreFlopAggressor && phase === 'turn' && state.currentBet === 0) mod += 0.03;
    if (stats.aggression > 0.45) mod -= 0.02; // aggressive opponents have it more often
  }
  return Math.max(-0.12, Math.min(0.12, mod / opponents.length));
}

// ─── Implied odds helper ──────────────────────────────────────────────────────

function calcImpliedOdds(
  player: Player, state: GameState, equity: number, hasFlushDrawFlag: boolean, hasStraightDrawFlag: boolean,
): number {
  if (!hasFlushDrawFlag && !hasStraightDrawFlag) return 0;
  if (state.phase === 'river') return 0; // no more streets
  const streetsLeft = state.phase === 'preflop' ? 2 : state.phase === 'flop' ? 2 : 1;
  const drawOuts    = (hasFlushDrawFlag ? 9 : 0) + (hasStraightDrawFlag ? 8 : 0);
  const hitProb     = 1 - Math.pow(1 - drawOuts / 46, streetsLeft); // rough approximation
  const effectiveStack = Math.min(player.chips, ...state.players
    .filter(p => p.id !== player.id && !p.isFolded && !p.isBusted)
    .map(p => p.chips));
  // Implied odds bonus: if we hit, we expect to win some fraction of remaining stack
  const impliedWin = hitProb * effectiveStack * 0.4;
  return state.pot > 0 ? Math.min(0.15, impliedWin / (state.pot * 2)) : 0;
}

// ─── Table dynamics helper ────────────────────────────────────────────────────

function getTableDynamics(state: GameState, player: Player): {
  stealBonus: number;    // increase raise frequency for steals
  callTighter: boolean;  // tighten calling range vs aggressive table
  bluffLess: boolean;    // reduce bluffs vs calling stations
} {
  const opponents = state.players.filter(p => p.id !== player.id && !p.isFolded && !p.isBusted);
  if (opponents.length === 0) return { stealBonus: 0, callTighter: false, bluffLess: false };

  const avgVpip = opponents.reduce((s, p) => s + getPlayerStats(p).vpip, 0) / opponents.length;
  const avgAgg  = opponents.reduce((s, p) => s + getPlayerStats(p).aggression, 0) / opponents.length;

  return {
    stealBonus:  avgVpip < 0.20 ? 0.08 : avgVpip > 0.38 ? -0.05 : 0,  // steal more vs tight tables
    callTighter: avgAgg  > 0.40,   // face aggressive table → fold more marginal hands
    bluffLess:   avgVpip > 0.38,   // loose table → they call bluffs more
  };
}

// ─── Continuation bet logic ───────────────────────────────────────────────────

function shouldContinuationBet(player: Player, state: GameState, perceived: number): boolean {
  if (!player.wasPreFlopAggressor) return false;
  if (state.phase !== 'flop') return false;
  if (state.currentBet > 0) return false; // someone else already bet

  // Exploit: if opponent folds to c-bets often, c-bet wider
  const opponents = state.players.filter(p => p.id !== player.id && !p.isFolded && !p.isBusted);
  const avgFoldToCBet = opponents.length > 0
    ? opponents.reduce((s, p) => s + getPlayerStats(p).foldToCBet, 0) / opponents.length
    : 0.50;

  const baseCBetFreq = perceived > 0.40 ? 0.80 : perceived > 0.25 ? 0.55 : 0.35;
  const adjustedFreq = baseCBetFreq + (avgFoldToCBet - 0.50) * 0.4; // more if opponents fold often
  return Math.random() < Math.min(0.95, Math.max(0.15, adjustedFreq));
}

// ─── Main AI decision ─────────────────────────────────────────────────────────

export function decideAIBet(
  state:    GameState,
  player:   Player,
  equities: Map<number, number>,
): BetAction {
  const equity = equities.get(player.id) ?? 0;
  const skill  = player.skill;
  const dist   = positionFromDealer(player.position, state.dealerButtonPosition);

  const callAmount = state.currentBet - player.roundBet;
  const toCall     = Math.min(callAmount, player.chips);
  const canCheck   = callAmount === 0;

  // ── Pot odds ──
  const effectivePot = state.pot + toCall;
  const potOdds      = (effectivePot > 0 && toCall > 0)
    ? toCall / effectivePot
    : 0;

  // ── Stack-to-pot ratio (SPR) ──
  const effectiveStack = Math.min(player.chips, ...state.players
    .filter(p => p.id !== player.id && !p.isFolded && !p.isBusted)
    .map(p => p.chips + p.roundBet));
  const spr = state.pot > 0 ? effectiveStack / state.pot : 999;

  // ── Active opponents (for bluff spots) ──
  const activeOpponents = state.players.filter(
    p => p.id !== player.id && !p.isFolded && !p.isBusted
  ).length;

  // ── In position (BTN=dist0, CO=dist7) ──
  const isInPosition = dist === 0 || dist === 7;

  // ── Position bonus (sharks benefit more from position) ──
  const posBonus = skill >= 0.65
    ? (dist === 0 ? 0.07 : dist === 7 ? 0.05 : dist === 1 ? -0.04 : 0)
    : 0;

  // ── Equity noise (fish misread hand strength) ──
  const fishFactor = 1 - skill;
  const noise      = fishFactor * 0.10 * (Math.random() * 2 - 1);
  const perceived  = Math.max(0, Math.min(1, equity + posBonus + noise));

  // ── Opponent profiling: adapt to user tendencies ──
  const userPlayer = state.players.find(p => p.isUser && !p.isFolded && !p.isBusted);
  const profile = state.userProfile;
  const userFoldTo3b = profile && profile.foldToThreeBetOpps > 3
    ? profile.foldToThreeBetCount / profile.foldToThreeBetOpps
    : 0.5;
  // Sharks 3-bet user more lightly if user folds to 3-bets often (>60%)
  const threeBetBoost = !player.isUser && userPlayer && player.skill >= 0.65 && userFoldTo3b > 0.60
    ? 0.12 : 0;

  // Also adapt to other AI opponents' fold-to-3-bet tendencies
  const targetStats = userPlayer ? getPlayerStats(userPlayer) : null;
  const adaptedThreeBetBoost = targetStats && !player.isUser && player.skill >= 0.55
    ? Math.max(0, (targetStats.foldToCBet - 0.45) * 0.20)   // fold-to-cbet proxy
    : threeBetBoost;

  // ── Board texture for post-flop sizing ──
  const texture = getBoardTexture(state.communityCards);
  const sizingFrac = textureSizingFrac(texture, state.phase, perceived);

  // ── Caller adjustment: call lighter against frequent bluffers ──
  // If any opponent has high bluffCount, lower our fold threshold
  const topBluffOpponent = Math.max(0, ...state.players
    .filter(p => p.id !== player.id && !p.isFolded && !p.isBusted)
    .map(p => p.bluffCount));
  const bluffAdjustment = Math.min(0.10, topBluffOpponent * 0.02);

  // ── Range-adjusted equity ──
  const opponents = state.players.filter(p => p.id !== player.id && !p.isFolded && !p.isBusted);
  const rangeAdj = estimateOpponentEquityModifier(opponents, state, state.phase);
  const rangeAdjPerceived = Math.max(0, Math.min(1, perceived - rangeAdj));

  // ── Table dynamics ──
  const dynamics = getTableDynamics(state, player);

  // ── GTO-inspired preflop open threshold ──
  if (state.phase === 'preflop' && !canCheck) {
    const pfThreshold = PREFLOP_OPEN_THRESHOLD[dist] ?? 0.38;
    if (perceived < pfThreshold && Math.random() < 0.82) return { type: 'fold' };
  }

  // ── Short-stack push/fold: < 15 BB → only jam or fold ──
  const bbEquiv = player.chips / state.bigBlind;
  if (bbEquiv < 15 && state.phase === 'preflop') {
    if (perceived > 0.44 + (dist === 0 ? -0.06 : 0)) return { type: 'allIn' };
    return { type: 'fold' };
  }

  // ── Maniac archetype: raises frequently even with weak hands ──
  if (player.archetype === 'maniac' && Math.random() < 0.30) {
    if (canCheck) return buildRaise(state, player);
    if (rangeAdjPerceived > 0.15) return buildRaise(state, player);
  }

  // ── Random variance (fish act randomly sometimes) ──
  if (Math.random() < fishFactor * 0.12) {
    if (canCheck) {
      return Math.random() < 0.7 ? { type: 'check' } : buildRaise(state, player);
    }
    const r = Math.random();
    if (r < 0.25) return { type: 'fold' };
    if (r < 0.80) return toCall >= player.chips ? { type: 'allIn' } : { type: 'call' };
    return buildRaise(state, player);
  }

  // ── Continuation bet ──
  if (shouldContinuationBet(player, state, rangeAdjPerceived)) {
    return buildRaise(state, player, sizingFrac);
  }

  // ── Semi-bluff: flush draw or straight draw → raise/bet ~40% ──
  const community = state.communityCards;
  if (community.length > 0 && !canCheck) {
    const hasFlush    = hasFlushDraw(player.holeCards, community);
    const hasStraight = hasStraightDraw(player.holeCards, community);
    if ((hasFlush || hasStraight) && Math.random() < 0.40) {
      if (toCall < player.chips) return buildRaise(state, player, sizingFrac);
    }
  }
  if (community.length > 0 && canCheck) {
    const hasFlush    = hasFlushDraw(player.holeCards, community);
    const hasStraight = hasStraightDraw(player.holeCards, community);
    if ((hasFlush || hasStraight) && Math.random() < 0.40) {
      return buildRaise(state, player, sizingFrac);
    }
  }

  // ── Pure bluff spot: missed draw + few opponents + in position + last to act ──
  const missedDraw = hasMissedDraw(player.holeCards, community, equity);
  let bluffFreq    = bluffFrequency(player);
  if (dynamics.bluffLess) bluffFreq *= 0.60; // reduce bluffs 40% vs calling stations
  if (missedDraw && activeOpponents <= 2 && isInPosition && canCheck) {
    if (Math.random() < bluffFreq) {
      return buildRaise(state, player, sizingFrac * 0.75);
    }
  }
  if (missedDraw && activeOpponents <= 2 && isInPosition && !canCheck) {
    if (Math.random() < bluffFreq * 0.6) {
      return buildRaise(state, player, sizingFrac * 0.75);
    }
  }

  // ── SPR adjustments ──
  // Low SPR (< 2): commit more readily with top pair+
  const lowSprThreshold = spr < 2 && rangeAdjPerceived > 0.35;
  // High SPR (> 10): fold marginal hands more
  let highSprPenalty  = spr > 10 && rangeAdjPerceived < 0.45 ? 0.08 : 0;
  if (dynamics.callTighter) highSprPenalty = Math.min(0.97, highSprPenalty + 0.05);

  // ── Implied odds ──
  const hasFlushFlag    = community.length > 0 ? hasFlushDraw(player.holeCards, community) : false;
  const hasStraightFlag = community.length > 0 ? hasStraightDraw(player.holeCards, community) : false;
  const impliedBonus    = calcImpliedOdds(player, state, equity, hasFlushFlag, hasStraightFlag);
  const effectiveEquity = rangeAdjPerceived + impliedBonus;

  // ── Late position: raise more with speculative hands ──
  const latePosBonusRaise = (dist === 0 || dist === 7) && rangeAdjPerceived > 0.30 && canCheck
    ? 0.10 + dynamics.stealBonus : 0;

  // ── No-cost action (check is free) ──
  if (canCheck) {
    const shouldBluffLate = latePosBonusRaise > 0 && Math.random() < latePosBonusRaise;
    if (rangeAdjPerceived < 0.18 && !shouldBluffLate) {
      return { type: 'check' };
    }
    if (lowSprThreshold && Math.random() < 0.50) {
      return buildRaise(state, player, sizingFrac);
    }
    if (rangeAdjPerceived > 0.50 && Math.random() < 0.30 + skill * 0.35) {
      return buildRaise(state, player, sizingFrac);
    }
    if (rangeAdjPerceived > 0.28 && Math.random() < 0.08 * skill) {
      return buildRaise(state, player, sizingFrac);
    }
    if (shouldBluffLate) return buildRaise(state, player, sizingFrac);
    return { type: 'check' };
  }

  // ── Pot odds check: if equity < pot odds, lean toward fold ──
  const equityBeatsPotOdds = effectiveEquity > potOdds - bluffAdjustment;

  const raiseFreq = 0.20 + skill * 0.30;

  if (rangeAdjPerceived > potOdds * 2.2 && rangeAdjPerceived > 0.42 && !highSprPenalty) {
    if (Math.random() < raiseFreq) return buildRaise(state, player, sizingFrac);
  }

  // ── Facing a bet: 3-bet user more if they fold to 3-bets often ──
  if (!canCheck && rangeAdjPerceived > 0.35 - adaptedThreeBetBoost && Math.random() < raiseFreq + adaptedThreeBetBoost) {
    return buildRaise(state, player, sizingFrac);
  }

  // Low SPR: commit more
  if (lowSprThreshold) {
    if (toCall >= player.chips) return { type: 'allIn' };
    return { type: 'call' };
  }

  if (equityBeatsPotOdds && effectiveEquity > potOdds * 0.85) {
    if (toCall >= player.chips) return { type: 'allIn' };
    return { type: 'call' };
  }

  // ── Below pot odds — probably fold ──
  const bb = state.bigBlind;
  let foldChance = toCall <= bb         ? 0.25
                 : toCall <= bb * 3     ? 0.55
                 : toCall <= bb * 8     ? 0.78
                 :                        0.90;

  // Bluff adjustment: call lighter against known bluffers
  foldChance = Math.max(0.05, foldChance - bluffAdjustment);
  // High SPR penalty
  foldChance = Math.min(0.97, foldChance + highSprPenalty);

  if (Math.random() < foldChance) return { type: 'fold' };
  if (toCall >= player.chips) return { type: 'allIn' };
  return { type: 'call' };
}
