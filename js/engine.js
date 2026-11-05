import {
  GHOST_TILE, countsFromTiles, formatTiles, isGhost, suitOf, sumCounts, tileLabel,
} from './tiles.js';
import {
  allowedTiles, analyzeHand, buildVisibleCounts, candidateDiscards, computeWaits, effectiveShanten,
  isWinStandard, patternPotential, scoreWin, voidInfo, winningPaths,
} from './analyzer.js';
import { OPPONENT_MODELS, riskByLevel } from './rules.js';

/* ============================================================
 * 约束蒙特卡洛 + 风险/损失
 * 说明：对手手牌按“可见牌、断门、副露、已胡”约束采样；
 * 行牌采用快速牌效策略；这是估计器，不是完整博弈求解器。
 * ============================================================ */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function capOf(tile, rule) {
  return tile === GHOST_TILE && rule.ghost?.enabled ? rule.ghost.count : 4;
}

export function normalizeState(raw = {}) {
  const hand = raw.handCounts ? raw.handCounts.slice() : countsFromTiles(raw.hand || []);
  const melds = raw.melds || [];
  const discards = (raw.discards || [[], [], [], []]).map((x) => x.slice());
  return {
    hand,
    melds,
    discards,
    meldsBySeat: raw.meldsBySeat || [[], [], [], []],
    voidSuits: raw.voidSuits || [null, null, null, null],
    winners: raw.winners || [false, false, false, false],
    seat: raw.seat ?? 0,
    wallRemaining: raw.wallRemaining ?? null,
    visibleExtra: raw.visibleExtra || [],
    responseTile: raw.responseTile ?? null,
    note: raw.note || '',
  };
}

export function buildPool(state, rule) {
  const visible = buildVisibleCounts(state);
  const pool = [];
  for (const t of allowedTiles(rule)) {
    const n = Math.max(0, capOf(t, rule) - (visible[t] || 0));
    for (let i = 0; i < n; i++) pool.push(t);
  }
  return pool;
}

export function estimateWallRemaining(state, rule, pool) {
  if (Number.isFinite(state.wallRemaining) && state.wallRemaining >= 0) return state.wallRemaining;
  let oppNeed = 0;
  for (let s = 0; s < 4; s++) {
    if (s === state.seat || state.winners[s]) continue;
    oppNeed += Math.max(0, 13 - 3 * (state.meldsBySeat[s]?.length || 0));
  }
  return Math.max(0, pool.length - oppNeed);
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function hasVoid(counts, voidSuit) {
  if (voidSuit === null || voidSuit === undefined) return false;
  for (let t = voidSuit * 9; t < voidSuit * 9 + 9; t++) if (counts[t] > 0) return true;
  return false;
}

function jokerOf(counts) {
  return counts[GHOST_TILE] || 0;
}

function withoutGhost(counts) {
  const c = counts.slice();
  c[GHOST_TILE] = 0;
  return c;
}

/** 快速牌效分，仅用于模拟中的弃牌策略。 */
export function quickShapeScore(counts) {
  let score = (counts[GHOST_TILE] || 0) * 2.8;
  for (let s = 0; s < 3; s++) {
    const c = counts.slice(s * 9, s * 9 + 9);
    let guard = 0;
    while (guard++ < 9) {
      let found = false;
      for (let i = 0; i < 9; i++) {
        if (c[i] >= 3) { c[i] -= 3; score += 5.5; found = true; break; }
      }
      if (found) continue;
      for (let i = 0; i <= 6; i++) {
        if (c[i] > 0 && c[i + 1] > 0 && c[i + 2] > 0) {
          c[i]--; c[i + 1]--; c[i + 2]--;
          score += 4.8; found = true; break;
        }
      }
      if (!found) break;
    }
    for (let i = 0; i < 9; i++) if (c[i] >= 2) { score += 2.2; c[i] -= 2; }
    for (let i = 0; i <= 7; i++) {
      if (c[i] > 0 && c[i + 1] > 0) { score += 1.1; c[i]--; c[i + 1]--; }
    }
    for (let i = 0; i <= 6; i++) {
      if (c[i] > 0 && c[i + 2] > 0) { score += 0.8; c[i]--; c[i + 2]--; }
    }
    score += c.reduce((a, b) => a + b, 0) * 0.12;
  }
  for (let i = 27; i < 34; i++) {
    if (i === GHOST_TILE) continue;
    if (counts[i] >= 2) score += 2;
    if (counts[i] >= 3) score += 3;
  }
  return score;
}

function chooseDiscard(counts, voidSuit, rule) {
  let best = -1;
  let bestScore = -Infinity;
  const unique = [];
  for (let t = 0; t < 34; t++) if (counts[t] > 0) unique.push(t);
  if (!unique.length) return null;
  // 有缺门牌先打缺门
  if (voidSuit !== null && voidSuit !== undefined) {
    const voidTiles = unique.filter((t) => t < 27 && suitOf(t) === voidSuit);
    if (voidTiles.length) {
      voidTiles.sort((a, b) => counts[a] - counts[b] || a - b);
      return voidTiles[0];
    }
  }
  for (const t of unique) {
    if (t === GHOST_TILE && rule.ghost?.enabled) continue;
    counts[t]--;
    const sc = quickShapeScore(counts);
    counts[t]++;
    if (sc > bestScore || (sc === bestScore && t < best)) {
      bestScore = sc;
      best = t;
    }
  }
  if (best < 0) best = unique[0];
  return best;
}

export function canWinNow(counts, melds, voidSuit, rule, selfDraw, flags = {}) {
  if (selfDraw === false && counts[GHOST_TILE] > 0 && rule.ghost?.enabled) {
    // 鬼牌被打出时不能被胡，交由调用方处理
  }
  if (hasVoid(counts, voidSuit)) return null;
  const c = withoutGhost(counts);
  const j = jokerOf(counts);
  if (!isWinStandard(c, melds.length, j)) return null;
  const sc = scoreWin(c, melds, j, { ...flags, selfDraw }, rule);
  if (selfDraw === false && !sc.validRon) return null;
  return sc;
}

function handTotal(h) {
  return h.reduce((a, b) => a + b, 0);
}

function allowedByVoid(tile, voidSuit) {
  return !(voidSuit !== null && voidSuit !== undefined && tile < 27 && suitOf(tile) === voidSuit);
}

/** 构造一副“已经听牌”的 13-3m 张手牌，用于更真实的威胁先验。
 *  结构：将 + (meldNeed-1) 个面子 + 一个搭子；因此通常有 1~2 面听。
 */
export function buildTenpaiHand(avail, voidSuit, need, exposedMelds, rng) {
  const meldNeed = 4 - exposedMelds;
  if (meldNeed < 0 || need <= 0) return null;
  if (need === 1) {
    const singles = [];
    for (let t = 0; t < 34; t++) if (allowedByVoid(t, voidSuit) && avail[t] >= 1) singles.push(t);
    if (!singles.length) return null;
    const hand = new Array(34).fill(0);
    hand[singles[Math.floor(rng() * singles.length)]] = 1;
    return hand;
  }
  for (let attempt = 0; attempt < 32; attempt++) {
    const used = new Array(34).fill(0);
    const hand = new Array(34).fill(0);
    const canUse = (t, n) => allowedByVoid(t, voidSuit) && avail[t] - used[t] >= n;

    // 选将
    const pairCandidates = [];
    for (let t = 0; t < 34; t++) if (canUse(t, 2)) pairCandidates.push(t);
    if (!pairCandidates.length) continue;
    const pair = pairCandidates[Math.floor(rng() * pairCandidates.length)];
    used[pair] += 2;
    hand[pair] += 2;

    let ok = true;
    // 完整面子
    for (let m = 0; m < meldNeed - 1; m++) {
      const candidates = [];
      for (let t = 0; t < 27; t++) {
        if (t % 9 <= 6 && canUse(t, 1) && canUse(t + 1, 1) && canUse(t + 2, 1)) candidates.push(['run', t]);
        if (canUse(t, 3)) candidates.push(['triplet', t]);
      }
      if (!candidates.length) { ok = false; break; }
      const pick = candidates[Math.floor(rng() * candidates.length)];
      if (pick[0] === 'run') {
        for (let k = 0; k < 3; k++) { used[pick[1] + k] += 1; hand[pick[1] + k] += 1; }
      } else {
        used[pick[1]] += 3; hand[pick[1]] += 3;
      }
    }
    if (!ok) continue;

    // 搭子：对子、两面/边张、坎张
    const taatsu = [];
    for (let t = 0; t < 34; t++) if (canUse(t, 2)) taatsu.push(['pair', t]);
    for (let t = 0; t < 27; t++) {
      if (t % 9 <= 7 && canUse(t, 1) && canUse(t + 1, 1)) taatsu.push(['adj', t]);
      if (t % 9 <= 6 && canUse(t, 1) && canUse(t + 2, 1)) taatsu.push(['gap', t]);
    }
    if (!taatsu.length) continue;
    const pick = taatsu[Math.floor(rng() * taatsu.length)];
    if (pick[0] === 'pair') { hand[pick[1]] += 2; used[pick[1]] += 2; }
    else if (pick[0] === 'adj') { hand[pick[1]] += 1; hand[pick[1] + 1] += 1; used[pick[1]] += 1; used[pick[1] + 1] += 1; }
    else { hand[pick[1]] += 1; hand[pick[1] + 2] += 1; used[pick[1]] += 1; used[pick[1] + 2] += 1; }

    if (handTotal(hand) !== need) continue;
    return hand;
  }
  return null;
}

function sampleHands(pool, state, rule, oppSizes, wallNeed, rng, tenpaiPrior = null) {
  const avail = new Array(34).fill(0);
  for (const t of pool) avail[t] += 1;
  const hands = Array.from({ length: 4 }, () => new Array(34).fill(0));
  const exposed = (s) => (state.meldsBySeat[s]?.length || 0);
  const totalTiles = rule.tileCount || 108;
  const remainingKnown = pool.length;
  const progress = Math.max(0, Math.min(1, 1 - (state.wallRemaining ?? remainingKnown / 2) / Math.max(1, totalTiles - 40)));
  const model = OPPONENT_MODELS[state._opponentModel || 'mixed'] || OPPONENT_MODELS.mixed;
  const autoPrior = (0.05 + 0.45 * progress) * (model.tenpaiBias || 1);
  const prior = Math.max(0, Math.min(0.85, tenpaiPrior ?? autoPrior));

  for (let s = 0; s < 4; s++) {
    if (s === state.seat || state.winners[s]) continue;
    const need = oppSizes[s];
    const voidSuit = state.voidSuits[s];
    let made = null;
    if (need >= 2 && rng() < prior) {
      made = buildTenpaiHand(avail, voidSuit, need, exposed(s), rng);
    }
    if (!made) {
      made = new Array(34).fill(0);
      const list = [];
      for (let t = 0; t < 34; t++) {
        if (!allowedByVoid(t, voidSuit)) continue;
        for (let i = 0; i < avail[t]; i++) list.push(t);
      }
      if (list.length < need) {
        for (let t = 0; t < 34; t++) for (let i = 0; i < avail[t]; i++) list.push(t);
      }
      shuffle(list, rng);
      for (let i = 0; i < need && i < list.length; i++) made[list[i]] += 1;
    }
    for (let t = 0; t < 34; t++) {
      const n = Math.min(made[t], avail[t]);
      hands[s][t] = n;
      avail[t] -= n;
    }
  }

  const wallList = [];
  for (let t = 0; t < 34; t++) for (let i = 0; i < avail[t]; i++) wallList.push(t);
  shuffle(wallList, rng);
  return { hands, wall: wallList.slice(0, wallNeed) };
}

function nextActive(active, from) {
  for (let k = 1; k <= 4; k++) {
    const s = (from + k) % 4;
    if (active[s]) return s;
  }
  return -1;
}

/**
 * 单个候选打牌的一次约束蒙特卡洛。
 */
export function simulateDiscard(scenario, candidate, options = {}) {
  const { state, rule } = scenario;
  const samples = Math.max(50, options.samples ?? 800);
  const seed = options.seed ?? 20261103;
  const rng = mulberry32(seed ^ (candidate.tile * 2654435761));
  const model = OPPONENT_MODELS[options.opponentModel] || OPPONENT_MODELS.mixed;
  const pool = buildPool(state, rule);
  const wallNeed = estimateWallRemaining(state, rule, pool);
  const oppSizes = [0, 0, 0, 0];
  let oppNeed = 0;
  for (let s = 0; s < 4; s++) {
    if (s === state.seat || state.winners[s]) continue;
    oppSizes[s] = Math.max(0, 13 - 3 * (state.meldsBySeat[s]?.length || 0));
    oppNeed += oppSizes[s];
  }
  if (pool.length < oppNeed + 1) {
    return { error: '可见牌与手牌数量不一致，剩余牌不足；请检查输入或减少已明示牌。', samples: 0 };
  }

  let selfWins = 0;
  let selfDrawWins = 0;
  let ronWins = 0;
  let dealImmediate = 0;
  let dealEventual = 0;
  let oppSelfDraw = 0;
  let noWin = 0;
  let scoreSum = 0;
  let scoreSq = 0;
  let dealLossSum = 0;
  let dealLossCount = 0;
  let oppSelfScoreSum = 0;
  let oppSelfScoreCount = 0;
  let totalTurns = 0;
  const sampleState = { ...state, _opponentModel: options.opponentModel || 'mixed' };
  const tenpaiPrior = options.tenpaiPrior ?? null;

  for (let n = 0; n < samples; n++) {
    const sample = sampleHands(pool, sampleState, rule, oppSizes, wallNeed, rng, tenpaiPrior);
    const hands = Array.from({ length: 4 }, () => new Array(34).fill(0));
    const melds = Array.from({ length: 4 }, () => []);
    hands[state.seat] = candidate.hand.slice();
    melds[state.seat] = state.melds;
    for (let s = 0; s < 4; s++) {
      if (s === state.seat || state.winners[s]) continue;
      hands[s] = sample.hands[s];
      melds[s] = state.meldsBySeat[s] || [];
    }
    const active = [true, true, true, true];
    for (let s = 0; s < 4; s++) if (state.winners[s]) active[s] = false;
    active[state.seat] = true;

    // 当前打出的牌立即点炮
    let immediate = false;
    let immediateLoss = 0;
    if (!(candidate.tile === GHOST_TILE && rule.ghost?.enabled)) {
      for (let s = 0; s < 4; s++) {
        if (s === state.seat || !active[s]) continue;
        hands[s][candidate.tile]++;
        const sc = canWinNow(hands[s], melds[s], state.voidSuits[s], rule, false);
        hands[s][candidate.tile]--;
        if (sc) {
          immediate = true;
          immediateLoss = Math.max(immediateLoss, sc.score);
          active[s] = false;
        }
      }
    }
    if (immediate) {
      dealImmediate++;
      dealLossSum += immediateLoss;
      dealLossCount++;
      // 血战规则下自摸方已走，仍可继续；为控制方差，点炮样本直接结束。
      noWin++;
      continue;
    }

    const wall = sample.wall.slice();
    let turn = nextActive(active, state.seat);
    let guard = 0;
    let selfWon = false;
    let selfDraw = false;
    let selfScore = 0;
    let oppSelf = false;
    let dealt = false;

    while (turn >= 0 && wall.length > 0 && guard++ < 320) {
      if (!active[turn]) { turn = nextActive(active, turn); continue; }
      const draw = wall.pop();
      totalTurns++;
      hands[turn][draw]++;

      const win = canWinNow(hands[turn], melds[turn], state.voidSuits[turn], rule, true);
      if (win) {
        if (turn === state.seat) {
          selfWon = true; selfDraw = true; selfScore = win.score;
          break;
        }
        oppSelf = true;
        oppSelfScoreSum += win.score;
        oppSelfScoreCount++;
        active[turn] = false;
        turn = nextActive(active, turn);
        continue;
      }

      const discard = chooseDiscard(hands[turn], state.voidSuits[turn], rule);
      if (discard === null) break;
      hands[turn][discard]--;
      const ghostDiscard = discard === GHOST_TILE && rule.ghost?.enabled;
      if (!ghostDiscard) {
        let winners = [];
        for (let s = 0; s < 4; s++) {
          if (s === turn || !active[s]) continue;
          hands[s][discard]++;
          const sc = canWinNow(hands[s], melds[s], state.voidSuits[s], rule, false);
          hands[s][discard]--;
          if (sc) winners.push({ s, sc });
        }
        const selfWinner = winners.find((w) => w.s === state.seat);
        if (selfWinner) {
          selfWon = true; selfDraw = false; selfScore = selfWinner.sc.score;
          break;
        }
        if (winners.length) {
          if (turn === state.seat) {
            dealt = true;
            const loss = Math.max(...winners.map((w) => w.sc.score));
            dealLossSum += loss;
            dealLossCount++;
          }
          for (const w of winners) active[w.s] = false;
          if (!active[state.seat]) break;
        }
      }
      turn = nextActive(active, turn);
    }

    if (selfWon) {
      selfWins++;
      if (selfDraw) selfDrawWins++; else ronWins++;
      scoreSum += selfScore;
      scoreSq += selfScore * selfScore;
    } else {
      noWin++;
    }
    if (oppSelf) oppSelfDraw++;
    if (dealt) dealEventual++;
  }

  const p = (x) => x / samples;
  const pWin = p(selfWins);
  const pDeal = p(dealImmediate);
  const pDealFuture = Math.max(0, p(dealEventual) - p(dealImmediate));
  const pOppSelf = p(oppSelfDraw);
  const avgScore = selfWins ? scoreSum / selfWins : 0;
  const variance = selfWins > 1 ? Math.max(0, scoreSq / selfWins - avgScore * avgScore) : 0;
  const avgDealLoss = dealLossCount ? dealLossSum / dealLossCount : defaultDealLoss(rule);
  const avgOppSelfScore = oppSelfScoreCount ? oppSelfScoreSum / oppSelfScoreCount : defaultOppLoss(rule);

  return {
    samples,
    pWin,
    pDeal,
    pDealFuture,
    pDealTotal: Math.max(pDeal, p(dealEventual)),
    pOppSelfDraw: pOppSelf,
    pNoWin: p(noWin),
    pSelfDraw: p(selfDrawWins),
    pRon: p(ronWins),
    avgScore,
    scoreSd: Math.sqrt(variance),
    avgDealLoss,
    avgOppSelfScore,
    avgTurns: totalTurns / samples,
    ci95: {
      pWin: wilson(selfWins, samples),
      pDeal: wilson(dealImmediate, samples),
      pOppSelfDraw: wilson(oppSelfDraw, samples),
    },
    opponentModel: options.opponentModel || 'mixed',
    seed: options.seed ?? 20261103,
    _modelAggression: model.aggression,
  };
}

function defaultDealLoss(rule) {
  return rule.scoringSystem === 'luzhou' ? 10 : 4;
}

function defaultOppLoss(rule) {
  return rule.scoringSystem === 'luzhou' ? 20 : 8;
}

export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

/* ---------- 危险牌 / 机会成本 ---------- */

export function tileDanger(tile, state, rule, opponentModel = 'mixed', visibleCounts = null) {
  const visible = visibleCounts || buildVisibleCounts(state);
  const model = OPPONENT_MODELS[opponentModel] || OPPONENT_MODELS.mixed;
  let danger = 0;
  let count = 0;
  for (let s = 0; s < 4; s++) {
    if (s === state.seat || state.winners[s]) continue;
    count++;
    const vs = state.voidSuits[s];
    if (vs !== null && vs !== undefined && tile < 27 && suitOf(tile) === vs) continue;
    let v = isGhost(tile) ? 0.1 : 0.55;
    const rank = tile < 27 ? (tile % 9) + 1 : 0;
    if (tile < 27 && (rank === 1 || rank === 9)) v = 0.3;
    if (tile < 27 && rank >= 3 && rank <= 7) v = 0.7;
    if (tile >= 27) v = 0.65;
    const meldCount = (state.meldsBySeat[s]?.length || 0);
    v += Math.min(0.25, meldCount * 0.07);
    if ((state.discards[s] || []).includes(tile)) v *= 0.72;
    const discards = state.discards.flat();
    if (discards.includes(tile)) v *= 0.9;
    const unseen = capOf(tile, rule) - (visible[tile] || 0);
    if (unseen <= 0) v = 0;
    danger += Math.min(1, v);
  }
  const base = count ? danger / count : 0;
  const modelFactor = 0.75 + model.aggression * 0.35 + model.defense * -0.1;
  return Math.max(0, Math.min(1, base * modelFactor));
}

export function opportunityCost(currentAnalysis, candidate, currentScore, bestEV) {
  if (currentAnalysis?.isWin) return currentScore * 0.9;
  if (currentAnalysis?.shanten === 0 && candidate.shanten > 0) return Math.max(0.4, currentScore * 0.45);
  if (currentAnalysis?.shanten === 0 && candidate.shanten === 0 && candidate.ukeire < (currentAnalysis.ukeire || 0)) {
    return Math.max(0, (currentAnalysis.ukeire - candidate.ukeire) * 0.01);
  }
  if (currentAnalysis && candidate.shanten > currentAnalysis.shanten + 1) return Math.max(0.2, bestEV * 0.15);
  return 0;
}

/* ---------- 总流程 ---------- */

export function prepareScenario(rawState, rule) {
  const state = normalizeState(rawState);
  const visible = buildVisibleCounts(state);
  const jokers = state.hand[GHOST_TILE] || 0;
  const analysis = analyzeHand(state.hand, state.melds, jokers, rule, state, visible);
  const candidates = candidateDiscards(state.hand, state.melds, jokers, rule, state, visible);
  let paths;
  const totalCounts = state.hand.slice();
  totalCounts[GHOST_TILE] = 0;
  const total = sumCounts(totalCounts) + jokers;
  if (total === 14 - 3 * state.melds.length && candidates.length) {
    const best = candidates.find((c) => c.voidInfo.count === 0) || candidates[0];
    paths = winningPaths(best.hand, state.melds, best.jokers, rule, state, visible);
  } else {
    paths = winningPaths(state.hand, state.melds, jokers, rule, state, visible);
  }
  const currentScore = candidateScoreOfHand(state.hand, state.melds, jokers, rule);
  return { state, rule, visible, jokers, analysis, candidates, paths, currentScore };
}

function candidateScoreOfHand(hand, melds, jokers, rule) {
  const c = hand.slice(); c[GHOST_TILE] = 0;
  if (isWinStandard(c, melds.length, jokers)) {
    return scoreWin(c, melds, jokers, { selfDraw: true }, rule).score;
  }
  return patternPotential(c, melds, jokers, rule);
}

/**
 * 对每个候选弃牌做模拟，并计算损失。onProgress(done,total,candidate)。
 */
export function evaluateCandidates(scenario, options = {}, onProgress = null) {
  const { state, rule, analysis, candidates, currentScore } = scenario;
  const risk = riskByLevel(options.riskLevel ?? 3);
  const lambda = Number.isFinite(options.lambda) ? options.lambda : risk.lambda;
  const samples = Math.max(100, Math.min(20000, options.samples ?? 1200));
  const all = [];
  const n = candidates.length;

  // 胡牌动作
  if (analysis.isWin) {
    const sc = scoreWin((() => { const c = state.hand.slice(); c[GHOST_TILE] = 0; return c; })(), state.melds, scenario.jokers, { selfDraw: true }, rule);
    all.push({
      action: 'hu',
      tile: null,
      label: '立即胡牌',
      shanten: -1,
      ukeire: 0,
      waits: [],
      pWin: 1,
      pSelfDraw: 1,
      pRon: 0,
      pDeal: 0,
      pDealTotal: 0,
      pOppSelfDraw: 0,
      avgScore: sc.score,
      risk: 0,
      cWait: 0,
      loss: -sc.score,
      riskAdjusted: sc.score,
      ci95: { pWin: [1, 1], pDeal: [0, 0], pOppSelfDraw: [0, 0] },
      pattern: sc.pattern,
      reason: `已满足胡牌：${sc.labels.join(' / ')}，${sc.score}${rule.scoreUnit}。`,
      details: sc,
    });
  }

  candidates.forEach((cand, idx) => {
    const result = simulateDiscard(scenario, cand, {
      samples,
      seed: options.seed ?? 20261103,
      opponentModel: options.opponentModel || 'mixed',
      tenpaiPrior: options.tenpaiPrior ?? null,
    });
    if (result.error) {
      all.push({
        action: 'discard', tile: cand.tile, label: `打 ${tileLabel(cand.tile)}`, error: result.error,
        shanten: cand.shanten, ukeire: cand.ukeire, waits: cand.waits,
      });
      return;
    }
    const sc = scoreWin((() => {
      const c = cand.hand.slice(); c[GHOST_TILE] = 0; return c;
    })(), state.melds, cand.jokers, { selfDraw: true }, rule);
    const cWait = opportunityCost(analysis, cand, currentScore, result.pWin * result.avgScore);
    const riskValue = result.pDealTotal * result.avgDealLoss + result.pOppSelfDraw * result.avgOppSelfScore;
    const loss = -result.pWin * result.avgScore + lambda * riskValue + cWait;
    all.push({
      action: 'discard',
      tile: cand.tile,
      label: `打 ${tileLabel(cand.tile)}`,
      hand: cand.hand,
      jokers: cand.jokers,
      shanten: cand.shanten,
      ukeire: cand.ukeire,
      waits: cand.waits,
      voidInfo: cand.voidInfo,
      pWin: result.pWin,
      pSelfDraw: result.pSelfDraw,
      pRon: result.pRon,
      pDeal: result.pDeal,
      pDealTotal: result.pDealTotal,
      pDealFuture: result.pDealFuture,
      pOppSelfDraw: result.pOppSelfDraw,
      pNoWin: result.pNoWin,
      avgScore: result.avgScore || sc.score,
      risk: riskValue,
      cWait,
      loss,
      riskAdjusted: -loss,
      ci95: result.ci95,
      pattern: sc.pattern,
      danger: tileDanger(cand.tile, state, rule, options.opponentModel || 'mixed', scenario.visible),
      simulation: result,
      reason: buildReason(cand, result, sc, cWait, rule),
    });
    if (onProgress) onProgress(idx + 1, n, cand);
  });

  all.sort((a, b) => (a.error ? 1 : 0) - (b.error ? 1 : 0) || a.loss - b.loss);
  return {
    candidates: all,
    lambda,
    riskProfile: risk,
    samples,
    seed: options.seed ?? 20261103,
    opponentModel: options.opponentModel || 'mixed',
    model: OPPONENT_MODELS[options.opponentModel] || OPPONENT_MODELS.mixed,
  };
}

function buildReason(cand, result, sc, cWait, rule) {
  const bits = [];
  if (cand.voidInfo?.count > 0) bits.push(`仍需打 ${cand.voidInfo.count} 张缺门`);
  if (cand.shanten === 0) bits.push(`听 ${cand.waits.map((w) => tileLabel(w.tile)).join('/')}`);
  else bits.push(`${cand.shanten} 向听`);
  if (result.pDeal > 0.03) bits.push(`立即点炮 ${(result.pDeal * 100).toFixed(1)}%`);
  if (result.pWin > 0.05) bits.push(`模拟胡率 ${(result.pWin * 100).toFixed(1)}%`);
  if (cWait > 0.01) bits.push('破坏当前听牌/灵活性');
  bits.push(`潜在 ${sc.pattern} ${sc.score}${rule.scoreUnit}`);
  return bits.join('；');
}

export function topPaths(scenario, candidate, limit = 5) {
  const paths = winningPaths(candidate.hand, scenario.state.melds, candidate.jokers, scenario.rule, scenario.state, scenario.visible);
  return paths.paths.slice(0, limit);
}

export function sensitivityNotes(result) {
  const notes = [];
  const sorted = result.candidates.filter((c) => !c.error);
  if (sorted.length >= 2) {
    const gap = sorted[1].loss - sorted[0].loss;
    notes.push(`第 1 与第 2 名损失差 ${gap.toFixed(3)}；${gap < 0.05 ? '排序接近，样本误差可能改变名次' : '排序有较明显间隔'}`);
  }
  notes.push(`风险档位 λ=${result.lambda.toFixed(2)}（${result.riskProfile.name}）；λ 越高越偏向安全牌。`);
  const byRisk = [0.5, 0.8, 1.0, 1.3, 1.8].map((lambda) => {
    const ordered = sorted
      .map((c) => ({ c, l: -c.pWin * c.avgScore + lambda * c.risk + (c.cWait || 0) }))
      .sort((a, b) => a.l - b.l)
      .slice(0, 3)
      .map((x) => x.c.action === 'hu' ? '胡' : `打${tileLabel(x.c.tile)}`);
    return `λ=${lambda}: ${ordered.join(' > ')}`;
  });
  notes.push(`风险档位 Top3 变化：${byRisk.join('；')}`);
  notes.push(`对手模型：${result.model.name}。切换模型会改变点炮/被自摸估计。`);
  notes.push(`样本 ${result.samples}；概率给出 95% Wilson 区间，分数期望不含杠分。`);
  return notes;
}
