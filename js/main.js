/*
 * Sticky-Jelly — application shell.
 *
 * Screen routing (overworld / game / editor), progress persistence
 * (localStorage), overworld rendering, unlock logic and settings.
 */
(function (global) {
  'use strict';

  var LEVELS = global.JELLY_LEVELS;
  var STORE_KEY = 'stickyjelly.v1';

  function el(id) { return document.getElementById(id); }

  /* ---------------- persistence ---------------- */
  function loadStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { solved: {}, custom: [], settings: { colorblind: false } };
  }

  var store = loadStore();

  function saveStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ }
  }

  var Progress = {
    solved: store.solved,
    custom: store.custom,
    settings: store.settings,
    complete: function (id, moves) {
      var prev = store.solved[id];
      store.solved[id] = {
        moves: moves,
        best: prev ? Math.min(prev.best, moves) : moves,
      };
      saveStore();
    },
    bestFor: function (id) {
      return store.solved[id] ? store.solved[id].best : null;
    },
    isSolved: function (id) { return !!store.solved[id]; },
    worldSolved: function (world) {
      var n = 0;
      for (var i = 0; i < world.levels.length; i++) if (store.solved[world.levels[i].id]) n++;
      return n;
    },
    totalSolved: function () {
      var n = 0;
      LEVELS.forEach(function (w) {
        w.levels.forEach(function (l) { if (store.solved[l.id]) n++; });
      });
      return n;
    },
    totalLevels: function () {
      var n = 0;
      LEVELS.forEach(function (w) { n += w.levels.length; });
      return n;
    },
    addCustom: function (lvl) {
      store.custom.push(lvl);
      saveStore();
    },
    removeCustom: function (index) {
      store.custom.splice(index, 1);
      saveStore();
    },
    customCount: function () { return store.custom.length; },
  };

  global.Progress = Progress;

  /* ---------------- screen routing ---------------- */
  var returnToEditor = false;

  function showScreen(name) {
    ['overworld', 'game', 'editor'].forEach(function (s) {
      el('screen-' + s).classList.toggle('hidden', s !== name);
    });
    if (name !== 'game') Game.stop();
    if (name !== 'editor') Editor.stop();
    if (name === 'overworld') renderOverworld();
    if (name === 'editor') { Editor.start(); }
    if (name === 'game') { /* Game.start already called by caller */ }
  }

  /* ---------------- overworld ---------------- */
  function renderOverworld() {
    el('overworld-progress').textContent =
      '🍮 ' + Progress.totalSolved() + ' / ' + Progress.totalLevels() + ' solved';

    var worldsBox = el('worlds');
    worldsBox.innerHTML = '';

    LEVELS.forEach(function (world, wi) {
      var unlocked = isWorldUnlocked(wi);
      var card = document.createElement('div');
      card.className = 'world-card' + (unlocked ? '' : ' locked');

      var head = document.createElement('div');
      head.className = 'world-head';
      var solvedCount = Progress.worldSolved(world);
      head.innerHTML =
        '<span class="world-emoji">' + world.emoji + '</span>' +
        '<span class="world-name">' + world.name + (world.secret ? ' 🔒' : '') + '</span>' +
        '<span class="world-count">' + solvedCount + '/' + world.levels.length + '</span>';
      card.appendChild(head);

      var grid = document.createElement('div');
      grid.className = 'level-grid';
      world.levels.forEach(function (lvl) {
        var b = document.createElement('button');
        b.className = 'level-btn';
        b.textContent = world.levels.indexOf(lvl) + 1;
        if (Progress.isSolved(lvl.id)) {
          b.classList.add('solved');
          var s = document.createElement('span');
          s.className = 'star'; s.textContent = '★';
          b.appendChild(s);
        }
        if (!unlocked) {
          b.disabled = true;
          b.textContent = '🔒';
        } else {
          b.classList.add('available');
          if (lvl.par) b.setAttribute('data-par', 'par ' + lvl.par);
          b.onclick = function () { playLevel(world, lvl, false); };
        }
        grid.appendChild(b);
      });
      card.appendChild(grid);
      worldsBox.appendChild(card);
    });

    renderCustomLevels();
  }

  function isWorldUnlocked(index) {
    if (index === 0) return true;
    var world = LEVELS[index];
    if (world.secret) {
      // secret world needs 100% of every non-secret world
      return LEVELS.filter(function (w) { return !w.secret; }).every(function (w) {
        return Progress.worldSolved(w) === w.levels.length;
      });
    }
    var prev = LEVELS[index - 1];
    return Progress.worldSolved(prev) >= Math.ceil(prev.levels.length * 0.6);
  }

  function renderCustomLevels() {
    var box = el('custom-levels');
    box.innerHTML = '';
    if (!Progress.custom.length) {
      box.innerHTML = '<p class="empty-hint">No custom levels yet — open the editor to build one.</p>';
      return;
    }
    Progress.custom.forEach(function (lvl, i) {
      var pill = document.createElement('div');
      pill.className = 'custom-pill';
      var name = document.createElement('span');
      name.textContent = '🧪 ' + (lvl.title || 'Custom ' + (i + 1));
      pill.appendChild(name);
      var del = document.createElement('span');
      del.textContent = '✕';
      del.style.color = 'var(--text-mute)';
      del.style.cursor = 'pointer';
      del.title = 'Delete';
      del.onclick = function (e) {
        e.stopPropagation();
        Progress.removeCustom(i);
        renderCustomLevels();
      };
      pill.appendChild(del);
      pill.onclick = function () {
        playLevel({ emoji: '🧪', name: 'Custom', theme: '#6ee7b7' }, lvl, false);
      };
      box.appendChild(pill);
    });
  }

  /* ---------------- starting a game ---------------- */
  function playLevel(world, lvl, fromEditor) {
    returnToEditor = fromEditor;
    Game.setCallbacks({
      onWin: function () { showScreen(returnToEditor ? 'editor' : 'overworld'); },
      onFail: null,
      onNext: function () {
        if (returnToEditor) { showScreen('editor'); return; }
        if (!Array.isArray(world.levels)) { showScreen('overworld'); return; }
        var idx = world.levels.indexOf(lvl);
        if (idx >= 0 && idx + 1 < world.levels.length) playLevel(world, world.levels[idx + 1], false);
        else showScreen('overworld');
      },
      onBack: function () { showScreen(returnToEditor ? 'editor' : 'overworld'); },
    });
    showScreen('game');
    Game.start(lvl, world);
  }

  /* ---------------- settings ---------------- */
  function updateMuteIcon() {
    var on = AudioSys.isEnabled();
    ['btn-mute', 'btn-game-mute'].forEach(function (id) {
      var b = el(id);
      if (b) b.textContent = on ? '🔊' : '🔇';
    });
  }

  global.mainToggleMute = function () {
    AudioSys.setEnabled(!AudioSys.isEnabled());
    updateMuteIcon();
  };

  function toggleColorblind() {
    Progress.settings.colorblind = !Progress.settings.colorblind;
    saveStore();
    var b = el('btn-colorblind');
    b.classList.toggle('active', Progress.settings.colorblind);
  }

  /* ---------------- share links ---------------- */
  function handleShareLink() {
    var h = location.hash;
    if (h && h.indexOf('#level=') === 0) {
      try {
        var b64 = h.slice(7);
        var json = decodeURIComponent(escape(atob(b64)));
        var lvl = JSON.parse(json);
        showScreen('editor');
        Editor.loadFromJSON(JSON.stringify(lvl));
        location.hash = '';
        return true;
      } catch (e) {
        location.hash = '';
      }
    }
    return false;
  }

  /* ---------------- boot ---------------- */
  function boot() {
    Game.bind();
    Editor.bind();
    Editor.setCallbacks({
      onBack: function () { showScreen('overworld'); },
      onPlay: function (lvl) {
        playLevel({ emoji: '🧪', name: 'Playtest', theme: '#6ee7b7' }, lvl, true);
      },
    });

    el('btn-open-editor').onclick = function () { showScreen('editor'); };
    el('btn-mute').onclick = global.mainToggleMute;
    el('btn-colorblind').onclick = toggleColorblind;

    // first-gesture audio unlock
    function unlockAudio() {
      AudioSys.unlock();
      if (AudioSys.isEnabled() && AudioSys.isMusicOn()) AudioSys.startMusic();
    }
    global.addEventListener('pointerdown', unlockAudio, { once: false });
    global.addEventListener('keydown', unlockAudio);

    el('btn-colorblind').classList.toggle('active', !!Progress.settings.colorblind);

    if (!handleShareLink()) showScreen('overworld');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
