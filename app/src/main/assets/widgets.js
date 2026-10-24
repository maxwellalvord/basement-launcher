/* Home screen widgets: weather, Pi-hole ads blocked, Minecraft servers, homelab watchdog.
 * Homelab calls go through the Kotlin bridge (window.Android.request / mcPing), because this page is https
 * and the WebView blocks https -> http requests. Config lives in homelab.json (copied in by build.sh,
 * never committed). In a desktop browser there's no bridge, so the widgets run on example data. */
(() => {
  "use strict";
  const DEMO = !window.Android;

  // ---------- native bridge: promise wrapper around window.__native callbacks ----------
  const pending = new Map(); let seq = 0;
  window.__native = (id, status, body) => { const r = pending.get(id); if (r) { pending.delete(id); r({ status, body }); } };
  function native(call, ...args) {
    return new Promise(res => {
      const id = "n" + (++seq);
      pending.set(id, res);
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ status: -1, body: "timeout" }); } }, 10000);
      try { window.Android[call](id, ...args); } catch (e) { pending.delete(id); res({ status: -1, body: String(e) }); }
    });
  }
  const http = (method, url, headers = {}, body = "") => native("request", method, url, JSON.stringify(headers), body);
  const json = s => { try { return JSON.parse(s); } catch (e) { return null; } };

  // ---------- DOM ----------
  const css = document.createElement("style");
  css.textContent = `
  .widgets { position: fixed; right: max(28px, env(safe-area-inset-right, 0px)); bottom: calc(48px + env(safe-area-inset-bottom, 0px));
    width: 250px; display: grid; gap: 10px; z-index: 20; pointer-events: none; transition: opacity 1.2s; }
  body.ambient .widgets { opacity: 0.75; }
  .card { background: rgba(15,19,28,0.82); border: 1px solid #2a3346; border-radius: 10px; padding: 11px 13px; position: relative; }
  .card .k { font: 500 10px "IBM Plex Mono", ui-monospace, monospace; letter-spacing: .1em; text-transform: uppercase; color: #8a93a6; }
  .card .big { font: 800 30px "Syne", system-ui, sans-serif; line-height: 1.05; margin-top: 4px; font-variant-numeric: tabular-nums; color: #e6e9f0; }
  .card .sub { font: 12px "IBM Plex Mono", ui-monospace, monospace; color: #8a93a6; margin-top: 3px; }
  .card .row { display: flex; align-items: center; gap: 8px; margin-top: 7px; font: 12px "IBM Plex Mono", ui-monospace, monospace; color: #e6e9f0; }
  .card .row .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card .row .v { color: #8a93a6; font-variant-numeric: tabular-nums; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; background: #5c6370; }
  .dot.up { background: #4cc38a; } .dot.down { background: #e0606a; box-shadow: 0 0 0 3px rgba(224,96,106,.25); } .dot.pend { background: #f2c84b; }
  .card.alert { border-color: #e0606a; }
  .card .tag { display: inline-block; margin-top: 7px; padding: 3px 7px; border-radius: 5px; background: rgba(224,96,106,.15); color: #f0a0a6;
    font: 500 11px "IBM Plex Mono", ui-monospace, monospace; }
  .lab-grid { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 7px; }
  .lab-grid span { display: inline-flex; align-items: center; gap: 5px; font: 11px "IBM Plex Mono", ui-monospace, monospace; color: #c9ccd6; }`;
  document.head.appendChild(css);
  const box = document.createElement("div"); box.className = "widgets";
  box.innerHTML = `
    <div class="card" id="wAds"><div class="k">Ads blocked today</div><div class="big">--</div><div class="sub">Asking Pi-hole…</div></div>
    <div class="card" id="wMc"><div class="k">Minecraft</div><div class="mc"></div></div>
    <div class="card" id="wLab"><div class="k">Homelab</div><div class="lab-grid"></div><div class="lab-msg"></div></div>`;
  document.body.appendChild(box);
  const $ = (id, sel) => document.getElementById(id).querySelector(sel);
  const fmt = n => Math.round(n).toLocaleString();

  let CFG = null;
  async function loadConfig() {
    if (DEMO) return {
      homelab: "http://192.168.68.53", kumaSlug: "home",
      weather: { lat: 45.6387, lon: -122.6615, place: "Vancouver" },
      minecraft: [{ name: "Lakeside town", host: "192.168.68.53", port: 25565 }, { name: "ATM10 Sky", host: "192.168.68.53", port: 25566 }]
    };
    try { const r = await fetch("homelab.json", { cache: "no-store" }); if (r.ok) return await r.json(); } catch (e) {}
    return null;
  }

  // ---------- weather (Open-Meteo is https + keyless, so plain fetch works) ----------
  const WMO = c => c === 0 ? "Clear" : c <= 2 ? "Partly cloudy" : c === 3 ? "Overcast" : c <= 48 ? "Fog" : c <= 57 ? "Drizzle" :
    c <= 67 ? "Rain" : c <= 77 ? "Snow" : c <= 82 ? "Showers" : c <= 86 ? "Snow showers" : "Thunderstorm";
  const isWet = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
  async function weather() {
    const w = CFG.weather || { lat: 45.6387, lon: -122.6615, place: "Vancouver" };
    let d;
    if (DEMO) {
      const h = new Date().getHours();
      d = { temp: 52, code: 61, isDay: h >= 7 && h < 18 ? 1 : 0, sunrise: 7.4, sunset: 18.1 };
    } else {
      try {
        const u = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code,is_day&daily=sunrise,sunset&temperature_unit=fahrenheit&timezone=auto&forecast_days=1`;
        const r = await (await fetch(u)).json();
        const hrs = s => { const t = new Date(s); return t.getHours() + t.getMinutes() / 60; };
        d = { temp: r.current.temperature_2m, code: r.current.weather_code, isDay: r.current.is_day, sunrise: hrs(r.daily.sunrise[0]), sunset: hrs(r.daily.sunset[0]) };
      } catch (e) { return; }
    }
    // no weather card any more: the reading only drives the basement windows and room light
    const now = new Date().getHours() + new Date().getMinutes() / 60;
    const golden = Math.abs(now - d.sunrise) < 0.75 || Math.abs(now - d.sunset) < 0.75;
    window.__outside = { isDay: !!d.isDay, golden, wet: isWet(d.code) };   // kept for the 3D scene if it loads later
    window.setOutside && window.setOutside(window.__outside);
  }

  // ---------- Pi-hole v6: log in once with the app password, reuse the session ----------
  let sid = null;
  async function piAuth() {
    const r = await http("POST", `${CFG.homelab}:${CFG.piholePort || 8053}/api/auth`, { "Content-Type": "application/json" }, JSON.stringify({ password: CFG.piholePassword || "" }));
    const j = json(r.body); sid = j && j.session && j.session.valid ? j.session.sid : null;
    return sid;
  }
  async function ads() {
    let total, blocked, pct;
    if (DEMO) { blocked = 4812 + Math.floor(Math.random() * 30); total = 26400; pct = blocked / total * 100; }
    else {
      if (!CFG.piholePassword) { $("wAds", ".sub").textContent = "Add piholePassword to homelab.json"; return; }
      if (!sid && !(await piAuth())) { $("wAds", ".sub").textContent = "Pi-hole login failed"; return; }
      let r = await http("GET", `${CFG.homelab}:${CFG.piholePort || 8053}/api/stats/summary`, { sid });
      if (r.status === 401) { await piAuth(); r = await http("GET", `${CFG.homelab}:${CFG.piholePort || 8053}/api/stats/summary`, { sid }); }
      const j = json(r.body);
      if (!j || !j.queries) { $("wAds", ".sub").textContent = "Pi-hole unreachable"; lab.piholeDown = true; return; }
      lab.piholeDown = false;
      ({ total, blocked } = j.queries); pct = j.queries.percent_blocked;
    }
    $("wAds", ".big").textContent = fmt(blocked);
    $("wAds", ".sub").textContent = `${pct.toFixed(1)}% of ${fmt(total)} lookups`;
  }

  // ---------- Minecraft ----------
  async function minecraft() {
    const list = CFG.minecraft || [];
    const rows = await Promise.all(list.map(async s => {
      if (DEMO) return s.port === 25565 ? { s, up: true, online: 2, max: 20, names: ["maxxity", "friend"] } : { s, up: false };
      const r = await native("mcPing", s.host, s.port);
      const j = r.status === 200 ? json(r.body) : null;
      if (!j) return { s, up: false };
      return { s, up: true, online: j.players?.online ?? 0, max: j.players?.max ?? 0, names: (j.players?.sample || []).map(p => p.name) };
    }));
    const el = $("wMc", ".mc"); el.replaceChildren();
    for (const r of rows) {
      const row = document.createElement("div"); row.className = "row";
      row.innerHTML = `<i class="dot ${r.up ? "up" : ""}"></i><span class="n"></span><span class="v"></span>`;
      row.querySelector(".n").textContent = r.s.name;
      row.querySelector(".v").textContent = r.up ? `${r.online}/${r.max}` : "offline";
      if (r.up && r.names.length) row.title = r.names.join(", ");
      el.appendChild(row);
      if (r.up && r.online > 0 && r.names.length) {
        const who = document.createElement("div"); who.className = "sub"; who.textContent = r.names.slice(0, 4).join(", ");
        el.appendChild(who);
      }
    }
    if (!rows.length) el.innerHTML = `<div class="sub">No servers in homelab.json</div>`;
  }

  // ---------- homelab watchdog (Uptime Kuma status page) ----------
  const lab = { down: new Set(), misses: 0, names: {}, piholeDown: false };
  let demoTick = 0;
  async function watchdog() {
    let monitors = [];      // [{ name, status }]  status: 1 up, 0 down, 2 pending, 3 maintenance
    if (DEMO) {
      demoTick++;
      const base = ["Jellyfin", "Pi-hole", "Vaultwarden", "Nextcloud", "Immich", "AMP", "Homepage"];
      // the preview simulates Immich going down for a bit so you can see Lilly sound the alarm
      monitors = base.map(n => ({ name: n, status: n === "Immich" && demoTick % 6 >= 3 && demoTick % 6 <= 4 ? 0 : 1 }));
    } else {
      const slug = CFG.kumaSlug || "home", base = `${CFG.homelab}:${CFG.kumaPort || 3001}`;
      if (!Object.keys(lab.names).length) {
        const p = json((await http("GET", `${base}/api/status-page/${slug}`)).body);
        for (const g of p?.publicGroupList || []) for (const m of g.monitorList || []) lab.names[m.id] = m.name;
      }
      const r = await http("GET", `${base}/api/status-page/heartbeat/${slug}`);
      const j = r.status === 200 ? json(r.body) : null;
      if (!j) {
        lab.misses++;
        if (lab.misses >= 2) render([], lab.piholeDown ? "Homelab is offline (Kuma and Pi-hole not answering)" : "Can't reach Uptime Kuma");
        if (lab.misses === 2 && lab.piholeDown) bark("Homelab offline");
        return;
      }
      lab.misses = 0;
      for (const [id, beats] of Object.entries(j.heartbeatList || {})) {
        const last = beats[beats.length - 1];
        monitors.push({ name: lab.names[id] || "Monitor " + id, status: last ? last.status : 2 });
      }
      if (!monitors.length) { render([], `No monitors on status page "${slug}"`); return; }
    }
    const nowDown = new Set(monitors.filter(m => m.status === 0).map(m => m.name));
    const fresh = [...nowDown].filter(n => !lab.down.has(n));
    const recovered = [...lab.down].filter(n => !nowDown.has(n));
    lab.down = nowDown;
    render(monitors, nowDown.size ? `${[...nowDown].join(", ")} down` : "");
    if (fresh.length) bark(fresh.join(", ") + " down");
    else if (recovered.length && window.lilly) { window.lilly.say("heart", 2000); }
  }
  function render(monitors, msg) {
    const card = document.getElementById("wLab"), grid = card.querySelector(".lab-grid");
    grid.replaceChildren(...monitors.map(m => {
      const s = document.createElement("span");
      s.innerHTML = `<i class="dot ${m.status === 1 ? "up" : m.status === 0 ? "down" : "pend"}"></i>`;
      s.append(m.name); return s;
    }));
    card.classList.toggle("alert", !!msg && /down|offline/i.test(msg));
    card.querySelector(".lab-msg").innerHTML = msg ? `<span class="tag"></span>` : "";
    if (msg) card.querySelector(".tag").textContent = msg;
  }
  function bark(reason) {
    console.warn("[watchdog]", reason);
    // she barks from the top card (her only widget perch); the red Homelab card shows what's wrong
    if (window.lilly && window.lilly.alert) window.lilly.alert(0);
  }

  // ---------- schedule ----------
  const every = (fn, ms) => { const run = () => fn().catch(e => console.error(fn.name, e)); run(); return setInterval(run, ms); };
  (async () => {
    CFG = await loadConfig();
    if (!CFG) {
      for (const id of ["wAds", "wMc", "wLab"]) document.getElementById(id).querySelector(".sub, .mc, .lab-msg").textContent = "Not set up: add homelab.json";
      CFG = {};
      every(weather, 15 * 60000);
      return;
    }
    every(weather, 15 * 60000);
    every(ads, 60000);
    every(minecraft, 60000);
    every(watchdog, DEMO ? 5000 : 30000);
  })();
})();
