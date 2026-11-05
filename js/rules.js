import { GHOST_TILE } from './tiles.js';

/* 规则配置。所有未显式配置的字段都来自这里，并在结果页标注“默认假设”。 */
export const RISK_PROFILES = [
  { level: 1, name: '极保守', lambda: 0.5, note: '优先避免点炮，可放弃低番听牌' },
  { level: 2, name: '保守', lambda: 0.8, note: '安全略优先于速度' },
  { level: 3, name: '均衡', lambda: 1.0, note: '期望收益与风险同等权重' },
  { level: 4, name: '激进', lambda: 1.3, note: '接受更高点炮风险换取胡牌速度' },
  { level: 5, name: '极激进', lambda: 1.8, note: '接近只看进攻，适合大比分追赶' },
];

export const OPPONENT_MODELS = {
  random: { name: '随机型', aggression: 0.55, defense: 0.15, tenpaiBias: 0.9, note: '弃牌近似随机，威胁被低估' },
  conservative: { name: '保守型', aggression: 0.4, defense: 0.8, tenpaiBias: 0.85, note: '更早拆搭防守，点炮率下降' },
  aggressive: { name: '激进型', aggression: 0.85, defense: 0.2, tenpaiBias: 1.15, note: '更愿意追大牌，威胁上升' },
  read: { name: '按弃牌推断', aggression: 0.65, defense: 0.55, tenpaiBias: 1.0, note: '用现物、筋、断门与副露修正危险度' },
  mixed: { name: '混合先验', aggression: 0.62, defense: 0.45, tenpaiBias: 1.0, note: '默认：70% 牌效 + 30% 防守' },
};

const COMMON = {
  seat: 0,
  dingque: true,
  mustClearVoid: true,
  canPengGangVoid: false,
  allowChi: false,
  bloodBattle: true,
  multiRon: true,
  maxWinners: 3,
  checkReady: true,
  gangScoring: false,
  ghost: { enabled: false, tile: GHOST_TILE, count: 0 },
  honorTiles: false,
  scoringSystem: 'fan',
  fanCap: 4,
  baseFan: 1,
  selfDrawFanBonus: 1,
  discardScoreFactor: 1,
  minFan: 1,
  capScore: 16,
  plainCanRon: true,
  cap: 16,
  scoreUnit: '倍',
  reportScoring: false,
  assumptions: [],
};

export const RULE_PRESETS = {
  'chengdu-standard': {
    ...COMMON,
    id: 'chengdu-standard',
    family: 'chengdu',
    name: '成都麻将 · 血战到底（标准）',
    shortName: '成都血战',
    tileCount: 108,
    ghost: { enabled: false, tile: GHOST_TILE, count: 0 },
    fanCap: 4,
    capScore: 16,
    baseFan: 1,
    selfDrawFanBonus: 1,
    discardScoreFactor: 1,
    gangScoring: true,
    plainCanRon: true,
    assumptions: [
      '108 张（万/筒/条），无字牌，无鬼牌',
      '定缺后不能碰/杠缺门牌，胡牌前必须打完缺门',
      '血战到底，允许一炮多响；4 番封顶（16 倍）',
      '自摸 +1 番；杠上花/杠上炮/抢杠/海底各 +1 番',
      '刮风下雨按简化杠分计，未计入主番期望',
    ],
  },
  'luzhou-ghost12': {
    ...COMMON,
    id: 'luzhou-ghost12',
    family: 'luzhou',
    name: '泸州鬼麻将 · 12 红中鬼',
    shortName: '泸州十二鬼',
    tileCount: 120,
    ghost: { enabled: true, tile: GHOST_TILE, count: 12 },
    scoringSystem: 'luzhou',
    fanCap: 40,
    capScore: 40,
    cap: 40,
    scoreUnit: '颗',
    selfDrawFanBonus: 0,
    discardScoreFactor: 0.5,
    plainCanRon: false,
    gangScoring: false,
    mustClearVoid: true,
    assumptions: [
      '120 张：万/筒/条各 36 张 + 12 张红中鬼牌',
      '红中可替代任意牌；鬼牌打出去后他家不能碰/杠/胡',
      '定缺、血战到底、一炮多响；无刮风下雨（杠分不另计）',
      '平胡不能点炮胡，只能自摸；其余牌型放炮按自摸颗数折半（向下取整）',
      '40 颗封顶；闺=四张同牌（含杠），每多一闺翻倍；手把一翻倍',
      '无鬼胡、抢杠、杠上炮、杠上花按你给出的泸州规则表计算',
      '报牌/喜钱暂不计入主期望，可在规则配置中开启',
    ],
  },
  'luzhou-ghost8': {
    ...COMMON,
    id: 'luzhou-ghost8',
    family: 'luzhou',
    name: '泸州鬼麻将 · 8 红中鬼',
    shortName: '泸州八鬼',
    tileCount: 116,
    ghost: { enabled: true, tile: GHOST_TILE, count: 8 },
    scoringSystem: 'luzhou',
    fanCap: 40,
    capScore: 40,
    cap: 40,
    scoreUnit: '颗',
    selfDrawFanBonus: 0,
    discardScoreFactor: 0.5,
    plainCanRon: false,
    gangScoring: false,
    assumptions: ['与 12 鬼版相同，仅鬼牌数为 8 张（116 张牌）'],
  },
  'chengdu-noghost': {
    ...COMMON,
    id: 'chengdu-noghost',
    family: 'chengdu',
    name: '成都麻将 · 无鬼快速版',
    shortName: '成都无鬼',
    tileCount: 108,
    fanCap: 3,
    capScore: 8,
    assumptions: ['3 番封顶（8 倍）的常见成都休闲局', '其余同成都标准'],
  },
};

export function getPreset(id) {
  return RULE_PRESETS[id] || RULE_PRESETS['chengdu-standard'];
}

export function buildRuleConfig(presetId = 'chengdu-standard', overrides = {}) {
  const preset = getPreset(presetId);
  const rule = {
    ...preset,
    ...overrides,
    ghost: { ...preset.ghost, ...(overrides.ghost || {}) },
  };
  rule.cap = rule.capScore;
  rule.tileCount = rule.ghost?.enabled
    ? 108 + rule.ghost.count
    : 108 + (rule.honorTiles ? 28 : 0);
  return rule;
}

export function ruleRows(rule) {
  const fn = (b) => (b ? '是' : '否');
  return [
    ['规则变体', rule.name],
    ['牌张总数', `${rule.tileCount} 张${rule.ghost?.enabled ? `（含 ${rule.ghost.count} 张鬼）` : ''}`],
    ['是否定缺', fn(rule.dingque)],
    ['缺门能否碰/杠', fn(rule.canPengGangVoid)],
    ['缺门是否必须打完', fn(rule.mustClearVoid)],
    ['是否血战到底', fn(rule.bloodBattle)],
    ['是否可一炮多响', fn(rule.multiRon)],
    ['番型/计分', rule.scoringSystem === 'luzhou' ? '泸州颗数表（自摸计，放炮折半）' : '成都番数表（2^番）'],
    ['番数封顶', rule.scoringSystem === 'luzhou' ? `${rule.cap} 颗` : `${rule.fanCap} 番 / ${rule.capScore} 倍`],
    ['胡牌最低番', rule.scoringSystem === 'luzhou' ? '平胡仅自摸；最低 2 颗' : `${rule.minFan} 番`],
    ['查叫', fn(rule.checkReady)],
    ['杠分规则', rule.gangScoring ? '刮风下雨（简化，另计）' : '不另计杠分'],
    ['自摸/点炮', rule.scoringSystem === 'luzhou' ? '自摸按表；放炮折半（向下取整）' : `自摸 +${rule.selfDrawFanBonus} 番`],
    ['杠上花 / 杠上炮', rule.scoringSystem === 'luzhou' ? '平胡固定 10；有番型翻倍，40 封顶' : '各 +1 番'],
    ['手把一', rule.scoringSystem === 'luzhou' ? '翻倍（需在 flags 标记）' : '不适用'],
    ['报牌 / 喜钱', rule.reportScoring ? '开启，计入副收益' : '暂不计入主期望'],
    ['鬼牌', rule.ghost?.enabled ? `${rule.ghost.count} 张红中，万能牌` : '无'],
  ];
}

export function riskByLevel(level) {
  return RISK_PROFILES.find((r) => r.level === Number(level)) || RISK_PROFILES[2];
}
