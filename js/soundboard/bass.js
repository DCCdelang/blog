// A small monophonic bass synth with a 16 step sequencer.
//
// Signal chain per note:
//   oscillator + sub oscillator -> waveshaper (drive) -> lowpass -> amp -> master
//
// Notes on keeping this light for the browser:
//   * one shared AudioContext (see audio.js), one master gain built once
//   * the waveshaper curve is recalculated only when the drive control moves
//   * the ~5 nodes per note are collected by the browser once the note has
//     stopped, so nothing accumulates while the sequencer runs
//   * the sequencer schedules ahead on a 25ms timer instead of doing audio work
//     every frame, and requestAnimationFrame runs only while it is playing
//   * the 240 sequencer cells share a single delegated click listener
(function () {
  const STEPS = 16;
  // The grid starts at C2 (65Hz) rather than C1. That puts the fundamental in
  // the part of the range speakers actually reproduce, and leaves the sub
  // oscillator an octave below at C1 (33Hz) where it is still audible. Starting
  // at C1 would have put the sub at 16Hz, below hearing, wasting headroom.
  const LOWEST_MIDI = 36;   // C2
  const NOTE_ROWS = 13;     // C2 up to C3 inclusive
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // Scheduler: look this far ahead, and wake up this often to do it.
  const LOOKAHEAD_S = 0.12;
  const TIMER_MS = 25;

  const params = {
    wave: 'sawtooth',
    sub: 0.4,          // level of the sine one octave below
    octave: 0,         // transpose the whole grid
    glide: 60,         // ms, only used on steps marked as a slide
    cutoff: 500,       // Hz, where the filter sits once the envelope has closed
    resonance: 8,      // filter Q, the honk
    envAmount: 2.5,    // octaves the filter envelope opens by
    envDecay: 180,     // ms for the filter to close again
    attack: 5,         // ms
    decay: 180,        // ms
    sustain: 0.35,     // 0..1
    release: 90,       // ms
    drive: 0.25,       // 0..1 distortion
    level: 0.7,        // master volume
    bpm: 120,
    gate: 55,          // % of a step that the note is held for
    swing: 0           // % that every other 16th is pushed late
  };

  // Each step holds a note row (null when the step is silent) plus the two
  // performance toggles.
  const pattern = [];
  for (let i = 0; i < STEPS; i++) {
    pattern.push({ row: null, accent: false, slide: false });
  }

  // A default line so the panel makes a sound the moment you press play.
  // Values are semitones above C1; null is a rest.
  const DEFAULT_LINE = [0, null, 0, 12, null, 0, null, 3, 0, null, 7, null, 0, null, 10, 3];
  DEFAULT_LINE.forEach((semitone, step) => {
    pattern[step].row = semitone === null ? null : NOTE_ROWS - 1 - semitone;
  });
  [0, 3, 10].forEach(step => { pattern[step].accent = true; });
  [3, 15].forEach(step => { pattern[step].slide = true; });

  // ---------------------------------------------------------------- audio ---

  let master = null;

  function getMaster(ctx) {
    if (master === null) {
      master = ctx.createGain();
      master.gain.value = params.level;
      master.connect(ctx.destination);
    }
    return master;
  }

  // Soft clipping curve. At drive 0 this is exactly y = x, so the voice is
  // clean; as drive rises the peaks are squashed and harmonics appear.
  // Cached because building the table on every note would be wasteful.
  let cachedDrive = -1;
  let cachedCurve = null;

  function driveCurve(amount) {
    if (amount === cachedDrive) return cachedCurve;
    const n = 1024; // a small table is plenty at these frequencies
    const curve = new Float32Array(n);
    const k = amount * 100;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    cachedDrive = amount;
    cachedCurve = curve;
    return curve;
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Either jump straight to the note or slide into it from the previous one.
  function setPitch(frequencyParam, target, from, time) {
    if (from === null) {
      frequencyParam.setValueAtTime(target, time);
      return;
    }
    frequencyParam.setValueAtTime(from, time);
    frequencyParam.exponentialRampToValueAtTime(target, time + params.glide / 1000);
  }

  let lastFreq = null; // where a slide starts from

  function playNote(midi, time, gateSeconds, accent, slide) {
    const ctx = window.SharedAudio.get();
    const out = getMaster(ctx);
    const freq = midiToFreq(midi);
    const from = (slide && lastFreq !== null) ? lastFreq : null;
    lastFreq = freq;

    // Distortion sums both oscillators before shaping them, which is what
    // gives the growl rather than two separately clipped tones.
    const shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(params.drive);
    shaper.oversample = '2x'; // cheap insurance against aliasing

    const osc = ctx.createOscillator();
    osc.type = params.wave;
    setPitch(osc.frequency, freq, from, time);

    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.7;
    osc.connect(oscGain);
    oscGain.connect(shaper);

    let sub = null;
    if (params.sub > 0.001) {
      sub = ctx.createOscillator();
      sub.type = 'sine';
      setPitch(sub.frequency, freq / 2, from === null ? null : from / 2, time);
      const subGain = ctx.createGain();
      subGain.gain.value = params.sub;
      sub.connect(subGain);
      subGain.connect(shaper);
    }

    // Filter envelope: snap open, then close down to the cutoff setting.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = params.resonance * (accent ? 1.3 : 1);
    const base = Math.max(params.cutoff, 40);
    const ceiling = ctx.sampleRate / 2 * 0.9; // stay below Nyquist
    const open = Math.min(base * Math.pow(2, params.envAmount * (accent ? 1.25 : 1)), ceiling);
    filter.frequency.setValueAtTime(open, time);
    filter.frequency.exponentialRampToValueAtTime(base, time + params.envDecay / 1000);

    // Amp envelope. Attack and decay are squeezed to fit inside the gate when
    // the gate is short, otherwise the release would be scheduled in the middle
    // of a ramp and the level would jump.
    const amp = ctx.createGain();
    let attack = params.attack / 1000;
    let decay = params.decay / 1000;
    const release = params.release / 1000;
    if (attack + decay > gateSeconds) {
      const squeeze = gateSeconds / (attack + decay);
      attack *= squeeze;
      decay *= squeeze;
    }
    const peak = (accent ? 1 : 0.7) * 0.6;
    const sustain = peak * params.sustain;
    amp.gain.setValueAtTime(0, time);
    amp.gain.linearRampToValueAtTime(peak, time + attack);
    amp.gain.linearRampToValueAtTime(sustain, time + attack + decay);
    amp.gain.setValueAtTime(sustain, time + gateSeconds);
    amp.gain.linearRampToValueAtTime(0, time + gateSeconds + release);

    shaper.connect(filter);
    filter.connect(amp);
    amp.connect(out);

    const stopAt = time + gateSeconds + release + 0.02;
    osc.start(time);
    osc.stop(stopAt);
    if (sub) {
      sub.start(time);
      sub.stop(stopAt);
    }
  }

  // ------------------------------------------------------------ sequencer ---

  let isPlaying = false;
  let currentStep = 0;
  let nextStepTime = 0;
  let timerId = null;
  const drawQueue = []; // {step, time} handed to the playhead

  function stepSeconds() {
    return (60 / params.bpm) / 4; // sixteenth notes
  }

  function scheduleStep(step, time) {
    const duration = stepSeconds();
    // Swing pushes every second sixteenth later, which is the whole groove.
    const offset = (step % 2 === 1) ? (params.swing / 100) * duration * 0.5 : 0;
    const noteTime = time + offset;

    drawQueue.push({ step: step, time: noteTime });

    const slot = pattern[step];
    if (slot.row === null) {
      lastFreq = null; // a rest breaks the slide chain
      return;
    }
    const semitone = NOTE_ROWS - 1 - slot.row;
    const midi = LOWEST_MIDI + semitone + params.octave * 12;
    const gate = Math.max(0.02, duration * (params.gate / 100));
    playNote(midi, noteTime, gate, slot.accent, slot.slide);
  }

  function scheduler() {
    const ctx = window.SharedAudio.get();
    while (nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      scheduleStep(currentStep, nextStepTime);
      nextStepTime += stepSeconds();
      currentStep = (currentStep + 1) % STEPS;
    }
  }

  function start() {
    if (isPlaying) return;
    const ctx = window.SharedAudio.get();
    isPlaying = true;
    currentStep = 0;
    lastFreq = null;
    nextStepTime = ctx.currentTime + 0.05;
    timerId = window.setInterval(scheduler, TIMER_MS);
    scheduler();
    window.requestAnimationFrame(drawPlayhead);
    playButton.textContent = 'Stop';
    playButton.classList.add('playing');
  }

  function stop() {
    if (!isPlaying) return;
    isPlaying = false;
    window.clearInterval(timerId);
    timerId = null;
    drawQueue.length = 0;
    lastFreq = null;
    clearPlayhead();
    playButton.textContent = 'Play';
    playButton.classList.remove('playing');
  }

  // ------------------------------------------------------------------- UI ---

  const columns = []; // {element, noteCells[], accentCell, slideCell}
  let playButton = null;
  let playingColumn = null;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function noteLabel(row) {
    const semitone = NOTE_ROWS - 1 - row;
    const midi = LOWEST_MIDI + semitone;
    return NOTE_NAMES[midi % 12] + Math.floor(midi / 12 - 1);
  }

  // The playhead is driven off the audio clock, not the timer, so the highlight
  // lines up with what you hear.
  function drawPlayhead() {
    if (!isPlaying) return;
    const now = window.SharedAudio.get().currentTime;
    while (drawQueue.length && drawQueue[0].time <= now) {
      highlight(drawQueue.shift().step);
    }
    window.requestAnimationFrame(drawPlayhead);
  }

  function highlight(step) {
    const next = columns[step].element;
    if (next === playingColumn) return;
    if (playingColumn) playingColumn.classList.remove('playing');
    next.classList.add('playing');
    playingColumn = next;
  }

  function clearPlayhead() {
    if (playingColumn) playingColumn.classList.remove('playing');
    playingColumn = null;
  }

  function renderColumn(step) {
    const slot = pattern[step];
    const column = columns[step];
    column.noteCells.forEach((cell, row) => {
      cell.classList.toggle('on', slot.row === row);
    });
    column.accentCell.classList.toggle('on', slot.accent);
    column.slideCell.classList.toggle('on', slot.slide);
  }

  function buildControls(parent) {
    const groups = [
      { name: 'Oscillator', items: [
        { key: 'wave', label: 'Wave', options: ['sawtooth', 'square', 'triangle', 'sine'] },
        { key: 'sub', label: 'Sub', min: 0, max: 1, step: 0.01 },
        // Only one octave down: any lower and the fundamental drops out of range.
        { key: 'octave', label: 'Octave', min: -1, max: 2, step: 1 },
        { key: 'glide', label: 'Glide', min: 0, max: 300, step: 5, unit: 'ms' }
      ]},
      { name: 'Filter', items: [
        { key: 'cutoff', label: 'Cutoff', min: 60, max: 4000, step: 10, unit: 'Hz' },
        { key: 'resonance', label: 'Reso', min: 0.5, max: 20, step: 0.5 },
        { key: 'envAmount', label: 'Env amt', min: 0, max: 5, step: 0.1, unit: 'oct' },
        { key: 'envDecay', label: 'Env dec', min: 20, max: 800, step: 10, unit: 'ms' }
      ]},
      { name: 'Amp envelope', items: [
        { key: 'attack', label: 'Attack', min: 0, max: 200, step: 1, unit: 'ms' },
        { key: 'decay', label: 'Decay', min: 10, max: 600, step: 5, unit: 'ms' },
        { key: 'sustain', label: 'Sustain', min: 0, max: 1, step: 0.01 },
        { key: 'release', label: 'Release', min: 10, max: 600, step: 5, unit: 'ms' }
      ]},
      { name: 'Drive', items: [
        { key: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01 },
        { key: 'level', label: 'Level', min: 0, max: 1, step: 0.01 }
      ]},
      { name: 'Timing', items: [
        { key: 'bpm', label: 'Tempo', min: 60, max: 200, step: 1, unit: 'BPM' },
        { key: 'gate', label: 'Gate', min: 5, max: 100, step: 1, unit: '%' },
        { key: 'swing', label: 'Swing', min: 0, max: 75, step: 1, unit: '%' }
      ]}
    ];

    const rack = el('div', 'rack');
    groups.forEach(group => {
      const box = el('div', 'group');
      box.appendChild(el('h3', null, group.name));
      group.items.forEach(item => {
        box.appendChild(item.options ? buildSelect(item) : buildSlider(item));
      });
      rack.appendChild(box);
    });
    parent.appendChild(rack);
  }

  function buildSelect(item) {
    const row = el('label', 'control');
    row.appendChild(el('span', 'name', item.label));
    const select = el('select');
    item.options.forEach(option => {
      const node = el('option', null, option);
      node.value = option;
      select.appendChild(node);
    });
    select.value = params[item.key];
    select.addEventListener('change', () => { params[item.key] = select.value; });
    row.appendChild(select);
    return row;
  }

  function buildSlider(item) {
    const row = el('label', 'control');
    row.appendChild(el('span', 'name', item.label));
    const input = el('input');
    input.type = 'range';
    input.min = item.min;
    input.max = item.max;
    input.step = item.step;
    input.value = params[item.key];
    const readout = el('span', 'value');

    function show() {
      const value = parseFloat(input.value);
      readout.textContent = value + (item.unit ? ' ' + item.unit : '');
      params[item.key] = value;
      // The master gain is live, so ramp it instead of stepping it.
      if (item.key === 'level' && master) {
        const ctx = window.SharedAudio.get();
        master.gain.setTargetAtTime(value, ctx.currentTime, 0.01);
      }
    }

    show();
    input.addEventListener('input', show);
    row.appendChild(input);
    row.appendChild(readout);
    return row;
  }

  function buildSequencer(parent) {
    const grid = el('div', 'seq');

    // Row labels down the left hand side.
    const labels = el('div', 'seq-labels');
    for (let row = 0; row < NOTE_ROWS; row++) {
      labels.appendChild(el('div', 'seq-label', noteLabel(row)));
    }
    // 'gap' matches the margin on the accent cells, keeping the rows aligned.
    labels.appendChild(el('div', 'seq-label gap', 'acc'));
    labels.appendChild(el('div', 'seq-label', 'sld'));
    grid.appendChild(labels);

    // One element per step, so moving the playhead is a single class change.
    const cols = el('div', 'seq-cols');
    for (let step = 0; step < STEPS; step++) {
      const column = el('div', 'seq-col');
      const noteCells = [];
      for (let row = 0; row < NOTE_ROWS; row++) {
        const cell = el('div', 'cell note');
        cell.dataset.step = step;
        cell.dataset.row = row;
        cell.dataset.kind = 'note';
        column.appendChild(cell);
        noteCells.push(cell);
      }
      const accentCell = el('div', 'cell accent');
      accentCell.dataset.step = step;
      accentCell.dataset.kind = 'accent';
      const slideCell = el('div', 'cell slide');
      slideCell.dataset.step = step;
      slideCell.dataset.kind = 'slide';
      column.appendChild(accentCell);
      column.appendChild(slideCell);

      cols.appendChild(column);
      columns.push({ element: column, noteCells: noteCells, accentCell: accentCell, slideCell: slideCell });
    }
    grid.appendChild(cols);

    // One listener for every cell rather than 240 of them.
    cols.addEventListener('click', event => {
      const cell = event.target;
      if (!cell.dataset || !cell.dataset.kind) return;
      const step = parseInt(cell.dataset.step, 10);
      const slot = pattern[step];
      if (cell.dataset.kind === 'accent') {
        slot.accent = !slot.accent;
      } else if (cell.dataset.kind === 'slide') {
        slot.slide = !slot.slide;
      } else {
        const row = parseInt(cell.dataset.row, 10);
        slot.row = (slot.row === row) ? null : row; // clicking again clears it
      }
      renderColumn(step);
    });

    parent.appendChild(grid);
    for (let step = 0; step < STEPS; step++) renderColumn(step);
  }

  function buildTransport(parent) {
    const bar = el('div', 'transport');

    playButton = el('button', 'transport-button', 'Play');
    playButton.addEventListener('click', () => { isPlaying ? stop() : start(); });
    bar.appendChild(playButton);

    const randomise = el('button', 'transport-button', 'Random');
    randomise.addEventListener('click', () => {
      // Root notes and fifths land on the beat more often, which keeps the
      // random patterns musical rather than arbitrary.
      const scale = [0, 3, 5, 7, 10, 12];
      for (let step = 0; step < STEPS; step++) {
        const slot = pattern[step];
        const play = (step % 4 === 0) ? true : Math.random() < 0.55;
        if (!play) {
          slot.row = null;
        } else {
          const semitone = (step % 4 === 0 && Math.random() < 0.6)
            ? 0
            : scale[Math.floor(Math.random() * scale.length)];
          slot.row = NOTE_ROWS - 1 - semitone;
        }
        slot.accent = Math.random() < 0.25;
        slot.slide = Math.random() < 0.2;
        renderColumn(step);
      }
    });
    bar.appendChild(randomise);

    const clear = el('button', 'transport-button', 'Clear');
    clear.addEventListener('click', () => {
      pattern.forEach((slot, step) => {
        slot.row = null;
        slot.accent = false;
        slot.slide = false;
        renderColumn(step);
      });
    });
    bar.appendChild(clear);

    parent.appendChild(bar);
  }

  const host = document.getElementById('bass') || document.body;
  const panel = el('div', 'bass-panel');
  buildTransport(panel);
  buildSequencer(panel);
  buildControls(panel);
  host.appendChild(panel);

  // Stop the sequencer if the tab is hidden, so it does not keep a timer and an
  // audio thread busy in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });
})();
