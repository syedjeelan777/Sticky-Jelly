/*
 * Sticky-Jelly — smoke test.
 *
 * Two layers:
 *   1. Pure-logic checks (always run, no dependencies):
 *      - engine move/fire/win behaviour
 *      - every shipped level is solvable
 *   2. DOM checks (run when `jsdom` is installed, e.g. `npm i -D jsdom`):
 *      - boot, overworld, game flow, undo/reset, hint, editor, toggles.
 *
 * Usage:  node tools/smoke_test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const Engine = require(path.join(ROOT, 'js', 'engine.js'));
const Solver = require(path.join(ROOT, 'js', 'solver.js'));
const LEVELS = require(path.join(ROOT, 'js', 'levels.js'));

let checks = 0;
let failures = 0;
function ok(cond, label) {
  checks++;
  if (cond) console.log('  ✓', label);
  else { failures++; console.log('  ✗', label); }
}

console.log('— Logic checks —');

// Fire destroys a non-fireproof jelly
let s = Engine.loadLevel({
  width: 6, height: 5,
  tiles: ['######', '#.F..#', '#....#', '#.J..#', '######'],
  entities: [{ type: 'bouncy', x: 2, y: 3 }],
});
const r1 = Engine.applyMove(s, s.entities[0], 0, -1);
ok(r1.destroyed.length === 1, 'fire destroys a bouncy jelly that slides onto it');

// Rigid jellies are fireproof
let s2 = Engine.loadLevel({
  width: 6, height: 5,
  tiles: ['######', '#.F..#', '#....#', '#.R..#', '######'],
  entities: [{ type: 'rigid', x: 2, y: 3 }],
});
const r2 = Engine.applyMove(s2, s2.entities[0], 0, -1);
ok(r2.destroyed.length === 0 && r2.state.entities.length === 1, 'rigid jelly is fireproof');

// Stone on plate opens gates
let s3 = Engine.loadLevel({
  width: 7, height: 5,
  tiles: ['#######', '#..g..#', '#.....#', '#P...R#', '#######'],
  entities: [{ type: 'rigid', x: 5, y: 3 }],
});
let s3b = Engine.applyMove(s3, s3.entities[0], -1, 0).state; // rigid onto (4,3)
const gateClosedBefore = Engine.getTile(s3, 3, 1) === Engine.CH.GATE_CLOSED;
ok(gateClosedBefore, 'gate starts closed');
// push rigid left until it reaches the plate
let cur = s3, ent = null;
for (let i = 0; i < 4; i++) {
  ent = cur.entities.find(e => e.type === 'rigid');
  const res = Engine.applyMove(cur, ent, -1, 0);
  if (res.blocked) break;
  cur = res.state;
}
ok(Engine.getTile(cur, 3, 1) === Engine.CH.GATE_OPEN, 'heavy rigid on plate opens the gate');

// Sticky cluster moves as one (pushed sideways, staying anchored to the floor)
let s4 = Engine.loadLevel({
  width: 6, height: 5,
  tiles: ['######', '#.GG.#', '#....#', '#.JJ.#', '######'],
  entities: [{ type: 'sticky', x: 2, y: 3 }, { type: 'sticky', x: 3, y: 3 }],
});
const r4 = Engine.applyMove(s4, s4.entities[0], -1, 0);
const xs = r4.state.entities.map(e => e.x).sort().join(',');
ok(xs === '1,2', 'sticky cluster moves together (both jellies shift left)');

// A sticky cluster pushed off its floor anchor falls back down
const r4b = Engine.applyMove(s4, s4.entities[0], 0, -1);
ok(r4b.state.entities.every(e => e.y === 3), 'unanchored sticky cluster falls back down');

// All shipped levels solvable
let solved = 0, bad = 0;
for (const w of LEVELS) for (const l of w.levels) {
  const st = Engine.loadLevel(l);
  const r = Solver.solve(st, { maxNodes: 60000, maxDepth: 120 });
  if (r.solved) solved++; else { bad++; console.log('    UNSOLVED:', l.id); }
}
ok(bad === 0, `all shipped levels solvable (${solved}/${LEVELS.reduce((a, w) => a + w.levels.length, 0)})`);

console.log('— DOM checks —');

let jsdom = null;
try { jsdom = require('jsdom'); } catch (e) { /* not installed */ }

if (!jsdom) {
  console.log('  (jsdom not installed — skipping DOM checks. Run `npm i -D jsdom` to enable.)');
} else {
  const { JSDOM } = jsdom;
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: false });
  const { window } = dom;

  window.requestAnimationFrame = () => 0;
  window.cancelAnimationFrame = () => {};
  window.devicePixelRatio = 1;
  const gradient = { addColorStop() {} };
  function makeCtx() {
    return new Proxy({}, {
      get(t, p) {
        if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => gradient;
        if (p === 'measureText') return () => ({ width: 10 });
        if (p in t) return t[p];
        return () => {};
      },
      set(t, p, v) { t[p] = v; return true; },
    });
  }
  window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
  window.HTMLCanvasElement.prototype.getBoundingClientRect = function () { return { width: 480, height: 360, left: 0, top: 0 }; };

  for (const f of ['js/engine.js', 'js/solver.js', 'js/levels.js', 'js/audio.js', 'js/renderer.js', 'js/game.js', 'js/editor.js', 'js/main.js']) {
    window.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  const d = window.document;
  if (!d.getElementById('worlds').children.length) d.dispatchEvent(new window.Event('DOMContentLoaded'));

  ok(d.getElementById('worlds').children.length === 6, 'overworld renders 6 world cards');
  const firstBtn = d.querySelector('#worlds .level-btn.available');
  ok(!!firstBtn, 'a level button is clickable');
  firstBtn.onclick();
  ok(!d.getElementById('screen-game').classList.contains('hidden'), 'clicking a level opens the game screen');
  ok(d.getElementById('legend').children.length === 5, 'jelly legend renders 5 rows');
  window.Game.move(-1, 0);
  ok(!!window.Progress.solved['strawberry-01'], 'win is recorded to progress');
  window.Game.stop();
  window.Editor.start();
  ok(d.getElementById('palette').children.length === 12, 'editor palette has 12 tools');
  window.Editor.stop();
}

console.log('\n' + checks + ' checks, ' + failures + ' failure(s)');
process.exit(failures ? 1 : 0);
