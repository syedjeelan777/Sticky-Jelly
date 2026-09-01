/*
 * Sticky-Jelly — game screen controller.
 *
 * Owns a live Engine state, the undo history, input (keyboard / click /
 * drag / D-pad), the render loop and win / fail handling.
 */
(function (global) {
  'use strict';

  var Engine = global.Engine;
  var Solver = global.Solver;
  var Renderer = global.Renderer;
  var AudioSys = global.AudioSys;

  var canvas, ctx2d;
  var running = false;
  var rafId = null;

  var state = null;
  var level = null;
  var worldMeta = null;
  var history = [];
  var display = {};
  var selected = {};
  var hint = null;
  var hintText = '';
  var time = 0;
  var lastTs = 0;

  // callbacks wired by main.js
  var callbacks = { onWin: null, onFail: null, onNext: null };

  function el(id) { return document.getElementById(id); }

  function start(lvl, world) {
    stop();
    level = lvl;
    worldMeta = world;
    state = Engine.loadLevel(lvl);
    history = [];
    display = {};
    selected = {};
    hint = null;
    hintText = lvl.hint ? '💬 ' + lvl.hint : '';
    syncDisplay(true);
    running = true;

    el('game-title').textContent = lvl.title;
    el('game-world').textContent = world.emoji + ' ' + world.name;
    el('game-world').style.background = world.theme + '33';
    el('game-hint').textContent = hintText;
    el('btn-hint').classList.remove('active');
    updateHud();
    renderLegend(world);
    fitCanvas();

    lastTs = 0;
    rafId = requestAnimationFrame(loop);
  }

  function fitCanvas() {
    var wrap = document.querySelector('#screen-game .board-wrap');
    var max = wrap ? wrap.clientWidth - 28 : 600;
    Renderer.fit(canvas, state, Math.min(max, 620));
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function syncDisplay(snap) {
    for (var i = 0; i < state.entities.length; i++) {
      var e = state.entities[i];
      if (snap || !display[e.id]) display[e.id] = { x: e.x, y: e.y };
    }
  }

  function renderLegend(world) {
    var box = el('legend');
    box.innerHTML = '';
    var types = ['sticky', 'rigid', 'squishy', 'bouncy', 'stone'];
    for (var i = 0; i < types.length; i++) {
      var info = Engine.TYPE_INFO[types[i]];
      var row = document.createElement('div');
      row.className = 'legend-row';
      var sw = document.createElement('div');
      sw.className = 'legend-swatch';
      sw.style.background = 'linear-gradient(180deg,' + info.color + ',' + info.dark + ')';
      var txt = document.createElement('div');
      txt.innerHTML = '<div class="legend-label">' + info.label + '</div><div class="legend-blurb">' + info.blurb + '</div>';
      row.appendChild(sw);
      row.appendChild(txt);
      box.appendChild(row);
    }
  }

  /* ---------------- movement ---------------- */
  function representative() {
    // an entity in the current selection, or fall back to the first jelly
    for (var i = 0; i < state.entities.length; i++) {
      if (selected[state.entities[i].id]) return state.entities[i];
    }
    for (var j = 0; j < state.entities.length; j++) {
      if (state.entities[j].kind === 'jelly') {
        select(state.entities[j]);
        return state.entities[j];
      }
    }
    return null;
  }

  function select(entity) {
    var comp = Engine.componentOf(state, entity);
    selected = {};
    for (var i = 0; i < comp.length; i++) selected[comp[i].id] = true;
  }

  function move(dx, dy) {
    if (!state) return;
    hideOverlay();
    var rep = representative();
    if (!rep) return;

    var before = Engine.cloneState(state);
    var res = Engine.applyMove(state, rep, dx, dy);
    if (!res.state || res.blocked) {
      AudioSys.sfx.error();
      return;
    }
    history.push(before);
    state = res.state;
    syncDisplay(false);

    // sounds
    if (res.destroyed.length) AudioSys.sfx.fire();
    else if (rep.type === 'bouncy') AudioSys.sfx.slide();
    else if (rep.type === 'squishy') AudioSys.sfx.squish();
    else AudioSys.sfx.move();

    // keep selection on the moved unit (if it survived)
    selected = {};
    for (var j = 0; j < state.entities.length; j++) {
      if (state.entities[j].id === rep.id) {
        if (rep.type === 'sticky') {
          var comp = Engine.componentOf(state, state.entities[j]);
          for (var i = 0; i < comp.length; i++) selected[comp[i].id] = true;
        } else {
          selected[rep.id] = true;
        }
        break;
      }
    }

    hint = null;
    updateHud();

    if (res.destroyed.length) return fail();
    if (Engine.isWin(state)) return win();
  }

  function undo() {
    if (!history.length) { AudioSys.sfx.error(); return; }
    state = history.pop();
    syncDisplay(false);
    hint = null;
    updateHud();
    AudioSys.sfx.select();
    hideOverlay();
  }

  function reset() {
    state = Engine.loadLevel(level);
    history = [];
    selected = {};
    hint = null;
    syncDisplay(true);
    updateHud();
    hideOverlay();
    AudioSys.sfx.select();
  }

  function doHint() {
    if (!state) return;
    var res = Solver.solve(state, { maxNodes: 20000, maxDepth: 60 });
    if (res.solved && res.moves.length) {
      var m = res.moves[0];
      var ent = null;
      for (var i = 0; i < state.entities.length; i++) {
        if (state.entities[i].id === m.entityId) { ent = state.entities[i]; break; }
      }
      if (ent) {
        select(ent);
        hint = { entityId: m.entityId, dx: m.dx, dy: m.dy };
        hintText = '💡 Try pushing the ' + Engine.TYPE_INFO[ent.type].label.toLowerCase() +
          ' jelly ' + dirName(m.dx, m.dy) + '.';
        el('game-hint').textContent = hintText;
        AudioSys.sfx.select();
        return;
      }
    }
    hintText = '💡 No quick hint found — try a different approach!';
    el('game-hint').textContent = hintText;
  }

  function dirName(dx, dy) {
    if (dx === 1) return 'right';
    if (dx === -1) return 'left';
    if (dy === 1) return 'down';
    return 'up';
  }

  /* ---------------- win / fail ---------------- */
  function win() {
    AudioSys.sfx.win();
    var moves = history.length;
    // Don't record playtests (from the editor) as real progress.
    if (global.Progress && worldMeta && worldMeta.name !== 'Playtest') {
      global.Progress.complete(level.id, moves);
    }
    showOverlay(
      '🍮 Solved!',
      'Completed in ' + moves + ' move' + (moves === 1 ? '' : 's') +
        (level.par ? ' · par ' + level.par : '') + '.',
      [
        { label: 'Menu', cls: 'btn-ghost', action: function () { if (callbacks.onWin) callbacks.onWin(); } },
        { label: 'Next level →', cls: 'btn-primary', action: function () { if (callbacks.onNext) callbacks.onNext(); } },
      ]
    );
  }

  function fail() {
    AudioSys.sfx.fail();
    showOverlay(
      '🔥 Sizzled!',
      'A jelly met the fire. Undo your last move or reset the level.',
      [
        { label: '↩️ Undo', cls: 'btn-primary', action: undo },
        { label: '🔄 Reset', cls: 'btn-ghost', action: reset },
      ]
    );
  }

  function showOverlay(title, sub, actions) {
    el('overlay-title').textContent = title;
    el('overlay-sub').textContent = sub;
    var box = el('overlay-actions');
    box.innerHTML = '';
    actions.forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'btn ' + a.cls;
      b.textContent = a.label;
      b.onclick = function () { hideOverlay(); a.action(); };
      box.appendChild(b);
    });
    el('overlay').classList.remove('hidden');
  }

  function hideOverlay() {
    el('overlay').classList.add('hidden');
  }

  function updateHud() {
    el('game-moves').textContent = history.length + ' move' + (history.length === 1 ? '' : 's');
    var best = global.Progress ? global.Progress.bestFor(level.id) : null;
    el('game-best').textContent = best ? '★ ' + best : '';
    el('btn-undo').disabled = !history.length;
  }

  /* ---------------- input ---------------- */
  function cellFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    var L = Renderer.layout(state, canvas);
    var x = ev.clientX - rect.left;
    var y = ev.clientY - rect.top;
    var gx = Math.floor((x - L.ox) / L.cell);
    var gy = Math.floor((y - L.oy) / L.cell);
    if (gx < 0 || gy < 0 || gx >= state.width || gy >= state.height) return null;
    return { x: gx, y: gy };
  }

  function onPointerDown(ev) {
    AudioSys.unlock();
    var c = cellFromEvent(ev);
    if (!c) return;
    var ent = Engine.entityAt(state, c.x, c.y);
    if (ent) select(ent);
    else selected = {};
    hint = null;
    AudioSys.sfx.select();
    dragAnchor = { x: ev.clientX, y: ev.clientY, moved: false };
  }

  var dragAnchor = null;
  function onPointerMove(ev) {
    if (!dragAnchor) return;
    var dx = ev.clientX - dragAnchor.x;
    var dy = ev.clientY - dragAnchor.y;
    var cell = Renderer.layout(state, canvas).cell;
    if (Math.abs(dx) > cell * 0.55 || Math.abs(dy) > cell * 0.55) {
      var dir = Math.abs(dx) > Math.abs(dy)
        ? { dx: dx > 0 ? 1 : -1, dy: 0 }
        : { dx: 0, dy: dy > 0 ? 1 : -1 };
      dragAnchor = { x: ev.clientX, y: ev.clientY, moved: true };
      move(dir.dx, dir.dy);
    }
  }
  function onPointerUp() { dragAnchor = null; }

  function onKey(ev) {
    if (!running) return;
    var map = {
      ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
    };
    if (map[ev.key]) {
      ev.preventDefault();
      move(map[ev.key][0], map[ev.key][1]);
    } else if (ev.key === 'z' || ev.key === 'Z') {
      ev.preventDefault(); undo();
    } else if (ev.key === 'r' || ev.key === 'R') {
      ev.preventDefault(); reset();
    } else if (ev.key === 'h' || ev.key === 'H') {
      ev.preventDefault(); doHint();
    }
  }

  /* ---------------- render loop ---------------- */
  function loop(ts) {
    if (!running) return;
    if (!lastTs) lastTs = ts;
    var dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    time += dt;

    // tween display positions toward logical positions
    for (var id in display) {
      var d = display[id];
      var ent = null;
      for (var i = 0; i < state.entities.length; i++) {
        if (state.entities[i].id === Number(id)) { ent = state.entities[i]; break; }
      }
      if (!ent) continue;
      d.x += (ent.x - d.x) * 0.25;
      d.y += (ent.y - d.y) * 0.25;
      if (Math.abs(d.x - ent.x) < 0.01) d.x = ent.x;
      if (Math.abs(d.y - ent.y) < 0.01) d.y = ent.y;
    }

    Renderer.draw(state, canvas, {
      time: time, display: display, selected: selected,
      colorblind: global.Progress && global.Progress.settings.colorblind,
    });

    // draw hint arrow
    if (hint) {
      var L = Renderer.layout(state, canvas);
      var ent = null;
      for (var j = 0; j < state.entities.length; j++) {
        if (state.entities[j].id === hint.entityId) { ent = state.entities[j]; break; }
      }
      if (ent) {
        ctx2d = canvas.getContext('2d');
        var dpr = global.devicePixelRatio || 1;
        ctx2d.save();
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        var cx = L.ox + (display[ent.id] ? display[ent.id].x : ent.x) * L.cell + L.cell / 2;
        var cy = L.oy + (display[ent.id] ? display[ent.id].y : ent.y) * L.cell + L.cell / 2;
        drawArrow(ctx2d, cx, cy, hint.dx, hint.dy, L.cell);
        ctx2d.restore();
      }
    }

    rafId = requestAnimationFrame(loop);
  }

  function drawArrow(ctx, cx, cy, dx, dy, cell) {
    var len = cell * 0.62;
    var ang = Math.atan2(dy, dx);
    var sx = cx - Math.cos(ang) * len * 0.7;
    var sy = cy - Math.sin(ang) * len * 0.7;
    var ex = cx + Math.cos(ang) * len * 0.7;
    var ey = cy + Math.sin(ang) * len * 0.7;
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = Math.max(3, cell * 0.1);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    var ah = cell * 0.16;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang - 0.5) * ah, ey - Math.sin(ang - 0.5) * ah);
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - Math.cos(ang + 0.5) * ah, ey - Math.sin(ang + 0.5) * ah);
    ctx.stroke();
  }

  /* ---------------- wiring ---------------- */
  function bind() {
    canvas = el('game-canvas');
    el('btn-undo').onclick = undo;
    el('btn-reset').onclick = reset;
    el('btn-hint').onclick = doHint;
    el('btn-game-back').onclick = function () { if (callbacks.onBack) callbacks.onBack(); };
    el('btn-game-mute').onclick = function () { global.mainToggleMute(); };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);

    var dpad = el('dpad');
    dpad.addEventListener('click', function (ev) {
      var b = ev.target.closest('.dpad-btn');
      if (!b) return;
      var d = b.getAttribute('data-dir');
      var map = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      move(map[d][0], map[d][1]);
    });

    global.addEventListener('keydown', onKey);
    global.addEventListener('resize', function () { if (running) fitCanvas(); });
  }

  var Game = {
    start: start,
    stop: stop,
    bind: bind,
    move: move,
    undo: undo,
    reset: reset,
    doHint: doHint,
    setCallbacks: function (cb) { callbacks = cb; },
  };

  global.Game = Game;
  if (typeof module !== 'undefined' && module.exports) module.exports = Game;
})(typeof window !== 'undefined' ? window : globalThis);
