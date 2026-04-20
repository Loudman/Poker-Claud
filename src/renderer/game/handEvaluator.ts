import { Card } from './deck';

export type HandRank =
  | 'Royal Flush'
  | 'Straight Flush'
  | 'Four of a Kind'
  | 'Full House'
  | 'Flush'
  | 'Straight'
  | 'Three of a Kind'
  | 'Two Pair'
  | 'Pair'
  | 'High Card';

export interface HandResult {
  rank: HandRank;
  score: number;
  bestHand: Card[];
  description: string;
}

// Each hand rank occupies a band of 1,000,000.
// Within a band the tiebreaker uses base-15 encoding of up to 5 values (max ≈ 759,374 < 1,000,000).
const HAND_BASE: Record<HandRank, number> = {
  'Royal Flush':     9_000_000,
  'Straight Flush':  8_000_000,
  'Four of a Kind':  7_000_000,
  'Full House':      6_000_000,
  'Flush':           5_000_000,
  'Straight':        4_000_000,
  'Three of a Kind': 3_000_000,
  'Two Pair':        2_000_000,
  'Pair':            1_000_000,
  'High Card':               0,
};

// Encode up to 5 values (each 0-14) into a single number using base 15.
// First value is most significant.
function encode(vals: number[]): number {
  let n = 0;
  for (let i = 0; i < 5; i++) {
    n = n * 15 + (vals[i] ?? 0);
  }
  return n;
}

function getCombinations(cards: Card[], k: number): Card[][] {
  if (k === 0) return [[]];
  if (cards.length < k) return [];
  const [first, ...rest] = cards;
  return [
    ...getCombinations(rest, k - 1).map(c => [first, ...c]),
    ...getCombinations(rest, k),
  ];
}

function evaluateFiveCards(cards: Card[]): HandResult {
  const sorted = [...cards].sort((a, b) => b.value - a.value);
  const values = sorted.map(c => c.value);
  const suits  = sorted.map(c => c.suit);

  // Frequency map
  const freq: Record<number, number> = {};
  for (const v of values) freq[v] = (freq[v] || 0) + 1;

  // Groups: sorted by count desc, then by value desc within same count
  const groups = Object.entries(freq)
    .map(([v, cnt]) => ({ v: Number(v), cnt }))
    .sort((a, b) => b.cnt - a.cnt || b.v - a.v);

  const counts = groups.map(g => g.cnt);

  const isFlush   = suits.every(s => s === suits[0]);
  const uniqVals  = groups.map(g => g.v); // unique values, sorted by freq then by value
  const allUniq   = [...new Set(values)].sort((a, b) => b - a);
  const isStr     = allUniq.length === 5 && allUniq[0] - allUniq[4] === 4;
  const isWheel   = String(allUniq) === '14,5,4,3,2'; // A-2-3-4-5

  const rankOf = (v: number) => sorted.find(c => c.value === v)!.rank;

  // ── Royal / Straight Flush ──────────────────────────────────────────────────
  if (isFlush && isStr && values[0] === 14 && values[4] === 10) {
    return { rank: 'Royal Flush', score: HAND_BASE['Royal Flush'] + encode([14]), bestHand: sorted, description: 'Royal Flush' };
  }
  if (isFlush && (isStr || isWheel)) {
    const high = isWheel ? 5 : values[0];
    return { rank: 'Straight Flush', score: HAND_BASE['Straight Flush'] + encode([high]), bestHand: sorted, description: `Straight Flush, ${isWheel ? '5' : sorted[0].rank} high` };
  }

  // ── Four of a Kind ──────────────────────────────────────────────────────────
  if (counts[0] === 4) {
    const quadVal   = groups[0].v;
    const kickerVal = groups[1].v;
    return { rank: 'Four of a Kind', score: HAND_BASE['Four of a Kind'] + encode([quadVal, kickerVal]), bestHand: sorted, description: `Four of a Kind, ${rankOf(quadVal)}s` };
  }

  // ── Full House ──────────────────────────────────────────────────────────────
  if (counts[0] === 3 && counts[1] === 2) {
    const tripVal = groups[0].v;
    const pairVal = groups[1].v;
    return { rank: 'Full House', score: HAND_BASE['Full House'] + encode([tripVal, pairVal]), bestHand: sorted, description: `Full House, ${rankOf(tripVal)}s over ${rankOf(pairVal)}s` };
  }

  // ── Flush ───────────────────────────────────────────────────────────────────
  if (isFlush) {
    return { rank: 'Flush', score: HAND_BASE['Flush'] + encode(values), bestHand: sorted, description: `Flush, ${sorted[0].rank} high` };
  }

  // ── Straight ────────────────────────────────────────────────────────────────
  if (isStr || isWheel) {
    const high = isWheel ? 5 : values[0];
    return { rank: 'Straight', score: HAND_BASE['Straight'] + encode([high]), bestHand: sorted, description: `Straight, ${isWheel ? '5' : sorted[0].rank} high` };
  }

  // ── Three of a Kind ─────────────────────────────────────────────────────────
  if (counts[0] === 3) {
    const tripVal   = groups[0].v;
    const kickers   = groups.filter(g => g.cnt === 1).map(g => g.v); // [k1, k2] already sorted desc
    return { rank: 'Three of a Kind', score: HAND_BASE['Three of a Kind'] + encode([tripVal, kickers[0], kickers[1]]), bestHand: sorted, description: `Three of a Kind, ${rankOf(tripVal)}s` };
  }

  // ── Two Pair ────────────────────────────────────────────────────────────────
  if (counts[0] === 2 && counts[1] === 2) {
    const highPair  = groups[0].v;
    const lowPair   = groups[1].v;
    const kicker    = groups[2].v;
    return { rank: 'Two Pair', score: HAND_BASE['Two Pair'] + encode([highPair, lowPair, kicker]), bestHand: sorted, description: `Two Pair, ${rankOf(highPair)}s and ${rankOf(lowPair)}s` };
  }

  // ── Pair ────────────────────────────────────────────────────────────────────
  if (counts[0] === 2) {
    const pairVal = groups[0].v;
    const kickers = groups.filter(g => g.cnt === 1).map(g => g.v); // [k1, k2, k3] sorted desc
    return { rank: 'Pair', score: HAND_BASE['Pair'] + encode([pairVal, kickers[0], kickers[1], kickers[2]]), bestHand: sorted, description: `Pair of ${rankOf(pairVal)}s` };
  }

  // ── High Card ───────────────────────────────────────────────────────────────
  return { rank: 'High Card', score: HAND_BASE['High Card'] + encode(values), bestHand: sorted, description: `High Card, ${sorted[0].rank}` };
}

export function evaluateBestHand(holeCards: Card[], communityCards: Card[]): HandResult {
  const allCards = [...holeCards, ...communityCards];
  const combos = getCombinations(allCards, 5);
  let best: HandResult | null = null;
  for (const combo of combos) {
    const result = evaluateFiveCards(combo);
    if (!best || result.score > best.score) best = result;
  }
  return best!;
}
