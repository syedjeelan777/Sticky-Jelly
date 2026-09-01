/*
 * Sticky-Jelly — canvas renderer.
 *
 * Draws a game state onto a <canvas>, including animated jellies, fire,
 * goals, plates, gates and colorblind-friendly shape cues. Shared by the
 * game screen and the level editor.
 */
(function (global) {
  'use strict';

  var Engine = global.Engine;

  var FLOOR_A = '#352650';
  var FLOOR_B = '#3b2b5c';
  var WALL = '#181226';
  var WALL_EDGE = '#2c2140';

  function sizeCanvas(canvas) {
    var dpr = global.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { dpr: dpr, w: w, h: h };
  }

  function layout(state, canvas) {
    var rect = canvas.getBoundingClientRect();
    var w = rect.width || 400;
    var h = rect.height || 400;
    var pad = 6;
    var cell = Math.floor(Math.min((w - pad * 2) / state.width, (h - pad * 2) / state.height));
    cell = Math.max(cell, 4);
    var ox = Math.floor((w - cell * state.width) / 2);
    var oy = Math.floor((h - cell * state.height) / 2);
    return { cell: cell, ox: ox, oy: oy, w: w, h: h };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ------------------------- tile painting ------------------------- */
  function drawFloor(ctx, x, y, cell) {
    ctx.fillStyle = ((x + y) % 2 === 0) ? FLOOR_A : FLOOR_B;
    ctx.fillRect(x, y, cell, cell);
  }

  function drawWall(ctx, x, y, cell) {
    ctx.fillStyle = WALL;
    ctx.fillRect(x, y, cell, cell);
    ctx.fillStyle = WALL_EDGE;
    ctx.fillRect(x, y, cell, 3);
    ctx.fillStyle = '#050308';
    ctx.fillRect(x, y + cell - 2, cell, 2);
  }

  function drawFire(ctx, x, y, cell, time, seed) {
    var cx = x + cell / 2;
    var flick = 1 + 0.22 * Math.sin(time * 9 + seed * 7.3) + 0.1 * Math.sin(time * 23 + seed);
    // ember base
    ctx.fillStyle = '#3a1430';
    ctx.fillRect(x, y, cell, cell);
    // flame (two teardrops)
    var fh = cell * 0.62 * flick;
    var fw = cell * 0.34;
    ctx.fillStyle = '#ff7b1c';
    ctx.beginPath();
    ctx.moveTo(cx - fw, y + cell - cell * 0.12);
    ctx.quadraticCurveTo(cx - fw * 0.9, y + cell - fh * 0.7, cx, y + cell - fh);
    ctx.quadraticCurveTo(cx + fw * 0.9, y + cell - fh * 0.7, cx + fw, y + cell - cell * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(cx - fw * 0.5, y + cell - cell * 0.1);
    ctx.quadraticCurveTo(cx - fw * 0.4, y + cell - fh * 0.5, cx, y + cell - fh * 0.62);
    ctx.quadraticCurveTo(cx + fw * 0.4, y + cell - fh * 0.5, cx + fw * 0.5, y + cell - cell * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  function drawGoal(ctx, x, y, cell, time) {
    drawFloor(ctx, x, y, cell);
    var cx = x + cell / 2, cy = y + cell / 2;
    var r = cell * 0.34 * (1 + 0.06 * Math.sin(time * 3));
    ctx.fillStyle = 'rgba(255, 209, 102, 0.18)';
    ctx.beginPath(); ctx.arc(cx, cy, r + cell * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#f5b942';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffe9b0';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawPlate(ctx, x, y, cell) {
    drawFloor(ctx, x, y, cell);
    var cx = x + cell / 2, cy = y + cell / 2;
    ctx.fillStyle = '#5a5f76';
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.36, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8b91ad';
    ctx.lineWidth = Math.max(1, cell * 0.06);
    ctx.stroke();
    ctx.fillStyle = '#c9cede';
    ctx.beginPath(); ctx.arc(cx, cy, cell * 0.14, 0, Math.PI * 2); ctx.fill();
  }

  function drawGate(ctx, x, y, cell, open) {
    drawFloor(ctx, x, y, cell);
    if (open) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84);
      ctx.strokeStyle = '#6ee7b7';
      ctx.lineWidth = Math.max(1, cell * 0.08);
      ctx.strokeRect(x + cell * 0.16, y + cell * 0.3, cell * 0.68, cell * 0.4);
      return;
    }
    ctx.fillStyle = '#3d3160';
    ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = '#8b7ac0';
    ctx.lineWidth = Math.max(1, cell * 0.08);
    var n = 3;
    for (var i = 1; i <= n; i++) {
      var gx = x + (cell * i) / (n + 1);
      ctx.beginPath();
      ctx.moveTo(gx, y + cell * 0.1);
      ctx.lineTo(gx, y + cell * 0.9);
      ctx.stroke();
    }
  }

  /* ------------------------- entity painting ------------------------- */
  function jellyColor(e) {
    return Engine.TYPE_INFO[e.type].color;
  }

  function glyphPath(ctx, type, cx, cy, s) {
    ctx.beginPath();
    switch (type) {
      case 'sticky':
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s * 0.42, cy - s * 0.42);
        ctx.lineTo(cx + s, cy);
        ctx.lineTo(cx + s * 0.42, cy + s * 0.42);
        ctx.lineTo(cx, cy + s);
        ctx.lineTo(cx - s * 0.42, cy + s * 0.42);
        ctx.lineTo(cx - s, cy);
        ctx.lineTo(cx - s * 0.42, cy - s * 0.42);
        ctx.closePath();
        break;
      case 'rigid':
        ctx.rect(cx - s, cy - s, s * 2, s * 2);
        break;
      case 'squishy':
        ctx.arc(cx, cy, s * 0.62, 0, Math.PI * 2);
        break;
      case 'bouncy':
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s, cy + s * 0.6);
        ctx.lineTo(cx - s, cy + s * 0.6);
        ctx.closePath();
        break;
    }
  }

  function drawJelly(ctx, e, px, py, cell, opts) {
    var info = Engine.TYPE_INFO[e.type];
    var id = e.id || 0;
    var wobble = 1;
    if (e.type !== 'rigid') {
      wobble = 1 + 0.05 * Math.sin(opts.time * 3.2 + id * 1.7);
      if (e.type === 'squishy') wobble = 1 + 0.09 * Math.sin(opts.time * 3.8 + id);
    }
    var cx = px + cell / 2, cy = py + cell / 2;
    var s = cell * 0.44 * wobble;

    // body
    roundRect(ctx, cx - s, cy - s, s * 2, s * 2, cell * 0.26);
    var grad = ctx.createLinearGradient(cx - s, cy - s, cx + s, cy + s);
    grad.addColorStop(0, lighten(info.color, 0.18));
    grad.addColorStop(0.55, info.color);
    grad.addColorStop(1, info.dark);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth = Math.max(1, cell * 0.05);
    ctx.stroke();

    // gloss highlight
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx - s * 0.35, cy - s * 0.4, s * 0.3, s * 0.18, -0.6, 0, Math.PI * 2);
    ctx.fill();

    // shape glyph (accessibility cue — always present, stronger in colorblind mode)
    var gs = opts.colorblind ? s * 0.72 : s * 0.5;
    ctx.fillStyle = opts.colorblind ? '#ffffff' : 'rgba(0,0,0,0.5)';
    glyphPath(ctx, e.type, cx, cy, gs);
    ctx.fill();
  }

  function drawStone(ctx, e, px, py, cell) {
    var m = cell * 0.06;
    roundRect(ctx, px + m, py + m, cell - m * 2, cell - m * 2, cell * 0.16);
    var grad = ctx.createLinearGradient(px, py, px + cell, py + cell);
    grad.addColorStop(0, '#5b6070');
    grad.addColorStop(1, '#2c2f3a');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(1, cell * 0.05);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(px + m * 1.4, py + m * 1.4, cell - m * 2.8, cell * 0.18);
  }

  function lighten(hex, amt) {
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = Math.min(255, parseInt(c.slice(0, 2), 16) + 255 * amt);
    var g = Math.min(255, parseInt(c.slice(2, 4), 16) + 255 * amt);
    var b = Math.min(255, parseInt(c.slice(4, 6), 16) + 255 * amt);
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  /* ------------------------- full frame ------------------------- */
  function draw(state, canvas, opts) {
    opts = opts || {};
    var t = opts.time || 0;
    var d = sizeCanvas(canvas);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(d.dpr, 0, 0, d.dpr, 0, 0);
    ctx.clearRect(0, 0, d.w, d.h);

    var L = layout(state, canvas);
    var cell = L.cell;

    ctx.fillStyle = '#221733';
    ctx.fillRect(0, 0, d.w, d.h);

    // tiles
    for (var y = 0; y < state.height; y++) {
      for (var x = 0; x < state.width; x++) {
        var px = L.ox + x * cell, py = L.oy + y * cell;
        var ch = state.tiles[y][x];
        switch (ch) {
          case Engine.CH.WALL: drawWall(ctx, px, py, cell); break;
          case Engine.CH.FIRE: drawFire(ctx, px, py, cell, t, x * 13 + y * 7); break;
          case Engine.CH.GOAL: drawGoal(ctx, px, py, cell, t); break;
          case Engine.CH.PLATE: drawPlate(ctx, px, py, cell); break;
          case Engine.CH.GATE_CLOSED: drawGate(ctx, px, py, cell, false); break;
          case Engine.CH.GATE_OPEN: drawGate(ctx, px, py, cell, true); break;
          default: drawFloor(ctx, px, py, cell);
        }
      }
    }

    // subtle grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= state.width; gx++) {
      ctx.beginPath();
      ctx.moveTo(L.ox + gx * cell + 0.5, L.oy);
      ctx.lineTo(L.ox + gx * cell + 0.5, L.oy + state.height * cell);
      ctx.stroke();
    }
    for (var gy = 0; gy <= state.height; gy++) {
      ctx.beginPath();
      ctx.moveTo(L.ox, L.oy + gy * cell + 0.5);
      ctx.lineTo(L.ox + state.width * cell, L.oy + gy * cell + 0.5);
      ctx.stroke();
    }

    // hover highlight
    if (opts.hover) {
      var hx = opts.hover.x, hy = opts.hover.y;
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(L.ox + hx * cell + 1, L.oy + hy * cell + 1, cell - 2, cell - 2);
      ctx.setLineDash([]);
    }

    // entities
    var selected = opts.selected || {};
    var display = opts.display || {};
    for (var i = 0; i < state.entities.length; i++) {
      var e = state.entities[i];
      var dp = display[e.id] || { x: e.x, y: e.y };
      var ex = L.ox + dp.x * cell, ey = L.oy + dp.y * cell;
      if (e.kind === 'stone') drawStone(ctx, e, ex, ey, cell);
      else drawJelly(ctx, e, ex, ey, cell, opts);

      if (selected[e.id]) {
        var pulse = 0.5 + 0.5 * Math.sin(t * 6);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.55 + 0.4 * pulse).toFixed(2) + ')';
        ctx.lineWidth = Math.max(2, cell * 0.09);
        ctx.setLineDash([cell * 0.16, cell * 0.1]);
        ctx.strokeRect(ex + 1, ey + 1, cell - 2, cell - 2);
        ctx.setLineDash([]);
      }
    }

    return L;
  }

  function fit(canvas, state, maxSize) {
    // Set the canvas CSS size so the grid fills (but never exceeds) the stage.
    var cell = Math.max(22, Math.floor((maxSize - 24) / Math.max(state.width, state.height)));
    canvas.style.width = (state.width * cell) + 'px';
    canvas.style.height = (state.height * cell) + 'px';
  }

  var Renderer = {
    sizeCanvas: sizeCanvas,
    layout: layout,
    draw: draw,
    fit: fit,
    drawJelly: drawJelly,
    drawStone: drawStone,
    jellyColor: jellyColor,
  };

  global.Renderer = Renderer;
  if (typeof module !== 'undefined' && module.exports) module.exports = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
