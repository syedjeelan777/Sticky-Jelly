/*
 * Sticky-Jelly — level generator.
 *
 * Produces js/levels.js containing 300+ hand-crafted + procedurally generated
 * levels, every one of which is verified solvable by the BFS solver.
 *
 * Usage:  node tools/generate_levels.js [--seed 12345]
 */
'use strict';

const path = require('path');
const fs = require('fs');
const Engine = require(path.join(__dirname, '..', 'js', 'engine.js'));
const Solver = require(path.join(__dirname, '..', 'js', 'solver.js'));

const ARGV = process.argv.slice(2);
function argVal(name, fallback) {
  const i = ARGV.indexOf(name);
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : fallback;
}
const SEED = parseInt(argVal('--seed', '1337'), 10);

/* Deterministic PRNG (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
function randInt(a, b) { return a + Math.floor(rand() * (b - a + 1)); }
function pick(arr) { return arr[Math.floor(rand() * arr.length)]; }

/* ------------------------------------------------------------------ *
 * Level helpers
 * ------------------------------------------------------------------ */
function emptyBoard(w, h) {
  const tiles = [];
  tiles.push('#'.repeat(w));
  for (let y = 1; y < h - 1; y++) tiles.push('#' + '.'.repeat(w - 2) + '#');
  tiles.push('#'.repeat(w));
  return tiles;
}

function setChar(tiles, x, y, ch) {
  const row = tiles[y];
  tiles[y] = row.slice(0, x) + ch + row.slice(x + 1);
}

function freeCells(tiles, w, h) {
  const cells = [];
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++)
      if (tiles[y][x] === '.') cells.push([x, y]);
  return cells;
}

function buildLevel(tiles, entities, meta) {
  return {
    id: meta.id, title: meta.title, world: meta.world,
    width: tiles[0].length, height: tiles.length,
    tiles: tiles.slice(), entities: entities,
    hint: meta.hint || null,
  };
}

function solveLevel(level, opts) {
  const state = Engine.loadLevel(level);
  return Solver.solve(state, opts || { maxNodes: 25000, maxDepth: 120 });
}

/* ------------------------------------------------------------------ *
 * Hand-crafted tutorial seeds
 * ------------------------------------------------------------------ */
function seed(tiles, entities, meta) {
  // Entity placeholder letters (J/S/R/B) become floor; 'G' goal, 'P' plate and
  // 'g' gate are real tile characters and are left untouched.
  return buildLevel(tiles.map(r => r.replace(/[JSRB]/g, '.')), entities, meta);
}

const SEEDS = [];

// 1 — the most basic move.
SEEDS.push(seed([
  '######',
  '#....#',
  '#....#',
  '#.GJ.#',
  '######',
], [{ type: 'sticky', x: 3, y: 3 }],
  { id: 'strawberry-01', title: 'First Steps', world: 'Strawberry Grove',
    hint: 'A sticky jelly clings to walls and the floor. Push it left onto the goal.' }));

// 2 — two stickies gloop into a cluster that moves as one.
SEEDS.push(seed([
  '######',
  '#.GG.#',
  '#....#',
  '#.JJ.#',
  '######',
], [{ type: 'sticky', x: 2, y: 3 }, { type: 'sticky', x: 3, y: 3 }],
  { id: 'strawberry-02', title: 'Two of a Kind', world: 'Strawberry Grove',
    hint: 'Adjacent sticky jellies stick together and move as one cluster.' }));

// 3 — sticky jelly climbs a wall (it stays glued to vertical surfaces).
SEEDS.push(seed([
  '######',
  '#G...#',
  '#....#',
  '#J...#',
  '######',
], [{ type: 'sticky', x: 1, y: 3 }],
  { id: 'strawberry-03', title: 'Climb the Wall', world: 'Strawberry Grove',
    hint: 'Sticky jellies hold onto walls, so they can climb straight up.' }));

// 4 — rigid pushes a stone onto a pressure plate to open a gate.
SEEDS.push(seed([
  '#######',
  '#G.g..#',
  '#.....#',
  '#.P.SR#',
  '#######',
], [{ type: 'rigid', x: 5, y: 3 }, { type: 'stone', x: 4, y: 3 }],
  { id: 'lemon-01', title: 'Under Pressure', world: 'Lemon Labs',
    hint: 'Push the stone onto the plate — its weight opens the gate.' }));

// 5 — bouncy jelly slides until it hits something.
SEEDS.push(seed([
  '######',
  '#....#',
  '#....#',
  '#J..G#',
  '######',
], [{ type: 'bouncy', x: 1, y: 3 }],
  { id: 'cherry-01', title: 'Springboard', world: 'Cherry Cascade',
    hint: 'A bouncy jelly slides all the way across when you push it.' }));

/* ------------------------------------------------------------------ *
 * World definitions
 * ------------------------------------------------------------------ */
const WORLDS = [
  { key: 'strawberry', name: 'Strawberry Grove', emoji: '🍓', theme: '#ff8fab',
    w: 6, h: 5, count: 50, wallDensity: 0.10, minMoves: 2, maxMoves: 60,
    entityPool: () => {
      const es = [{ type: 'sticky' }];
      if (rand() < 0.5) es.push({ type: 'sticky' });
      return es;
    },
    extras: () => [] },
  { key: 'lemon', name: 'Lemon Labs', emoji: '🍋', theme: '#ffe066',
    w: 7, h: 6, count: 50, wallDensity: 0.14, minMoves: 3, maxMoves: 80,
    entityPool: () => {
      const es = [{ type: 'sticky' }];
      if (rand() < 0.7) es.push({ type: 'rigid' });
      if (rand() < 0.6) es.push({ type: 'stone' });
      if (rand() < 0.4) es.push({ type: 'sticky' });
      return es;
    },
    extras: () => (rand() < 0.7 ? [{ type: 'plate' }, { type: 'gate' }] : []) },
  { key: 'blueberry', name: 'Blueberry Basin', emoji: '🫐', theme: '#7fd0ff',
    w: 7, h: 6, count: 50, wallDensity: 0, minMoves: 3, maxMoves: 60,
    entityPool: () => [], // replaced by the staircase constructor
    extras: () => [],
    constructor: 'staircase' },
  { key: 'cherry', name: 'Cherry Cascade', emoji: '🍒', theme: '#ff6b81',
    w: 7, h: 6, count: 50, wallDensity: 0.14, minMoves: 3, maxMoves: 80,
    entityPool: () => {
      const es = [];
      const n = randInt(1, 2);
      for (let i = 0; i < n; i++) es.push({ type: rand() < 0.6 ? 'bouncy' : 'sticky' });
      if (rand() < 0.4) es.push({ type: 'rigid' });
      return es;
    },
    extras: () => {
      const ex = [];
      if (rand() < 0.8) ex.push({ type: 'fire' });
      if (rand() < 0.4) ex.push({ type: 'fire' });
      return ex;
    } },
  { key: 'grape', name: 'Grape Galaxy', emoji: '🍇', theme: '#b48cff',
    w: 8, h: 7, count: 50, wallDensity: 0.15, minMoves: 4, maxMoves: 100,
    entityPool: () => {
      const all = ['sticky', 'rigid', 'squishy', 'bouncy', 'stone'];
      const n = randInt(2, 3);
      const es = [];
      for (let i = 0; i < n; i++) es.push({ type: pick(all) });
      return es;
    },
    extras: () => {
      const ex = [];
      if (rand() < 0.6) ex.push({ type: 'fire' });
      if (rand() < 0.5) { ex.push({ type: 'plate' }, { type: 'gate' }); }
      return ex;
    } },
  { key: 'fruit', name: 'Fruit Salad', emoji: '🥗', theme: '#6ee7b7', secret: true,
    w: 9, h: 8, count: 50, wallDensity: 0.17, minMoves: 5, maxMoves: 120,
    entityPool: () => {
      const all = ['sticky', 'rigid', 'squishy', 'bouncy', 'stone'];
      const n = randInt(3, 4);
      const es = [];
      for (let i = 0; i < n; i++) es.push({ type: pick(all) });
      return es;
    },
    extras: () => {
      const ex = [{ type: 'fire' }];
      if (rand() < 0.6) { ex.push({ type: 'plate' }, { type: 'gate' }); }
      if (rand() < 0.4) ex.push({ type: 'fire' });
      return ex;
    } },
];

const TITLE_A = ['Gloopy', 'Wobbly', 'Squishy', 'Jiggly', 'Sticky', 'Bouncy', 'Springy', 'Drippy', 'Taffy', 'Mellow', 'Ripply', 'Quivery', 'Gooey', 'Jellybean', 'Splodgy', 'Smooshy'];
const TITLE_B = ['Steps', 'Path', 'Puzzle', 'Garden', 'Drop', 'Slide', 'Stack', 'Gate', 'Cavern', 'Bridge', 'Dance', 'Tangle', 'Bloom', 'Ladder', 'Corner', 'Drift'];
function randomTitle() { return pick(TITLE_A) + ' ' + pick(TITLE_B); }

/* ------------------------------------------------------------------ *
 * Random generation (used by most worlds)
 * ------------------------------------------------------------------ */
function placeOn(tiles, w, h, predicate) {
  const cells = freeCells(tiles, w, h).filter(([x, y]) => predicate(x, y));
  if (!cells.length) return null;
  return pick(cells);
}

function generateRandom(world, idx) {
  const { w, h, wallDensity, entityPool, extras, minMoves, maxMoves } = world;
  for (let attempt = 0; attempt < 120; attempt++) {
    const tiles = emptyBoard(w, h);

    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++)
        if (rand() < wallDensity) setChar(tiles, x, y, '#');

    const pool = entityPool();
    const jellies = pool.filter(e => e.type !== 'stone');
    const stones = pool.filter(e => e.type === 'stone');

    const entities = [];
    let ok = true;
    for (const j of jellies) {
      // Squishy jellies are placed on the bottom row so they start at rest
      // (they can't climb), which keeps solvability high in mixed worlds.
      const pred = j.type === 'squishy'
        ? (x, y) => y === h - 2
        : () => true;
      const pos = placeOn(tiles, w, h, pred);
      if (!pos) { ok = false; break; }
      setChar(tiles, pos[0], pos[1], 'X');
      entities.push({ type: j.type, x: pos[0], y: pos[1] });
    }
    if (!ok) continue;
    for (const s of stones) {
      const pos = placeOn(tiles, w, h, () => true);
      if (!pos) { ok = false; break; }
      setChar(tiles, pos[0], pos[1], 'X');
      entities.push({ type: 'stone', x: pos[0], y: pos[1] });
    }
    if (!ok) continue;

    // Goals — one per jelly, on free floor.
    if (freeCells(tiles, w, h).length < jellies.length) continue;
    for (let g = 0; g < jellies.length; g++) {
      const pos = placeOn(tiles, w, h, () => true);
      if (!pos) { ok = false; break; }
      setChar(tiles, pos[0], pos[1], 'G');
    }
    if (!ok) continue;

    // Hazards / gates.
    for (const ex of extras()) {
      const pos = placeOn(tiles, w, h, () => true);
      if (!pos) { ok = false; break; }
      setChar(tiles, pos[0], pos[1],
        ex.type === 'plate' ? 'P' : ex.type === 'fire' ? 'F' : 'g');
    }
    if (!ok) continue;

    // Restore entity-start markers to floor.
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (tiles[y][x] === 'X') setChar(tiles, x, y, '.');

    const level = buildLevel(tiles, entities, {
      id: world.key + '-' + String(idx).padStart(2, '0'),
      title: randomTitle(), world: world.name,
    });
    const result = solveLevel(level);
    if (result.solved && result.moves.length >= minMoves && result.moves.length <= maxMoves) {
      level.par = result.moves.length;
      return level;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Staircase constructor — guaranteed-solvable gravity puzzles.
 *
 * A raised terrace (left) steps down to a lower terrace (right). Squishy
 * jellies rest on the top terrace; the player nudges them over the edge and
 * they drip down to the goals below. Optionally a stone must be pushed off
 * the path, or a stray fire tile guards a corner.
 * ------------------------------------------------------------------ */
function generateStaircase(world, idx) {
  const w = world.w, h = world.h;
  for (let attempt = 0; attempt < 200; attempt++) {
    const tiles = emptyBoard(w, h);
    const top = 1 + randInt(0, 1);                 // top terrace floor row
    const bot = h - 2;                             // bottom terrace floor row
    if (bot - top < 2) continue;                   // need a real drop
    const mid = randInt(2, w - 3);                 // step boundary column

    // Carve the terraces: left region floor at `top`, right region at `bot`.
    for (let y = top; y < h; y++) {
      for (let x = 1; x < mid; x++) setChar(tiles, x, y, y === top ? '.' : '#');
    }
    for (let y = bot; y < h; y++) {
      for (let x = mid; x <= w - 2; x++) setChar(tiles, x, y, y === bot ? '.' : '#');
    }
    // Cliff face at the boundary is implicit (column mid-1 walled below top).

    const nSquish = randInt(1, 2);
    const entities = [];

    // Squishies on the top terrace.
    const topCols = [];
    for (let x = 1; x < mid; x++) topCols.push(x);
    if (topCols.length < nSquish) continue;
    const used = {};
    for (let i = 0; i < nSquish; i++) {
      let x;
      do { x = pick(topCols); } while (used[x]);
      used[x] = true;
      entities.push({ type: 'squishy', x, y: top - 1 });
    }

    // Goals on the bottom terrace (right of the drop, spaced out).
    const botCols = [];
    for (let x = mid; x <= w - 2; x++) botCols.push(x);
    if (botCols.length < nSquish) continue;
    const usedGoals = {};
    for (let i = 0; i < nSquish; i++) {
      let x;
      do { x = pick(botCols); } while (usedGoals[x]);
      usedGoals[x] = true;
      setChar(tiles, x, bot, 'G');
    }

    // Occasional extra flavour: a stone on the top terrace, or fire in a
    // bottom-terrace corner away from goals (the solver still verifies).
    if (rand() < 0.3 && topCols.length > nSquish + 1) {
      let x;
      do { x = pick(topCols); } while (used[x]);
      used[x] = true;
      entities.push({ type: 'stone', x, y: top - 1 });
    }

    const level = buildLevel(tiles, entities, {
      id: world.key + '-' + String(idx).padStart(2, '0'),
      title: randomTitle(), world: world.name,
    });
    const result = solveLevel(level);
    if (result.solved && result.moves.length >= world.minMoves && result.moves.length <= world.maxMoves) {
      level.par = result.moves.length;
      return level;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Assemble everything
 * ------------------------------------------------------------------ */
function main() {
  console.log('Sticky-Jelly level generator — seed', SEED);

  const validSeeds = [];
  for (const s of SEEDS) {
    const r = solveLevel(s, { maxNodes: 100000, maxDepth: 80 });
    if (r.solved) { s.par = r.moves.length; validSeeds.push(s); }
    else console.log('  ✗ seed unsolvable:', s.id, JSON.stringify(r).slice(0, 120));
  }

  const worlds = [];
  let total = 0;
  for (const world of WORLDS) {
    const levels = [];
    for (const s of validSeeds) if (s.world === world.name) levels.push(s);

    const gen = world.constructor === 'staircase' ? generateStaircase : generateRandom;
    let guard = 0;
    while (levels.length < world.count && guard++ < 40000) {
      const lvl = gen(world, levels.length + 1);
      if (lvl) levels.push(lvl);
    }
    levels.forEach((l, i) => { if (!l.title) l.title = 'Level ' + (i + 1); });

    worlds.push({
      key: world.key, name: world.name, emoji: world.emoji, theme: world.theme,
      secret: !!world.secret, levels: levels,
    });
    total += levels.length;
    console.log(`  ${world.emoji} ${world.name}: ${levels.length} levels`);
  }

  const header = '/* AUTO-GENERATED by tools/generate_levels.js — do not edit by hand. */\n' +
    '/* Every level in this file has been verified solvable by js/solver.js. */\n';
  const body = '(function (global) {\n' +
    "  'use strict';\n" +
    '  var WORLDS = ' + JSON.stringify(worlds, null, 2) + ';\n' +
    '  global.JELLY_LEVELS = WORLDS;\n' +
    "  if (typeof module !== 'undefined' && module.exports) module.exports = WORLDS;\n" +
    '})(typeof window !== "undefined" ? window : globalThis);\n';

  fs.writeFileSync(path.join(__dirname, '..', 'js', 'levels.js'), header + body);
  console.log(`\nWrote ${total} levels to js/levels.js`);
}

main();
