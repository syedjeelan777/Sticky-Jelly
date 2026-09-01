/*
 * Sticky-Jelly — procedural audio (WebAudio, no asset files).
 *
 * All sound effects and the ambient music loop are synthesized on the fly so
 * the game ships with zero audio assets. Audio is unlocked on the first user
 * gesture (browser autoplay policy).
 */
(function (global) {
  'use strict';

  var ctx = null;
  var master = null;
  var musicGain = null;
  var sfxGain = null;
  var enabled = true;
  var musicOn = true;
  var musicTimer = null;
  var nextNoteTime = 0;
  var noteIndex = 0;

  function ensureCtx() {
    if (ctx) return true;
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);

      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(master);

      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.7;
      sfxGain.connect(master);
      return true;
    } catch (e) {
      return false;
    }
  }

  function unlock() {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended') ctx.resume();
  }

  function setEnabled(v) {
    enabled = v;
    if (master) master.gain.value = v ? 0.9 : 0;
  }

  function setMusicOn(v) {
    musicOn = v;
    if (musicGain) musicGain.gain.value = v ? 0.16 : 0;
  }

  /* ---------------- SFX ---------------- */
  function tone(freq, dur, type, vol, when, slideTo) {
    if (!ctx || !enabled) return;
    var t0 = when || ctx.currentTime;
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  function noise(dur, vol, filterFreq, when) {
    if (!ctx || !enabled) return;
    var t0 = when || ctx.currentTime;
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq || 800;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    src.start(t0);
  }

  var SFX = {
    move: function () { tone(210, 0.09, 'triangle', 0.22, null, 140); },
    squish: function () { noise(0.16, 0.5, 520); tone(160, 0.12, 'sine', 0.3, null, 80); },
    slide: function () { noise(0.24, 0.28, 1200); },
    select: function () { tone(520, 0.07, 'sine', 0.18, null, 700); },
    win: function () {
      var seq = [523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < seq.length; i++) tone(seq[i], 0.32, 'triangle', 0.26, ctx ? ctx.currentTime + i * 0.1 : 0);
    },
    fail: function () { tone(220, 0.3, 'sawtooth', 0.2, null, 90); },
    fire: function () { noise(0.3, 0.4, 2500); noise(0.2, 0.3, 1500, ctx ? ctx.currentTime + 0.05 : 0); },
    gate: function () { tone(330, 0.1, 'square', 0.12, null, 440); },
    place: function () { tone(430, 0.05, 'sine', 0.14, null, 380); },
    erase: function () { tone(300, 0.05, 'sine', 0.12, null, 200); },
    error: function () { tone(180, 0.14, 'square', 0.14, null, 120); },
    unlock: function () { tone(392, 0.18, 'triangle', 0.2, null, 587); },
  };

  /* ---------------- Ambient music (soft pentatonic arpeggio) ---------------- */
  var SCALE = [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25]; // A minor pentatonic
  var STEP = 0.34; // seconds between notes

  function scheduleNote() {
    if (!ctx || !musicOn || !enabled) return;
    while (nextNoteTime < ctx.currentTime + 0.5) {
      var i = noteIndex % SCALE.length;
      var f = SCALE[i] * (noteIndex % 24 === 0 ? 0.5 : 1);
      // Soft pluck
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0.0001, nextNoteTime);
      g.gain.exponentialRampToValueAtTime(0.5, nextNoteTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, nextNoteTime + 1.1);
      osc.connect(g); g.connect(musicGain);
      osc.start(nextNoteTime); osc.stop(nextNoteTime + 1.2);
      // A low drone every 8 notes
      if (noteIndex % 8 === 0) {
        var d = ctx.createOscillator();
        var dg = ctx.createGain();
        d.type = 'sine';
        d.frequency.value = 110;
        dg.gain.setValueAtTime(0.0001, nextNoteTime);
        dg.gain.exponentialRampToValueAtTime(0.35, nextNoteTime + 0.4);
        dg.gain.exponentialRampToValueAtTime(0.0001, nextNoteTime + 2.6);
        d.connect(dg); dg.connect(musicGain);
        d.start(nextNoteTime); d.stop(nextNoteTime + 2.8);
      }
      noteIndex = (noteIndex + 1) % 64;
      nextNoteTime += STEP;
    }
  }

  function startMusic() {
    if (!ensureCtx()) return;
    if (musicTimer) return;
    nextNoteTime = ctx.currentTime + 0.1;
    noteIndex = 0;
    musicTimer = setInterval(scheduleNote, 120);
  }

  var AudioSys = {
    unlock: unlock,
    setEnabled: setEnabled,
    setMusicOn: setMusicOn,
    isEnabled: function () { return enabled; },
    isMusicOn: function () { return musicOn; },
    sfx: SFX,
    startMusic: startMusic,
  };

  global.AudioSys = AudioSys;
  if (typeof module !== 'undefined' && module.exports) module.exports = AudioSys;
})(typeof window !== 'undefined' ? window : globalThis);
