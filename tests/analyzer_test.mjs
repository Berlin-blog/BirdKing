import assert from 'node:assert/strict';
import {
  standardShanten, isWinStandard, sevenPairsShanten, isSevenPairs,
  wildcardShanten, scoreChengdu, scoreLuzhou, suitPatterns,
} from '../js/analyzer.js';
import { parseTiles, countsFromTiles, formatTiles } from '../js/tiles.js';
import { buildRuleConfig } from '../js/rules.js';

const C = (s) => countsFromTiles(parseTiles(s));
const ruleC = buildRuleConfig('chengdu-standard');
const ruleL = buildRuleConfig('luzhou-ghost12');

function t(name, fn) {
  try { fn(); console.log('ok  ', name); }
  catch (e) { console.error('FAIL', name, e.message); process.exitCode = 1; }
}

t('parse tiles', () => {
  assert.equal(formatTiles(parseTiles('1m2m3m4p5p6s')), '1m2m3m4p5p6s');
  assert.equal(parseTiles('123m456p789s').length, 9);
  assert.equal(parseTiles('红中').length, 1);
});

t('suit patterns basic', () => {
  const p = suitPatterns([1, 1, 1, 0, 0, 0, 0, 0, 0]);
  assert.ok(p.some((x) => x.m === 1 && x.t === 0));
});

t('win standard', () => {
  assert.equal(isWinStandard(C('123m456m789m123p55s'), 0, 0), true);
  assert.equal(isWinStandard(C('123m456m789m123p5s'), 0, 0), false);
  assert.equal(isWinStandard(C('111m222m333m444p55s'), 0, 0), true);
  assert.equal(isWinStandard(C('11223344556677m'), 0, 0), true);
});

t('shanten standard', () => {
  assert.equal(standardShanten(C('123m456m789m123p5s'), 0), 0);
  assert.equal(standardShanten(C('123m456m789m123p55s'), 0), -1);
  assert.equal(standardShanten(C('13m456m789m123p55s'), 0), 0);
  assert.ok(standardShanten(C('1m4m7m2p5p8p3s6s9s1z4z7z'), 0) >= 4);
});

t('seven pairs', () => {
  assert.equal(isSevenPairs(C('11223344556677m'), 0, 0), true);
  assert.equal(sevenPairsShanten(C('1122334455667m'), 0, 0), 0);
});

t('win with one ghost', () => {
  assert.equal(isWinStandard(C('123m456m789m123p5s'), 0, 1), true);
  assert.equal(isWinStandard(C('123m456m789m123p5p'), 0, 1), true);
});

t('luzhou score table', () => {
  const s0 = scoreLuzhou(C('123m456m789m123p55s'), [], 0, { selfDraw: true }, ruleL);
  assert.equal(s0.pattern, '平胡');
  assert.equal(s0.selfDrawScore, 10); // 无鬼平胡固定 10 颗
  const s1 = scoreLuzhou(C('123m456m789m123p5s'), [], 1, { selfDraw: true }, ruleL);
  assert.equal(s1.selfDrawScore, 2); // 有鬼平胡 2 颗
});
