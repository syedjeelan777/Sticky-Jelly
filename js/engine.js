/*
 * Sticky-Jelly — core game engine (pure logic, no DOM).
 *
 * This module encodes the entire puzzle rule set and is shared by:
 *   - the browser game (js/game.js)
 *   - the level editor (js/editor.js)
 *   - the solver (js/solver.js)
 *   - the offline level generator (tools/generate_levels.js)
 *
 * It is written in a dual CommonJS / browser-global style so the same file
 * can be `require()`d by Node and loaded with a plain <script> tag.
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Cell characters
   * ------------------------------------------------------------------ */
  var CH = {
    FLOOR: '.',      // walkable floor
    WALL: '#',       // solid wall
    FIRE: 'F',       // walkable, burns non-fireproof jellies that enter it
    GOAL: 'G',       // walkable; a jelly resting here counts toward the win
    PLATE: 'P',      // walkable; a heavy entity on it opens all gates
    GATE_CLOSED: 'g',// solid gate (closed)
    GATE_OPEN: 'o',  // walkable gate (open)
  };

  /* ------------------------------------------------------------------ *
   * Entity types
   *
   *   sticky  — sticks to walls and to other sticky jellies (clusters).
   *             Falls only when the whole cluster is un-anchored.
   *   rigid   — a solid, never-falls block. Fireproof and heavy.
   *   squishy — deformable: obeys gravity, always settles to the lowest cell.
   *   bouncy  — elastic: slides across empty cells when pushed, then settles.
   *   stone   — a pushable solid (Sokoban crate). Fireproof and heavy.
   * ------------------------------------------------------------------ */
  var TYPES = ['sticky', 'rigid', 'squishy', 'bouncy'];

  var TYPE_INFO = {
    sticky:  { color: '#a06cf0', dark: '#7a45cf', label: 'Sticky',  glyph: '✦',
               blurb: 'Sticks to walls & fellow sticky jellies. Clusters move as one.' },
    rigid:   { color: '#f5c518', dark: '#c79a06', label: 'Rigid',   glyph: '■',
               blurb: 'A solid block. Never falls. Fireproof & heavy (holds pressure plates).' },
    squishy: { color: '#38b6ff', dark: '#1f86d6', label: 'Squishy', glyph: '●',
               blurb: 'Deformable: it always drips down to the lowest cell.' },
    bouncy:  { color: '#ff5d73', dark: '#d43a50', label: 'Bouncy',  glyph: '▲',
               blurb: 'Elastic: a single push launches it sliding until it hits something.' },
    stone:   { color: '#3c3f4d', dark: '#23252f', label: 'Stone',   glyph: '▣',
               blurb: 'A pushable solid. Fireproof & heavy. Never falls.' },
  };

  var DIRS = [
    { dx: 0, dy: -1, name: 'up' },
    { dx: 1, dy: 0,  name: 'right' },
    { dx: 0, dy: 1,  name: 'down' },
    { dx: -1, dy: 0, name: 'left' },
  ];

  /* ------------------------------------------------------------------ *
   * Low-level helpers
   * ------------------------------------------------------------------ */
  function inBounds(state, x, y) {
    return x >= 0 && y >= 0 && x < state.width && y < state.height;
  }

  function getTile(state, x, y) {
    if (!inBounds(state, x, y)) return CH.WALL;
    return state.tiles[y][x];
  }

  function isWalkableChar(c) {
    return c === CH.FLOOR || c === CH.FIRE || c === CH.GOAL ||
           c === CH.PLATE || c === CH.GATE_OPEN;
  }

  function isSolidChar(c) {
    return c === CH.WALL || c === CH.GATE_CLOSED;
  }

  function isFireproof(e) {
    return e.kind === 'stone' || (e.kind === 'jelly' && e.type === 'rigid');
  }

  function isHeavy(e) {
    // Heavy entities press pressure plates: stones and rigid jellies.
    return e.kind === 'stone' || (e.kind === 'jelly' && e.type === 'rigid');
  }

  function isFallingType(e) {
    // Only squishy jellies fall on their own. Bouncy jellies hold position
    // (they are elastic) and only travel by sliding when pushed.
    return e.kind === 'jelly' && e.type === 'squishy';
  }

  function cloneState(state) {
    return {
      width: state.width,
      height: state.height,
      tiles: state.tiles.map(function (row) { return row.slice(); }),
      entities: state.entities.map(function (e) { return Object.assign({}, e); }),
    };
  }

  function entityAt(state, x, y) {
    for (var i = 0; i < state.entities.length; i++) {
      var e = state.entities[i];
      if (e.x === x && e.y === y) return e;
    }
    return null;
  }

  function goalsOf(state) {
    var n = 0;
    for (var y = 0; y < state.height; y++)
      for (var x = 0; x < state.width; x++)
        if (state.tiles[y][x] === CH.GOAL) n++;
    return n;
  }

  function jellyCount(state) {
    var n = 0;
    for (var i = 0; i < state.entities.length; i++)
      if (state.entities[i].kind === 'jelly') n++;
    return n;
  }

  /* ------------------------------------------------------------------ *
   * Sticky components (connected clusters of sticky jellies)
   * ------------------------------------------------------------------ */
  function stickyComponents(state) {
    var seen = {};
    var comps = [];
    var index = {};
    var sticky = [];
    for (var i = 0; i < state.entities.length; i++) {
      var e = state.entities[i];
      if (e.kind === 'jelly' && e.type === 'sticky') {
        sticky.push(e);
        index[e.x + ',' + e.y] = e;
      }
    }
    for (var s = 0; s < sticky.length; s++) {
      var e0 = sticky[s];
      var k0 = e0.x + ',' + e0.y;
      if (seen[k0]) continue;
      seen[k0] = true;
      var comp = [e0];
      var stack = [e0];
      while (stack.length) {
        var cur = stack.pop();
        for (var d = 0; d < 4; d++) {
          var nx = cur.x + DIRS[d].dx;
          var ny = cur.y + DIRS[d].dy;
          var k = nx + ',' + ny;
          if (index[k] && !seen[k]) {
            seen[k] = true;
            var nxt = index[k];
            comp.push(nxt);
            stack.push(nxt);
          }
        }
      }
      comps.push(comp);
    }
    return comps;
  }

  function componentOf(state, entity) {
    if (entity.kind !== 'jelly' || entity.type !== 'sticky') return [entity];
    var comps = stickyComponents(state);
    for (var i = 0; i < comps.length; i++) {
      for (var j = 0; j < comps[i].length; j++) {
        if (comps[i][j].id === entity.id) return comps[i];
      }
    }
    return [entity];
  }

  function isAnchored(state, comp) {
    // A sticky cluster is anchored if any member touches a wall.
    for (var i = 0; i < comp.length; i++) {
      var e = comp[i];
      for (var d = 0; d < 4; d++) {
        if (getTile(state, e.x + DIRS[d].dx, e.y + DIRS[d].dy) === CH.WALL) return true;
      }
    }
    return false;
  }

  /* ------------------------------------------------------------------ *
   * Rules that mutate a (cloned) state
   * ------------------------------------------------------------------ */
  function burnOnFire(state) {
    // Any non-fireproof entity currently standing on a fire tile is destroyed.
    for (var i = state.entities.length - 1; i >= 0; i--) {
      var e = state.entities[i];
      if (!isFireproof(e) && getTile(state, e.x, e.y) === CH.FIRE) {
        state.entities.splice(i, 1);
      }
    }
  }

  function recomputeGates(state) {
    var open = false;
    for (var i = 0; i < state.entities.length; i++) {
      var e = state.entities[i];
      if (isHeavy(e) && getTile(state, e.x, e.y) === CH.PLATE) { open = true; break; }
    }
    for (var y = 0; y < state.height; y++) {
      for (var x = 0; x < state.width; x++) {
        if (state.tiles[y][x] === CH.GATE_CLOSED || state.tiles[y][x] === CH.GATE_OPEN) {
          state.tiles[y][x] = open ? CH.GATE_OPEN : CH.GATE_CLOSED;
        }
      }
    }
  }

  function settle(state) {
    // Apply gravity until stable. Mutates state in place.
    var guard = 0;
    var changed = true;
    while (changed && guard++ < 1000) {
      changed = false;

      // 1) Sticky clusters fall as a whole (bottom-most first).
      var comps = stickyComponents(state);
      comps.sort(function (a, b) { return maxY(b) - maxY(a); });
      for (var c = 0; c < comps.length; c++) {
        var comp = comps[c];
        if (isAnchored(state, comp)) continue;
        var ok = true;
        for (var i = 0; i < comp.length; i++) {
          var e = comp[i];
          var ny = e.y + 1;
          if (ny >= state.height) { ok = false; break; }
          if (isSolidChar(getTile(state, e.x, ny))) { ok = false; break; }
          var below = entityAt(state, e.x, ny);
          if (below && comp.indexOf(below) === -1) { ok = false; break; }
        }
        if (ok) {
          for (var j = 0; j < comp.length; j++) comp[j].y += 1;
          changed = true;
          burnOnFire(state);
        }
      }

      // 2) Squishy & bouncy jellies fall individually (bottom-up so stacks work).
      var falling = [];
      for (var k = 0; k < state.entities.length; k++) {
        if (isFallingType(state.entities[k])) falling.push(state.entities[k]);
      }
      falling.sort(function (a, b) { return b.y - a.y; });
      for (var f = 0; f < falling.length; f++) {
        var en = falling[f];
        var ny = en.y + 1;
        if (ny >= state.height) continue;
        if (isSolidChar(getTile(state, en.x, ny))) continue;
        if (entityAt(state, en.x, ny)) continue;
        en.y += 1;
        changed = true;
        burnOnFire(state);
      }
    }
  }

  function maxY(comp) {
    var m = -1;
    for (var i = 0; i < comp.length; i++) if (comp[i].y > m) m = comp[i].y;
    return m;
  }

  /* ------------------------------------------------------------------ *
   * applyMove — attempt a move. Returns:
   *   { state, blocked, destroyed[] }
   * where `state` is the resulting state (or null if blocked).
   * ------------------------------------------------------------------ */
  function applyMove(state, entity, dx, dy) {
    if (!entity || (dx === 0 && dy === 0)) return { state: null, blocked: true, destroyed: [] };

    var s = cloneState(state);
    var ent = null;
    for (var i = 0; i < s.entities.length; i++) {
      if (s.entities[i].id === entity.id) { ent = s.entities[i]; break; }
    }
    if (!ent) return { state: null, blocked: true, destroyed: [] };

    var beforeIds = {};
    for (var b = 0; b < s.entities.length; b++) beforeIds[s.entities[b].id] = true;

    var unit = componentOf(s, ent);

    if (ent.kind === 'jelly' && ent.type === 'bouncy') {
      // Slide across empty cells until blocked.
      var cx = ent.x, cy = ent.y;
      for (var steps = 0; steps < 1000; steps++) {
        var nx = cx + dx, ny = cy + dy;
        if (isSolidChar(getTile(s, nx, ny))) break;
        if (entityAt(s, nx, ny)) break;
        cx = nx; cy = ny;
        if (getTile(s, nx, ny) === CH.FIRE) break; // it slides onto fire → burns
      }
      if (cx === ent.x && cy === ent.y) {
        return { state: null, blocked: true, destroyed: [] }; // nothing to slide into
      }
      ent.x = cx; ent.y = cy;
    } else {
      // Step push (may also push stones ahead of it).
      var pushes = [];
      for (var u = 0; u < unit.length; u++) {
        var tx = unit[u].x + dx, ty = unit[u].y + dy;
        var tc = getTile(s, tx, ty);
        if (isSolidChar(tc)) return { state: null, blocked: true, destroyed: [] };
        var occ = entityAt(s, tx, ty);
        if (occ && unit.indexOf(occ) === -1) {
          if (occ.kind === 'stone') {
            if (pushes.indexOf(occ) === -1) pushes.push(occ);
          } else {
            return { state: null, blocked: true, destroyed: [] }; // can't push a jelly
          }
        }
      }
      for (var p = 0; p < pushes.length; p++) {
        var px = pushes[p].x + dx, py = pushes[p].y + dy;
        if (isSolidChar(getTile(s, px, py))) return { state: null, blocked: true, destroyed: [] };
        var occ2 = entityAt(s, px, py);
        if (occ2 && unit.indexOf(occ2) === -1 && pushes.indexOf(occ2) === -1) {
          return { state: null, blocked: true, destroyed: [] };
        }
      }
      for (var m = 0; m < unit.length; m++) { unit[m].x += dx; unit[m].y += dy; }
      for (var q = 0; q < pushes.length; q++) {
        pushes[q].x += dx; pushes[q].y += dy;
      }
    }

    burnOnFire(s);
    settle(s);
    burnOnFire(s);
    recomputeGates(s);

    // Entities present before the move but absent afterwards were destroyed.
    var afterIds = {};
    for (var a = 0; a < s.entities.length; a++) afterIds[s.entities[a].id] = true;
    var destroyed = [];
    for (var bid in beforeIds) {
      if (!afterIds[bid]) destroyed.push({ id: Number(bid) });
    }
    return { state: s, blocked: false, destroyed: destroyed };
  }

  /* ------------------------------------------------------------------ *
   * Win / fail
   * ------------------------------------------------------------------ */
  function isWin(state) {
    var goals = goalsOf(state);
    if (goals === 0) return false;
    var onGoal = 0;
    for (var i = 0; i < state.entities.length; i++) {
      var e = state.entities[i];
      if (e.kind === 'jelly' && getTile(state, e.x, e.y) === CH.GOAL) onGoal++;
    }
    return onGoal === goals;
  }

  function isUnwinnable(state) {
    // Fewer jellies than goals can never satisfy all goals.
    return jellyCount(state) < goalsOf(state);
  }

  /* ------------------------------------------------------------------ *
   * Loading / creating levels
   * ------------------------------------------------------------------ */
  function loadLevel(level) {
    // Build a playable state from a level definition object.
    var tiles = level.tiles.map(function (row) { return row.split(''); });
    var state = {
      width: level.width,
      height: level.height,
      tiles: tiles,
      entities: [],
    };
    var id = 0;
    for (var i = 0; i < level.entities.length; i++) {
      var d = level.entities[i];
      state.entities.push({
        id: id++,
        kind: d.type === 'stone' ? 'stone' : 'jelly',
        type: d.type,
        x: d.x,
        y: d.y,
      });
    }
    // Settle to a stable configuration (gravity) before play begins, then
    // resolve any fire contact and gate state.
    settle(state);
    burnOnFire(state);
    recomputeGates(state);
    return state;
  }

  function stateToLevel(state, meta) {
    var tiles = state.tiles.map(function (row) { return row.join(''); });
    var entities = state.entities.map(function (e) {
      return { type: e.type, x: e.x, y: e.y };
    });
    return {
      id: meta && meta.id || 'custom',
      title: meta && meta.title || 'Untitled',
      world: meta && meta.world || 'Custom',
      width: state.width,
      height: state.height,
      tiles: tiles,
      entities: entities,
    };
  }

  /* ------------------------------------------------------------------ *
   * Export
   * ------------------------------------------------------------------ */
  var Engine = {
    CH: CH,
    TYPES: TYPES,
    TYPE_INFO: TYPE_INFO,
    DIRS: DIRS,
    inBounds: inBounds,
    getTile: getTile,
    isWalkableChar: isWalkableChar,
    isSolidChar: isSolidChar,
    isFireproof: isFireproof,
    isHeavy: isHeavy,
    cloneState: cloneState,
    entityAt: entityAt,
    goalsOf: goalsOf,
    jellyCount: jellyCount,
    stickyComponents: stickyComponents,
    componentOf: componentOf,
    isAnchored: isAnchored,
    settle: settle,
    recomputeGates: recomputeGates,
    burnOnFire: burnOnFire,
    applyMove: applyMove,
    isWin: isWin,
    isUnwinnable: isUnwinnable,
    loadLevel: loadLevel,
    stateToLevel: stateToLevel,
  };

  global.Engine = Engine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Engine;
  }
})(typeof window !== 'undefined' ? window : globalThis);
