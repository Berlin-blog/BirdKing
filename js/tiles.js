/* 牌张编码：0-8 万，9-17 筒，18-26 条，27-33 字牌（东南西北中发白）
 * 四川麻将只使用 0-26；泸州鬼麻将把 33（中）作为鬼牌，共 12 张。
 */
export const SUIT_CODES = ['m', 'p', 's'];
export const SUIT_NAMES = ['万', '筒', '条'];
/* 27-30 风牌；31 发、32 白、33 中（泸州鬼牌）。z5 专指红中/鬼。 */
export const HONOR_NAMES = ['东', '南', '西', '北', '发', '白', '中'];
export const HONOR_CODES = ['z1', 'z2', 'z3', 'z4', 'z6', 'z7', 'z5'];
export const GHOST_TILE = 33;
export const MAX_TILE = 33;

export const TILE_CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function suitOf(tile) {
  if (tile < 9) return 0;
  if (tile < 18) return 1;
  if (tile < 27) return 2;
  return 3;
}

export function rankOf(tile) {
  return tile < 27 ? (tile % 9) + 1 : (tile - 26);
}

export function isHonor(tile) {
  return tile >= 27;
}

export function isGhost(tile) {
  return tile === GHOST_TILE;
}

export function tileCode(tile) {
  if (tile < 0 || tile > MAX_TILE) return '?';
  if (tile < 27) return `${(tile % 9) + 1}${SUIT_CODES[Math.floor(tile / 9)]}`;
  return HONOR_CODES[tile - 27];
}

export function parseTile(token) {
  token = String(token).trim().toLowerCase();
  if (!token) return null;
  if (token === '鬼' || token === '红中' || token === '中' || token === 'z5') return GHOST_TILE;
  const honorMap = { 东: 27, 南: 28, 西: 29, 北: 30, 中: 33, 发: 31, 白: 32 };
  if (honorMap[token] !== undefined) return honorMap[token];
  const m = token.match(/^([1-9])([mps])$/);
  if (m) return (m[2] === 'm' ? 0 : m[2] === 'p' ? 9 : 18) + Number(m[1]) - 1;
  const z = token.match(/^z([1-7])$/);
  if (z) {
    const n = Number(z[1]);
    if (n === 5) return GHOST_TILE;
    if (n === 6) return 31;
    if (n === 7) return 32;
    return 26 + n;
  }
  return null;
}

export function parseTiles(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.flatMap((x) => (typeof x === 'number' ? [x] : parseTiles(String(x))));
  }
  let text = String(input).trim().toLowerCase();
  if (!text) return [];
  // 先把 123m 展开成 1m2m3m；保留单独的 1m 形式
  text = text.replace(/([1-9]{2,})([mps])/g, (_, digits, suit) =>
    [...digits].map((d) => `${d}${suit}`).join(''));
  const tokens = [];
  // 支持 1m2m3m、1m 2m 3m、1m,2m、123m、123万、鬼、红中
  const re = /(鬼|红中|[1-9][mps]|z[1-7]|[东南西北中发白]|[1-9][万筒条])/g;
  let match;
  while ((match = re.exec(text))) {
    let t = match[1];
    if (/[万筒条]$/.test(t)) {
      const suit = t.endsWith('万') ? 'm' : t.endsWith('筒') ? 'p' : 's';
      t = `${t[0]}${suit}`;
    }
    const tile = parseTile(t);
    if (tile !== null) tokens.push(tile);
  }
  if (tokens.length) return tokens;
  // 连续花色简写：123m456p
  const grouped = text.matchAll(/([1-9]+)([mps])/g);
  for (const g of grouped) {
    for (const ch of g[1]) {
      const tile = parseTile(`${ch}${g[2]}`);
      if (tile !== null) tokens.push(tile);
    }
  }
  return tokens;
}

export function formatTiles(tiles) {
  return tiles.map(tileCode).join('');
}

export function tileLabel(tile) {
  if (tile < 27) {
    const suit = Math.floor(tile / 9);
    return `${TILE_CN_NUM[tile % 9]}${SUIT_NAMES[suit]}`;
  }
  return HONOR_NAMES[tile - 27];
}

export function tileShort(tile) {
  if (tile < 27) return `${(tile % 9) + 1}${SUIT_NAMES[Math.floor(tile / 9)]}`;
  return HONOR_NAMES[tile - 27];
}

export function countsFromTiles(tiles, size = 34) {
  const counts = new Array(size).fill(0);
  for (const t of tiles) {
    if (Number.isInteger(t) && t >= 0 && t < size) counts[t] += 1;
  }
  return counts;
}

export function tilesFromCounts(counts) {
  const out = [];
  counts.forEach((n, t) => {
    for (let i = 0; i < n; i++) out.push(t);
  });
  return out;
}

export function uniqueTiles(tiles) {
  return [...new Set(tiles)].sort((a, b) => a - b);
}

export function sumCounts(counts) {
  return counts.reduce((a, b) => a + b, 0);
}

export function isSuitTile(tile, suit) {
  return suit >= 0 && suit <= 2 && tile >= suit * 9 && tile < suit * 9 + 9;
}

export function capacityOf(tile, rule) {
  if (tile === GHOST_TILE && rule?.ghost?.enabled) return rule.ghost.count;
  return 4;
}

export const ALL_TILES = Array.from({ length: 34 }, (_, i) => i);
export const SICHUAN_TILES = Array.from({ length: 27 }, (_, i) => i);
