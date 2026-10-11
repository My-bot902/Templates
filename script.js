/* ==========================================================================
   AZARATH METRION ZINTHOS — script.js

   Flow:  idle ──(hover / click)──► charging ──(audio ends)──► climax ──► done
                ▲                                                       │
                └───────────────(hover / click "Cast again")────────────┘

   While "charging", the audio's playback progress (0..1) drives:
     • ring rotation speed, glow (--power), shake strength
     • how many energy particles spiral into the centre
     • which word of the incantation is lit
   ========================================================================== */
(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     CONFIG — tweak the feel here
     ------------------------------------------------------------------------ */
  const CONFIG = {
    climaxLead: 0,      // 0 = fire ONLY on the audio 'ended' event (exact end).
    // If spell.m4a has trailing silence, set e.g. 0.15 to fire that many
    // seconds early (uses a per-frame look-ahead).
    fallbackDuration: 2.0,    // seconds to simulate if the audio file cannot play (matches your 2s clip)
    settleMs: 7200,   // ms until the climax is "done" and Cast again appears
    chargeShakePx: 7,      // max shake while charging
    climaxShakePx: 34,     // initial shake at the climax (decays)
    chargeRate: 420,    // energy particles per second at full power
    maxParticles: 1800,   // comma added here properly

    // One of these is picked at random when the spell ends
    afterSpellSounds: [
      // 'sound effect after spell(1).mp3',
      'sound effect after spell(2).mp3'
    ],
    afterSpellVolume: 1       // 0..1
  };






  /* ------------------------------------------------------------------------
     DOM + helpers
     ------------------------------------------------------------------------ */
  const $ = (sel) => document.querySelector(sel);
  const els = {
    audio: $('#spell'),
    btn: $('#castBtn'),
    label: $('#castLabel'),
    hint: $('#hint'),
    sigil: $('#sigil'),
    world: $('#world'),
    canvas: $('#fx'),
    stars: $('#stars'),
    words: [...document.querySelectorAll('.incantation .word')],
    ringOuter: $('#ringOuter'),
    ringMid: $('#ringMid'),
    ringInner: $('#ringInner'),
    core: $('#core'),
  };

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* ------------------------------------------------------------------------
     AFTER-SPELL SOUND EFFECTS — preloaded so they start instantly at the climax
     ------------------------------------------------------------------------ */
  const sfx = CONFIG.afterSpellSounds.map((file) => {
    const a = new Audio(encodeURI(file));   // handles the spaces in the filenames
    a.preload = 'auto';
    a.volume = CONFIG.afterSpellVolume;
    return a;
  });

  function playRandomSfx() {
    if (!sfx.length) return;
    const a = sfx[Math.floor(Math.random() * sfx.length)];
    try { a.currentTime = 0; } catch (_) { /* metadata not ready */ }
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* blocked or missing file: stay silent, keep the visuals */ });
  }

  function stopSfx() {
    sfx.forEach((a) => {
      a.pause();
      try { a.currentTime = 0; } catch (_) { }
    });
  }

  /* Safari/iOS only allow an Audio element to play later if it was "touched" during a real
     click/tap. Prime both once, silently, on the first interaction. */
  let sfxPrimed = false;
  function primeSfx() {
    if (sfxPrimed) return;
    sfxPrimed = true;
    sfx.forEach((a) => {
      a.muted = true;
      const p = a.play();
      const done = () => { a.pause(); a.currentTime = 0; a.muted = false; };
      if (p && p.then) p.then(done).catch(() => { a.muted = false; });
      else done();
    });
  }
  /* ------------------------------------------------------------------------
     SIGIL GENERATION — ticks, runes, hexagram, pentagram (SVG, origin = centre)
     ------------------------------------------------------------------------ */
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const RUNES = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';

  const svgEl = (tag, attrs, parent) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    parent.appendChild(n);
    return n;
  };
  const polar = (r, deg) => {
    const a = (deg * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  };

  function buildSigil() {
    const g = (id) => document.getElementById(id);

    // 72 tick marks, every 6th one longer
    for (let i = 0; i < 72; i++) {
      const long = i % 6 === 0;
      const [x1, y1] = polar(long ? 272 : 276, i * 5);
      const [x2, y2] = polar(286, i * 5);
      svgEl('line', { x1, y1, x2, y2, class: long ? 'tick tick-long' : 'tick' }, g('ticks'));
    }

    // Runes spaced around the outer band
    [...RUNES].forEach((ch, i, arr) => {
      const t = svgEl('text', {
        class: 'rune',
        transform: `rotate(${(i * 360) / arr.length}) translate(0 -236)`,
      }, g('runes'));
      t.textContent = ch;
    });

    // Hexagram: two opposed triangles
    const tri = (offset) => [0, 1, 2]
      .map((k) => polar(212, offset + k * 120).map((n) => n.toFixed(2)).join(','))
      .join(' ');
    svgEl('polygon', { points: tri(-90) }, g('hexagram'));
    svgEl('polygon', { points: tri(90) }, g('hexagram'));

    // Pentagram + node orbs on each vertex
    const verts = [0, 1, 2, 3, 4].map((k) => polar(140, -90 + k * 72));
    const order = [0, 2, 4, 1, 3];
    svgEl('polygon', {
      points: order.map((i) => verts[i].map((n) => n.toFixed(2)).join(',')).join(' '),
    }, g('pentagram'));
    verts.forEach(([cx, cy]) => svgEl('circle', { cx, cy, r: 9, class: 'node' }, g('pentaNodes')));
  }

  /* Stars for the cosmic dimension: one element, many box-shadows */
  function buildStars() {
    const shadows = [];
    for (let i = 0; i < 160; i++) {
      shadows.push(
        `${rand(0, 100).toFixed(2)}vw ${rand(0, 100).toFixed(2)}vh 0 ${Math.random() < 0.2 ? 1 : 0}px ` +
        `rgba(233,213,255,${rand(0.3, 1).toFixed(2)})`
      );
    }
    els.stars.style.boxShadow = shadows.join(',');
  }

  /* ------------------------------------------------------------------------
     PARTICLE SYSTEM (canvas)
       kind 0 = energy spiralling inward   (charging)
       kind 1 = spark                      (explosion + falling shower)
       kind 2 = ambient mote               (always)
     ------------------------------------------------------------------------ */
  const fx = (() => {
    const canvas = els.canvas;
    const ctx = canvas.getContext('2d');
    const list = [];
    let w = 0, h = 0, cx = 0, cy = 0;
    let chargeAcc = 0, rainAcc = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      cx = w / 2;           // the sigil is dead-centre
      cy = h / 2;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawnCharge() {
      const maxR = Math.hypot(w, h) * 0.5;
      const rad = maxR * rand(0.55, 1);
      const ang = rand(0, TAU);
      list.push({
        k: 0, ang, rad, r0: rad,
        spd: rand(140, 300),
        swirl: rand(0.6, 1.6),
        size: rand(0.8, 2.2),
        hue: rand(255, 300),
        x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad,
        px: cx + Math.cos(ang) * rad, py: cy + Math.sin(ang) * rad,
      });
    }

    function burst(n) {
      for (let i = 0; i < n && list.length < CONFIG.maxParticles; i++) {
        const a = rand(0, TAU);
        const sp = 80 + Math.pow(Math.random(), 0.55) * 1150;   // many fast, some slow
        const life = rand(2.5, 6.5);                             // long life = slow fade
        list.push({
          k: 1, x: cx, y: cy,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          g: rand(30, 120), life, max: life,
          size: rand(1, 3.6),
          hue: rand(262, 305),
          l: Math.random() < 0.18 ? 88 : 62,   // some near-white hot sparks
        });
      }
    }

    function spawnRain() {
      const life = rand(4, 7);
      list.push({
        k: 1, x: rand(0, w), y: -10,
        vx: rand(-30, 30), vy: rand(40, 220),
        g: 60, life, max: life,
        size: rand(0.8, 2.4), hue: rand(262, 300), l: 66,
      });
    }

    function spawnMote(anywhere) {
      const life = rand(6, 12);
      list.push({
        k: 2, x: rand(0, w), y: anywhere ? rand(0, h) : h + 10,
        vx: rand(-8, 8), vy: -rand(6, 22),
        life, max: life, size: rand(0.6, 1.8), hue: rand(260, 290),
      });
    }

    function seedMotes() { for (let i = 0; i < 55; i++) spawnMote(true); }

    function update(dt, state, power, climaxT) {
      // --- Spawning ---
      if (state === 'charging') {
        chargeAcc += (40 + CONFIG.chargeRate * power) * dt;
        while (chargeAcc >= 1) {
          chargeAcc--;
          if (list.length < CONFIG.maxParticles) spawnCharge();
        }
      }
      if (state === 'climax' && climaxT < 3.6 && !reduceMotion) {
        rainAcc += 110 * dt;
        while (rainAcc >= 1) {
          rainAcc--;
          if (list.length < CONFIG.maxParticles) spawnRain();
        }
      }
      let motes = 0;
      for (const p of list) if (p.k === 2) motes++;
      if (motes < 55) spawnMote(false);

      // --- Update + draw ---
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';   // additive = glowing

      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];

        if (p.k === 0) {
          // Energy: spiral inward, accelerating with power
          p.px += (p.x - p.px) * 0.2;
          p.py += (p.y - p.py) * 0.2;
          p.rad -= p.spd * dt * (1 + power * 2.2);
          p.ang += p.swirl * dt * (260 / (p.rad + 90));
          p.x = cx + Math.cos(p.ang) * p.rad;
          p.y = cy + Math.sin(p.ang) * p.rad;
          if (p.rad < 18) { list[i] = list[list.length - 1]; list.pop(); continue; }

          const t = 1 - p.rad / p.r0;
          ctx.strokeStyle = `hsla(${p.hue},95%,${60 + t * 25}%,${clamp(0.15 + t, 0, 1) * 0.9})`;
          ctx.lineWidth = p.size * (1 + t);
          ctx.beginPath();
          ctx.moveTo(p.px, p.py);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();

        } else if (p.k === 1) {
          // Spark: drag + gravity, fades slowly (ease-out curve)
          const drag = Math.pow(0.985, dt * 60);
          p.vx *= drag; p.vy *= drag;
          p.vy += p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt;
          if (p.life <= 0) { list[i] = list[list.length - 1]; list.pop(); continue; }

          const a = Math.pow(p.life / p.max, 1.5);
          ctx.strokeStyle = `hsla(${p.hue},95%,${p.l}%,${a})`;
          ctx.lineWidth = p.size * (0.5 + a);
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.fillStyle = `hsla(${p.hue},95%,${p.l}%,${a * 0.18})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 3, 0, TAU);
          ctx.fill();

        } else {
          // Ambient mote
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt;
          if (p.life <= 0 || p.y < -10) { list[i] = list[list.length - 1]; list.pop(); continue; }
          const a = Math.sin(Math.PI * (p.life / p.max)) * 0.5;
          ctx.fillStyle = `hsla(${p.hue},90%,75%,${a})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    return { resize, burst, update, seedMotes };
  })();

  /* ------------------------------------------------------------------------
     STATE
     ------------------------------------------------------------------------ */
  let state = 'idle';           // 'idle' | 'charging' | 'climax' | 'done'
  let casting = false;          // lock: prevents double-triggering (hover + click)
  let audioBroken = false;      // true if spell.m4a failed to load
  let fallback = false;         // simulate the spell with a timer
  let fallbackStart = 0;
  let climaxStart = 0;
  let settleTimer = 0;
  let power = 0;                // smoothed 0..1 energy level
  let angOuter = 0, angMid = 0, angInner = 0;

  const body = document.body;

  function setHint(msg) { els.hint.textContent = msg || ''; }

  /* Random jitter on the whole world; amp = max pixels */
  function applyShake(amp) {
    els.world.style.transform = amp > 0.05
      ? `translate3d(${rand(-amp, amp).toFixed(2)}px, ${rand(-amp, amp).toFixed(2)}px, 0) rotate(${(rand(-amp, amp) * 0.04).toFixed(3)}deg)`
      : '';
  }

  /* ------------------------------------------------------------------------
     CASTING
     ------------------------------------------------------------------------ */
  async function cast() {
    if (casting) return;
    if (state === 'done') reset();
    if (state !== 'idle') return;

    casting = true;
    setHint('');

    if (audioBroken) { beginCharge(true); return; }

    try {
      els.audio.currentTime = 0;
      await els.audio.play();      // rejects if the browser blocks autoplay
      if (state === 'idle') beginCharge(false);   // 'playing' listener may already have done it
    } catch (err) {
      if (err && err.name === 'NotAllowedError') {
        // Browsers refuse sound until the visitor has clicked/tapped once.
        // Hover works automatically after that first interaction.
        casting = false;
        setHint('Your browser needs one click before it allows sound. Click “Cast Spell”.');
      } else {
        beginCharge(true);         // file missing / unsupported: still run the show
      }
    }
  }

  function beginCharge(useFallback) {
    fallback = useFallback;
    fallbackStart = performance.now();
    state = 'charging';
    body.classList.add('charging');
    els.btn.setAttribute('aria-disabled', 'true');
    els.label.textContent = 'Casting…';
    if (useFallback) setHint('spell.m4a could not be played, so a silent version is running.');
  }

  /* ------------------------------------------------------------------------
     CLIMAX — portal, flash, shockwaves and the soul-self are pure CSS keyframes
     triggered by body.climax; here we add the particles and the screen shake.
     ------------------------------------------------------------------------ */
  function climax() {
    if (state !== 'charging') return;
    state = 'climax';
    climaxStart = performance.now();
    power = 1;

    body.classList.remove('charging');
    body.classList.add('climax');
    els.words.forEach((w) => w.classList.add('lit'));
    playRandomSfx();
    // Everything below runs synchronously inside the 'ended' event, so the
    // explosion lands on the very same frame the sound stops.
    fx.burst(reduceMotion ? 220 : 620);
    if (!reduceMotion) applyShake(CONFIG.climaxShakePx);        // first violent jolt, no waiting for next frame
    setTimeout(() => fx.burst(reduceMotion ? 80 : 260), 120);   // quick second wave

    settleTimer = setTimeout(settle, CONFIG.settleMs);
  }

  function settle() {
    state = 'done';
    body.classList.add('done');
    els.label.textContent = 'Cast again';
    els.btn.setAttribute('aria-disabled', 'false');
    casting = false;
  }

  function reset() {
    clearTimeout(settleTimer);
    stopSfx(); 
    state = 'idle';
    casting = false;
    fallback = false;
    power = 0;
    body.classList.remove('charging', 'climax', 'done');
    els.words.forEach((w) => w.classList.remove('lit'));
    els.label.textContent = 'Cast Spell';
    els.btn.setAttribute('aria-disabled', 'false');
    els.audio.pause();
    try { els.audio.currentTime = 0; } catch (_) { /* metadata not ready */ }
  }

  /* ------------------------------------------------------------------------
     PROGRESS (0..1) — from the audio element, or a timer in fallback mode
     ------------------------------------------------------------------------ */
  function getProgress(now) {
    if (fallback) return clamp((now - fallbackStart) / (CONFIG.fallbackDuration * 1000));
    const a = els.audio, d = a.duration;
    if (Number.isFinite(d) && d > 0) return clamp(a.currentTime / d);
    return clamp(a.currentTime / CONFIG.fallbackDuration) * 0.95;   // metadata not ready yet
  }

  /* True when the spell is about to finish (frame-accurate, beats 'timeupdate'
     which only fires ~4 times a second). 'ended' remains as the guaranteed backup. */
  function spellIsFinishing(progress) {
    if (fallback) return progress >= 1;
    if (CONFIG.climaxLead <= 0) return false;      // rely purely on the 'ended' event
    const a = els.audio, d = a.duration;
    return Number.isFinite(d) && a.currentTime > 0 && d - a.currentTime <= CONFIG.climaxLead;
  }

  /* ------------------------------------------------------------------------
     MAIN LOOP
     ------------------------------------------------------------------------ */
  let lastT = performance.now();

  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    let target = 0;
    let climaxT = 0;

    if (state === 'charging') {
      const progress = getProgress(now);
      target = 0.12 + 0.88 * Math.pow(progress, 1.25);    // builds faster near the end

      // Light each word as its share of the spell is spoken
      [0.02, 0.33, 0.64].forEach((t, i) => els.words[i].classList.toggle('lit', progress >= t));

      if (spellIsFinishing(progress)) climax();
    } else if (state === 'climax') {
      climaxT = (now - climaxStart) / 1000;
      target = climaxT < 0.45 ? 1 : 0;
    }

    // Smooth the energy level so nothing snaps
    power += (target - power) * Math.min(1, dt * (state === 'climax' ? 4 : 9));
    els.sigil.style.setProperty('--power', power.toFixed(3));

    // Rings spin faster as power rises (counter-rotating for depth)
    const boost = 1 + power * power * 24;
    angOuter += 6 * boost * dt;
    angMid -= 9 * boost * dt;
    angInner += 14 * boost * dt;
    els.ringOuter.setAttribute('transform', `rotate(${angOuter.toFixed(2)})`);
    els.ringMid.setAttribute('transform', `rotate(${angMid.toFixed(2)})`);
    els.ringInner.setAttribute('transform', `rotate(${angInner.toFixed(2)})`);

    // Core pulses faster and larger with power
    const pulse = 1 + power * 0.45 + 0.05 * Math.sin((now / 300) * (1 + power * 6));
    els.core.setAttribute('transform', `scale(${pulse.toFixed(3)})`);

    // Screen shake: grows while charging, violent then decaying at the climax
    let amp = 0;
    if (state === 'charging') amp = power * power * CONFIG.chargeShakePx;
    if (state === 'climax') amp = CONFIG.climaxShakePx * Math.exp(-climaxT * 0.9);
    if (reduceMotion) amp = 0;
    applyShake(amp);

    fx.update(dt, state, power, climaxT);
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------------------
     EVENTS
     ------------------------------------------------------------------------ */
  // Enter the charging state the instant sound actually starts, so 'ended'
  // can never arrive while we are still "idle" (a race on very short clips).
  els.audio.addEventListener('playing', () => {
    if (casting && state === 'idle') beginCharge(false);
  });

  // THE TRIGGER: fires the moment the 2-second clip finishes.
  els.audio.addEventListener('ended', climax);

  // Missing or unreadable file: let the show run silently instead of breaking
  els.audio.addEventListener('error', () => { audioBroken = true; });

  // Hover starts the spell; click / tap / Enter does the same (needed for the
  // very first interaction on browsers that block autoplay)
  els.btn.addEventListener('pointerdown', primeSfx);   // NEW: unlocks the effects on first click/tap
  els.btn.addEventListener('mouseenter', cast);
  els.btn.addEventListener('click', cast);

  window.addEventListener('resize', fx.resize);

  /* ------------------------------------------------------------------------
     INIT
     ------------------------------------------------------------------------ */
  buildSigil();
  buildStars();
  fx.resize();
  fx.seedMotes();
  requestAnimationFrame(frame);
})();
