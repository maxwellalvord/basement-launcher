/* Lilly: a long-coat German Shepherd who lives on the home screen.
 * She walks along the app row, sits on tiles and the clock, and has needs (hunger, fun, energy)
 * that keep draining while the TV is off. Up on the remote opens her care menu.
 * Everything is drawn with canvas shapes, no image files. Colors and size are in CFG. */
(() => {
  "use strict";

  // ---------- look ----------
  const CFG = {
    name: "Lilly",
    scale: 0.78,                       // overall size on screen
    c: {
      saddle: "#16120f", grizzle: "#3b2f26", tan: "#b37a44", gold: "#cf9a57",
      cream: "#e6d3b1", mask: "#1b1613", grey: "#8d8882", nose: "#0b0a0a",
      eye: "#2a1a10", tongue: "#e0737b", earIn: "#c8a27a"
    }
  };
  const C = CFG.c;
  const VIDEO = /__input:|jellyfin|youtube|netflix|plex|hulu|disney|amazon|prime|hbo|\.max|twitch|crunchyroll|tubi|pluto|peacock|paramount/i;
  const now = () => performance.now();
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- needs (saved across reboots) ----------
  const KEY = "lilly.v1";
  let S = null;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S) S = { hunger: 85, fun: 80, energy: 80, t: Date.now(), seen: Date.now(), watched: null, morning: "" };
  const save = () => { S.t = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  function catchUp() {                // apply the time that passed while the TV was off
    const h = clamp((Date.now() - S.t) / 3.6e6, 0, 96);
    S.hunger = clamp(S.hunger - 5 * h, 0, 100);
    S.fun = clamp(S.fun - 3.5 * h, 0, 100);
    S.energy = clamp(S.energy + 12 * h, 0, 100);   // she naps while you're gone
    S.t = Date.now();
  }
  catchUp();
  const mood = () => (S.hunger < 30 || S.fun < 30) ? "sad" : (S.energy < 20 ? "tired" : (S.hunger > 65 && S.fun > 65 ? "happy" : "ok"));
  const isNight = () => { const h = new Date().getHours(); return h >= 22 || h < 7; };

  // ---------- DOM ----------
  const css = document.createElement("style");
  css.textContent = `
  #lilly { position: fixed; left: 0; top: 0; width: 260px; height: 220px; pointer-events: none; z-index: 30; will-change: transform; }
  .lilly-prop { position: fixed; left: 0; top: 0; pointer-events: none; z-index: 29; will-change: transform; }
  #lillyMenu { position: fixed; z-index: 40; width: 300px; padding: 14px 16px 12px; border-radius: 12px;
    background: rgba(15,19,28,0.94); border: 1px solid #2a3346; color: #e6e9f0; font: 13px "IBM Plex Mono", ui-monospace, monospace; }
  #lillyMenu .lm-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
  #lillyMenu .lm-head b { font: 600 20px "Syne", system-ui, sans-serif; }
  #lillyMenu .lm-mood { color: #8a93a6; text-transform: uppercase; letter-spacing: .06em; font-size: 11px; }
  #lillyMenu .lm-bar { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 8px; margin: 5px 0; color: #8a93a6; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  #lillyMenu .lm-bar i { height: 7px; border-radius: 4px; background: #2a3346; overflow: hidden; display: block; }
  #lillyMenu .lm-bar i b { display: block; height: 100%; border-radius: 4px; background: #f2a65a; }
  #lillyMenu .lm-bar i b.low { background: #e0606a; }
  #lillyMenu .lm-acts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 12px; }
  #lillyMenu .lm-acts span { text-align: center; padding: 8px 0; border-radius: 7px; border: 1px solid #2a3346; font-size: 12px; }
  #lillyMenu .lm-acts span.on { border-color: #f2a65a; color: #f2a65a; background: rgba(242,166,90,0.1); }
  #lillyMenu .lm-hint { margin-top: 9px; color: #8a93a6; font-size: 10px; letter-spacing: .04em; }
  .lilly-hint { position: fixed; left: 0; top: 0; z-index: 30; font: 11px "IBM Plex Mono", ui-monospace, monospace; color: #8a93a6; letter-spacing: .06em; text-transform: uppercase; pointer-events: none; transition: opacity .4s; }`;
  document.head.appendChild(css);

  const W = 260, H = 220, OX = 130, OY = 196;     // canvas size and where her feet are inside it
  const cv = document.createElement("canvas");
  cv.id = "lilly";
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = W * dpr; cv.height = H * dpr;
  document.body.appendChild(cv);
  const ctx = cv.getContext("2d");

  const menu = document.createElement("div");
  menu.id = "lillyMenu"; menu.hidden = true;
  const ACTS = [["feed", "Feed"], ["treat", "Treat"], ["play", "Play"], ["pet", "Belly rub"]];
  menu.innerHTML = `<div class="lm-head"><b>${CFG.name}</b><span class="lm-mood"></span></div>
    <div class="lm-bar">Hunger<i><b data-k="hunger"></b></i></div>
    <div class="lm-bar">Fun<i><b data-k="fun"></b></i></div>
    <div class="lm-bar">Energy<i><b data-k="energy"></b></i></div>
    <div class="lm-acts">${ACTS.map(a => `<span data-a="${a[0]}">${a[1]}</span>`).join("")}</div>
    <div class="lm-hint">Left / Right · OK · Down to close</div>`;
  document.body.appendChild(menu);

  const hint = document.createElement("div");
  hint.className = "lilly-hint"; hint.textContent = `Press Up for ${CFG.name}`;
  document.body.appendChild(hint);

  const prop = svg => { const d = document.createElement("div"); d.className = "lilly-prop"; d.innerHTML = svg; d.hidden = true; document.body.appendChild(d); return d; };
  const bowl = prop(`<svg width="46" height="22" viewBox="0 0 46 22"><ellipse cx="23" cy="6" rx="21" ry="5" fill="#c45a2a"/><circle cx="14" cy="4" r="3" fill="#8a4a24"/><circle cx="22" cy="3" r="3" fill="#a5582a"/><circle cx="30" cy="4" r="3" fill="#8a4a24"/><path d="M2 6 Q4 20 23 21 Q42 20 44 6 Z" fill="#8f9aa8"/><path d="M2 6 Q23 12 44 6" stroke="#c9ccd6" stroke-width="1.5" fill="none"/></svg>`);
  const cracker = prop(`<svg width="22" height="22" viewBox="0 0 22 22"><rect x="2" y="2" width="18" height="18" rx="2" fill="#e8822f" transform="rotate(12 11 11)"/><g fill="#b85a1c"><circle cx="8" cy="8" r="1.1"/><circle cx="14" cy="8" r="1.1"/><circle cx="8" cy="14" r="1.1"/><circle cx="14" cy="14" r="1.1"/><circle cx="11" cy="11" r="1.1"/></g></svg>`);
  const ball = prop(`<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="10" fill="#cfe04a"/><path d="M3 6 Q11 11 3 17 M19 6 Q11 11 19 17" stroke="#f4f7e6" stroke-width="1.6" fill="none"/></svg>`);
  const place = (el, x, y, w, h) => { el.style.transform = `translate3d(${x - w / 2}px, ${y - h}px, 0)`; };

  // ---------- where she can be ----------
  const tiles = () => [...document.querySelectorAll("#dock .tile")];
  const clockEl = () => document.querySelector(".hud h1");
  const focusIndex = () => (window.dock && window.dock.index ? window.dock.index() : 0);
  function point(p) {
    if (p.type === "tile") {
      const el = tiles()[p.i]; if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width * p.f, y: r.top + 4, vis: r.right > 40 && r.left < innerWidth - 40 };
    }
    const el = clockEl(); if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * p.f, y: r.top + r.height * 0.2, vis: true };
  }
  const tileP = i => ({ type: "tile", i: clamp(i, 0, Math.max(0, tiles().length - 1)), f: rand(0.3, 0.7) });
  function visibleTiles() {
    return tiles().map((el, i) => [el.getBoundingClientRect(), i]).filter(([r]) => r.right > 60 && r.left < innerWidth - 60).map(([, i]) => i);
  }

  // ---------- her state ----------
  const POSES = {
    stand: { bodyY: 40, tilt: 0, hx: 0, hy: 4, ht: 0.08, legs: "stand" },
    walk:  { bodyY: 40, tilt: 0, hx: 2, hy: 4, ht: 0.05, legs: "walk" },
    sit:   { bodyY: 33, tilt: -0.55, hx: 0, hy: 2, ht: 0.05, legs: "sit" },
    lie:   { bodyY: 13, tilt: 0, hx: 4, hy: 6, ht: 0, legs: "lie" },
    sleep: { bodyY: 12, tilt: 0, hx: 10, hy: 26, ht: 0.18, legs: "lie" },
    eat:   { bodyY: 40, tilt: 0.08, hx: 8, hy: 44, ht: 0.6, legs: "stand" },
    bow:   { bodyY: 30, tilt: 0.38, hx: 6, hy: 10, ht: -0.2, legs: "bow" },
    belly: { bodyY: 14, tilt: 0, hx: 6, hy: 10, ht: 2.6, legs: "belly" }
  };
  const D = {
    x: innerWidth / 2, y: innerHeight - 160, face: 1,
    perch: { type: "tile", i: 0, f: 0.5 }, mode: "idle", busy: false,
    pose: "sit", p: { ...POSES.sit }, phase: 0, until: 0,
    walk: null, jump: null, bubble: null, bubbleUntil: 0,
    wag: 0.15, wagSpeed: 6, tailA: 0.72, ears: 0, tongue: false, eyes: 0, blinkAt: now() + 3000,
    carrying: false, lastThought: now()
  };
  const setPose = name => { D.pose = name; };
  const say = (kind, ms = 2000) => { D.bubble = kind; D.bubbleUntil = now() + ms; };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // move to a perch: walk along the same level, jump between levels. Resolves on arrival
  function goTo(perch, speed = 60) {
    return new Promise(resolve => {
      const to = point(perch); if (!to) return resolve();
      if (Math.abs(to.y - D.y) > 14) {
        D.mode = "jump";
        D.jump = { perch, x0: D.x, y0: D.y, t0: now(), dur: 650 + Math.abs(to.x - D.x) * 0.5, h: 70 + Math.abs(to.y - D.y) * 0.25, done: resolve };
        D.face = to.x >= D.x ? 1 : -1; setPose("stand");
      } else {
        D.mode = "walk"; D.walk = { perch, speed, done: resolve }; setPose("walk");
      }
    });
  }
  const hop = () => new Promise(resolve => {
    D.mode = "jump"; setPose("stand");
    D.jump = { perch: D.perch, x0: D.x, y0: D.y, t0: now(), dur: 420, h: 34, done: resolve };
  });

  // ---------- the brain ----------
  function think(t) {
    if (D.busy || D.mode !== "idle" || t < D.until) return;
    const m = mood(), night = isNight();
    const here = point(D.perch);
    if (here && !here.vis) { goTo(tileP(focusIndex()), 110).then(settle); return; }
    if (night || m === "tired") {
      if (D.pose !== "sleep") { setPose(Math.random() < 0.3 ? "lie" : "sleep"); }
      D.until = t + rand(25000, 50000); return;
    }
    const slow = m === "sad" ? 0.6 : 1;
    const r = Math.random();
    if (r < 0.3) goTo(tileP(focusIndex()), 95 * slow).then(settle);
    else if (r < 0.55) { const v = visibleTiles(); goTo(tileP(v[Math.floor(Math.random() * v.length)] ?? 0), 55 * slow).then(settle); }
    else if (r < 0.62 && m !== "sad") goTo({ type: "clock", f: rand(0.25, 0.8) }, 60).then(settle);
    else {
      const pool = m === "sad" ? ["lie", "lie", "sit", "sleep"] : ["sit", "lie", "stand", "sit", "sleep"];
      setPose(pool[Math.floor(Math.random() * pool.length)]);
      if (Math.random() < 0.3) D.face *= -1;
      D.until = t + rand(7000, 16000);
    }
    if (m === "sad" && t - D.lastThought > 25000) { D.lastThought = t; say(S.hunger < 30 ? "bowl" : "ball", 3500); }
  }
  function settle() { setPose(Math.random() < 0.55 ? "sit" : "lie"); D.until = now() + rand(5000, 12000); }

  // ---------- care actions ----------
  const ACTIONS = {
    async feed() {
      setPose("stand"); await wait(300);
      if (D.x + D.face * 50 > innerWidth - 30 || D.x + D.face * 50 < 30) D.face *= -1;
      const bx = D.x + D.face * 46;
      bowl.hidden = false; place(bowl, bx, D.y, 46, 22);
      await wait(400); setPose("eat"); D.wagSpeed = 10; D.wag = 0.35;
      await wait(3800);
      bowl.hidden = true; S.hunger = clamp(S.hunger + 45, 0, 100); S.fun = clamp(S.fun + 4, 0, 100);
      setPose("sit"); D.tongue = true; say("heart", 1800); await wait(1800); D.tongue = false;
    },
    async treat() {
      setPose("sit"); D.face = D.x > innerWidth / 2 ? -1 : 1;
      const tx = D.x + D.face * 30, top = D.y - 170, bottom = D.y - 70;
      cracker.hidden = false; const t0 = now();
      await new Promise(res => {
        const f = () => { const k = Math.min(1, (now() - t0) / 650); place(cracker, tx, lerp(top, bottom, k * k), 22, 22); if (k < 1) requestAnimationFrame(f); else res(); };
        f();
      });
      cracker.hidden = true; await hop();
      S.hunger = clamp(S.hunger + 8, 0, 100); S.fun = clamp(S.fun + 10, 0, 100);
      setPose("sit"); D.tongue = true; say("heart", 1500); await wait(1500); D.tongue = false;
    },
    async play() {
      if (S.energy < 15) { setPose("lie"); say("z", 2500); await wait(2500); return; }
      const v = visibleTiles(); if (!v.length) return;
      const here = D.perch.type === "tile" ? D.perch.i : focusIndex();
      const far = v.slice().sort((a, b) => Math.abs(b - here) - Math.abs(a - here))[0];
      const target = { type: "tile", i: far, f: 0.5 }, tp = point(target); if (!tp) return;
      setPose("bow"); D.wag = 0.6; D.wagSpeed = 16; await wait(600);
      ball.hidden = false; const x0 = D.x, t0 = now(), dur = 900;
      await new Promise(res => {
        const f = () => {
          const k = Math.min(1, (now() - t0) / dur), p = point(target) || tp;
          const bounce = Math.abs(Math.sin(k * Math.PI * 3)) * 40 * (1 - k);
          place(ball, lerp(x0, p.x, k), p.y - bounce, 22, 22);
          if (k < 1) requestAnimationFrame(f); else res();
        };
        f();
      });
      D.tongue = true; await goTo(target, 230);
      ball.hidden = true; D.carrying = true;
      await goTo(tileP(focusIndex()), 200);
      D.carrying = false; setPose("bow"); say("heart", 1600); await wait(1600);
      S.fun = clamp(S.fun + 25, 0, 100); S.energy = clamp(S.energy - 15, 0, 100);
      D.tongue = false;
    },
    async pet() {
      setPose("belly"); D.wag = 0.7; D.wagSpeed = 18; D.tongue = true;
      say("heart", 3000); await wait(3200);
      S.fun = clamp(S.fun + 14, 0, 100);
      setPose("sit"); await wait(500); D.tongue = false;
    }
  };
  async function act(name) {
    if (D.busy) return;
    D.busy = true; D.until = 0;
    try { await ACTIONS[name](); } finally {
      D.busy = false; D.mode = "idle"; D.until = now() + rand(4000, 8000); save();
    }
  }

  // ---------- life events ----------
  async function greet(minutesAway) {
    if (D.busy) return;
    if (isNight()) { setPose("lie"); D.wag = 0.25; D.until = now() + 6000; return; }
    D.busy = true;
    try {
      setPose("stand"); say("!", 1400); D.wag = 0.8; D.wagSpeed = 18; D.tongue = true;
      await hop(); if (minutesAway > 120) { await hop(); await hop(); }
      await goTo(tileP(focusIndex()), 140);
      setPose("sit"); await wait(1200);
    } finally { D.busy = false; D.mode = "idle"; D.tongue = false; D.until = now() + 6000; }
  }
  async function morningStretch() {
    const today = new Date().toDateString(), h = new Date().getHours();
    if (h < 7 || h >= 11 || S.morning === today) return false;
    S.morning = today; save();
    D.busy = true;
    try { setPose("bow"); await wait(1600); setPose("stand"); D.tongue = true; await wait(900); D.tongue = false; }
    finally { D.busy = false; D.mode = "idle"; }
    return true;
  }
  let leftAt = 0;
  function onLeave() { leftAt = Date.now(); S.seen = leftAt; save(); closeMenu(); }
  function onReturn() {
    catchUp();
    const mins = leftAt ? (Date.now() - leftAt) / 60000 : 0; leftAt = 0;
    if (S.watched && mins > 2) {               // she watched it with you: she's lying on that app's tile
      const list = window.dock && window.dock.apps ? window.dock.apps() : [];
      const i = list.findIndex(a => a.pkg === S.watched);
      if (i >= 0) { D.perch = { type: "tile", i, f: 0.5 }; const p = point(D.perch); if (p) { D.x = p.x; D.y = p.y; } D.mode = "idle"; setPose("lie"); }
      S.watched = null; save();
      setTimeout(() => greet(mins), 1500);
      return;
    }
    S.watched = null;
    morningStretch().then(stretched => { if (!stretched && mins > 1) greet(mins); });
  }
  addEventListener("dock:launch", e => {
    const a = e.detail; if (a && VIDEO.test(a.pkg)) { S.watched = a.pkg; save(); }
  });
  addEventListener("dock:focus", e => {
    if (D.busy || D.mode !== "idle" || D.pose === "sleep" || Math.random() > 0.35) return;
    goTo(tileP(e.detail), 120).then(settle);
  });
  document.addEventListener("visibilitychange", () => { document.hidden ? onLeave() : onReturn(); });
  const prevResume = window.onResumeApp, prevPause = window.onPauseApp;
  window.onResumeApp = () => { prevResume && prevResume(); onReturn(); };
  window.onPauseApp = () => { prevPause && prevPause(); onLeave(); };

  // ---------- care menu (Up from the app row) ----------
  let menuOpen = false, sel = 0;
  function renderMenu() {
    menu.querySelector(".lm-mood").textContent = { sad: "Needs you", tired: "Sleepy", happy: "Happy", ok: "Content" }[mood()];
    menu.querySelectorAll("[data-k]").forEach(b => { const v = S[b.dataset.k]; b.style.width = v + "%"; b.classList.toggle("low", v < 30); });
    menu.querySelectorAll("[data-a]").forEach((s, k) => s.classList.toggle("on", k === sel));
    const mx = clamp(D.x - 150, 16, innerWidth - 316);
    const my = D.y > innerHeight / 2 ? D.y - 300 : D.y + 20;
    menu.style.left = mx + "px"; menu.style.top = clamp(my, 16, innerHeight - 200) + "px";
  }
  function openMenu() {
    menuOpen = true; menu.hidden = false; sel = 0;
    if (!D.busy && D.mode === "idle") { setPose("sit"); D.wag = 0.5; D.until = now() + 20000; }
    renderMenu();
  }
  function closeMenu() { menuOpen = false; menu.hidden = true; }
  addEventListener("keydown", e => {
    noteActivity();
    if (menuOpen) {
      if (e.key === "ArrowLeft") sel = (sel + ACTS.length - 1) % ACTS.length;
      else if (e.key === "ArrowRight") sel = (sel + 1) % ACTS.length;
      else if (e.key === "Enter" || e.key === " ") { closeMenu(); act(ACTS[sel][0]); }
      else if (e.key === "ArrowDown" || e.key === "Escape" || e.key === "Backspace") closeMenu();
      else return;
      if (menuOpen) renderMenu();
      e.preventDefault(); e.stopImmediatePropagation();
    } else if (e.key === "ArrowUp") {
      openMenu(); e.preventDefault(); e.stopImmediatePropagation();
    }
  }, true);
  const prevBack = window.onBack;
  window.onBack = () => { if (menuOpen) closeMenu(); else if (prevBack) prevBack(); };

  // ---------- ambient mode: after 3 idle minutes the dock fades and Lilly has the screen ----------
  let lastInput = Date.now();
  function noteActivity() {
    lastInput = Date.now();
    if (document.body.classList.contains("ambient")) document.body.classList.remove("ambient");
  }
  const amb = document.createElement("style");
  amb.textContent = `.dock-wrap, .dock-label, .focus-name, .shade, .lilly-hint { transition: opacity 1.2s; }
    body.ambient .dock-wrap { opacity: 0.12; } body.ambient .dock-label, body.ambient .focus-name, body.ambient .lilly-hint { opacity: 0; } body.ambient .shade { opacity: 0.4; }`;
  document.head.appendChild(amb);
  setInterval(() => {
    if (!menuOpen && Date.now() - lastInput > 180000) document.body.classList.add("ambient");
    hint.style.opacity = Date.now() - lastInput < 8000 && !menuOpen ? 1 : 0;
  }, 2000);

  // ---------- drawing ----------
  function drawDog(P, t) {
    const g = ctx, k = CFG.scale;
    const cos = Math.cos(P.tilt), sin = Math.sin(P.tilt);
    const tp = (x, y) => [x * cos - y * sin, -P.bodyY + x * sin + y * cos];   // torso space -> dog space
    const fill = c => { g.fillStyle = c; g.fill(); };
    const ell = (x, y, rx, ry, rot, c) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2); fill(c); };
    const line = (pts, w, c) => { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = c; g.stroke(); };
    // a shaggy ellipse: the outline has little fur spikes, fixed per part so they don't flicker
    const fur = (x, y, rx, ry, rot, c, jag = 2.2, n = 26, seed = 1) => {
      g.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, spike = (i % 2 ? jag : -jag * 0.3) * (0.7 + 0.3 * Math.sin(i * 1.7 + seed));
        const px = Math.cos(a) * (rx + spike), py = Math.sin(a) * (ry + spike);
        const X = x + px * Math.cos(rot || 0) - py * Math.sin(rot || 0), Y = y + px * Math.sin(rot || 0) + py * Math.cos(rot || 0);
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      g.closePath(); fill(c);
    };
    const fringe = (x0, y0, x1, y1, n, len, c) => {           // a row of long-hair tufts
      g.beginPath(); g.moveTo(x0, y0);
      for (let i = 1; i <= n; i++) {
        const a = i / n, ap = (i - 0.5) / n, L = len * (0.7 + 0.3 * Math.sin(i * 2.3));
        g.lineTo(lerp(x0, x1, ap) - 1.5, lerp(y0, y1, ap) + L); g.lineTo(lerp(x0, x1, a), lerp(y0, y1, a));
      }
      g.closePath(); fill(c);
    };
    const belly = P.legs === "belly", sleeping = D.pose === "sleep";

    g.save();
    g.translate(OX, OY); g.scale(k * D.face, k);
    ell(2, 1, 52, 6.5, 0, "rgba(0,0,0,0.35)");                  // shadow

    const sh = tp(22, 8), hip = tp(-22, 6);
    const leg = (front, near) => {
      const c = near ? C.tan : "#8a5c33", paw = near ? C.cream : C.tan;
      const s = P.legs === "walk" ? Math.sin(D.phase + (front ? 0 : Math.PI) + (near ? Math.PI : 0)) * 0.45 : 0;
      if (belly) {                                              // paws up for belly rubs
        const b = front ? tp(18, -12) : tp(-20, -12), up = near ? -18 : -13;
        line([b, [b[0] + (front ? 7 : -5), b[1] + up], [b[0] + (front ? 13 : -2), b[1] + up - 5]], near ? 10 : 9, c);
        ell(b[0] + (front ? 14 : -1), b[1] + up - 7, 5.5, 4.5, 0, paw);
        return;
      }
      if (front) {
        const a = sh;
        if (P.legs === "lie" || P.legs === "bow") {           // sphinx: front legs out, paws crossed-ish
          const r = near ? 32 : 27;
          line([[a[0], a[1] + 2], [a[0] + 12, -5], [a[0] + r, -4]], 10, c); ell(a[0] + r + 2, -4, 6.5, 4, 0, paw);
        } else {
          const px = a[0] + Math.sin(s) * 18;
          line([[a[0], a[1] + 4], [px, -3]], 10, c); ell(px + 2.5, -3, 6.5, 3.8, 0, paw);
        }
      } else {
        const a = hip;
        if (P.legs === "sit") {
          fur(a[0] + 3, Math.max(a[1], -16), 16, 14, 0, c, 2, 22, 3);
          fringe(a[0] - 12, -10, a[0] - 4, -2, 4, 5, C.cream);
          line([[a[0] + 8, -5], [a[0] + 22, -4]], 8, c); ell(a[0] + 24, -4, 6.5, 3.8, 0, paw);
        } else if (P.legs === "lie") {
          fur(a[0] + 2, -10, 17, 11, 0, c, 2, 22, 4);
          line([[a[0] + 6, -4], [a[0] + 22, -4]], 8, c);
        } else {
          const px = a[0] - 6 + Math.sin(s) * 16;
          fur(a[0], a[1] + 5, 15, 18, 0.2, c, 2, 22, 5);
          line([[a[0] - 4, a[1] + 16], [a[0] - 10 + Math.sin(s) * 10, -14], [px, -3]], 8, c);
          ell(px + 2.5, -3, 6.5, 3.8, 0, paw);
          if (near) fringe(a[0] - 15, a[1] + 2, a[0] - 9, a[1] + 22, 5, 7, C.cream);   // fluffy britches
        }
      }
    };

    if (!belly) { leg(true, false); leg(false, false); }

    // tail: one big plume, black on top, cream feathering underneath, hangs low
    {
      const base = tp(-34, -4);
      let a0 = Math.PI * (belly ? 1.0 : D.tailA) + Math.sin(t * 0.001 * D.wagSpeed) * D.wag;
      const droop = belly ? 0.05 : sleeping ? -0.25 : 0.35;      // how much it curves down toward the tip
      const N = 9, len = 48, pts = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N, a = a0 + droop * u * u;
        const prev = pts[i - 1] || base;
        const p = i ? [prev[0] + Math.cos(a) * len / N, Math.min(prev[1] + Math.sin(a) * len / N, -5)] : base;
        pts.push([p[0], p[1], a]);
      }
      const w = u => 5 + Math.sin(Math.min(1, u * 1.15) * Math.PI) * 11;  // thin at the base, fat plume, soft tip
      const side = s => pts.map(([x, y, a], i) => [x + Math.cos(a + Math.PI / 2 * s) * w(i / N), y + Math.sin(a + Math.PI / 2 * s) * w(i / N)]);
      const upper = side(-1), lower = side(1);
      g.beginPath(); upper.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
      lower.slice().reverse().forEach(p => g.lineTo(p[0], p[1])); g.closePath(); fill(C.saddle);
      g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
      lower.slice().reverse().forEach(p => g.lineTo(p[0], p[1])); g.closePath(); fill(C.grizzle);
      // cream feathering along the underside
      g.beginPath(); g.moveTo(lower[2][0], lower[2][1]);
      for (let i = 2; i <= N; i++) {
        const [x, y, a] = pts[i], ww = w(i / N) + 5 + (i % 2) * 3;
        g.lineTo(x + Math.cos(a + Math.PI / 2) * ww, y + Math.sin(a + Math.PI / 2) * ww); g.lineTo(lower[i][0], lower[i][1]);
      }
      for (let i = N; i >= 2; i--) { const [x, y] = pts[i]; g.lineTo((x + lower[i][0]) / 2, (y + lower[i][1]) / 2); }
      g.closePath(); fill(C.cream);
    }

    // torso: a big fluffy barrel
    g.save(); g.translate(0, -P.bodyY); g.rotate(P.tilt);
    if (belly) {
      fur(0, 0, 37, 19, 0, C.saddle, 2.5, 30, 7);
      g.save(); g.beginPath(); g.ellipse(0, 0, 37, 19, 0, 0, Math.PI * 2); g.clip(); ell(2, -10, 35, 13, 0, C.cream); g.restore();
      fringe(-28, -14, 24, -15, 9, -7, C.cream);
    } else {
      fur(0, 1, 37, 20, 0, C.tan, 2.5, 30, 7);
      g.save(); g.beginPath(); g.ellipse(0, 1, 37, 20, 0, 0, Math.PI * 2); g.clip();
      ell(-2, -9, 39, 17, 0, C.saddle);            // saddle over the back and shoulders
      ell(-31, 8, 11, 13, 0, C.gold);              // tan on the haunch
      ell(4, 18, 30, 7, 0, C.cream);               // pale belly
      g.restore();
      fur(-2, -12, 33, 7, 0, C.saddle, 2.6, 26, 9); // shaggy topline sticks out past the outline
      fringe(-26, 17, 22, 18, 10, 7, C.cream);      // long belly fringe
    }
    g.restore();

    leg(true, true); leg(false, true);
    if (belly) { leg(true, false); leg(false, false); }

    // head position, then a thick neck ruff connecting it
    const hb = tp(34, -16), hx = hb[0] + 8 + P.hx, hy = hb[1] - 12 + P.hy;
    const nb = tp(26, -2);
    const nx = (nb[0] + hx) / 2 - 2, ny = (nb[1] + hy) / 2 + 2;
    const nang = Math.atan2(hy - nb[1], hx - nb[0]), nlen = Math.hypot(hx - nb[0], hy - nb[1]) / 2 + 9;
    fur(nx, ny, nlen, 20, nang, belly ? C.cream : C.saddle, 3, 24, 11);    // thick mane
    if (!belly) {
      fur(nb[0] + 9, nb[1] + 5, 11, 14, 0.2, C.gold, 2.4, 20, 12);          // gold chest
      fur(nb[0] + 12, nb[1] + 9, 7, 9, 0.2, C.cream, 2, 16, 14);            // pale front of the ruff
    }

    // head: broad and fluffy, black mask, tan cheeks, grey chin
    g.save(); g.translate(hx, hy); g.rotate(P.ht + D.ears * 0.12); g.scale(1.32, 1.32);   // read from the couch
    const ear = near => {
      const back = D.ears, bx = near ? 1 : -4;
      const tip = [bx - 2 - back * 12, -24 + back * 14];
      g.beginPath(); g.moveTo(bx - 8, -7); g.lineTo(bx + 4, -9.5); g.lineTo(tip[0], tip[1]); g.closePath(); fill(near ? C.saddle : "#0e0b09");
      if (near) {
        g.beginPath(); g.moveTo(bx - 5, -8.5); g.lineTo(bx + 1, -9.5); g.lineTo(tip[0] + 0.5, tip[1] + 5); g.closePath(); fill(C.earIn);
        fringe(bx - 8, -7, tip[0], tip[1], 3, -2.5, C.grizzle);
      }
    };
    ear(false);
    fur(0, 0, 14.5, 12.5, 0, C.tan, 1.6, 22, 13);
    g.save(); g.beginPath(); g.ellipse(0, 0, 14.5, 12.5, 0, 0, Math.PI * 2); g.clip();
    ell(-6, -7, 13, 8, 0.15, C.saddle);           // dark forehead and crown
    ell(-11, 3, 7, 10, 0, C.grizzle);             // dark behind the cheek
    g.restore();
    // short, blunt muzzle
    g.beginPath(); g.moveTo(6, -6); g.lineTo(17, -3.5); g.quadraticCurveTo(21.5, -1, 20.5, 3.5); g.lineTo(14, 7.5); g.lineTo(6, 8); g.closePath(); fill(C.mask);
    g.beginPath(); g.moveTo(8, 6.5); g.lineTo(16, 6); g.quadraticCurveTo(12.5, 11, 7, 10); g.closePath(); fill(C.grey);
    ell(20, 0, 3.2, 2.6, 0, C.nose);
    if (D.tongue) ell(14, 10, 3, 4.5, 0.2, C.tongue);
    ell(4.5, -7.2, 2.1, 1.5, 0, C.gold);          // eyebrow spot
    ell(6, 1, 4, 4.5, 0, C.gold);                 // tan cheek under the eye
    if (D.eyes > 0.5 || sleeping) { g.beginPath(); g.arc(4.5, -3, 2.4, 0.2, Math.PI - 0.2); g.lineWidth = 1.3; g.strokeStyle = C.nose; g.stroke(); }
    else { ell(4.5, -3.2, 2.5, 2.5, 0, C.eye); ell(5.3, -4, 0.8, 0.8, 0, C.cream); }
    fringe(-12, 7, 1, 11, 5, 5, C.gold);          // cheek fluff
    ear(true);
    if (D.carrying) ell(18, 8, 5, 5, 0, "#cfe04a");
    g.restore();
    g.restore();

    // bubbles (not mirrored)
    if (D.bubble && now() < D.bubbleUntil) {
      const bx = OX + (hx * D.face) * k, by = OY + (hy - 34) * k;
      const bob = Math.sin(t / 300) * 2;
      g.save(); g.translate(bx, by + bob);
      const kind = D.bubble;
      if (kind === "heart" || kind === "!" || kind === "z") {
        g.font = "600 16px Syne, system-ui, sans-serif"; g.textAlign = "center";
        if (kind === "heart") {
          for (let i = 0; i < 3; i++) {
            const rise = ((t / 900 + i / 3) % 1), x = (i - 1) * 12, y = -rise * 26;
            g.globalAlpha = 1 - rise; g.save(); g.translate(x, y); g.scale(0.9, 0.9);
            g.beginPath(); g.moveTo(0, 4); g.bezierCurveTo(-8, -3, -4, -9, 0, -4); g.bezierCurveTo(4, -9, 8, -3, 0, 4); g.fillStyle = "#e0606a"; g.fill(); g.restore();
          }
          g.globalAlpha = 1;
        } else if (kind === "!") { g.fillStyle = "#f2a65a"; g.fillText("!", 0, 0); }
        else { g.fillStyle = "#8a93a6"; g.fillText("z", 0, 0); g.font = "600 11px Syne, system-ui"; g.fillText("z", 9, -10); }
      } else {
        g.fillStyle = "rgba(230,233,240,0.92)";
        g.beginPath(); g.ellipse(0, -6, 17, 13, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(-10, 9, 3, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(-14, 15, 1.8, 0, Math.PI * 2); g.fill();
        if (kind === "bowl") { g.fillStyle = "#8f9aa8"; g.beginPath(); g.moveTo(-9, -8); g.quadraticCurveTo(0, 4, 9, -8); g.closePath(); g.fill(); }
        else { g.fillStyle = "#b9c93a"; g.beginPath(); g.arc(0, -6, 6, 0, Math.PI * 2); g.fill(); }
      }
      g.restore();
    }
  }

  // ---------- frame loop (30 fps, small canvas, moved with a GPU transform) ----------
  let last = now(), lastSave = now();
  function frame(t) {
    requestAnimationFrame(frame);
    if (t - last < 33) return;
    const dt = Math.min(0.1, (t - last) / 1000); last = t;
    if (document.hidden) return;

    // needs drain live too
    const sleeping = D.pose === "sleep";
    S.hunger = clamp(S.hunger - dt * 5 / 3600, 0, 100);
    S.fun = clamp(S.fun - dt * 3.5 / 3600, 0, 100);
    S.energy = clamp(S.energy + dt * (sleeping ? 14 : -4) / 3600, 0, 100);
    if (t - lastSave > 20000) { lastSave = t; save(); }

    // movement
    if (D.mode === "walk" && D.walk) {
      const to = point(D.walk.perch);
      if (!to) { D.mode = "idle"; D.walk.done(); }
      else {
        const dx = to.x - D.x, step = D.walk.speed * dt;
        D.face = dx >= 0 ? 1 : -1; D.y = to.y; D.phase += step * 0.14;
        if (Math.abs(dx) <= step) { D.x = to.x; D.perch = D.walk.perch; D.mode = "idle"; const f = D.walk.done; D.walk = null; f(); }
        else D.x += Math.sign(dx) * step;
      }
    } else if (D.mode === "jump" && D.jump) {
      const j = D.jump, to = point(j.perch) || { x: j.x0, y: j.y0 };
      const k = Math.min(1, (t - j.t0) / j.dur);
      D.x = lerp(j.x0, to.x, k); D.y = lerp(j.y0, to.y, k) - Math.sin(Math.PI * k) * j.h;
      if (k >= 1) { D.perch = j.perch; D.mode = "idle"; const f = j.done; D.jump = null; f(); }
    } else if (D.mode === "idle") {
      const p = point(D.perch);                     // ride along when the dock scrolls
      if (p) { D.x = p.x; D.y = p.y; }
    }
    think(t);

    // mood -> body language
    const m = mood();
    const tgt = { tailA: m === "sad" ? 0.58 : m === "happy" ? 0.8 : 0.72, wag: m === "sad" ? 0.03 : m === "happy" ? 0.4 : 0.15, ears: m === "sad" ? 1 : 0 };
    if (!D.busy) { D.wag = lerp(D.wag, tgt.wag, dt * 1.5); D.wagSpeed = lerp(D.wagSpeed, m === "happy" ? 12 : 6, dt); }
    D.tailA = lerp(D.tailA, tgt.tailA, dt * 2); D.ears = lerp(D.ears, tgt.ears, dt * 2);
    if (t > D.blinkAt) { D.eyes = 1; if (t > D.blinkAt + 130) { D.eyes = 0; D.blinkAt = t + rand(2500, 6000); } }

    // ease toward the target pose
    const T = POSES[D.pose], ease = Math.min(1, dt * 7);
    for (const key of ["bodyY", "tilt", "hx", "hy", "ht"]) D.p[key] = lerp(D.p[key], T[key], ease);
    D.p.legs = T.legs;
    const breath = Math.sin(t / (D.pose === "sleep" ? 900 : 500)) * (D.pose === "sleep" ? 0.9 : 0.5);
    const bob = D.mode === "walk" ? Math.abs(Math.sin(D.phase)) * 1.6 : 0;
    const P = { ...D.p, bodyY: D.p.bodyY + breath + bob };

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawDog(P, t);
    if (D.pose === "sleep" && t >= D.bubbleUntil + 1500) say("z", 4000);
    cv.style.transform = `translate3d(${Math.round(D.x - OX)}px, ${Math.round(D.y - OY)}px, 0)`;
    hint.style.transform = `translate3d(${Math.round(clamp(D.x - 60, 8, innerWidth - 140))}px, ${Math.round(D.y - 108)}px, 0)`;
    if (menuOpen) renderMenu();
  }

  // start: find her spot after the dock has rendered
  setTimeout(() => {
    D.perch = tileP(focusIndex()); const p = point(D.perch); if (p) { D.x = p.x; D.y = p.y; }
    requestAnimationFrame(frame);
    const mins = (Date.now() - (S.seen || Date.now())) / 60000;
    morningStretch().then(s => { if (!s && mins > 1) greet(mins); });
  }, 400);
  window.lilly = { state: S, act, greet, say, D };     // handy from chrome://inspect
})();
