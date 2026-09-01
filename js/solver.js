/*
 * Sticky-Jelly — solver (BFS over puzzle states).
 *
 * Used by the offline level generator to guarantee every shipped level is
 * solvable, and by the in-browser level editor's "Validate" button.
 */
(function (global) {
  'use strict';

  var Engine = (typeof require !== 'undefined') ? require('./engine.js') : global.Engine;

  function keyOf(state) {
    var parts = [];
    for (var i = 0; i < state.entities.length; i++) {
      var e = state.entities[i];
      parts.push(e.kind + ':' + e.type + ':' + e.x + ',' + e.y);
    }
    parts.sort();
    return parts.join('|');
  }

  function enumerableUnits(state) {
    var units = [];
    var comps = Engine.stickyComponents(state);
    for (var i = 0; i < comps.length; i++) units.push(comps[i][0]);
    for (var j = 0; j < state.entities.length; j++) {
      var e = state.entities[j];
      if (e.kind === 'jelly' && e.type === 'sticky') continue; // already covered as comps
      units.push(e);
    }
    return units;
  }

  /*
   * solve(initialState, opts)
   *   opts: { maxNodes, maxDepth }
   * returns { solved, nodes, moves, timeout }
   *   moves — an array of { entityId, dx, dy } leading from start to a win.
   */
  function solve(initialState, opts) {
    opts = opts || {};
    var maxNodes = opts.maxNodes || 60000;
    var maxDepth = opts.maxDepth || 80;

    var start = Engine.cloneState(initialState);
    Engine.recomputeGates(start);
    if (Engine.isWin(start)) return { solved: true, nodes: 1, moves: [], timeout: false };

    var visited = {};
    visited[keyOf(start)] = true;

    var queue = [{ state: start, path: [] }];
    var nodes = 1;

    for (var qi = 0; qi < queue.length; qi++) {
      var cur = queue[qi];
      if (cur.path.length >= maxDepth) continue;

      var units = enumerableUnits(cur.state);
      for (var u = 0; u < units.length; u++) {
        for (var d = 0; d < Engine.DIRS.length; d++) {
          if (nodes >= maxNodes) {
            return { solved: false, nodes: nodes, moves: [], timeout: true };
          }
          nodes++;
          var dir = Engine.DIRS[d];
          var res = Engine.applyMove(cur.state, units[u], dir.dx, dir.dy);
          if (!res.state || res.blocked) continue;
          if (res.destroyed.length > 0) continue; // burning a jelly is a dead end
          if (Engine.isWin(res.state)) {
            return {
              solved: true,
              nodes: nodes,
              moves: cur.path.concat([{ entityId: units[u].id, dx: dir.dx, dy: dir.dy }]),
              timeout: false,
            };
          }
          if (Engine.isUnwinnable(res.state)) continue;
          var k = keyOf(res.state);
          if (visited[k]) continue;
          visited[k] = true;
          queue.push({
            state: res.state,
            path: cur.path.concat([{ entityId: units[u].id, dx: dir.dx, dy: dir.dy }]),
          });
        }
      }
    }
    return { solved: false, nodes: nodes, moves: [], timeout: false };
  }

  var Solver = {
    solve: solve,
    keyOf: keyOf,
    enumerableUnits: enumerableUnits,
  };

  global.Solver = Solver;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Solver;
  }
})(typeof window !== 'undefined' ? window : globalThis);
