/*
 * Sticky-Jelly — integrated in-browser level editor.
 *
 * Palette-based painting of tiles & entities, undo/redo, import/export (JSON
 * + shareable link), solver validation and one-tap playtesting.
 */
(function (global) {
  'use strict';

  var Engine = global.Engine;
  var Solver = global.Solver;
  var Renderer = global.Renderer;
  var AudioSys = global.AudioSys;

  var canvas;
  var W = 8, H = 6;
  var tiles = [];
  var entities = [];
  var nextId = 1;

  var currentTool = 'floor';
  var undoStack = [];
  var redoStack = [];
  var hover = null;
  var painting = false;
  var rafId = null;
  var time = 0;
  var running = false;

  var callbacks = { onBack: null, onPlay: null };

  function el(id) { return document.getElementById(id); }

  /* ---------------- tools ---------------- */
  var TOOLS = [
    { id: 'floor', label: 'Floor', glyph: null, swatch: '#352650' },
    { id: 'wall', label: 'Wall', glyph: null, swatch: '#181226' },
    { id: 'goal', label: 'Goal', glyph: null, swatch: '#f5b942' },
    { id: 'plate', label: 'Plate', glyph: null, swatch: '#8b91ad' },
    { id: 'gate', label: 'Gate', glyph: null, swatch: '#8b7ac0' },
    { id: 'fire', label: 'Fire', glyph: null, swatch: '#ff7b1c' },
    { id: 'sticky', label: 'Sticky', glyph: '✦', swatch: Engine.TYPE_INFO.sticky.color },
    { id: 'rigid', label: 'Rigid', glyph: '■', swatch: Engine.TYPE_INFO.rigid.color },
    { id: 'squishy', label: 'Squishy', glyph: '●', swatch: Engine.TYPE_INFO.squishy.color },
    { id: 'bouncy', label: 'Bouncy', glyph: '▲', swatch: Engine.TYPE_INFO.bouncy.color },
    { id: 'stone', label: 'Stone', glyph: '▣', swatch: Engine.TYPE_INFO.stone.color },
    { id: 'erase', label: 'Erase', glyph: null, swatch: null },
  ];

  function buildPalette() {
    var box = el('palette');
    box.innerHTML = '';
    TOOLS.forEach(function (tool) {
      var b = document.createElement('button');
      b.className = 'palette-btn';
      b.title = tool.label;
      b.setAttribute('data-tool', tool.id);
      if (tool.swatch) {
        var s = document.createElement('span');
        s.className = 'swatch';
        s.style.background = tool.swatch;
        b.appendChild(s);
      } else if (tool.id === 'erase') {
        var e = document.createElement('span');
        e.className = 'erase';
        b.appendChild(e);
      } else {
        b.textContent = tool.glyph || '·';
      }
      b.onclick = function () { setTool(tool.id); };
      box.appendChild(b);
    });
    setTool(currentTool);
  }

  function setTool(id) {
    currentTool = id;
    document.querySelectorAll('#palette .palette-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tool') === id);
    });
    setStatus('Tool: ' + id.charAt(0).toUpperCase() + id.slice(1) + '. Click or drag on the grid.');
  }

  function setStatus(msg) { el('editor-status').textContent = msg; }

  /* ---------------- grid state ---------------- */
  function blankTiles(w, h) {
    var t = [];
    for (var y = 0; y < h; y++) {
      var row = [];
      for (var x = 0; x < w; x++) {
        row.push((x === 0 || y === 0 || x === w - 1 || y === h - 1) ? Engine.CH.WALL : Engine.CH.FLOOR);
      }
      t.push(row);
    }
    return t;
  }

  function snapshot() {
    return {
      tiles: tiles.map(function (r) { return r.slice(); }),
      entities: entities.map(function (e) { return Object.assign({}, e); }),
    };
  }

  function restore(snap) {
    tiles = snap.tiles.map(function (r) { return r.slice(); });
    entities = snap.entities.map(function (e) { return Object.assign({}, e); });
    W = tiles[0].length; H = tiles.length;
  }

  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    updateButtons();
  }

  function applyTool(tool, x, y, addUndo) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    if (addUndo !== false) pushUndo();

    var tile = tiles[y][x];
    var entIndex = entityIndexAt(x, y);

    switch (tool) {
      case 'floor':
        tiles[y][x] = Engine.CH.FLOOR;
        removeEntityAt(x, y);
        AudioSys.sfx.place();
        break;
      case 'wall': case 'goal': case 'plate': case 'gate': case 'fire':
        removeEntityAt(x, y);
        tiles[y][x] = { wall: Engine.CH.WALL, goal: Engine.CH.GOAL, plate: Engine.CH.PLATE, gate: Engine.CH.GATE_CLOSED, fire: Engine.CH.FIRE }[tool];
        AudioSys.sfx.place();
        break;
      case 'erase':
        if (entIndex !== -1) { entities.splice(entIndex, 1); AudioSys.sfx.erase(); }
        else { tiles[y][x] = Engine.CH.FLOOR; AudioSys.sfx.erase(); }
        break;
      default: // jelly / stone
        if (tile === Engine.CH.WALL || tile === Engine.CH.GATE_CLOSED) { AudioSys.sfx.error(); return; }
        removeEntityAt(x, y);
        entities.push({ id: nextId++, kind: tool === 'stone' ? 'stone' : 'jelly', type: tool, x: x, y: y });
        AudioSys.sfx.place();
        break;
    }
    updateButtons();
  }

  function entityIndexAt(x, y) {
    for (var i = 0; i < entities.length; i++) if (entities[i].x === x && entities[i].y === y) return i;
    return -1;
  }

  function removeEntityAt(x, y) {
    var i = entityIndexAt(x, y);
    if (i !== -1) entities.splice(i, 1);
  }

  function clearBoard() {
    pushUndo();
    tiles = blankTiles(W, H);
    entities = [];
    updateButtons();
    AudioSys.sfx.select();
  }

  function newSize(w, h) {
    if (w < 3 || h < 3 || w > 24 || h > 18) { AudioSys.sfx.error(); return false; }
    pushUndo();
    var old = snapshot();
    tiles = blankTiles(w, h);
    // carry over whatever still fits
    entities = [];
    for (var i = 0; i < old.entities.length; i++) {
      var e = old.entities[i];
      if (e.x < w - 1 && e.y < h - 1) entities.push(Object.assign({}, e));
    }
    for (var y = 1; y < Math.min(h - 1, H - 1); y++) {
      for (var x = 1; x < Math.min(w - 1, W - 1); x++) {
        tiles[y][x] = old.tiles[y][x];
      }
    }
    W = w; H = h;
    updateButtons();
    return true;
  }

  /* ---------------- current level (de)serialization ---------------- */
  function toLevel() {
    var lvlTiles = tiles.map(function (r) { return r.join(''); });
    return {
      id: 'custom-' + Date.now(),
      title: 'Custom Level',
      world: 'Custom',
      width: W, height: H,
      tiles: lvlTiles,
      entities: entities.map(function (e) { return { type: e.type, x: e.x, y: e.y }; }),
    };
  }

  function loadLevel(lvl) {
    pushUndo();
    W = lvl.width; H = lvl.height;
    tiles = lvl.tiles.map(function (r) { return r.split(''); });
    entities = lvl.entities.map(function (e) {
      return { id: nextId++, kind: e.type === 'stone' ? 'stone' : 'jelly', type: e.type, x: e.x, y: e.y };
    });
    updateButtons();
  }

  function loadFromJSON(text) {
    try {
      var lvl = JSON.parse(text);
      if (!lvl || !Array.isArray(lvl.tiles) || !Array.isArray(lvl.entities)) throw new Error('bad shape');
      loadLevel(lvl);
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------- actions ---------------- */
  function validate() {
    var lvl = toLevel();
    if (!entities.length || !goalCount()) {
      setStatus('⚠️ Add at least one jelly and one goal before validating.');
      AudioSys.sfx.error();
      return;
    }
    setStatus('Validating with the solver…');
    setTimeout(function () {
      var st = Engine.loadLevel(lvl);
      var res = Solver.solve(st, { maxNodes: 60000, maxDepth: 120 });
      if (res.solved) {
        setStatus('✅ Solvable in ' + res.moves.length + ' moves.');
        AudioSys.sfx.win();
      } else if (res.timeout) {
        setStatus('⚠️ Could not find a solution (search limit reached). It may still be solvable.');
        AudioSys.sfx.error();
      } else {
        setStatus('❌ This level appears unsolvable — check jellies, goals, and hazards.');
        AudioSys.sfx.error();
      }
    }, 30);
  }

  function goalCount() {
    var n = 0;
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) if (tiles[y][x] === Engine.CH.GOAL) n++;
    return n;
  }

  function testPlay() {
    var lvl = toLevel();
    if (!entities.length || !goalCount()) {
      setStatus('⚠️ Add at least one jelly and one goal first.');
      AudioSys.sfx.error();
      return;
    }
    if (callbacks.onPlay) callbacks.onPlay(lvl);
  }

  function saveCustom() {
    var lvl = toLevel();
    if (!entities.length || !goalCount()) {
      setStatus('⚠️ Add at least one jelly and one goal first.');
      AudioSys.sfx.error();
      return;
    }
    lvl.title = 'Custom ' + (global.Progress ? global.Progress.customCount() + 1 : 'Level');
    if (global.Progress) global.Progress.addCustom(lvl);
    setStatus('💾 Saved as “' + lvl.title + '” — find it on the overworld.');
    AudioSys.sfx.unlock();
  }

  function exportModal() {
    var json = JSON.stringify(toLevel(), null, 2);
    var body = el('modal-body');
    body.innerHTML = '<label>Level JSON</label><textarea id="export-text" readonly>' +
      json.replace(/</g, '&lt;') + '</textarea>';
    el('modal-title').textContent = 'Export / Share';
    var actions = el('modal-actions');
    actions.innerHTML = '';
    addModalBtn(actions, '📋 Copy JSON', 'btn-primary', function () {
      copyText(json); closeModal();
    });
    addModalBtn(actions, '⬇️ Download file', 'btn-ghost', function () {
      download(json, 'level.json'); closeModal();
    });
    addModalBtn(actions, '🔗 Copy share link', 'btn-ghost', function () {
      copyText(shareLink(json)); closeModal();
    });
    addModalBtn(actions, 'Close', 'btn-ghost', closeModal);
    openModal();
  }

  function importModal() {
    el('modal-title').textContent = 'Import level';
    el('modal-body').innerHTML =
      '<label>Paste level JSON (from export, or a share link is auto-detected):</label>' +
      '<textarea id="import-text" placeholder=\'{ "width": 8, "height": 6, "tiles": [...], "entities": [...] }\'></textarea>';
    var actions = el('modal-actions');
    actions.innerHTML = '';
    addModalBtn(actions, 'Import', 'btn-primary', function () {
      var t = el('import-text').value.trim();
      if (t.indexOf('#') === 0) t = decodeLink(t); // share-link fragment
      if (loadFromJSON(t)) { setStatus('✅ Level imported.'); closeModal(); }
      else { setStatus('❌ Invalid JSON.'); AudioSys.sfx.error(); }
    });
    addModalBtn(actions, 'Cancel', 'btn-ghost', closeModal);
    openModal();
  }

  function addModalBtn(box, label, cls, fn) {
    var b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.onclick = fn;
    box.appendChild(b);
  }

  function openModal() { el('modal').classList.remove('hidden'); }
  function closeModal() { el('modal').classList.add('hidden'); }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () {});
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
  }

  function download(text, filename) {
    var blob = new Blob([text], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
  }

  function shareLink(json) {
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return location.origin + location.pathname + '#level=' + b64;
  }

  function decodeLink(frag) {
    var b64 = frag.replace(/^#level=/, '');
    return decodeURIComponent(escape(atob(b64)));
  }

  /* ---------------- input ---------------- */
  function cellFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    var L = Renderer.layout(editorState(), canvas);
    var x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    var gx = Math.floor((x - L.ox) / L.cell);
    var gy = Math.floor((y - L.oy) / L.cell);
    if (gx < 0 || gy < 0 || gx >= W || gy >= H) return null;
    return { x: gx, y: gy };
  }

  function editorState() {
    return { width: W, height: H, tiles: tiles, entities: entities };
  }

  function onPointerDown(ev) {
    AudioSys.unlock();
    ev.preventDefault();
    var c = cellFromEvent(ev);
    if (!c) return;
    painting = true;
    if (ev.button === 2) { currentTool = 'erase'; }
    applyTool(currentTool, c.x, c.y, true);
  }
  function onPointerMove(ev) {
    var c = cellFromEvent(ev);
    hover = c;
    if (painting && c) {
      if (ev.buttons & 1 || ev.buttons & 2) applyTool(currentTool, c.x, c.y, false);
    }
  }
  function onPointerUp() { painting = false; }
  function onContextMenu(ev) { ev.preventDefault(); }

  function onKey(ev) {
    if (!running) return;
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'z' || ev.key === 'Z')) {
      ev.preventDefault(); undo();
    } else if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'y' || ev.key === 'Y')) {
      ev.preventDefault(); redo();
    }
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
    updateButtons(); AudioSys.sfx.select();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
    updateButtons(); AudioSys.sfx.select();
  }

  function updateButtons() {
    el('btn-ed-undo').disabled = !undoStack.length;
    el('btn-ed-redo').disabled = !redoStack.length;
  }

  /* ---------------- render loop ---------------- */
  function loop(ts) {
    if (!running) return;
    time += 0.016;
    var st = editorState();
    Renderer.draw(st, canvas, {
      time: time,
      display: displayMap(),
      selected: {},
      colorblind: global.Progress && global.Progress.settings.colorblind,
      hover: hover,
    });
    drawGhost(st);
    rafId = requestAnimationFrame(loop);
  }

  function displayMap() {
    var m = {};
    for (var i = 0; i < entities.length; i++) m[entities[i].id] = { x: entities[i].x, y: entities[i].y };
    return m;
  }

  function drawGhost(st) {
    if (!hover || painting) return;
    var L = Renderer.layout(st, canvas);
    var ctx = canvas.getContext('2d');
    var dpr = global.devicePixelRatio || 1;
    var x = L.ox + hover.x * L.cell, y = L.oy + hover.y * L.cell, cell = L.cell;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 0.5;
    if (TOOLS.some(function (t) { return t.id === currentTool && t.swatch; })) {
      var tool = TOOLS.filter(function (t) { return t.id === currentTool; })[0];
      if (currentTool === 'sticky' || currentTool === 'rigid' || currentTool === 'squishy' || currentTool === 'bouncy') {
        Renderer.drawJelly(ctx, { type: currentTool, id: -1 }, x, y, cell, { time: time, colorblind: false });
      } else if (currentTool === 'stone') {
        Renderer.drawStone(ctx, { id: -1 }, x, y, cell);
      } else if (tool.swatch) {
        roundRectGhost(ctx, x, y, cell, tool.swatch);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function roundRectGhost(ctx, x, y, cell, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, cell, cell);
  }

  /* ---------------- lifecycle ---------------- */
  function start() {
    canvas = el('editor-canvas');
    if (!canvas.dataset.bound) {
      canvas.dataset.bound = '1';
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointerleave', onPointerUp);
      canvas.addEventListener('contextmenu', onContextMenu);
      global.addEventListener('keydown', onKey);
    }
    if (!tiles.length) tiles = blankTiles(W, H);
    running = true;
    rafId = requestAnimationFrame(loop);
    fitCanvas();
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function fitCanvas() {
    var wrap = document.querySelector('#screen-editor .board-wrap');
    var max = wrap ? wrap.clientWidth - 28 : 600;
    Renderer.fit(canvas, editorState(), Math.min(max, 640));
  }

  function bind() {
    buildPalette();
    el('btn-ed-undo').onclick = undo;
    el('btn-ed-redo').onclick = redo;
    el('btn-ed-validate').onclick = validate;
    el('btn-ed-play').onclick = testPlay;
    el('btn-ed-save').onclick = saveCustom;
    el('btn-ed-export').onclick = exportModal;
    el('btn-ed-import').onclick = importModal;
    el('btn-ed-clear').onclick = clearBoard;
    el('btn-ed-new').onclick = function () {
      el('modal-title').textContent = 'New level size';
      el('modal-body').innerHTML =
        '<label>Width</label><input id="new-w" type="number" min="3" max="24" value="' + W + '">' +
        '<label>Height</label><input id="new-h" type="number" min="3" max="18" value="' + H + '">';
      var actions = el('modal-actions');
      actions.innerHTML = '';
      addModalBtn(actions, 'Resize', 'btn-primary', function () {
        var w = parseInt(el('new-w').value, 10), h = parseInt(el('new-h').value, 10);
        if (newSize(w, h)) { fitCanvas(); closeModal(); }
        else setStatus('❌ Size must be between 3×3 and 24×18.');
      });
      addModalBtn(actions, 'Cancel', 'btn-ghost', closeModal);
      openModal();
    };
    el('btn-editor-back').onclick = function () { if (callbacks.onBack) callbacks.onBack(); };
    global.addEventListener('resize', function () { if (running) fitCanvas(); });
  }

  var Editor = {
    start: start,
    stop: stop,
    bind: bind,
    fitCanvas: fitCanvas,
    setCallbacks: function (cb) { callbacks = cb; },
    loadFromJSON: loadFromJSON,
    toLevel: toLevel,
  };

  global.Editor = Editor;
  if (typeof module !== 'undefined' && module.exports) module.exports = Editor;
})(typeof window !== 'undefined' ? window : globalThis);
