import {
  GHOST_TILE, HONOR_NAMES, TILE_CN_NUM, SUIT_NAMES, capacityOf, countsFromTiles,
  formatTiles, parseTile, parseTiles, suitOf, tileCode, tileLabel,
} from './tiles.js';
import { RULE_PRESETS, buildRuleConfig, getPreset, riskByLevel, ruleRows, OPPONENT_MODELS } from './rules.js';
import {
  allowedTiles, analyzeHand, buildVisibleCounts, candidateDiscards, winningPaths,
} from './analyzer.js';
import {
  evaluateCandidates, prepareScenario, sensitivityNotes, tileDanger, topPaths,
} from './engine.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const SEATS = [
  { name: '自己', wind: '我', short: '我' },
  { name: '下家', wind: '下', short: '下' },
  { name: '对家', wind: '对', short: '对' },
  { name: '上家', wind: '上', short: '上' },
];
const SUIT_CHAR = { m: '万', p: '筒', s: '条' };

const state = {
  ruleId: 'luzhou-ghost12',
  hand: [],
  meldsBySeat: [[], [], [], []],
  discards: [[], [], [], []],
  voidSuits: [null, null, null, null],
  winners: [false, false, false, false],
  wallRemaining: 42,
  riskLevel: 3,
  opponentModel: 'mixed',
  samples: 10000,
  seed: 20261103,
  visibleExtra: [],
  activeDiscardSeat: 0,
  paletteSuit: 'm',
  paletteTarget: 'hand',
  meldOwner: 0,
  lastResult: null,
  lastRaw: null,
  lastOptions: null,
  busy: false,
  worker: null,
  liveTimer: null,
};

const scanState = {
  image: null,
  file: null,
  cols: 14,
  rows: 1,
  slices: [],
  active: -1,
};

/* ---------- 基础工具 ---------- */

function currentRule() {
  return buildRuleConfig(state.ruleId);
}

function riskName(level) {
  return riskByLevel(level).name;
}

function pct(x, digits = 1) {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(digits)}%`;
}

function num(x, digits = 2) {
  return Number.isFinite(x) ? x.toFixed(digits) : '—';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(message, kind = 'info') {
  let node = $('#toast');
  if (!node) {
    node = document.createElement('div');
    node.id = 'toast';
    document.body.appendChild(node);
  }
  node.className = `show ${kind}`;
  node.textContent = message;
  clearTimeout(node._timer);
  node._timer = setTimeout(() => { node.className = ''; }, 3200);
}

function tileFace(tile) {
  if (tile === GHOST_TILE) return { cls: 'ghost', rank: '中', suit: '鬼', suitCode: 'z' };
  if (tile < 27) {
    const s = Math.floor(tile / 9);
    return { cls: '', rank: TILE_CN_NUM[tile % 9], suit: SUIT_NAMES[s], suitCode: ['m', 'p', 's'][s] };
  }
  return { cls: '', rank: HONOR_NAMES[tile - 27], suit: '字', suitCode: 'z' };
}

function makeTile(tile, opts = {}) {
  const el = document.createElement('div');
  const face = tileFace(tile);
  el.className = `tile ${face.cls} ${opts.size || ''}`.trim();
  el.dataset.suit = face.suitCode;
  el.dataset.tile = String(tile);
  el.title = tileLabel(tile);
  el.innerHTML = `<span class="${tile >= 27 ? 'tile-honor' : 'tile-rank'}">${face.rank}</span><span class="tile-suit">${face.suit}</span>`;
  if (opts.onClick) {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.remove')) return;
      opts.onClick(tile, el, e);
    });
  }
  if (opts.removable) {
    const rm = document.createElement('button');
    rm.className = 'remove';
    rm.type = 'button';
    rm.title = '移除';
    rm.textContent = '×';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.removable(tile, el, e);
    });
    el.appendChild(rm);
  }
  return el;
}

function addTileToHand(tile) {
  const rule = currentRule();
  if (!allowedTiles(rule).includes(tile)) {
    toast(`当前规则不含 ${tileLabel(tile)}`, 'warn');
    return;
  }
  state.hand.push(tile);
  state.hand.sort((a, b) => a - b);
  renderHand();
  scheduleLive();
}

function addDiscard(tile) {
  const rule = currentRule();
  if (!allowedTiles(rule).includes(tile)) {
    toast(`当前规则不含 ${tileLabel(tile)}`, 'warn');
    return;
  }
  state.discards[state.activeDiscardSeat].push(tile);
  renderSeats();
  scheduleLive();
}

/* ---------- 手牌 / 牌河 ---------- */

function renderHand() {
  const strip = $('#hand-strip');
  strip.innerHTML = '';
  for (const t of state.hand) {
    strip.appendChild(makeTile(t, {
      removable: (tile, el) => {
        const i = state.hand.indexOf(tile);
        if (i >= 0) state.hand.splice(i, 1);
        renderHand();
        scheduleLive();
      },
    }));
  }
  $('#hand-empty').style.display = state.hand.length ? 'none' : '';
  $('#hand-zone').classList.toggle('has-tiles', state.hand.length > 0);
  $('#hand-count').textContent = `${state.hand.length} 张`;
  const text = $('#hand-text');
  if (document.activeElement !== text) text.value = formatTiles(state.hand);
}

function parseHandInput() {
  const raw = $('#hand-text').value.trim();
  if (!raw) { state.hand = []; renderHand(); scheduleLive(); return; }
  const tiles = parseTiles(raw);
  if (!tiles.length) { toast('没有解析出牌张，请用 123m / 5p / z5 这类写法', 'warn'); return; }
  const rule = currentRule();
  const allowed = new Set(allowedTiles(rule));
  const bad = tiles.filter((t) => !allowed.has(t));
  if (bad.length) { toast(`当前规则不含：${[...new Set(bad)].map(tileLabel).join('、')}`, 'warn'); }
  const filtered = tiles.filter((t) => allowed.has(t));
  const counts = countsFromTiles(filtered);
  for (let t = 0; t < 34; t++) {
    const cap = capacityOf(t, rule);
    if (counts[t] > cap) { toast(`${tileLabel(t)} 超过 ${cap} 张上限`, 'warn'); return; }
  }
  state.hand = filtered.sort((a, b) => a - b);
  renderHand();
  scheduleLive();
}

function renderPalette() {
  const rule = currentRule();
  const root = $('#palette');
  root.innerHTML = '';
  let tiles = [];
  if (state.paletteSuit === 'm') tiles = Array.from({ length: 9 }, (_, i) => i);
  else if (state.paletteSuit === 'p') tiles = Array.from({ length: 9 }, (_, i) => 9 + i);
  else if (state.paletteSuit === 's') tiles = Array.from({ length: 9 }, (_, i) => 18 + i);
  else {
    if (rule.ghost?.enabled) tiles.push(GHOST_TILE);
    if (rule.honorTiles) tiles.push(...[27, 28, 29, 30, 31, 32]);
  }
  for (const t of tiles) {
    root.appendChild(makeTile(t, {
      onClick: (tile) => {
        if (state.paletteTarget === 'discard') addDiscard(tile);
        else addTileToHand(tile);
      },
    }));
  }
  $$('#palette-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.suit === state.paletteSuit));
  $$('#palette-target button').forEach((b) => b.classList.toggle('active', b.dataset.target === state.paletteTarget));
  $('#palette-ghost-tab').textContent = rule.ghost?.enabled ? '鬼 / 字' : '字牌';
}

function renderSeats() {
  const root = $('#seats');
  root.innerHTML = '';
  SEATS.forEach((seat, i) => {
    const row = document.createElement('div');
    row.className = `seat-row ${i === 0 ? 'self' : ''} ${state.activeDiscardSeat === i ? 'active' : ''}`;
    row.dataset.seat = String(i);

    const name = document.createElement('div');
    name.className = 'seat-name';
    name.innerHTML = `<span class="wind">${seat.wind}</span>${seat.name}${state.meldsBySeat[i].length ? `<small>${state.meldsBySeat[i].length}副露</small>` : ''}`;

    const select = document.createElement('select');
    select.innerHTML = `<option value="">无 / 未知</option><option value="0">缺万</option><option value="1">缺筒</option><option value="2">缺条</option>`;
    select.value = state.voidSuits[i] === null ? '' : String(state.voidSuits[i]);
    select.addEventListener('change', () => {
      state.voidSuits[i] = select.value === '' ? null : Number(select.value);
      scheduleLive();
      renderSeats();
    });

    const discard = document.createElement('div');
    discard.className = 'discard-mini';
    if (!state.discards[i].length) {
      discard.innerHTML = '<span class="empty">点击本行，再用上方牌张记录牌河</span>';
    } else {
      state.discards[i].forEach((t, idx) => {
        discard.appendChild(makeTile(t, {
          size: 'mini',
          removable: () => {
            state.discards[i].splice(idx, 1);
            renderSeats();
            scheduleLive();
          },
        }));
      });
    }

    const win = document.createElement('button');
    win.type = 'button';
    win.className = `win-toggle ${state.winners[i] ? 'on' : ''}`;
    win.title = state.winners[i] ? '已胡（点击取消）' : '标记为已胡';
    win.textContent = state.winners[i] ? '胡' : '在';
    win.addEventListener('click', (e) => {
      e.stopPropagation();
      if (i === 0) { toast('自己已胡则无需计算，直接点“立即胡牌”即可', 'warn'); return; }
      state.winners[i] = !state.winners[i];
      renderSeats();
      scheduleLive();
    });

    row.append(name, select, discard, win);
    row.addEventListener('click', (e) => {
      if (e.target.closest('select, button, .tile')) return;
      state.activeDiscardSeat = i;
      state.paletteTarget = 'discard';
      renderSeats();
      renderPalette();
    });
    root.appendChild(row);
  });
}

/* ---------- 副露 ---------- */

function meldTileOptions() {
  const rule = currentRule();
  const root = $('#meld-tile');
  root.innerHTML = '';
  for (const t of allowedTiles(rule)) {
    if (t === GHOST_TILE) continue;
    const o = document.createElement('option');
    o.value = String(t);
    o.textContent = tileLabel(t);
    root.appendChild(o);
  }
}

function renderMelds() {
  const list = $('#melds-list');
  list.innerHTML = '';
  const owner = state.meldOwner;
  $('#meld-owner-label').textContent = SEATS[owner].name;
  const melds = state.meldsBySeat[owner];
  if (!melds.length) {
    list.innerHTML = '<span class="fineprint" style="margin:0">暂无副露。选择归属与牌张后添加。</span>';
    return;
  }
  melds.forEach((m, idx) => {
    const chip = document.createElement('div');
    chip.className = 'meld-chip';
    const tag = document.createElement('span');
    tag.textContent = `${m.type === 'gang' ? '杠' : m.type === 'chi' ? '吃' : '碰'} `;
    chip.appendChild(tag);
    for (const t of m.tiles) chip.appendChild(makeTile(t, { size: 'mini' }));
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '×';
    rm.title = '移除副露';
    rm.addEventListener('click', () => {
      melds.splice(idx, 1);
      renderMelds();
      renderSeats();
      scheduleLive();
    });
    chip.appendChild(rm);
    list.appendChild(chip);
  });
}

function addMeld() {
  const type = $('#meld-type').value;
  const tile = Number($('#meld-tile').value);
  const rule = currentRule();
  let tiles;
  if (type === 'chi') {
    if (tile >= 27) { toast('吃只能用于万/筒/条', 'warn'); return; }
    const rank = (tile % 9) + 1;
    if (rank > 7) { toast('吃需要连续三张，起手牌不能是 8/9', 'warn'); return; }
    tiles = [tile, tile + 1, tile + 2];
  } else if (type === 'gang') {
    tiles = [tile, tile, tile, tile];
  } else {
    tiles = [tile, tile, tile];
  }
  // 校验可见张数
  const all = tiles.slice();
  const cap = capacityOf(tile, rule);
  if (tiles.length > cap) { toast(`${tileLabel(tile)} 数量超过上限`, 'warn'); return; }
  state.meldsBySeat[state.meldOwner].push({ type, tile, tiles: all });
  renderMelds();
  renderSeats();
  scheduleLive();
}

/* ---------- 实时分析 ---------- */

function buildRaw() {
  const handCounts = countsFromTiles(state.hand);
  return {
    seat: 0,
    handCounts,
    melds: state.meldsBySeat[0],
    discards: state.discards.map((x) => x.slice()),
    meldsBySeat: state.meldsBySeat.map((x) => x.slice()),
    voidSuits: state.voidSuits.slice(),
    winners: state.winners.slice(),
    wallRemaining: Number($('#wall-remaining')?.value ?? state.wallRemaining),
    visibleExtra: state.visibleExtra.slice(),
  };
}

function expectedHandSize() {
  return 14 - state.meldsBySeat[0].length * 3;
}

function validateState() {
  const need = expectedHandSize();
  if (state.hand.length !== need) {
    return `当前手牌 ${state.hand.length} 张，有 ${state.meldsBySeat[0].length} 个副露时应为 ${need} 张（摸牌后）。请补齐或移除。`;
  }
  const rule = currentRule();
  const counts = countsFromTiles(state.hand);
  for (let t = 0; t < 34; t++) {
    if (counts[t] > capacityOf(t, rule)) return `${tileLabel(t)} 出现 ${counts[t]} 张，超过上限 ${capacityOf(t, rule)}。`;
  }
  if (state.voidSuits[0] !== null) {
    const voidCount = state.hand.filter((t) => t < 27 && suitOf(t) === state.voidSuits[0]).length;
    if (voidCount > 0 && state.hand.length === need) {
      // 允许：当前仍需打缺；不阻断，只提示。
    }
  }
  return '';
}

function scheduleLive() {
  clearTimeout(state.liveTimer);
  state.liveTimer = setTimeout(updateLive, 140);
}

function updateLive() {
  const rule = currentRule();
  renderPreflight();
  const raw = buildRaw();
  const total = state.hand.length + state.meldsBySeat[0].length * 3;
  if (!state.hand.length) {
    $('#m-shanten').textContent = '—';
    $('#m-void').textContent = '—';
    $('#m-waits').textContent = '—';
    $('#m-wall').textContent = state.wallRemaining;
    $('#live-topology').innerHTML = '<span class="empty">还没有手牌</span>';
    $('#live-danger').innerHTML = '<span class="empty">录入后显示</span>';
    $('#live-paths').innerHTML = '<div class="empty">计算后显示 Top 路径</div>';
    return;
  }
  try {
    const visible = buildVisibleCounts(raw);
    const jokers = raw.handCounts[GHOST_TILE] || 0;
    const analysis = analyzeHand(raw.handCounts, raw.melds, jokers, rule, raw, visible);
    $('#m-shanten').textContent = analysis.isWin ? '胡' : analysis.shanten < 0 ? '胡' : String(analysis.shanten);
    $('#m-void').textContent = state.voidSuits[0] === null ? '?' : String(analysis.voidInfo.count);
    const waitCount = analysis.waits.length;
    $('#m-waits').textContent = analysis.isWin ? '已胡' : waitCount ? `${waitCount}种` : (analysis.ukeire ? `${analysis.ukeire}张` : (jokers > 0 ? '鬼局' : '—'));
    $('#m-wall').textContent = String(state.wallRemaining);
    $('#state-dot').textContent = analysis.isWin ? '可胡' : `${analysis.shanten} 向听`;
    $('#state-dot').className = `status-dot ${analysis.isWin ? 'ready' : ''}`;

    const topology = $('#live-topology');
    topology.innerHTML = '';
    for (const t of state.hand) topology.appendChild(makeTile(t, { size: 'mini' }));

    const dangerTiles = [...new Set(state.hand)].slice(0, 8);
    const danger = dangerTiles.map((t) => ({ t, value: tileDanger(t, raw, rule, state.opponentModel, visible) }))
      .sort((a, b) => b.value - a.value);
    const dl = $('#live-danger');
    dl.innerHTML = '';
    if (!danger.length) dl.innerHTML = '<span class="empty">暂无</span>';
    for (const d of danger.slice(0, 5)) {
      const row = document.createElement('div');
      row.className = 'danger-item';
      row.innerHTML = `<span>${tileLabel(d.t)}</span><span class="danger-bar"><i style="width:${Math.round(d.value * 100)}%"></i></span><b>${Math.round(d.value * 100)}</b>`;
      dl.appendChild(row);
    }

    let pathHand = raw.handCounts;
    let pathJokers = jokers;
    let pathPrefix = '';
    if (total === 14) {
      const cands = candidateDiscards(raw.handCounts, raw.melds, jokers, rule, raw, visible);
      const best = cands.find((c) => c.voidInfo.count === 0) || cands[0];
      if (best) {
        pathHand = best.hand;
        pathJokers = best.jokers;
        pathPrefix = `打 ${tileLabel(best.tile)} 后 · `;
      }
    }
    const paths = winningPaths(pathHand, raw.melds, pathJokers, rule, raw, visible);
    const pl = $('#live-paths');
    pl.innerHTML = '';
    if (!paths.paths.length) {
      pl.innerHTML = '<div class="empty">当前还没有可枚举的听牌路径；补齐副露/断门后再看，或直接计算模拟胡率。</div>';
    } else {
      for (const p of paths.paths.slice(0, 4)) {
        const row = document.createElement('div');
        row.className = 'path-item';
        row.innerHTML = `<span><b>${escapeHtml(p.type)}</b> · ${escapeHtml(pathPrefix + p.desc)}</span><span class="prob">${p.outs ?? 0} 张</span>`;
        pl.appendChild(row);
      }
    }
    const notice = $('#live-notice');
    if (total !== 14) {
      notice.innerHTML = `<b>张数提示：</b>当前手牌 + 副露折合 ${total} 张，摸牌后应为 14 张。缺少的牌会直接影响候选动作。`;
    } else if (state.voidSuits.some((v) => v === null)) {
      notice.innerHTML = '<b>断门缺口：</b>至少一家断门未填写；危险牌会使用位置先验，结果区间偏宽。';
    } else {
      notice.innerHTML = '<b>模型已就绪。</b> 概率来自约束蒙特卡洛；点“计算候选动作”比较风险调整后的期望损失。';
    }
  } catch (err) {
    console.error(err);
    $('#state-dot').textContent = '输入异常';
    $('#state-dot').className = 'status-dot busy';
  }
}

/* ---------- 规则 / 假设 ---------- */

function renderPreflight() {
  const rule = currentRule();
  const missing = state.voidSuits.map((v, i) => (v === null ? SEATS[i].name : null)).filter(Boolean);
  const selfVoid = state.voidSuits[0] === null ? '未填' : `缺${SUIT_NAMES[state.voidSuits[0]]}`;
  const ghostText = rule.ghost?.enabled ? `${rule.ghost.count} 鬼` : '无鬼';
  $('#preflight').innerHTML = `<b>计算前假设：</b>
    <span>${escapeHtml(rule.shortName)} · ${rule.tileCount} 张 · ${ghostText}</span>
    <span>自己 ${selfVoid}</span>
    <span>牌墙 ${Number($('#wall-remaining').value || state.wallRemaining)} 张</span>
    <span>${missing.length ? `断门未知：${missing.join('、')}` : '四家断门已填'}</span>
    ${rule.scoringSystem === 'luzhou' ? '<span>平胡仅自摸；放炮折半</span>' : ''}`;
}

function renderRuleTab() {
  const rule = currentRule();
  renderPreflight();
  const rows = ruleRows(rule);
  $('#rule-table').innerHTML = rows.map(([k, v]) => `<div class="rule-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(v)}</b></div>`).join('');

  const gaps = [];
  if (state.voidSuits.some((v) => v === null)) gaps.push('有玩家断门未填写：使用“位置 + 牌河”先验，不视为已知。');
  if (state.wallRemaining > 0) gaps.push(`剩余牌墙按输入值 ${state.wallRemaining} 张处理；系统会用未见牌约束采样。`);
  else gaps.push('牌墙剩余未知：按未见牌数量估计，后盘区间会变宽。');
  if (state.meldsBySeat.slice(1).every((m) => !m.length)) gaps.push('对手副露为空：可能低估其听牌速度与点炮风险。');
  if (rule.ghost?.enabled) gaps.push(`鬼牌局：${rule.ghost.count} 张红中均可替代任意牌；全局可见鬼数未知时按均匀先验。`);
  gaps.push('对手手牌不可见：模型仅用断门、副露、弃牌、牌墙与听牌先验约束，不是作弊读取。');
  gaps.push('血战到底的后续摸打被简化：一次模拟在立即点炮或对手自摸时终止，剩余局面用期望近似。');
  const assumptions = [...(rule.assumptions || []), ...gaps];
  $('#assumption-list').innerHTML = assumptions.map((s) => `<div class="assumption-item"><i>◆</i><span>${escapeHtml(s)}</span></div>`).join('');

  const repro = {
    ruleId: state.ruleId,
    rule: {
      name: rule.name, tileCount: rule.tileCount, ghost: rule.ghost, cap: rule.cap,
      fanCap: rule.fanCap, scoringSystem: rule.scoringSystem, plainCanRon: rule.plainCanRon,
      discardScoreFactor: rule.discardScoreFactor, bloodBattle: rule.bloodBattle,
    },
    state: {
      hand: formatTiles(state.hand),
      meldsBySeat: state.meldsBySeat.map((ms) => ms.map((m) => `${m.type}:${m.tiles.map(tileCode).join('')}`)),
      discards: state.discards.map((ds) => formatTiles(ds)),
      voidSuits: state.voidSuits,
      winners: state.winners,
      wallRemaining: Number($('#wall-remaining').value || state.wallRemaining),
      visibleExtra: formatTiles(state.visibleExtra),
    },
    options: {
      samples: Number($('#samples').value), seed: Number($('#seed').value),
      riskLevel: Number($('#risk-level').value), opponentModel: $('#opponent-model').value,
      lambda: $('#lambda').value === '' ? null : Number($('#lambda').value),
      tenpaiPrior: $('#tenpai-prior').value === '' ? null : Number($('#tenpai-prior').value),
    },
  };
  $('#repro-box').textContent = JSON.stringify(repro, null, 2);
}

/* ---------- 计算 ---------- */

function setBusy(busy, text = '') {
  state.busy = busy;
  $('#btn-calc').disabled = busy;
  $('#btn-calc-top').disabled = busy;
  $('#btn-recalc').disabled = busy;
  const p = $('#progress');
  p.classList.toggle('on', busy);
  if (busy) {
    p.querySelector('div').style.width = '2%';
    p.querySelector('span').textContent = text || '正在准备牌局…';
    $('#state-dot').textContent = '计算中';
    $('#state-dot').className = 'status-dot busy';
  } else {
    p.classList.remove('on');
  }
}

function optionsFromUI() {
  const lambdaRaw = $('#lambda').value;
  const priorRaw = $('#tenpai-prior').value;
  return {
    samples: Math.max(100, Math.min(20000, Number($('#samples').value) || 1200)),
    seed: Number($('#seed').value) || 20261103,
    riskLevel: Number($('#risk-level').value) || 3,
    opponentModel: $('#opponent-model').value || 'mixed',
    lambda: lambdaRaw === '' ? null : Number(lambdaRaw),
    tenpaiPrior: priorRaw === '' ? null : Number(priorRaw),
  };
}

async function calculate() {
  if (state.busy) return;
  const err = validateState();
  if (err) {
    toast(err, 'warn');
    $('#live-notice').innerHTML = `<b>还不能计算：</b>${escapeHtml(err)}`;
    switchTab('table');
    return;
  }
  const rule = currentRule();
  const raw = buildRaw();
  const options = optionsFromUI();
  state.wallRemaining = raw.wallRemaining;
  state.lastRaw = JSON.parse(JSON.stringify(raw));
  state.lastOptions = options;
  setBusy(true, `采样 ${options.samples} 次 × ${SEATS.length - 1} 家对手…`);
  if (state.worker) {
    state.worker.postMessage({ type: 'evaluate', rawState: raw, rule, options });
  } else {
    setTimeout(() => {
      try {
        const scenario = prepareScenario(raw, rule);
        const result = evaluateCandidates(scenario, options, (done, total) => {
          const p = $('#progress');
          p.querySelector('div').style.width = `${Math.round((done / Math.max(1, total)) * 100)}%`;
          p.querySelector('span').textContent = `正在模拟候选 ${done}/${total}…`;
        });
        const serializable = {
          ...result,
          candidates: result.candidates.map((c) => {
            const { hand, simulation, ...rest } = c;
            return { ...rest, paths: hand ? topPaths(scenario, c, 5) : [] };
          }),
          sensitivity: sensitivityNotes(result),
          scenarioMeta: {
            shanten: scenario.analysis.shanten,
            isWin: scenario.analysis.isWin,
            waits: scenario.analysis.waits,
            voidInfo: scenario.analysis.voidInfo,
            currentScore: scenario.currentScore,
            paths: scenario.paths,
          },
        };
        finishCalculation(serializable, raw, options, rule);
      } catch (e) {
        finishError(e);
      }
    }, 30);
  }
}

function finishCalculation(result, raw, options, rule) {
  setBusy(false);
  state.lastResult = result;
  state.lastRaw = raw;
  state.lastOptions = options;
  $('#state-dot').textContent = '已完成';
  $('#state-dot').className = 'status-dot ready';
  renderResults(result, raw, options, rule);
  switchTab('results');
}

function finishError(error) {
  setBusy(false);
  console.error(error);
  $('#state-dot').textContent = '计算失败';
  $('#state-dot').className = 'status-dot busy';
  toast(`计算失败：${error?.message || error}`, 'warn');
}

function initWorker() {
  try {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'progress') {
        const p = $('#progress');
        p.querySelector('div').style.width = `${Math.round((data.done / Math.max(1, data.total)) * 100)}%`;
        p.querySelector('span').textContent = `正在模拟候选 ${data.done}/${data.total}${data.tile !== null && data.tile !== undefined ? ` · ${tileLabel(data.tile)}` : ''}…`;
        return;
      }
      if (data.type === 'result') {
        finishCalculation(data.result, state.lastRaw, state.lastOptions, currentRule());
        return;
      }
      if (data.type === 'error') {
        console.error(data.stack || data.message);
        finishError(new Error(data.message));
      }
    };
    worker.onerror = (e) => {
      console.error('worker error', e);
      finishError(new Error('Web Worker 加载失败，将尝试主线程计算。'));
      state.worker = null;
    };
    state.worker = worker;
  } catch (e) {
    console.warn('Worker unavailable', e);
    state.worker = null;
  }
}

/* ---------- 结果渲染 ---------- */

function topCandidate(result) {
  return result?.candidates?.find((c) => !c.error) || null;
}

function candidateAction(c) {
  return c.action === 'hu' ? '立即胡牌' : `打 ${tileLabel(c.tile)}`;
}

function renderResults(result, raw, options, rule) {
  const root = $('#results-root');
  const best = topCandidate(result);
  if (!best) {
    root.innerHTML = '<div class="empty-state panel"><h3>没有可用候选</h3><p>检查手牌张数、断门与副露是否自洽。</p></div>';
    return;
  }
  const bestLabel = best.action === 'hu' ? '立即胡牌' : `打 ${tileLabel(best.tile)}`;
  $('#result-title').textContent = best.action === 'hu' ? '现在胡，还是再等等？' : `${bestLabel}，当前期望最优`;
  $('#result-subtitle').textContent = `${rule.name} · ${riskByLevel(options.riskLevel).name} λ=${num(result.lambda, 2)} · ${result.samples} 次采样 · 95% Wilson 区间`;

  const cards = result.candidates.filter((c) => !c.error).slice(0, 3).map((c, idx) => {
    const tileHtml = c.action === 'hu' ? '<span class="tile mini ghost"><span class="tile-honor">胡</span></span>' : makeTile(c.tile, { size: 'small' }).outerHTML;
    return `<div class="rec-card ${idx === 0 ? 'top' : ''}">
      <div class="rank">${idx === 0 ? 'RECOMMENDED' : `0${idx + 1} / ALTERNATIVE`}</div>
      <div class="action">${tileHtml}<span>${c.action === 'hu' ? '立即胡牌' : `打 ${tileLabel(c.tile)}`}</span></div>
      <div class="desc">${escapeHtml(c.reason || '')}</div>
      <div class="score">${num(c.riskAdjusted, 2)}</div>
      <div class="subscore">风险调整得分 · L=${num(c.loss, 2)}</div>
    </div>`;
  }).join('');

  const rows = result.candidates.map((c) => {
    if (c.error) {
      return `<tr><td><div class="action-cell">${escapeHtml(candidateAction(c))}</div></td><td colspan="11" class="fineprint">${escapeHtml(c.error)}</td></tr>`;
    }
    const ci = c.ci95?.pWin || [0, 0];
    return `<tr class="${c === best ? 'recommended' : ''}">
      <td><div class="action-cell">${c.action === 'hu' ? '<span class="pill gold">胡</span>' : makeTile(c.tile, { size: 'mini' }).outerHTML}<b>${escapeHtml(candidateAction(c))}</b></div></td>
      <td class="num">${c.action === 'hu' ? '—' : `${c.shanten < 0 ? '胡' : c.shanten === 0 ? '听' : c.shanten + '向'}<br><span class="fineprint">${c.ukeire ? `${c.ukeire} 张` : (rule.ghost?.enabled && c.shanten > 0 ? '鬼局模拟' : '0 张')}</span>`}</td>
      <td class="num">${pct(c.pWin)}<div class="ci-bar"><i style="left:${ci[0] * 100}%;width:${Math.max(1, (ci[1] - ci[0]) * 100)}%"></i></div><span class="fineprint">[${pct(ci[0], 0)}, ${pct(ci[1], 0)}]</span></td>
      <td class="num">${pct(c.pSelfDraw)}</td>
      <td class="num">${pct(c.pDeal)}<br><span class="fineprint">含后续 ${pct(c.pDealTotal)}</span></td>
      <td class="num">${pct(c.pOppSelfDraw)}</td>
      <td class="num">${num(c.avgScore, 1)}<br><span class="fineprint">${escapeHtml(c.pattern || '')}</span></td>
      <td class="num">${num(c.risk, 2)}</td>
      <td class="num ${c.loss < 0 ? 'loss good' : 'loss'}">${num(c.loss, 2)}</td>
      <td class="num ${c.riskAdjusted > 0 ? 'loss good' : 'loss'}"><b>${num(c.riskAdjusted, 2)}</b></td>
      <td class="fineprint" style="min-width:148px">${escapeHtml(c.reason || '')}</td>
    </tr>`;
  }).join('');

  const bestPaths = best.paths || [];
  const pathEmptyText = best.action === 'hu'
    ? '胡牌动作没有后续路径。'
    : best.shanten > 1
      ? `当前 ${best.shanten} 向听，路径枚举只覆盖听牌/一向听；此处的胡率来自模拟，不拆单一路径。`
      : '当前数据不足以拆出稳定路径，请补齐副露/断门或提高采样数。';
  const pathRows = bestPaths.length ? bestPaths.map((p) => {
    const w = bestPaths.reduce((a, b) => a + (b.weight || 0), 0) || 1;
    const contrib = (best.pWin || 0) * (p.weight || 0) / w;
    return `<div class="path-item"><span><b>${escapeHtml(p.type)}</b> · ${escapeHtml(p.desc)}</span><span class="prob">权重 ${(p.weight / w * 100).toFixed(0)}% · 贡献 ${pct(contrib)}</span></div>`;
  }).join('') : `<div class="empty">${escapeHtml(pathEmptyText)}</div>`;

  const danger = computeDangerList(raw, rule);
  const safeHtml = danger.safe.map((d) => `<span class="pill" title="${pct(d.value)}">${tileLabel(d.t)}</span>`).join(' ');
  const dangerHtml = danger.risky.map((d) => `<span class="pill warn" title="${pct(d.value)}">${tileLabel(d.t)}</span>`).join(' ');

  const sens = Array.isArray(result.sensitivity) ? result.sensitivity : [];
  const sensHtml = sens.length ? `<ul>${sens.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : '<p>当前结果对风险档位与采样数较稳定；改变 λ 会重排 Top3。</p>';

  const uncertainty = [];
  if (state.voidSuits.some((v) => v === null)) uncertainty.push('有玩家断门未知，危险度使用先验而非确定信息。');
  if (state.meldsBySeat.slice(1).every((m) => !m.length)) uncertainty.push('对手副露未录入，威胁可能被低估。');
  uncertainty.push('对手手牌由约束采样生成，并非真实手牌；结果应读作区间与排序，不是单点真相。');
  uncertainty.push('血战到底的后续摸打被截断；一炮多响、刮风下雨与报牌未进入主期望。');
  if (rule.ghost?.enabled) uncertainty.push(`鬼牌容量 ${rule.ghost.count} 张；未见的鬼牌按均匀先验分配。`);

  root.innerHTML = `
    <div class="recommend-grid">${cards}</div>
    <section class="panel result-panel">
      <h2>候选动作与期望损失</h2>
      <div class="sub">按 L 升序；风险调整得分 = −L。自摸/点炮为 95% Wilson 区间，点炮列同时给出“含后续”的总点炮率。</div>
      <div class="table-wrap"><table>
        <thead><tr><th>动作</th><th>向听 / 进张</th><th>总胡率</th><th>自摸</th><th>点炮</th><th>被自摸</th><th>期望得分</th><th>风险值</th><th>L</th><th>调整后</th><th>说明</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>
    <div class="detail-grid">
      <section class="panel result-panel">
        <h2>Top 路径</h2>
        <div class="sub">${best.action === 'hu' ? '当前已满足胡牌。' : `基于 ${escapeHtml(candidateAction(best))} 后的听牌/进张拓扑，最多 5 条。`}</div>
        <div class="path-list">${pathRows}</div>
      </section>
      <section class="panel result-panel">
        <h2>安全 / 危险牌</h2>
        <div class="sub">结合断门、现物、筋牌、副露数与牌墙可见张数。</div>
        <div class="detail-block" style="margin-bottom:8px"><h3>相对安全</h3><div>${safeHtml || '<span class="fineprint">暂无</span>'}</div></div>
        <div class="detail-block"><h3>高风险</h3><div>${dangerHtml || '<span class="fineprint">暂无</span>'}</div></div>
      </section>
      <section class="panel result-panel">
        <h2>敏感性</h2>
        <div class="sub">改变风险档位、采样数与对手模型时，排序可能如何变化。</div>
        <div class="detail-block">${sensHtml}</div>
      </section>
      <section class="panel result-panel">
        <h2>不确定性</h2>
        <div class="sub">这些不是“误差”，而是未被观测的信息。</div>
        <div class="warn-box"><ul>${uncertainty.map((u) => `<li>${escapeHtml(u)}</li>`).join('')}</ul></div>
      </section>
    </div>
  `;
  $('#result-subtitle').textContent = `${rule.name} · ${riskByLevel(options.riskLevel).name} λ=${num(result.lambda, 2)} · ${result.samples} 次采样 · ${result.opponentModel}`;
  $('#repro-box').textContent = JSON.stringify({
    ruleId: state.ruleId, rule: { name: rule.name, tileCount: rule.tileCount, ghost: rule.ghost, cap: rule.cap },
    state: raw, options, lambda: result.lambda, samples: result.samples, seed: result.seed,
  }, null, 2);
}

function computeDangerList(raw, rule) {
  const visible = buildVisibleCounts(raw);
  const vals = allowedTiles(rule)
    .filter((t) => !(t === GHOST_TILE && !rule.ghost?.enabled))
    .filter((t) => capacityOf(t, rule) - (visible[t] || 0) > 0)
    .map((t) => ({ t, value: tileDanger(t, raw, rule, state.opponentModel, visible) }));
  const sorted = vals.sort((a, b) => a.value - b.value);
  return { safe: sorted.slice(0, 6), risky: sorted.slice(-6).reverse() };
}

/* ---------- 标签页 ---------- */

function switchTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'rules') renderRuleTab();
  if (name === 'results' && !state.lastResult) {
    // 保留空态
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- 示例 ---------- */

function loadDemo(calculateAfter = false) {
  const preset = getPreset(state.ruleId);
  const isLuzhou = preset.family === 'luzhou';
  if (isLuzhou) {
    state.hand = parseTiles('1m1m4m5m8m9m3p5p6p6p6p8p9p z5');
    state.meldsBySeat = [[], [], [{ type: 'peng', tile: 13, tiles: [13, 13, 13] }], []];
    state.discards = [
      parseTiles('1p9p2m'),
      parseTiles('1m4m7m9m'),
      parseTiles('1p4p7p'),
      parseTiles('1s4s7s'),
    ];
    state.voidSuits = [2, 0, 1, 2];
    state.wallRemaining = 42;
  } else {
    state.hand = parseTiles('123m456m789m123p5s9s');
    state.meldsBySeat = [[], [], [], []];
    state.discards = [
      parseTiles('1p9p2m'),
      parseTiles('1m4m7m9m'),
      parseTiles('1p4p7p2s'),
      parseTiles('1s4s7s'),
    ];
    state.voidSuits = [2, 0, 1, 2];
    state.wallRemaining = 40;
  }
  state.winners = [false, false, false, false];
  state.visibleExtra = [];
  state.activeDiscardSeat = 0;
  state.paletteTarget = 'hand';
  $('#wall-remaining').value = String(state.wallRemaining);
  $('#visible-extra').value = '';
  renderAll();
  switchTab('table');
  if (calculateAfter) setTimeout(calculate, 120);
}

/* ---------- 导出 ---------- */

function exportResult() {
  if (!state.lastResult) { toast('还没有结果可导出', 'warn'); return; }
  const payload = {
    generatedAt: new Date().toISOString(),
    notice: '合法麻将策略研究/娱乐用途；概率为模型估计。',
    rule: currentRule(),
    state: state.lastRaw,
    options: state.lastOptions,
    result: state.lastResult,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mahjong-decision-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- 拍照识牌 ---------- */

const VISION_KEY = 'mahjong.vision.settings.v1';

function loadVisionSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(VISION_KEY) || '{}');
    if (s.base) $('#vision-base').value = s.base;
    if (s.model) $('#vision-model').value = s.model;
    if (s.key) $('#vision-key').value = s.key;
  } catch { /* ignore */ }
}

function visionSettings() {
  return {
    base: $('#vision-base').value.trim().replace(/\/$/, ''),
    model: $('#vision-model').value.trim(),
    key: $('#vision-key').value.trim(),
  };
}

function saveVisionSettings() {
  localStorage.setItem(VISION_KEY, JSON.stringify(visionSettings()));
  $('#vision-status').textContent = '已保存到本机浏览器';
}

function loadScanFile(file) {
  if (!file) return;
  scanState.file = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    scanState.image = img;
    $('#scan-preview-wrap').hidden = false;
    const canvas = $('#scan-preview');
    const maxW = 1000;
    const scale = Math.min(1, maxW / img.naturalWidth);
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0b2c22';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    splitScan();
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

function splitScan() {
  if (!scanState.image) return;
  const cols = Math.max(1, Math.min(18, Number($('#scan-cols').value) || 14));
  const rows = Math.max(1, Math.min(4, Number($('#scan-rows').value) || 1));
  scanState.cols = cols;
  scanState.rows = rows;
  const img = scanState.image;
  const cw = img.naturalWidth / cols;
  const ch = img.naturalHeight / rows;
  scanState.slices = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(cw));
      canvas.height = Math.max(1, Math.round(ch));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, c * cw, r * ch, cw, ch, 0, 0, canvas.width, canvas.height);
      scanState.slices.push({ canvas, label: null });
    }
  }
  scanState.active = 0;
  renderSlices();
  renderScanPalette();
}

function renderSlices() {
  const root = $('#slice-grid');
  root.innerHTML = '';
  if (!scanState.slices.length) {
    root.innerHTML = '<span class="fineprint">上传照片后按列/行切分。</span>';
    return;
  }
  scanState.slices.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = `slice-item ${scanState.active === i ? 'active' : ''}`;
    const c = document.createElement('canvas');
    c.width = 84; c.height = 112;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    const scale = Math.min(c.width / s.canvas.width, c.height / s.canvas.height);
    const w = s.canvas.width * scale;
    const h = s.canvas.height * scale;
    ctx.drawImage(s.canvas, (c.width - w) / 2, (c.height - h) / 2, w, h);
    item.appendChild(c);
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = s.label === null ? '待确认' : tileLabel(s.label);
    item.appendChild(label);
    item.addEventListener('click', () => {
      scanState.active = i;
      renderSlices();
    });
    root.appendChild(item);
  });
}

function renderScanPalette() {
  const root = $('#scan-palette');
  root.innerHTML = '';
  const rule = currentRule();
  const tiles = [
    ...Array.from({ length: 27 }, (_, i) => i),
    ...(rule.ghost?.enabled ? [GHOST_TILE] : []),
    ...(rule.honorTiles ? [27, 28, 29, 30, 31, 32] : []),
  ];
  for (const t of tiles) {
    root.appendChild(makeTile(t, {
      onClick: () => {
        if (scanState.active < 0 || scanState.active >= scanState.slices.length) {
          toast('先点一个切片，再选择牌张', 'warn');
          return;
        }
        scanState.slices[scanState.active].label = t;
        scanState.active = Math.min(scanState.slices.length - 1, scanState.active + 1);
        renderSlices();
      },
    }));
  }
}

function applyScan() {
  const labels = scanState.slices.map((s) => s.label).filter((x) => x !== null);
  if (!labels.length) { toast('还没有确认任何牌', 'warn'); return; }
  const target = $('#scan-target').value;
  if (target === 'hand') {
    state.hand = labels.slice(0, 14).sort((a, b) => a - b);
  } else {
    const seat = Number(target.split('-')[1]);
    state.discards[seat].push(...labels);
  }
  renderAll();
  switchTab('table');
  toast(`已应用 ${labels.length} 张牌；请核对张数后再计算`, 'info');
}

function resizeImageData(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

async function callVision(dataUrl) {
  const settings = visionSettings();
  const expected = scanState.slices.length || (scanState.cols * scanState.rows);
  const prompt = `你是麻将牌识别器。请逐张识别图片中的麻将牌，共约 ${expected} 张。只输出 JSON，不要解释：{"tiles":["1m","2m","5p","z5"]}。m=万，p=筒，s=条，z5=红中/鬼。按从左到右、从上到下的顺序。无法确认的牌用 "?" 占位。`;
  if (settings.base && settings.key) {
    const res = await fetch(`${settings.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` },
      body: JSON.stringify({
        model: settings.model || 'gpt-4o-mini',
        temperature: 0,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`视觉接口 ${res.status}: ${(await res.text()).slice(0, 180)}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content || '';
  }
  // 本地代理
  const res = await fetch('/api/vision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, prompt }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`未配置本地视觉服务（${res.status}）。请填写 API Key，或启动 server.mjs。${text.slice(0, 120)}`);
  }
  const json = await res.json();
  return json.content || json.tiles || '';
}

function parseVisionContent(content) {
  if (Array.isArray(content)) return content;
  if (typeof content === 'object' && content?.tiles) return content.tiles;
  const text = String(content || '');
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (Array.isArray(obj.tiles)) return obj.tiles;
    } catch { /* ignore */ }
  }
  const tokens = text.match(/(?:z[1-7]|[1-9][mps]|鬼|红中)/g) || [];
  return tokens;
}

async function aiScan() {
  if (!scanState.file) { toast('先上传照片', 'warn'); return; }
  const status = $('#vision-status');
  status.textContent = '正在调用视觉接口…';
  try {
    const dataUrl = await resizeImageData(scanState.file);
    const content = await callVision(dataUrl);
    const tokens = parseVisionContent(content);
    if (!tokens.length) throw new Error('接口没有返回可解析的牌张');
    const mapped = tokens.map((x) => {
      if (typeof x === 'number') return x;
      return parseTile(String(x)) ?? parseTile(String(x).replace('z5', 'z5'));
    });
    let filled = 0;
    for (let i = 0; i < scanState.slices.length && i < mapped.length; i++) {
      if (mapped[i] !== null && mapped[i] !== undefined) { scanState.slices[i].label = mapped[i]; filled++; }
    }
    renderSlices();
    status.textContent = `识别返回 ${mapped.length} 张，已填入 ${filled} 张；请逐张确认。`;
    toast('AI 识牌完成，请务必人工确认后再应用', 'info');
  } catch (e) {
    status.textContent = e.message;
    toast(`识牌失败：${e.message.slice(0, 90)}`, 'warn');
  }
}

/* ---------- 绑定 ---------- */

function renderAll() {
  renderHand();
  renderPalette();
  renderSeats();
  renderMelds();
  meldTileOptions();
  renderRuleTab();
  updateLive();
}

function bind() {
  $$('.tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#rule-preset').addEventListener('change', (e) => {
    state.ruleId = e.target.value;
    const rule = currentRule();
    const allowed = new Set(allowedTiles(rule));
    const before = state.hand.length;
    state.hand = state.hand.filter((t) => allowed.has(t));
    for (const seat of state.meldsBySeat) {
      for (let i = seat.length - 1; i >= 0; i--) if (seat[i].tiles.some((t) => !allowed.has(t))) seat.splice(i, 1);
    }
    if (state.hand.length !== before) toast('切换规则后移除了不属于该变体的牌', 'warn');
    renderAll();
  });
  $('#risk-level').addEventListener('input', (e) => {
    state.riskLevel = Number(e.target.value);
    $('#risk-label').textContent = riskName(state.riskLevel);
    $('#lambda').placeholder = `跟随档位 (${riskByLevel(state.riskLevel).lambda})`;
  });
  $('#btn-parse-hand').addEventListener('click', parseHandInput);
  $('#hand-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') parseHandInput(); });
  $('#btn-clear-hand').addEventListener('click', () => { state.hand = []; renderHand(); scheduleLive(); });
  $$('#palette-tabs button').forEach((b) => b.addEventListener('click', () => { state.paletteSuit = b.dataset.suit; renderPalette(); }));
  $$('#palette-target button').forEach((b) => b.addEventListener('click', () => {
    state.paletteTarget = b.dataset.target;
    renderPalette();
    if (state.paletteTarget === 'discard') toast(`当前牌河：${SEATS[state.activeDiscardSeat].name}`, 'info');
  }));
  $('#meld-owner').addEventListener('change', (e) => { state.meldOwner = Number(e.target.value); renderMelds(); });
  $('#btn-add-meld').addEventListener('click', addMeld);
  $('#btn-calc').addEventListener('click', calculate);
  $('#btn-calc-top').addEventListener('click', calculate);
  $('#btn-recalc').addEventListener('click', calculate);
  $('#btn-goto-results').addEventListener('click', () => switchTab('results'));
  $('#btn-demo').addEventListener('click', () => loadDemo(false));
  $('#btn-empty-demo').addEventListener('click', () => loadDemo(true));
  $('#btn-export').addEventListener('click', exportResult);
  $('#wall-remaining').addEventListener('change', (e) => { state.wallRemaining = Number(e.target.value) || 0; scheduleLive(); });
  $('#opponent-model').addEventListener('change', (e) => { state.opponentModel = e.target.value; scheduleLive(); });
  $('#samples').addEventListener('change', (e) => { state.samples = Number(e.target.value); });
  $('#seed').addEventListener('change', (e) => { state.seed = Number(e.target.value); });
  $$('.quick-samples button').forEach((b) => b.addEventListener('click', () => {
    $('#samples').value = b.dataset.samples;
    state.samples = Number(b.dataset.samples);
  }));
  $('#visible-extra').addEventListener('change', (e) => {
    const tiles = parseTiles(e.target.value);
    const allowed = new Set(allowedTiles(currentRule()));
    state.visibleExtra = tiles.filter((t) => allowed.has(t));
    e.target.value = formatTiles(state.visibleExtra);
    scheduleLive();
  });
  $('#hand-zone').addEventListener('click', (e) => {
    if (e.target.closest('.tile')) return;
    state.paletteTarget = 'hand';
    renderPalette();
  });

  // 识牌
  $('#scan-drop').addEventListener('click', () => $('#scan-file').click());
  $('#scan-file').addEventListener('change', (e) => loadScanFile(e.target.files[0]));
  ['dragover', 'dragenter'].forEach((ev) => $('#scan-drop').addEventListener(ev, (e) => { e.preventDefault(); $('#scan-drop').classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => $('#scan-drop').addEventListener(ev, (e) => { e.preventDefault(); $('#scan-drop').classList.remove('drag'); }));
  $('#scan-drop').addEventListener('drop', (e) => loadScanFile(e.dataTransfer.files[0]));
  $('#btn-split').addEventListener('click', splitScan);
  $('#btn-ai-scan').addEventListener('click', aiScan);
  $('#btn-sample-scan').addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch('./samples/sample_hand.svg');
      const blob = await res.blob();
      loadScanFile(new File([blob], 'sample_hand.svg', { type: 'image/svg+xml' }));
    } catch (err) {
      toast(`示例图加载失败：${err.message}`, 'warn');
    }
  });
  $('#btn-apply-scan').addEventListener('click', applyScan);
  $('#btn-save-vision').addEventListener('click', saveVisionSettings);
  $('#btn-test-vision').addEventListener('click', () => {
    const s = visionSettings();
    $('#vision-status').textContent = s.base && s.key ? '将直连该接口；未通过 CORS 时会失败。' : '未填写 Key，将尝试本地 /api/vision 代理。';
  });

  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); calculate(); }
  });
}

/* ---------- 启动 ---------- */

initWorker();
loadVisionSettings();
bind();
$('#risk-label').textContent = riskName(3);
$('#lambda').placeholder = `跟随档位 (${riskByLevel(3).lambda})`;
loadDemo(false);
renderRuleTab();
if (new URLSearchParams(location.search).get('calc') === '1') {
  setTimeout(() => loadDemo(true), 500);
}
