import assert from 'node:assert/strict';
import {
  allowedTiles, analyzeHand, computeWaits, isWinStandard, scoreLuzhou,
} from '../js/analyzer.js';
import { parseTiles, countsFromTiles, formatTiles, parseTile, tileCode, capacityOf } from '../js/tiles.js';
import { buildRuleConfig } from '../js/rules.js';
import { buildPool, prepareScenario } from '../js/engine.js';

const C = (s) => countsFromTiles(parseTiles(s));
const ruleC = buildRuleConfig('chengdu-standard');
const ruleL = buildRuleConfig('luzhou-ghost12');

function t(name, fn) {
  try { fn(); console.log('ok  ', name); }
  catch (e) { console.error('FAIL', name, e.message); process.exitCode = 1; }
}

function stripGhost(counts) {
  const c = counts.slice();
  c[33] = 0;
  return c;
}

t('honor / ghost code mapping', () => {
  assert.equal(parseTile('z5'), 33);
  assert.equal(parseTile('z6'), 31);
  assert.equal(parseTile('z7'), 32);
  assert.equal(tileCode(33), 'z5');
  assert.equal(formatTiles([33, 31, 32]), 'z5z6z7');
});

t('allowed tiles by rule', () => {
  assert.equal(allowedTiles(ruleC).length, 27);
  assert.equal(allowedTiles(ruleC).includes(33), false);
  assert.equal(allowedTiles(ruleL).length, 28);
  assert.equal(allowedTiles(ruleL).includes(33), true);
  assert.equal(capacityOf(33, ruleL), 12);
  assert.equal(capacityOf(33, ruleC), 4);
});

t('十二鬼牌张容量与胡牌', () => {
  const c = C('1m2m');
  assert.equal(isWinStandard(c, 0, 12), true);
  assert.equal(isWinStandard(c, 0, 11), false);
  const state = { handCounts: c, melds: [], discards: [[], [], [], []], meldsBySeat: [[], [], [], []], voidSuits: [2, null, null, null], winners: [false, false, false, false], seat: 0, wallRemaining: 40 };
  const visible = { ...new Array(34).fill(0), 0: 1, 1: 1, 33: 12 };
  const a = analyzeHand(c, [], 12, ruleL, state, visible);
  assert.equal(a.isWin, true);
  assert.equal(a.shanten, -1);
});

t('鬼牌不应被重复计入万能与普通牌', () => {
  const base = C('123m456m789m123p');
  const waits = computeWaits(base, [], 1, ruleL, null, new Array(34).fill(0));
  assert.ok(waits.length > 0);
  assert.ok(waits.every((w) => w.tile !== 33 || w.remaining <= 12));
});

t('泸州计分：平胡 / 无鬼 / 大对子 / 七对 / 清一色', () => {
  const plainGhost = scoreLuzhou(C('123m456m789m123p5s'), [], 1, { selfDraw: true }, ruleL);
  assert.equal(plainGhost.pattern, '平胡');
  assert.equal(plainGhost.selfDrawScore, 2);
  assert.equal(plainGhost.discardScore, 1);

  const plainNoGhost = scoreLuzhou(C('123m456m789m123p55s'), [], 0, { selfDraw: true }, ruleL);
  assert.equal(plainNoGhost.pattern, '平胡');
  assert.equal(plainNoGhost.selfDrawScore, 10);
  assert.equal(plainNoGhost.discardScore, 5);

  const triplets = scoreLuzhou(C('111m222m333p444p55s'), [], 0, { selfDraw: true }, ruleL);
  assert.equal(triplets.pattern, '大对子');
  assert.equal(triplets.selfDrawScore, 40);

  const seven = scoreLuzhou(C('11223344556677m'), [], 0, { selfDraw: true }, ruleL);
  assert.ok(seven.seven);
  assert.equal(seven.selfDrawScore, 40);

  const pure = scoreLuzhou(C('123m234m345m456m55m'), [], 0, { selfDraw: true }, ruleL);
  assert.equal(pure.pure, true);
  assert.equal(pure.selfDrawScore, 40);
});

t('泸州：平胡不能点炮胡，放炮折半', () => {
  const c = C('123m456m789m123p5s');
  const ghost = scoreLuzhou(c, [], 1, { selfDraw: false }, ruleL);
  assert.equal(ghost.validRon, false);
  assert.equal(ghost.discardScore, 1);
  const named = scoreLuzhou(C('111m222m333p444p5s'), [], 1, { selfDraw: false }, ruleL);
  assert.equal(named.validRon, true);
  assert.equal(named.discardScore, 5);
});

t('牌池：成都 108 / 泸州 120', () => {
  const hand = C('123m456m789m123p55s');
  const raw = { handCounts: hand, melds: [], discards: [[], [], [], []], meldsBySeat: [[], [], [], []], voidSuits: [2, null, null, null], winners: [false, false, false, false], seat: 0, wallRemaining: 0 };
  assert.equal(buildPool(raw, ruleC).length, 108 - 14);
  const lraw = { ...raw, handCounts: C('1m2m') };
  lraw.handCounts[33] = 12;
  assert.equal(buildPool(lraw, ruleL).length, 120 - 14);
});

t('prepareScenario 可识别十二鬼胡牌', () => {
  const c = C('1m2m');
  c[33] = 12;
  const raw = { handCounts: c, melds: [], discards: [[], [], [], []], meldsBySeat: [[], [], [], []], voidSuits: [2, null, null, null], winners: [false, false, false, false], seat: 0, wallRemaining: 40 };
  const sc = prepareScenario(raw, ruleL);
  assert.equal(sc.analysis.isWin, true);
  assert.equal(sc.candidates.some((x) => x.tile === 0), true);
});
