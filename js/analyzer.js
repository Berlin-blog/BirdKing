import {
  ALL_TILES, GHOST_TILE, countsFromTiles, formatTiles, isHonor,
  rankOf, suitOf, sumCounts, tileLabel, tilesFromCounts,
} from './tiles.js';

/* ============================================================
 * 手牌分析核心：向听、胡牌、听牌、进张、番型、路径
 * ============================================================ */

const HONORS = [27, 28, 29, 30, 31, 32];

function splitGhost(counts, ghostEnabled = true) {
  const c = counts.slice();
  const j = ghostEnabled ? c[GHOST_TILE] : 0;
  if (ghostEnabled) c[GHOST_TILE] = 0;
  return { c, j };
}

/* ---------- 一门花色的块分解 ---------- */

export function suitPatterns(counts9) {
  const c = counts9.slice();
  const raw = [];
  const seen = new Set();

  function push(m, t, p) {
    const key = `${m},${t},${p}`;
    if (seen.has(key)) return;
    seen.add(key);
    raw.push({ m, t, p });
  }

  function dfs(start, m, t, p, pairTile) {
    let i = start;
    while (i < 9 && c[i] === 0) i++;
    if (i === 9) {
      push(m, t, p);
      return;
    }
    if (m > 4) return;

    // leave tile unused
    dfs(i + 1, m, t, p, pairTile);

    // triplet
    if (c[i] >= 3 && m < 4) {
      c[i] -= 3;
      dfs(i, m + 1, t, p, pairTile);
      c[i] += 3;
    }
    // run
    if (i <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && m < 4) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      dfs(i, m + 1, t, p, pairTile);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    // pair (head)
    if (c[i] >= 2 && p === 0 && pairTile !== i) {
      c[i] -= 2;
      dfs(i, m, t, 1, i);
      c[i] += 2;
    }
    // pair as taatsu
    if (c[i] >= 2 && m + t < 4 && pairTile !== i) {
      c[i] -= 2;
      dfs(i, m, t + 1, p, i);
      c[i] += 2;
    }
    // adjacent taatsu
    if (i <= 7 && c[i + 1] > 0 && m + t < 4) {
      c[i]--; c[i + 1]--;
      dfs(i, m, t + 1, p, pairTile);
      c[i]++; c[i + 1]++;
    }
    // gap taatsu
    if (i <= 6 && c[i + 2] > 0 && m + t < 4) {
      c[i]--; c[i + 2]--;
      dfs(i, m, t + 1, p, pairTile);
      c[i]++; c[i + 2]++;
    }
  }

  dfs(0, 0, 0, 0, -1);
  return paretoPatterns(raw);
}

function paretoPatterns(patterns) {
  const byP = [[], []];
  for (const x of patterns) byP[x.p].push(x);
  const out = [];
  for (const list of byP) {
    list.sort((a, b) => b.m - a.m || b.t - a.t);
    let bestT = -1;
    for (const x of list) {
      if (x.t > bestT) {
        out.push(x);
        bestT = x.t;
      }
    }
  }
  return out;
}

function honorPatterns(counts) {
  let list = [{ m: 0, t: 0, p: 0 }];
  for (const tile of HONORS) {
    const n = counts[tile] || 0;
    if (n === 0) continue;
    const next = [];
    for (const b of list) {
      next.push(b);
      if (n >= 3 && b.m < 4) next.push({ m: b.m + 1, t: b.t, p: b.p });
      if (n >= 2 && b.p === 0) next.push({ m: b.m, t: b.t, p: 1 });
      if (n >= 2 && b.m + b.t < 4) next.push({ m: b.m, t: b.t + 1, p: b.p });
    }
    list = dedupe(next);
  }
  return list;
}

function dedupe(list) {
  const m = new Map();
  for (const x of list) {
    const k = `${x.m},${x.t},${x.p}`;
    if (!m.has(k)) m.set(k, x);
  }
  return [...m.values()];
}

function combine(a, b) {
  const m = new Map();
  for (const x of a) {
    for (const y of b) {
      const mm = x.m + y.m;
      if (mm > 4) continue;
      const key = `${mm},${x.t + y.t},${Math.min(1, x.p + y.p)}`;
      if (!m.has(key)) m.set(key, { m: mm, t: x.t + y.t, p: Math.min(1, x.p + y.p) });
    }
  }
  return dedupe([...m.values()]);
}

/* ---------- 无鬼向听 ---------- */

export function standardShanten(counts, exposedMelds = 0) {
  const c = counts.slice();
  let merged = suitPatterns(c.slice(0, 9));
  merged = combine(merged, suitPatterns(c.slice(9, 18)));
  merged = combine(merged, suitPatterns(c.slice(18, 27)));
  merged = combine(merged, honorPatterns(c));

  let best = -Infinity;
  for (const x of merged) {
    const m = Math.min(x.m + exposedMelds, 4);
    const t = Math.min(x.t, Math.max(0, 4 - m));
    best = Math.max(best, 2 * m + t + x.p);
  }
  return 8 - best;
}

export function sevenPairsShanten(counts, jokers = 0) {
  let pairs = 0;
  let singles = 0;
  for (let i = 0; i < 34; i++) {
    if (i === GHOST_TILE) continue;
    pairs += Math.floor(counts[i] / 2);
    singles += counts[i] % 2;
  }
  const used = Math.min(singles, jokers);
  const maxPairs = pairs + used + Math.floor((jokers - used) / 2);
  return 6 - Math.min(6, maxPairs);
}

export function isSevenPairs(counts, jokers = 0, exposedMelds = 0) {
  if (exposedMelds > 0) return false;
  if (sumCounts(counts) + jokers !== 14) return false;
  let pairs = 0;
  let singles = 0;
  for (let i = 0; i < 34; i++) {
    if (i === GHOST_TILE) continue;
    pairs += Math.floor(counts[i] / 2);
    singles += counts[i] % 2;
  }
  if (singles > jokers) return false;
  const rem = jokers - singles;
  if (rem % 2 !== 0) return false;
  return pairs + singles + rem / 2 >= 7;
}

/* ---------- 胡牌判定 ---------- */

function canFormMelds(counts, needMelds) {
  if (needMelds === 0) return sumCounts(counts) === 0;
  let i = 0;
  while (i < 34 && counts[i] === 0) i++;
  if (i === 34) return false;
  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canFormMelds(counts, needMelds - 1)) { counts[i] += 3; return true; }
    counts[i] += 3;
  }
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--; counts[i + 1]--; counts[i + 2]--;
    if (canFormMelds(counts, needMelds - 1)) {
      counts[i]++; counts[i + 1]++; counts[i + 2]++;
      return true;
    }
    counts[i]++; counts[i + 1]++; counts[i + 2]++;
  }
  return false;
}

function canFormMeldsWild(counts, needMelds, jokers) {
  if (needMelds === 0) return sumCounts(counts) === 0 && jokers === 0;
  let i = 0;
  while (i < 34 && counts[i] === 0) i++;
  if (i === 34) return jokers === needMelds * 3;

  const real = Math.min(3, counts[i]);
  const need = 3 - real;
  if (need <= jokers) {
    counts[i] -= real;
    if (canFormMeldsWild(counts, needMelds - 1, jokers - need)) { counts[i] += real; return true; }
    counts[i] += real;
  }
  if (i < 27 && i % 9 <= 6) {
    let usedJ = 0;
    const used = [];
    for (let k = 0; k < 3; k++) {
      const t = i + k;
      if (counts[t] > 0) { counts[t]--; used.push(t); }
      else usedJ++;
    }
    if (usedJ <= jokers && canFormMeldsWild(counts, needMelds - 1, jokers - usedJ)) {
      for (const t of used) counts[t]++;
      return true;
    }
    for (const t of used) counts[t]++;
  }
  return false;
}

export function isWinStandard(counts, exposedMelds = 0, jokers = 0) {
  if (sumCounts(counts) + jokers !== 14 - 3 * exposedMelds) return false;
  if (isSevenPairs(counts, jokers, exposedMelds)) return true;
  const need = 4 - exposedMelds;
  if (need < 0) return false;
  const c = counts.slice();
  const pairCandidates = [];
  for (let i = 0; i < 34; i++) {
    if (i === GHOST_TILE || c[i] === 0) continue;
    pairCandidates.push([i, Math.min(2, c[i]), Math.max(0, 2 - c[i])]);
  }
  pairCandidates.push([-1, 0, 2]);
  for (const [tile, real, needJ] of pairCandidates) {
    if (needJ > jokers) continue;
    const cc = c.slice();
    if (tile >= 0) cc[tile] -= real;
    if (canFormMeldsWild(cc, need, jokers - needJ)) return true;
  }
  return false;
}

export function isAllTripletsWin(counts, exposedMelds, jokers = 0, meldList = []) {
  if (meldList.some((m) => m.type === 'chi')) return false;
  if (sumCounts(counts) + jokers !== 14 - 3 * exposedMelds) return false;
  const need = 4 - exposedMelds;
  if (need < 0) return false;
  const c = counts.slice();
  const candidates = [];
  for (let i = 0; i < 34; i++) {
    if (i === GHOST_TILE || c[i] === 0) continue;
    candidates.push([i, Math.min(2, c[i]), Math.max(0, 2 - c[i])]);
  }
  candidates.push([-1, 0, 2]);
  for (const [tile, real, needJ] of candidates) {
    if (needJ > jokers) continue;
    const cc = c.slice();
    if (tile >= 0) cc[tile] -= real;
    if (canFormTriplets(cc, need, jokers - needJ)) return true;
  }
  return false;
}

function canFormTriplets(counts, needMelds, jokers) {
  if (needMelds === 0) return sumCounts(counts) === 0 && jokers === 0;
  let i = 0;
  while (i < 34 && counts[i] === 0) i++;
  if (i === 34) return jokers === needMelds * 3;
  const real = Math.min(3, counts[i]);
  const need = 3 - real;
  if (need > jokers) return false;
  counts[i] -= real;
  const ok = canFormTriplets(counts, needMelds - 1, jokers - need);
  counts[i] += real;
  return ok;
}

/* ---------- 带鬼向听 ---------- */

const finishCache = new Map();

function finishScore(m, t, p, jokers, unusedReal, need) {
  const key = `${need}|${m}|${t}|${p}|${jokers}|${unusedReal}`;
  if (finishCache.has(key)) return finishCache.get(key);
  const memo = new Map();

  function rec(mm, tt, pp, jj, uu) {
    const k = `${mm},${tt},${pp},${jj},${uu}`;
    if (memo.has(k)) return memo.get(k);
    let val = 2 * Math.min(mm, need) + Math.min(tt, Math.max(0, need - mm)) + pp;
    const slotsM = need - mm;
    const slotsT = Math.max(0, need - mm - tt);
    if (slotsM > 0 && jj >= 3) val = Math.max(val, rec(mm + 1, tt, pp, jj - 3, uu));
    if (slotsM > 0 && jj >= 2 && uu > 0) val = Math.max(val, rec(mm + 1, tt, pp, jj - 2, uu - 1));
    if (slotsT > 0 && jj >= 1 && uu > 0) val = Math.max(val, rec(mm, tt + 1, pp, jj - 1, uu - 1));
    if (slotsT > 0 && jj >= 2) val = Math.max(val, rec(mm, tt + 1, pp, jj - 2, uu));
    if (pp === 0 && jj >= 1 && uu > 0) val = Math.max(val, rec(mm, tt, 1, jj - 1, uu - 1));
    if (pp === 0 && jj >= 2) val = Math.max(val, rec(mm, tt, 1, jj - 2, uu));
    memo.set(k, val);
    return val;
  }

  const result = rec(m, t, p, jokers, unusedReal);
  finishCache.set(key, result);
  return result;
}

export function wildcardShanten(counts, exposedMelds = 0, jokers = 0) {
  const need = 4 - exposedMelds;
  if (need < 0) return 8;
  if (jokers === 0) return Math.min(standardShanten(counts, exposedMelds), sevenPairsShanten(counts, 0));
  if (sumCounts(counts) + jokers === 14 - 3 * exposedMelds && isWinStandard(counts, exposedMelds, jokers)) return -1;

  const c = counts.slice();
  const memo = new Set();
  let best = -Infinity;

  function dfs(i, m, t, p, j) {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) {
      best = Math.max(best, finishScore(m, t, p, j, sumCounts(c), need));
      return;
    }
    if (m > need) return;
    const key = `${i}|${c.join('')}|${m}|${t}|${p}|${j}`;
    if (memo.has(key)) return;
    memo.add(key);

    dfs(i + 1, m, t, p, j);

    if (m < need) {
      for (let real = Math.min(3, c[i]); real >= 1; real--) {
        const needJ = 3 - real;
        if (needJ > j) continue;
        c[i] -= real;
        dfs(i, m + 1, t, p, j - needJ);
        c[i] += real;
      }
    }

    if (i < 27) {
      const suitStart = Math.floor(i / 9) * 9;
      const maxStart = Math.min(i, suitStart + 6);
      for (let s = Math.max(suitStart, i - 2); s <= maxStart; s++) {
        let needJ = 0;
        const used = [];
        let hasReal = false;
        for (let k = 0; k < 3; k++) {
          const tk = s + k;
          if (c[tk] > 0) { c[tk]--; used.push(tk); hasReal = true; }
          else needJ++;
        }
        if (needJ <= j && hasReal && m < need) {
          dfs(i, m + 1, t, p, j - needJ);
        }
        for (const tk of used) c[tk]++;
      }
    }

    if (p === 0) {
      for (let real = Math.min(2, c[i]); real >= 1; real--) {
        const needJ = 2 - real;
        if (needJ > j) continue;
        c[i] -= real;
        dfs(i, m, t, 1, j - needJ);
        c[i] += real;
      }
    }

    if (m + t < need) {
      for (let real = Math.min(2, c[i]); real >= 1; real--) {
        const needJ = 2 - real;
        if (needJ > j) continue;
        c[i] -= real;
        dfs(i, m, t + 1, p, j - needJ);
        c[i] += real;
      }
      if (i < 27) {
        const suitStart = Math.floor(i / 9) * 9;
        for (const gap of [1, 2]) {
          for (let s = Math.max(suitStart, i - 1); s <= i; s++) {
            const second = s + gap;
            if (second >= suitStart + 9 || s > i || second < i) continue;
            let needJ = 0;
            const used = [];
            let hasReal = false;
            for (const tk of [s, second]) {
              if (c[tk] > 0) { c[tk]--; used.push(tk); hasReal = true; }
              else needJ++;
            }
            if (needJ <= j && hasReal) dfs(i, m, t + 1, p, j - needJ);
            for (const tk of used) c[tk]++;
          }
        }
      }
    }
  }

  dfs(0, 0, 0, 0, jokers);
  if (!Number.isFinite(best)) return 8;
  return 8 - best;
}

/* ---------- 番型 / 计分 ---------- */

export function quadCount(counts, melds = []) {
  const total = counts.slice();
  for (const m of melds) {
    if (m.tiles) for (const t of m.tiles) total[t] += 1;
    else if (m.tile !== undefined) total[m.tile] += m.type === 'gang' ? 4 : 3;
  }
  let q = 0;
  for (let i = 0; i < 34; i++) if (i !== GHOST_TILE && total[i] >= 4) q++;
  return q;
}

export function isPureSuit(counts, melds = [], jokers = 0) {
  const suits = new Set();
  for (let i = 0; i < 27; i++) if (counts[i] > 0) suits.add(Math.floor(i / 9));
  for (const m of melds) {
    if (m.tile !== undefined && m.tile < 27) suits.add(Math.floor(m.tile / 9));
    if (m.tiles) for (const t of m.tiles) if (t < 27) suits.add(Math.floor(t / 9));
  }
  return suits.size <= 1;
}

export function isAllTerminalsOrHonors(counts, melds = []) {
  const all = [];
  for (let i = 0; i < 34; i++) for (let k = 0; k < counts[i]; k++) all.push(i);
  for (const m of melds) {
    if (m.tile !== undefined) all.push(m.tile);
    if (m.tiles) all.push(...m.tiles);
  }
  return all.every((t) => isHonor(t) || rankOf(t) === 1 || rankOf(t) === 9);
}

export function scoreChengdu(counts, melds = [], jokers = 0, flags = {}, rule) {
  const labels = [];
  let fan = rule.baseFan || 1;
  const seven = isSevenPairs(counts, jokers, melds.length);
  const allTriplets = isAllTripletsWin(counts, melds.length, jokers, melds);
  const pure = isPureSuit(counts, melds, jokers);
  const terminals = isAllTerminalsOrHonors(counts, melds);
  const quads = quadCount(counts, melds);
  let pattern = '平胡';

  if (seven) {
    pattern = quads >= 1 ? '龙七对' : '七对';
    fan += 2 + (quads >= 1 ? 1 : 0);
    labels.push(pattern);
  } else if (allTriplets) {
    pattern = '对对胡';
    fan += 2;
    labels.push(pattern);
  }
  if (pure) {
    pattern = seven ? '清七对' : allTriplets ? '清对' : '清一色';
    fan += 2;
    labels.push('清一色');
  }
  if (terminals) { fan += 2; labels.push('带幺九'); }
  if (quads > 0) { fan += quads; labels.push(`${quads}根`); }
  if (melds.length === 4 && sumCounts(counts) + jokers <= 2) { fan += 2; labels.push('金钩钓'); }
  if (flags.selfDraw) { fan += rule.selfDrawFanBonus || 0; labels.push('自摸'); }
  if (flags.afterKong) { fan += 1; labels.push('杠上花'); }
  if (flags.robKong) { fan += 1; labels.push('抢杠胡'); }
  if (flags.lastTile) { fan += 1; labels.push('海底'); }
  if (flags.afterKongDiscard) { fan += 1; labels.push('杠上炮'); }
  fan = Math.min(fan, rule.fanCap ?? 4);
  const score = Math.min(2 ** fan, rule.capScore ?? 16);
  return { fan, labels, score, pattern, seven, allTriplets, pure, quads, validRon: true };
}

export function scoreLuzhou(counts, melds = [], jokers = 0, flags = {}, rule) {
  const labels = [];
  const seven = isSevenPairs(counts, jokers, melds.length);
  const allTriplets = isAllTripletsWin(counts, melds.length, jokers, melds);
  const pure = isPureSuit(counts, melds, jokers);
  const quads = quadCount(counts, melds);
  const noGhost = jokers === 0;
  let pattern = '平胡';
  let score = 2;

  if (seven) {
    if (pure) {
      pattern = quads > 0 ? '清龙七对' : '清七对';
      score = 40 * 2 ** Math.max(0, quads - 1);
    } else {
      pattern = quads > 1 ? '双龙七对' : quads === 1 ? '龙七对' : '七对';
      score = 10 * 2 ** quads;
    }
    labels.push(pattern);
  } else if (allTriplets) {
    if (pure) {
      pattern = '清对';
      score = 40 * 2 ** quads;
    } else {
      pattern = quads > 1 ? '双闺对' : quads === 1 ? '闺对' : '大对子';
      score = 10 * 2 ** quads;
    }
    labels.push(pattern);
  } else if (pure) {
    pattern = quads > 1 ? '清双闺' : quads === 1 ? '清闺' : '清一色';
    score = 10 * 2 ** quads;
    labels.push(pattern);
  } else {
    if (quads > 0) {
      score = 5 * 2 ** (quads - 1);
      labels.push(`${quads}闺平胡`);
    } else {
      labels.push('平胡');
    }
  }

  if (noGhost) {
    if (pattern === '平胡') {
      score = Math.max(score, 10);
      labels.push('无鬼胡');
    } else {
      score = Math.max(score, 40);
      labels.push('无鬼');
    }
  }

  if (flags.afterKong) {
    if (pattern === '平胡') score = Math.max(score, 10);
    else if (allTriplets || pure) score = Math.max(score * 2, 40);
    else score *= 2;
    if (noGhost) score = Math.max(score, 40);
    labels.push('杠上花');
  }
  if (flags.afterKongDiscard) {
    if (pattern === '平胡') score = 10;
    else score *= 2;
    labels.push('杠上炮');
  }
  if (flags.robKong) {
    if (pattern === '平胡') score = 10;
    else score *= 2;
    labels.push('抢杠胡');
  }
  if (flags.handOne) { score *= 2; labels.push('手把一'); }
  if (flags.heavenly) { score = 40; labels.push('天胡/地胡'); }

  score = Math.max(2, Math.min(rule.cap ?? 40, Math.floor(score)));
  const discardScore = Math.floor(score / 2);
  return {
    score: flags.selfDraw === false ? discardScore : score,
    selfDrawScore: score,
    discardScore,
    pattern,
    labels: [...new Set(labels)],
    seven,
    allTriplets,
    pure,
    quads,
    validRon: !(pattern === '平胡' && !rule.plainCanRon),
  };
}

export function scoreWin(counts, melds, jokers, flags, rule) {
  return rule.scoringSystem === 'luzhou'
    ? scoreLuzhou(counts, melds, jokers, flags, rule)
    : scoreChengdu(counts, melds, jokers, flags, rule);
}

/* ---------- 听牌 / 进张 ---------- */

function capacityOf(tile, rule) {
  return tile === GHOST_TILE && rule.ghost?.enabled ? rule.ghost.count : 4;
}

export function allowedTiles(rule) {
  const list = [];
  for (let t = 0; t < 27; t++) list.push(t);
  if (rule?.honorTiles) for (let t = 27; t < 33; t++) list.push(t);
  if (rule?.ghost?.enabled) list.push(GHOST_TILE);
  return list;
}

export function computeWaits(handCounts, melds, jokers, rule, voidSuit, visibleCounts) {
  const out = [];
  const base = handCounts.slice();
  base[GHOST_TILE] = 0;
  for (const t of allowedTiles(rule)) {
    if (voidSuit !== null && voidSuit !== undefined && t < 27 && suitOf(t) === voidSuit) continue;
    if (t !== GHOST_TILE && (base[t] || 0) >= capacityOf(t, rule)) continue;
    const c = base.slice();
    const addJ = t === GHOST_TILE ? 1 : 0;
    if (t !== GHOST_TILE) c[t] += 1;
    if (isWinStandard(c, melds.length, jokers + addJ)) {
      const rem = Math.max(0, capacityOf(t, rule) - (visibleCounts[t] || 0));
      out.push({ tile: t, remaining: rem });
    }
  }
  return out;
}

/** 当前 shanten 下的有效进张；仅对无鬼/低向听展开，避免组合爆炸。 */
export function effectiveDraws(handCounts, melds, jokers, currentShanten, rule, voidSuit, visibleCounts) {
  if (currentShanten <= 0) {
    return computeWaits(handCounts, melds, jokers, rule, voidSuit, visibleCounts)
      .map((w) => ({ tile: w.tile, remaining: w.remaining, nextShanten: 0 }));
  }
  if (jokers > 0 || currentShanten > 2) return [];
  const out = [];
  const base = handCounts.slice();
  base[GHOST_TILE] = 0;
  const total = sumCounts(base) + jokers;
  if (total !== 13 - 3 * melds.length) return [];
  for (const t of allowedTiles(rule)) {
    if (t !== GHOST_TILE && (base[t] || 0) >= capacityOf(t, rule)) continue;
    if (voidSuit !== null && voidSuit !== undefined && t < 27 && suitOf(t) === voidSuit) continue;
    const c = base.slice();
    const addJ = t === GHOST_TILE ? 1 : 0;
    if (t !== GHOST_TILE) c[t] += 1;
    let improved = false;
    for (let d = 0; d < 34; d++) {
      if (c[d] === 0) continue;
      c[d]--;
      if (effectiveShanten(c, melds, jokers + addJ, rule, voidSuit, visibleCounts) < currentShanten) {
        improved = true;
        c[d]++;
        break;
      }
      c[d]++;
    }
    if (improved) {
      out.push({
        tile: t,
        remaining: Math.max(0, capacityOf(t, rule) - (visibleCounts[t] || 0)),
        nextShanten: 0,
      });
    }
  }
  return out;
}

export function voidInfo(handCounts, voidSuit) {
  if (voidSuit === null || voidSuit === undefined) return { count: 0, cleared: true, tiles: [] };
  let count = 0;
  const tiles = [];
  for (let t = voidSuit * 9; t < voidSuit * 9 + 9; t++) {
    if (handCounts[t] > 0) { count += handCounts[t]; tiles.push(t); }
  }
  return { count, cleared: count === 0, tiles };
}

export function effectiveShanten(handCounts, melds, jokers, rule, voidSuit, visibleCounts) {
  const vi = voidInfo(handCounts, voidSuit);
  const c = handCounts.slice();
  c[GHOST_TILE] = 0;
  if (rule.mustClearVoid && voidSuit !== null) {
    for (let t = voidSuit * 9; t < voidSuit * 9 + 9; t++) c[t] = 0;
  }
  const base = jokers > 0
    ? wildcardShanten(c, melds.length, jokers)
    : Math.min(standardShanten(c, melds.length), sevenPairsShanten(c, 0));
  if (!rule.mustClearVoid || vi.count === 0) return base;
  return base + vi.count;
}

export function buildVisibleCounts(state) {
  const v = new Array(34).fill(0);
  if (state.handCounts) {
    for (let t = 0; t < 34; t++) v[t] += state.handCounts[t] || 0;
  } else {
    for (const t of state.hand || []) v[t] += 1;
  }
  for (const m of state.melds || []) {
    if (m.tiles) for (const t of m.tiles) v[t] += 1;
    else if (m.tile !== undefined) v[m.tile] += m.type === 'gang' ? 4 : 3;
  }
  for (const seatDiscards of state.discards || []) for (const t of seatDiscards) v[t] += 1;
  for (const t of state.visibleExtra || []) v[t] += 1;
  for (const seatMelds of state.meldsBySeat || []) {
    for (const m of seatMelds) {
      if (m.tiles) for (const t of m.tiles) v[t] += 1;
      else if (m.tile !== undefined) v[m.tile] += m.type === 'gang' ? 4 : 3;
    }
  }
  return v;
}

export function analyzeHand(handCounts, melds, jokers, rule, state, visibleCounts) {
  const voidSuit = state.voidSuits?.[state.seat ?? 0] ?? null;
  const vi = voidInfo(handCounts, voidSuit);
  const sh = effectiveShanten(handCounts, melds, jokers, rule, voidSuit, visibleCounts);
  const waits = sh === 0 ? computeWaits(handCounts, melds, jokers, rule, voidSuit, visibleCounts) : [];
  const draws = sh === 0 ? [] : effectiveDraws(handCounts, melds, jokers, sh, rule, voidSuit, visibleCounts);
  const uke = sh === 0
    ? waits.reduce((a, b) => a + b.remaining, 0)
    : draws.reduce((a, b) => a + b.remaining, 0);
  const cWin = handCounts.slice();
  cWin[GHOST_TILE] = 0;
  const total = sumCounts(cWin) + jokers;
  const isWin = total === 14 - 3 * melds.length && vi.count === 0 && isWinStandard(cWin, melds.length, jokers);
  return {
    shanten: sh,
    rawShanten: jokers > 0 ? wildcardShanten(cWin, melds.length, jokers) : standardShanten(cWin, melds.length),
    voidInfo: vi,
    waits,
    draws,
    ukeire: uke,
    isWin,
    total,
    jokers,
  };
}

export function candidateDiscards(handCounts, melds, jokers, rule, state, visibleCounts) {
  const out = [];
  const seen = new Set();
  const voidSuit = state.voidSuits?.[state.seat ?? 0] ?? null;
  for (let t = 0; t < 34; t++) {
    if (handCounts[t] === 0 || seen.has(t)) continue;
    seen.add(t);
    const c = handCounts.slice();
    c[t] -= 1;
    const jj = jokers - (t === GHOST_TILE ? 1 : 0);
    const vi = voidInfo(c, voidSuit);
    const sh = effectiveShanten(c, melds, jj, rule, voidSuit, visibleCounts);
    const waits = sh === 0 ? computeWaits(c, melds, jj, rule, voidSuit, visibleCounts) : [];
    const draws = sh === 0 ? [] : effectiveDraws(c, melds, jj, sh, rule, voidSuit, visibleCounts);
    const uke = sh === 0
      ? waits.reduce((a, b) => a + b.remaining, 0)
      : draws.reduce((a, b) => a + b.remaining, 0);
    out.push({
      tile: t,
      hand: c,
      jokers: jj,
      shanten: sh,
      voidInfo: vi,
      waits,
      draws,
      ukeire: uke,
      isWin: (() => {
        const cw = c.slice(); cw[GHOST_TILE] = 0;
        return sumCounts(cw) + jj === 14 - 3 * melds.length && vi.count === 0 && isWinStandard(cw, melds.length, jj);
      })(),
      discardLabel: tileLabel(t),
    });
  }
  out.sort((a, b) => a.shanten - b.shanten || b.ukeire - a.ukeire || a.tile - b.tile);
  return out;
}

export function patternPotential(counts, melds, jokers, rule) {
  const pure = isPureSuit(counts, melds, jokers);
  const quads = quadCount(counts, melds);
  if (rule.scoringSystem === 'luzhou') {
    let score = 2;
    if (quads > 0) score = 5 * 2 ** (quads - 1);
    if (pure) score = Math.max(score, 10 * 2 ** quads);
    return Math.min(rule.cap ?? 40, score);
  }
  let fan = rule.baseFan || 1;
  if (pure) fan += 2;
  fan += quads;
  return Math.min(2 ** Math.min(fan, rule.fanCap ?? 4), rule.capScore ?? 16);
}

export function winningPaths(handCounts, melds, jokers, rule, state, visibleCounts) {
  const voidSuit = state.voidSuits?.[state.seat ?? 0] ?? null;
  const base = handCounts.slice();
  base[GHOST_TILE] = 0;
  const sh = effectiveShanten(handCounts, melds, jokers, rule, voidSuit, visibleCounts);
  if (sh === 0) {
    const waits = computeWaits(base, melds, jokers, rule, voidSuit, visibleCounts);
    const totalOuts = waits.reduce((a, b) => a + b.remaining, 0);
    const paths = waits.map((w) => {
      const c = base.slice();
      if (w.tile !== GHOST_TILE) c[w.tile] += 1;
      const jj = jokers + (w.tile === GHOST_TILE ? 1 : 0);
      const sc = scoreWin(c, melds, jj, { selfDraw: true }, rule);
      return {
        type: '听牌',
        draw: w.tile,
        wait: w.tile,
        outs: w.remaining,
        weight: totalOuts ? w.remaining / totalOuts : 0,
        score: sc.score,
        pattern: sc.pattern,
        desc: `摸/胡 ${tileLabel(w.tile)} → ${sc.pattern} ${sc.score}${rule.scoreUnit}`,
      };
    });
    return { shanten: sh, paths: paths.sort((a, b) => b.outs - a.outs), totalOuts };
  }
  if (sh === 1) {
    const paths = [];
    const seen = new Set();
    for (const t of allowedTiles(rule)) {
      if (voidSuit !== null && voidSuit !== undefined && t < 27 && suitOf(t) === voidSuit) continue;
      if (t !== GHOST_TILE && (base[t] || 0) >= capacityOf(t, rule)) continue;
      const c = base.slice();
      if (t !== GHOST_TILE) c[t] += 1;
      const jj = jokers + (t === GHOST_TILE ? 1 : 0);
      let best = null;
      for (let d = 0; d < 34; d++) {
        if (c[d] === 0) continue;
        c[d]--;
        const sh2 = effectiveShanten(c, melds, jj - (d === GHOST_TILE ? 1 : 0), rule, voidSuit, visibleCounts);
        if (sh2 === 0) {
          const waits = computeWaits(c, melds, jj - (d === GHOST_TILE ? 1 : 0), rule, voidSuit, visibleCounts);
          if (!waits.length) { c[d]++; continue; }
          const uke = waits.reduce((a, b) => a + b.remaining, 0);
          if (!best || uke > best.uke) best = { d, waits, uke };
        }
        c[d]++;
      }
      if (!best || !best.waits.length) continue;
      const key = `${t}|${best.d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const outs = Math.max(0, capacityOf(t, rule) - (visibleCounts[t] || 0));
      const sc = scoreWin(c, melds, jj, { selfDraw: true }, rule);
      paths.push({
        type: '一向听',
        draw: t,
        discard: best.d,
        wait: best.waits[0]?.tile,
        outs,
        secondOuts: best.uke,
        weight: outs * Math.max(1, best.uke),
        score: sc.score,
        pattern: sc.pattern,
        desc: `摸 ${tileLabel(t)} → 打 ${tileLabel(best.d)} → 听 ${best.waits.map((w) => tileLabel(w.tile)).join('/')}`,
      });
    }
    const maxW = Math.max(1, ...paths.map((p) => p.weight));
    for (const p of paths) p.weight /= maxW;
    return { shanten: sh, paths: paths.sort((a, b) => b.weight - a.weight).slice(0, 8), totalOuts: paths.reduce((a, b) => a + b.outs, 0) };
  }
  return { shanten: sh, paths: [], totalOuts: 0 };
}

export { formatTiles, tilesFromCounts, countsFromTiles, splitGhost };
