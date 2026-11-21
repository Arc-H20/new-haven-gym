"use strict";
const L = self.GymLib, S = self.Store;
const APP_VERSION = "1.0.2";
const $ = (sel, el = document) => el.querySelector(sel);

// h("div.cls#id", {attrs, onclick}, ...children)
function h(tag, attrs, ...kids) {
  const [t, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(t || "div");
  for (const r of rest) r[0] === "." ? el.classList.add(r.slice(1)) : (el.id = r.slice(1));
  if (attrs != null && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const svg = (markup, cls = "") => { const d = document.createElement("span"); d.className = "svgw " + cls; d.innerHTML = markup; return d; };
const LOGO = `<svg viewBox="0 0 64 64" aria-hidden="true"><use href="#logo"/></svg>`;
const CHECK = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 8 14.5 16 6" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- data ----------
let ctx = null;
function buildCtx() {
  const files = S.cache().files;
  const find = re => { const k = Object.keys(files).find(p => re.test(p)); return k ? { path: k, text: files[k].text } : null; };
  const exF = find(/(^|\/)Exercises\.md$/i), roF = find(/(^|\/)Routines\.md$/i);
  const lib = L.parseLibrary(exF ? exF.text : "");
  const routines = L.parseRoutines(roF ? roF.text : "", lib);
  const sessions = [];
  for (const [p, f] of Object.entries(files)) {
    if (!/(^|\/)Sessions\/[^/]+\.md$/i.test(p)) continue;
    const s = L.parseSession(f.text, p);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date)) continue;
    for (const e of s.entries) { e.name = L.resolve(lib, e.name) || e.name; e.unit = e.unit || (lib.ex[e.name] ? lib.ex[e.name].unit : "kg"); }
    sessions.push(s);
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path));
  const sessFolder = (Object.keys(files).find(p => /(^|\/)Sessions\//.test(p)) || "Sessions/x").replace(/\/[^/]+$/, "");
  ctx = { lib, routines, sessions, routinesPath: roF ? roF.path : "Routines.md", sessFolder, hasData: !!(exF || roF) };
  return ctx;
}
const today = () => L.isoDate(new Date());
const unitOf = name => (ctx.lib.ex[name] ? ctx.lib.ex[name].unit : "kg");
const fmtW = (w, unit) => w == null || w === "" ? (unit === "pin" ? "pin –" : "– kg") : L.fmtWeight(w, unit);
const rangeTxt = r => `${r[0]}–${r[1]} reps`;

// ---------- sync status ----------
let syncState = { busy: false, error: null };
async function syncNow({ quiet } = {}) {
  if (!S.settings()) return;
  syncState = { busy: true, error: null }; paintStatus();
  try { if (S.outbox().length) await S.flush(); await S.sync(); syncState = { busy: false, error: null }; }
  catch (e) { syncState = { busy: false, error: e.message, offline: e.status === -1 }; }
  buildCtx(); paintStatus();
  if (!quiet && !["ex", "finish", "connect"].includes(route.name)) render();
}
function statusText() {
  const n = S.outbox().length;
  if (syncState.busy) return "Syncing…";
  if (syncState.offline) return n ? `Offline · ${n} waiting to upload` : "Offline";
  if (syncState.error) return n ? `${n} waiting to upload` : "Couldn't sync";
  if (n) return `${n} waiting to upload`;
  return "Synced";
}
function paintStatus() { document.querySelectorAll("[data-status]").forEach(el => (el.textContent = statusText())); }

// ---------- routing ----------
const VIEWS = {};
let route = { name: "home", arg: null };
function go(name, arg = null, { replace } = {}) {
  route = { name, arg };
  const hash = "#" + name + (arg ? "/" + encodeURIComponent(arg) : "");
  replace ? history.replaceState(route, "", hash) : history.pushState(route, "", hash);
  render(); window.scrollTo(0, 0);
}
window.addEventListener("popstate", e => { route = e.state || parseHash(); render(); });
function parseHash() { const [n, a] = location.hash.slice(1).split("/"); return { name: VIEWS[n] ? n : "home", arg: a ? decodeURIComponent(a) : null }; }

const TABS = [["log", "Log", "M4 6h16M4 12h16M4 18h10"], ["week", "Week", "M5 20V10M12 20V4M19 20v-7"], ["history", "History", "M4 18l5-6 4 3 7-9"], ["more", "More", "M5 12h.01M12 12h.01M19 12h.01"]];
function tabbar(active) {
  return h("nav.tabbar", { "aria-label": "Sections" }, TABS.map(([k, label, d]) =>
    h("button.tab" + (k === active ? ".on" : ""), { onclick: () => go(k), "aria-current": k === active ? "page" : null },
      svg(`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`, "ti"), label)));
}
function topbar(title, sub, right) {
  return h("header.topbar", h("button.logo-btn", { onclick: () => go("home"), "aria-label": "Home" }, svg(LOGO)),
    h("div.grow", sub ? h("div.eyebrow", sub) : null, h("h1.title", title)), right || null);
}

function render() {
  const app = $("#app");
  if (!S.settings() && route.name !== "connect") { route = { name: "connect" }; }
  const v = VIEWS[route.name] || VIEWS.home;
  app.replaceChildren(v(route.arg));
  paintTimer(); paintStatus(); placeOverlays();
}

// ---------- draft (workout in progress) ----------
const draft = () => S.draft();
function saveDraft(d) { S.setDraft(d); }
function exState(d, name) {
  if (!d.ex[name]) {
    const t = L.target(ctx, name, d.routine);
    const rows = L.plan(t).map(p => ({ w: p.w === "" ? "" : p.w, r: "", tr: p.tr, rir: "", done: false,
      warm: t.weight != null && p.w !== "" && p.w < t.weight && t.style !== "topset" }));
    if (t.style === "topset" && rows.length) { const ti = rows.findIndex(r => r.w === t.weight); rows.forEach((r, i) => { r.warm = ti >= 0 && i < ti; }); }
    else if (t.weight != null) {
      // Warm-ups only before the first working set; lighter sets logged after it last time are dropped.
      const first = rows.findIndex(r => !r.warm);
      for (let i = rows.length - 1; i > first; i--) if (rows[i].warm) rows.splice(i, 1);
    }
    d.ex[name] = { unit: t.unit || unitOf(name), rows, note: "", status: "todo" };
  }
  return d.ex[name];
}
function startWorkout(routine) {
  const r = ctx.routines[routine];
  const d = { routine, date: today(), startedAt: Date.now(), order: r ? r.items.map(i => i.name) : [], ex: {} };
  saveDraft(d); requestWake(); go("log", null);
}
function verdict(d, name) {
  const st = d.ex[name]; const range = L.repRange(ctx.routines, d.routine, name);
  const work = st.rows.filter(r => r.done && !r.warm && r.r !== "");
  const ok = work.filter(r => +r.r >= range[0]).length;
  return { ok, n: work.length, all: work.length > 0 && ok === work.length };
}

// ---------- rest timer ----------
let timerTick = null;
function startRest(secs, ask) {
  const d = draft(); if (!d) return;
  d.rest = { end: Date.now() + secs * 1000, total: secs, ask: ask || null, fired: false }; saveDraft(d); paintTimer();
}
function paintTimer() {
  const host = $("#timer-host"); if (!host) return;
  const d = draft(); const rest = d && d.rest;
  if (!rest || !["log", "ex"].includes(route.name)) { host.replaceChildren(); host.hidden = true; clearInterval(timerTick); timerTick = null; placeOverlays(); return; }
  host.hidden = false;
  const left = Math.max(0, Math.round((rest.end - Date.now()) / 1000));
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  const kids = [];
  const ask = rest.ask && d.ex[rest.ask.name] && d.ex[rest.ask.name].rows[rest.ask.i];
  if (ask && ask.rir === "") {
    kids.push(h("div.timer-q", `${rest.ask.label}: how many more reps could you have done?`),
      h("div.rir", ["0", "1", "2", "3+"].map(v => h("button.rchip", { onclick: () => {
        const dd = draft(); dd.ex[rest.ask.name].rows[rest.ask.i].rir = v === "3+" ? "3" : v; saveDraft(dd); paintTimer(); if (route.name === "ex") render();
      } }, v))));
  }
  kids.unshift(h("div.timer-row", h("b.timer-t" + (left === 0 ? ".zero" : ""), { "aria-live": "off" }, left === 0 ? "Go" : mm),
    h("span.grow.timer-l", left === 0 ? "Rest done" : "Rest"),
    h("button.tbtn", { onclick: () => { const dd = draft(); dd.rest.end += 30000; saveDraft(dd); paintTimer(); } }, "+30s"),
    h("button.tbtn", { onclick: () => { const dd = draft(); delete dd.rest; saveDraft(dd); paintTimer(); } }, left === 0 ? "Close" : "Skip")));
  host.replaceChildren(h("div.timer", kids)); placeOverlays();
  if (left === 0 && !rest.fired) { rest.fired = true; const dd = draft(); dd.rest.fired = true; saveDraft(dd); alertRestDone(); }
  if (!timerTick) timerTick = setInterval(() => { const t = $(".timer-t"); const dd = draft(); if (!dd || !dd.rest) return paintTimer();
    const l = Math.max(0, Math.round((dd.rest.end - Date.now()) / 1000)); if (l === 0 || !t) return paintTimer(); t.textContent = `${Math.floor(l / 60)}:${String(l % 60).padStart(2, "0")}`; }, 500);
}
let audioCtx = null;
function alertRestDone() {
  try { navigator.vibrate && navigator.vibrate([350, 150, 350]); } catch {}
  if (!S.prefs().sound) return;
  try { audioCtx = audioCtx || new AudioContext(); const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.2, audioCtx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + 0.6); } catch {}
}
let wakeLock = null;
async function requestWake() { try { if (draft() && navigator.wakeLock && !wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => (wakeLock = null)); } } catch {} }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { requestWake(); paintTimer(); } });

// Keeps the toast above the timer/tab bar and the page scrollable past the timer.
function placeOverlays() {
  const timer = $("#timer-host"), host = $("#toast-host"); const hasTabs = !!$(".tabbar");
  const th = timer.hidden ? 0 : timer.offsetHeight;
  document.documentElement.style.setProperty("--timerh", th + "px");
  host.style.bottom = th ? `calc(${th}px + var(--tabh) + var(--sab) + 12px)` : hasTabs ? "calc(var(--tabh) + var(--sab) + 12px)" : "calc(var(--sab) + 20px)";
}
// ---------- toast (finished exercise pill) ----------
let toastT = null;
function toast({ title, sub, ok, undo }) {
  const host = $("#toast-host");
  const el = h("div.toast", { role: "status" }, h("span.check" + (ok ? "" : ".out"), svg(CHECK)),
    h("div.grow", h("b", title), sub ? h("div.toast-sub", sub) : null),
    undo ? h("button.toast-u", { onclick: () => { undo(); host.replaceChildren(); } }, "Undo") : null);
  host.replaceChildren(el); placeOverlays(); requestAnimationFrame(() => el.classList.add("in"));
  clearTimeout(toastT); toastT = setTimeout(() => { el.classList.remove("in"); setTimeout(() => el.remove(), 300); }, 4500);
}

// ---------- exercise picker (add / swap) ----------
function picker({ title, onPick, exclude = [] }) {
  const host = $("#sheet-host");
  const list = h("div.plist");
  const input = h("input.search#pick-search", { type: "search", placeholder: "Search exercises", autocomplete: "off", "aria-label": "Search exercises" });
  const all = Object.values(ctx.lib.ex).filter(e => !exclude.includes(e.name)).sort((a, b) => a.name.localeCompare(b.name));
  const paint = () => {
    const q = L.norm(input.value);
    const hits = all.filter(e => !q || L.norm(e.name).includes(q) || e.aliases.some(a => L.norm(a).includes(q))).slice(0, 60);
    list.replaceChildren(...hits.map(e => h("button.prow", { onclick: () => { close(); onPick(e.name); } }, h("span.grow", e.name), h("span.dim", e.muscle))),
      hits.length ? null : h("div.empty", "No match. Ask Claude to add it to your exercise list."));
  };
  const close = () => host.replaceChildren();
  input.addEventListener("input", paint);
  host.replaceChildren(h("div.scrim", { onclick: close }), h("div.sheet", { role: "dialog", "aria-label": title },
    h("div.grab"), h("div.rowx", h("h2.sheet-t.grow", title), h("button.linkbtn", { onclick: close }, "Close")), input, list));
  paint(); setTimeout(() => input.focus(), 50);
}

// ================= VIEWS =================

// ---------- Home ----------
VIEWS.home = () => {
  const d = draft();
  const sel = homeSel();
  const nowIso = today();
  const wk = L.weekStart(new Date());
  const wkIso = L.isoDate(wk);
  const thisWeek = ctx.sessions.filter(s => s.date >= wkIso).length;
  const monthIso = nowIso.slice(0, 8) + "01";
  const bests = countBests(monthIso);

  // Training map: 9 columns (weeks, oldest left), 7 rows Mon..Sun.
  const trained = new Set(ctx.sessions.map(s => s.date));
  const start = new Date(wk); start.setDate(start.getDate() - 7 * 8);
  const cells = []; const monthMarks = [];
  for (let w = 0; w < 9; w++) {
    const col = new Date(start); col.setDate(col.getDate() + w * 7);
    monthMarks.push(col.getDate() <= 7 || w === 0 ? L.MONTHS[col.getMonth()] : "");
  }
  for (let r = 0; r < 7; r++) for (let w = 0; w < 9; w++) {
    const day = new Date(start); day.setDate(day.getDate() + w * 7 + r);
    const iso = L.isoDate(day);
    const cls = iso > nowIso ? ".x" : trained.has(iso) ? ".f" : "";
    cells.push(h("i" + cls + (iso === nowIso ? ".today" : ""), { title: L.prettyDate(iso) + (trained.has(iso) ? " · trained" : "") }));
  }
  const count9 = ctx.sessions.filter(s => s.date >= L.isoDate(start)).length;

  const dayTile = d
    ? h("div.tile.today", h("div.rowx", h("div.grow", h("div.eyebrow", "In progress"), h("div.disp.big", d.routine),
        h("div.dim.small", `${d.order.filter(n => d.ex[n] && d.ex[n].status === "done").length} of ${d.order.length} done`)),
        h("button.go.go-sm", { onclick: () => { requestWake(); go("log"); } }, "Resume")))
    : h("div.tile.today", h("div.rowx", h("div.grow", h("div.eyebrow", sel === L.nextRoutine(ctx.sessions) ? "Today" : "Chosen"), h("div.disp.big", sel)),
        h("button.go.go-sm", { onclick: () => startWorkout(sel), disabled: !ctx.routines[sel] }, "Start")),
      h("div.next", { role: "group", "aria-label": "Choose day" }, rotationFrom(L.nextRoutine(ctx.sessions)).map(r =>
        h("button" + (r === sel ? ".on" : ""), { onclick: () => { homeSelVal = r; render(); }, "aria-pressed": r === sel ? "true" : "false" }, r))));

  return h("div.page.home",
    h("header.home-top", svg(LOGO, "home-logo"), h("span.grow"), h("span.dim.small", L.prettyDate(nowIso))),
    ctx.hasData ? null : h("div.callout", "No routines or exercises found in the repo yet. Check Settings."),
    h("section.map", h("div.rowx", h("span.grow.strong", "Last 9 weeks"), h("span.dim.small", `${count9} session${count9 === 1 ? "" : "s"}`)),
      h("div.heat", { role: "img", "aria-label": `Training map: ${count9} sessions in the last 9 weeks` }, cells),
      h("div.heat-m", monthMarks.map(m => h("span", m)))),
    dayTile,
    h("div.grid2",
      navTile("Week", `${thisWeek} session${thisWeek === 1 ? "" : "s"}`, () => go("week")),
      navTile("History", `${bests} new best${bests === 1 ? "" : "s"} this month`, () => go("history")),
      navTile("Routines", `${Object.keys(ctx.routines).length} days`, () => go("routines")),
      navTile("Settings", h("span", { "data-status": "" }, statusText()), () => go("more"))));
};
let homeSelVal = null;
function homeSel() { return homeSelVal && ctx.routines[homeSelVal] ? homeSelVal : L.nextRoutine(ctx.sessions); }
function rotationFrom(first) { const i = L.ROTATION.indexOf(first); return i < 0 ? L.ROTATION : [...L.ROTATION.slice(i), ...L.ROTATION.slice(0, i)]; }
const navTile = (t, sub, fn) => h("button.tile.nav", { onclick: fn }, h("div.strong", t), h("div.dim.small", sub));
function countBests(fromIso) {
  let n = 0;
  ctx.sessions.forEach((s, i) => { if (s.date < fromIso) return; n += L.sessionSummary(ctx, s, ctx.sessions.slice(0, i), null).bests.length; });
  return n;
}

// ---------- Log (plan when idle, workout list when running) ----------
let editMode = false;
VIEWS.log = () => {
  const d = draft();
  return d ? workoutList(d) : planView();
};

function planView() {
  const sel = homeSel();
  const r = ctx.routines[sel];
  const items = r ? r.items : [];
  const list = h("div.list#plan-list");
  const rows = items.map((it, i) => editMode
    ? h("div.lrow.edit", { "data-i": i }, h("span.grip", { "aria-label": `Drag to move ${it.name}`, role: "button", tabindex: 0 }),
        h("span.grow.strong", it.name), h("button.xbtn", { "aria-label": `Remove ${it.name}`, onclick: () => saveOrder(sel, items.filter((_, k) => k !== i)) }))
    : h("div.lrow", h("span.grow.strong", it.name)));
  list.append(...rows);
  if (editMode) {
    list.append(h("button.lrow.add", { onclick: () => picker({ title: `Add to ${sel}`, exclude: items.map(x => x.name),
      onPick: name => saveOrder(sel, [...items, { name, sets: null, range: null, style: "double", ss: null }]) }) }, h("span.plus"), h("span.grow.strong", "Add exercise")));
    enableDrag(list, items, sel);
  }
  return h("div.page",
    topbar(sel, `${L.STRENGTH_DAYS.includes(sel) ? "Strength" : "Hypertrophy"} · ${items.length} exercises`,
      h("button.linkbtn", { onclick: () => { editMode = !editMode; render(); } }, editMode ? "Done" : "Edit")),
    h("div.chips", { role: "group", "aria-label": "Choose day" }, L.ROTATION.filter(x => ctx.routines[x]).map(x =>
      h("button.chip" + (x === sel ? ".on" : ""), { onclick: () => { homeSelVal = x; render(); }, "aria-pressed": x === sel ? "true" : "false" }, x))),
    r && r.rir ? h("div.hint", `Aim for ${r.rir[0]}–${r.rir[1]} reps in reserve on working sets.`) : null,
    list,
    h("div.foot", h("button.go", { onclick: () => startWorkout(sel), disabled: !items.length }, `Start ${sel}`)),
    tabbar("log"));
}
function saveOrder(routine, items) {
  S.enqueue({ kind: "routine", path: ctx.routinesPath, routine, items, label: routine });
  buildCtx(); render(); S.flush().then(() => syncNow({ quiet: true })).catch(() => paintStatus());
}
function enableDrag(list, items, routine) {
  let drag = null;
  list.addEventListener("pointerdown", e => {
    const grip = e.target.closest(".grip"); if (!grip) return;
    const row = grip.closest(".lrow"); e.preventDefault();
    const rows = [...list.querySelectorAll(".lrow.edit")];
    drag = { row, from: +row.dataset.i, rows, startY: e.clientY, h: row.getBoundingClientRect().height, to: +row.dataset.i };
    row.classList.add("dragging"); row.setPointerCapture(e.pointerId);
    row.addEventListener("pointermove", move); row.addEventListener("pointerup", up, { once: true }); row.addEventListener("pointercancel", up, { once: true });
  });
  function move(e) {
    const dy = e.clientY - drag.startY;
    drag.row.style.transform = `translateY(${dy}px)`;
    drag.to = Math.max(0, Math.min(drag.rows.length - 1, drag.from + Math.round(dy / drag.h)));
    drag.rows.forEach((r, i) => { if (r === drag.row) return;
      const shift = drag.from < drag.to ? (i > drag.from && i <= drag.to ? -1 : 0) : (i < drag.from && i >= drag.to ? 1 : 0);
      r.style.transform = shift ? `translateY(${shift * drag.h}px)` : ""; });
  }
  function up() {
    drag.row.removeEventListener("pointermove", move);
    const { from, to } = drag; drag = null;
    if (from === to) return render();
    const next = items.slice(); const [m] = next.splice(from, 1); next.splice(to, 0, m);
    saveOrder(routine, next);
  }
  // Keyboard: arrow keys on a focused grip move it.
  list.addEventListener("keydown", e => {
    const grip = e.target.closest(".grip"); if (!grip || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
    const i = +grip.closest(".lrow").dataset.i, j = i + (e.key === "ArrowUp" ? -1 : 1);
    if (j < 0 || j >= items.length) return; e.preventDefault();
    const next = items.slice(); [next[i], next[j]] = [next[j], next[i]]; saveOrder(routine, next);
  });
}

function workoutList(d) {
  const mins = Math.max(1, Math.round((Date.now() - d.startedAt) / 60000));
  const doneN = d.order.filter(n => d.ex[n] && d.ex[n].status === "done").length;
  const rows = d.order.map(name => {
    const st = d.ex[name];
    const t = L.target(ctx, name, d.routine);
    const range = L.repRange(ctx.routines, d.routine, name);
    const status = st ? st.status : "todo";
    const doneSets = st ? st.rows.filter(r => r.done && !r.warm).length : 0;
    const planned = st ? st.rows.filter(r => !r.warm).length : 0;
    let right;
    if (status === "done") { const v = verdict(d, name); right = h("span.badge" + (v.all ? "" : ".muted"), v.all ? "In range" : `${v.ok} of ${v.n} in range`); }
    else if (status === "skipped") right = h("span.badge.muted", "Skipped");
    else if (doneSets) right = h("span.badge.muted", `${doneSets} of ${planned}`);
    else right = h("span.chev");
    const ring = status === "done" ? ".done" : doneSets ? ".half" : status === "skipped" ? ".skip" : "";
    return h("button.lrow.tap", { onclick: () => go("ex", name) }, h("span.ring" + ring, status === "done" ? svg(CHECK) : null),
      h("div.grow", h("div.strong", name), h("div.dim.small", `${fmtW(t.weight, t.unit || unitOf(name))} | ${rangeTxt(range)}`)), right);
  });
  return h("div.page",
    topbar(d.routine, `${mins} min · ${doneN} of ${d.order.length} done`,
      h("button.linkbtn", { onclick: () => picker({ title: "Add exercise", exclude: d.order, onPick: name => { const dd = draft(); dd.order.push(name); saveDraft(dd); render(); } }) }, "+ Exercise")),
    h("div.list", rows),
    h("div.foot.col", h("button.ghost.wide", { onclick: () => go("finish") }, "Finish workout"),
      h("button.linkbtn.danger#discard", { onclick: () => askDiscard(d) }, "Discard workout")),
    tabbar("log"));
}
// Leave a workout without saving. Nothing is uploaded, so the rotation stays where it was.
function askDiscard(d) {
  const sets = Object.values(d.ex).reduce((n, st) => n + st.rows.filter(r => r.done).length, 0);
  if (!sets) return discardWorkout();
  const host = $("#sheet-host"); const close = () => host.replaceChildren();
  host.replaceChildren(h("div.scrim", { onclick: close }), h("div.sheet", { role: "dialog", "aria-label": "Discard workout" },
    h("div.grab"), h("h2.sheet-t", `Discard ${d.routine}?`),
    h("div.dim", `The ${sets} ${sets === 1 ? "set" : "sets"} you've logged won't be saved. You can then pick another day and start again.`),
    h("div.foot.col", h("button.go.danger-go#discard-yes", { onclick: () => { close(); discardWorkout(); } }, "Discard workout"),
      h("button.ghost.wide", { onclick: close }, "Keep going"))));
}
function discardWorkout() {
  const d = draft(); const routine = d && d.routine;
  S.setDraft(null); try { wakeLock && wakeLock.release(); } catch {}
  clearInterval(timerTick); timerTick = null; editMode = false;
  if (routine) homeSelVal = routine;
  go("log", null, { replace: true });
}

// ---------- Exercise logging (option A) ----------
VIEWS.ex = name => {
  const d = draft();
  if (!d || !name) { setTimeout(() => go("log", null, { replace: true })); return h("div"); }
  const st = exState(d, name); saveDraft(d);
  const t = L.target(ctx, name, d.routine);
  const range = L.repRange(ctx.routines, d.routine, name);
  const curW = (st.rows.find(r => !r.warm && r.w !== "") || {}).w;
  const e1 = bestE1(name, st);
  let n = 0;
  const grid = h("div.sets", h("span.h", "Set"), h("span.h.c", st.unit === "pin" ? "pin" : "kg"), h("span.h.c", "reps"), h("span.h.c", "RIR"), h("span"),
    st.rows.map((row, i) => {
      const label = row.warm ? "W" : String(++n);
      const wIn = h("input.num-in", { type: "text", inputmode: "decimal", value: row.w === "" ? "" : row.w, placeholder: "–", "aria-label": `Set ${label} weight`,
        onchange: e => upd(i, { w: e.target.value === "" ? "" : parseFloat(e.target.value.replace(",", ".")) }) });
      const rIn = h("input.num-in", { type: "text", inputmode: "numeric", value: row.r, placeholder: row.tr === "" ? "–" : String(row.tr), "aria-label": `Set ${label} reps`,
        onchange: e => upd(i, { r: e.target.value === "" ? "" : parseInt(e.target.value, 10) }) });
      const rir = row.warm ? h("span.cap.c", "warm-up") : h("button.rv" + (row.rir === "" ? ".dim" : ""), { "aria-label": `Set ${label} reps in reserve`, onclick: () => cycleRir(i) }, row.rir === "" ? "–" : row.rir === "3" ? "3+" : row.rir);
      const chk = h("button.chk" + (row.done ? ".on" : ""), { "aria-label": row.done ? `Set ${label} done, tap to undo` : `Mark set ${label} done`, onclick: () => tick(i, label) }, svg(CHECK));
      return [h("span.sl", label), wIn, rIn, rir, chk];
    }));
  function upd(i, patch) { const dd = draft(); Object.assign(dd.ex[name].rows[i], patch); saveDraft(dd); }
  function cycleRir(i) { const dd = draft(); const r = dd.ex[name].rows[i]; const order = ["", "0", "1", "2", "3"]; r.rir = order[(order.indexOf(r.rir) + 1) % order.length]; saveDraft(dd); render(); }
  function tick(i, label) {
    const dd = draft(); const ex = dd.ex[name]; const row = ex.rows[i];
    if (row.done) { row.done = false; ex.status = "todo"; saveDraft(dd); return render(); }
    if (row.w === "" || row.w == null) { const inp = grid.querySelectorAll(".num-in")[i * 2]; inp.focus(); inp.classList.add("need"); return; }
    if (row.r === "" && row.tr !== "") row.r = +row.tr;
    if (row.r === "") { const inp = grid.querySelectorAll(".num-in")[i * 2 + 1]; inp.focus(); inp.classList.add("need"); return; }
    row.done = true;
    const next = ex.rows.findIndex((r, k) => k > i && !r.done && r.w === "");
    if (next >= 0) ex.rows[next].w = row.w;
    saveDraft(dd);
    const allDone = ex.rows.every(r => r.done);
    startRest(L.restFor(dd.routine, name, S.prefs()), row.warm ? null : { name, i, label: `Set ${label}` });
    if (allDone) finishExercise(name); else render();
  }
  return h("div.page",
    h("header.topbar", h("button.back", { onclick: () => go("log"), "aria-label": "Back to list" }, h("span.chev.l"), "List"),
      h("h1.title.grow", name),
      h("button.linkbtn", { onclick: () => picker({ title: `Swap ${name} for…`, exclude: d.order, onPick: nn => swapEx(name, nn) }) }, "Swap")),
    h("div.stats",
      h("div.stat", h("div.disp.statv", curW == null || curW === "" ? "–" : L.fmtNum(curW), h("span.unit", st.unit === "pin" ? "pin" : "kg")), h("div.cap", "weight")),
      h("div.stat", h("div.disp.statv", `${range[0]}–${range[1]}`), h("div.cap", "rep range")),
      h("div.stat", h("div.disp.statv", e1 ? L.fmtNum(Math.round(e1 * 10) / 10) : "–", e1 ? h("span.unit", "kg") : null), h("div.cap", "est. 1RM"))),
    grid,
    h("div.rowx.actions",
      h("button.linkbtn", { onclick: () => { const dd = draft(); const rows = dd.ex[name].rows; const last = rows.filter(r => !r.warm).at(-1) || {};
        rows.push({ w: last.w ?? "", r: "", tr: last.tr ?? range[0], rir: "", done: false, warm: false }); dd.ex[name].status = "todo"; saveDraft(dd); render(); } }, "+ Add set"),
      h("span.grow"),
      h("button.linkbtn", { onclick: () => { const dd = draft(); dd.ex[name].status = "skipped"; saveDraft(dd); go("log"); } }, "Skip"),
      h("button.linkbtn", { onclick: e => { const ta = $("#note-" + CSS.escape(L.norm(name))); ta.hidden = !ta.hidden; if (!ta.hidden) ta.focus(); } }, "Note")),
    h("textarea.note#note-" + L.norm(name), { hidden: !st.note, placeholder: "Note for this exercise", "aria-label": "Note",
      oninput: e => { const dd = draft(); dd.ex[name].note = e.target.value; saveDraft(dd); } }, st.note),
    h("div.spacer"),
    tabbar("log"));
};
function bestE1(name, st) {
  if (st.unit !== "kg") return null;
  let b = 0;
  for (const e of L.history(ctx.sessions, name)) { const v = L.bestE1rm(e.sets); if (v && v > b) b = v; }
  for (const r of st.rows) if (r.done && r.r) { const v = L.e1rm(+r.w, +r.r); if (v > b) b = v; }
  return b || null;
}
function swapEx(oldName, newName) {
  const d = draft(); d.order = d.order.map(n => (n === oldName ? newName : n)); delete d.ex[oldName]; saveDraft(d); go("ex", newName, { replace: true });
}
function finishExercise(name) {
  const d = draft(); d.ex[name].status = "done"; saveDraft(d);
  const v = verdict(d, name);
  go("log");
  toast({ title: name, sub: v.all ? "All sets in range" : `${v.ok} of ${v.n} sets in range`, ok: v.all,
    undo: () => { const dd = draft(); dd.ex[name].status = "todo"; const rows = dd.ex[name].rows; const li = rows.map(r => r.done).lastIndexOf(true); if (li >= 0) rows[li].done = false; saveDraft(dd); go("ex", name); } });
}

// ---------- Finish ----------
VIEWS.finish = () => {
  const d = draft(); if (!d) { setTimeout(() => go("home", null, { replace: true })); return h("div"); }
  const s = draftToSession(d);
  const targets = {}; for (const n of d.order) targets[n] = L.target(ctx, n, d.routine);
  const sum = L.sessionSummary(ctx, s, ctx.sessions.filter(x => x.date <= s.date), targets);
  const skipped = s.entries.filter(e => e.skipped).map(e => e.name);
  let note = d.note || "";
  return h("div.page",
    topbar(`${d.routine} done · ${s.duration} min`, L.prettyDate(d.date)),
    h("div.stats",
      h("div.stat", h("div.disp.statv", sum.sets), h("div.cap", "sets")),
      h("div.stat", h("div.disp.statv", sum.planned ? `${sum.hit}/${sum.planned}` : "–"), h("div.cap", "targets hit")),
      h("div.stat", h("div.disp.statv", sum.exercises), h("div.cap", "exercises"))),
    sum.bests.length ? h("section", h("div.eyebrow", "New bests"), h("div.list", sum.bests.map(b => h("div.lrow",
      h("span.grow", h("b", b.name), " ", b.e1rm ? `est. 1RM ${L.fmtNum(Math.round(b.e1rm * 10) / 10)} kg` : `${L.fmtWeight(b.cur.w, b.unit)} × ${b.cur.r}`),
      h("span.dim.small", b.e1rm ? `+${L.fmtNum(Math.round((b.e1rm - b.prevE) * 10) / 10)}` : `was ${L.fmtWeight(b.prev.w, b.unit)} × ${b.prev.r}`))))) : null,
    sum.cmp ? h("div.dim.small", `vs last ${d.routine} (${L.prettyDate(sum.cmp.date)}): ${sum.sets - sum.cmp.sets >= 0 ? "+" : ""}${sum.sets - sum.cmp.sets} sets`) : null,
    h("label.eyebrow", { for: "sess-note" }, "Session note"),
    h("textarea.note#sess-note", { placeholder: "How did it feel?", oninput: e => { note = e.target.value; const dd = draft(); dd.note = note; saveDraft(dd); } }, note),
    skipped.length ? h("div.dim.small", `Skipped: ${skipped.join(", ")}`) : null,
    h("div.foot.col", h("button.go", { onclick: () => saveWorkout() }, "Finish & save"),
      h("div.cap.c", `Saves ${ctx.sessFolder}/${d.date} ${d.routine}.md to your log`),
      h("button.linkbtn.c", { onclick: () => go("log") }, "Back to workout"),
      h("button.linkbtn.c.danger", { onclick: e => { if (e.target.dataset.sure) { S.setDraft(null); go("home"); } else { e.target.dataset.sure = "1"; e.target.textContent = "Tap again to discard this workout"; } } }, "Discard workout")),
    tabbar("log"));
};
function draftToSession(d) {
  const entries = d.order.map(name => {
    const st = d.ex[name];
    const sets = st ? st.rows.filter(r => r.done && r.w !== "").map(r => ({ w: +r.w, r: r.r === "" ? null : +r.r, ...(r.rir !== "" ? { rir: +r.rir } : {}) })) : [];
    return { name, unit: st ? st.unit : unitOf(name), sets, skipped: !sets.length, note: st ? st.note : "" };
  });
  return { routine: d.routine, date: d.date, entries, duration: Math.max(1, Math.round((Date.now() - d.startedAt) / 60000)), path: `${ctx.sessFolder}/${d.date} ${d.routine}.md` };
}
async function saveWorkout() {
  const d = draft(); const s = draftToSession(d);
  if (d.note && d.note.trim()) s.entries.push({ name: "Session note", unit: "kg", sets: [], skipped: true, note: d.note.trim() });
  const full = L.formatSession(s).replace(/\n- Session note: skipped \/\/ (.*)\n?$/, "\n> $1\n");
  const entriesText = s.entries.filter(e => e.name !== "Session note").map(L.formatEntry).join("\n");
  S.enqueue({ kind: "session", path: s.path, entriesText, fullText: full, label: `${s.routine} ${s.date}` });
  S.setDraft(null); try { wakeLock && wakeLock.release(); } catch {}
  buildCtx(); homeSelVal = null; go("home");
  try { await S.flush(); toast({ title: "Workout saved", sub: `${s.routine} · ${s.date}`, ok: true }); syncNow({ quiet: true }); }
  catch (e) { toast({ title: "Saved on this phone", sub: e.status === -1 ? "It'll upload when you're online." : e.message, ok: false }); paintStatus(); }
}

async function checkForUpdates() {
  toast({ title: "Checking for updates…", ok: true });
  try {
    const r = await navigator.serviceWorker.getRegistration();
    if (r) {
      await r.update();
      const sw = r.installing || r.waiting;
      if (sw) await new Promise(res => { if (sw.state === "activated") return res(); sw.addEventListener("statechange", () => sw.state === "activated" && res()); setTimeout(res, 8000); });
    }
  } catch {}
  location.reload();
}

// ---------- Week ----------
VIEWS.week = () => {
  const wk = L.weekStart(new Date()); const from = L.isoDate(wk); const end = new Date(wk); end.setDate(end.getDate() + 6);
  const ms = L.muscleSets(ctx, from, L.isoDate(end));
  const muscles = ["Chest", "Back", "Shoulders", "Triceps", "Biceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core"].filter(m => ms[m] != null || ["Chest", "Back", "Shoulders", "Triceps", "Biceps", "Quads", "Hamstrings"].includes(m));
  const n = ctx.sessions.filter(s => s.date >= from).length;
  const nxt = L.nextRoutine(ctx.sessions);
  const doneWk = new Set(ctx.sessions.filter(s => s.date >= from).map(s => s.routine));
  const stalled = [];
  for (const r of L.ROTATION) for (const it of (ctx.routines[r] ? ctx.routines[r].items : [])) {
    if (stalled.some(x => x.name === it.name)) continue;
    const t = L.target(ctx, it.name, r); if (t.kind === "deload") stalled.push({ name: it.name, stall: t.stall });
  }
  return h("div.page",
    topbar("This week", `${L.prettyDate(from)} – ${L.prettyDate(L.isoDate(end))}`),
    h("div.seg", L.ROTATION.map((r, i) => h("span" + (doneWk.has(r) ? ".done" : r === nxt ? ".next" : ""), r))),
    h("div.dim.small", `${n} session${n === 1 ? "" : "s"} this week · next up ${nxt}`),
    h("section.card", h("div.rowx", h("span.grow.strong", "Hard sets per muscle"), h("span.dim.small", "goal 10–20")),
      muscles.map(m => { const v = ms[m] || 0; const pct = Math.min(100, (v / 25) * 100);
        return h("div.mrow", h("span", m), h("div.bar", h("i.zone"), h("i.fill" + (v >= 10 && v <= 20 ? ".ok" : ""), { style: { width: pct + "%" } })), h("b.num", v)); }),
      h("div.cap", "Counts sets at 3 or fewer reps in reserve (or 80%+ of the top weight when RIR wasn't logged). Bars stop at 25.")),
    stalled.length ? h("section.card", h("div.strong", "Stalled"), stalled.slice(0, 4).map(s => h("div.dim.small", `${s.name}: no progress in ${s.stall} sessions. A lighter week will help.`))) : null,
    tabbar("week"));
};

// ---------- History ----------
let histMode = "e1rm";
VIEWS.history = arg => {
  const names = [...new Set(ctx.sessions.flatMap(s => s.entries.filter(e => !e.skipped && e.sets.length).map(e => e.name)))].sort();
  const name = arg && names.includes(arg) ? arg : (names.includes("Incline DB press") ? "Incline DB press" : names[0]);
  if (!name) return h("div.page", topbar("History"), h("div.empty", "No sessions yet."), tabbar("history"));
  const hist = L.history(ctx.sessions, name).filter(e => !e.skipped && e.sets.length);
  const unit = hist.at(-1).unit;
  const pts = hist.map(e => ({ date: e.date, v: histMode === "e1rm" && unit === "kg" ? L.bestE1rm(e.sets) : (L.bestSet(e.sets) || {}).w })).filter(p => p.v);
  const best = hist.reduce((b, e) => { const s = L.bestSet(e.sets); return s && (!b || s.w > b.s.w || (s.w === b.s.w && s.r > b.s.r)) ? { s, date: e.date } : b; }, null);
  return h("div.page",
    topbar(name, "Exercise history", h("button.linkbtn", { onclick: () => picker({ title: "Choose exercise", onPick: n => go("history", n, { replace: true }) }) }, "Change")),
    unit === "kg" ? h("div.chips", ["e1rm", "top"].map(m => h("button.chip" + (histMode === m ? ".on" : ""), { onclick: () => { histMode = m; render(); } }, m === "e1rm" ? "est. 1RM" : "Top set"))) : null,
    chart(pts, unit === "kg" ? "kg" : "pin"),
    best ? h("div.small", h("b", `Best ${L.fmtWeight(best.s.w, unit)} × ${best.s.r}`), h("span.dim", ` · ${L.prettyDate(best.date)}`)) : null,
    h("div.list", hist.slice().reverse().map(e => h("div.lrow.tall", h("div.grow", h("div", h("b", L.prettyDate(e.date)), h("span.dim", ` · ${e.routine}`)),
      h("div.dim.small", e.sets.map(L.fmtSetPretty).join(", ") + (e.note ? ` · ${e.note}` : "")))))),
    tabbar("history"));
};
function niceTicks(min, max) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min; const raw = span / 3; const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const t = []; for (let v = lo; v <= hi + 1e-9; v += step) t.push(Math.round(v * 100) / 100);
  return t;
}
function chart(pts, unit) {
  if (pts.length < 2) return h("div.card.dim.small", "Log this exercise twice to see a trend.");
  const W = 320, H = 170, L0 = 34, R = 10, T = 12, B = 26;
  const ticks = niceTicks(Math.min(...pts.map(p => p.v)), Math.max(...pts.map(p => p.v)));
  const lo = ticks[0], hi = ticks.at(-1);
  const t0 = L.parseIso(pts[0].date).getTime(), t1 = L.parseIso(pts.at(-1).date).getTime();
  const x = d => L0 + ((L.parseIso(d).getTime() - t0) / Math.max(1, t1 - t0)) * (W - L0 - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const months = []; const c = L.parseIso(pts[0].date); c.setDate(1); c.setMonth(c.getMonth() + 1);
  while (c.getTime() <= t1) { months.push({ x: x(L.isoDate(c)), m: L.MONTHS[c.getMonth()] }); c.setMonth(c.getMonth() + 1); }
  const line = pts.map(p => `${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const last = pts.at(-1);
  return svg(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend from ${L.fmtNum(Math.round(pts[0].v * 10) / 10)} to ${L.fmtNum(Math.round(last.v * 10) / 10)} ${unit}">
    ${ticks.map(t => `<line x1="${L0}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L0 - 6}" y="${y(t) + 4}" text-anchor="end" class="ax">${t}</text>`).join("")}
    ${months.map(m => `<text x="${m.x}" y="${H - 6}" text-anchor="middle" class="ax">${m.m}</text>`).join("")}
    <polyline points="${line}" class="ln"/>${pts.map(p => `<circle cx="${x(p.date)}" cy="${y(p.v)}" r="2.5" class="pt"/>`).join("")}
    <circle cx="${x(last.date)}" cy="${y(last.v)}" r="5" class="end"/></svg>`, "chart card");
}

// ---------- Routines ----------
VIEWS.routines = () => h("div.page",
  topbar("Routines", "Rotation: " + L.ROTATION.join(" → ")),
  L.ROTATION.filter(r => ctx.routines[r]).map(r => { const R = ctx.routines[r];
    return h("section.card", h("div.rowx", h("span.disp.med.grow", r), h("span.dim.small", `${rangeTxt(R.range)}${R.rir ? ` · RIR ${R.rir[0]}–${R.rir[1]}` : ""}`)),
      R.items.map(it => h("div.rrow", h("span.grow", (it.ss && R.items[R.items.indexOf(it) - 1] && R.items[R.items.indexOf(it) - 1].ss === it.ss ? "+ " : "") + it.name),
        h("span.dim.small", [it.sets ? `${it.sets} sets` : null, it.range ? rangeTxt(it.range) : null, it.style === "topset" ? "top set" : null].filter(Boolean).join(" · ")))));
  }),
  h("div.cap", "Reorder, add or remove exercises from Log → Edit. Sets and rep ranges are changed with Claude on your PC."),
  tabbar("more"));

// ---------- More / Settings ----------
VIEWS.more = () => {
  const s = S.settings() || {}; const p = S.prefs(); const ob = S.outbox(); const c = S.cache();
  const prefIn = (key, label) => h("label.prefrow", h("span.grow", label),
    h("input.num-in.sm", { type: "text", inputmode: "numeric", value: p[key], "aria-label": label + " in seconds",
      onchange: e => { const v = parseInt(e.target.value, 10); if (v > 0) { const pp = S.prefs(); pp[key] = v; S.setPrefs(pp); } } }), h("span.dim.small", "s"));
  return h("div.page",
    topbar("More"),
    h("div.list",
      h("button.lrow.tap", { onclick: () => go("routines") }, h("div.grow", h("div.strong", "Routines"), h("div.dim.small", `${Object.keys(ctx.routines).length} days, sets and rep ranges`)), h("span.chev")),
      h("button.lrow.tap", { onclick: () => go("exercises") }, h("div.grow", h("div.strong", "Exercises"), h("div.dim.small", `${Object.keys(ctx.lib.ex).length} exercises`)), h("span.chev"))),
    h("section.card", h("div.strong", "Rest timer"), prefIn("strength", "Heavy compounds, Upper and Lower"), prefIn("hyper", "Compounds, Push, Pull and Legs"), prefIn("accessory", "Everything else"),
      h("label.prefrow", h("span.grow", "Beep when rest ends"), h("input#pref-sound", { type: "checkbox", checked: p.sound, onchange: e => { const pp = S.prefs(); pp.sound = e.target.checked; S.setPrefs(pp); } }))),
    h("section.card",
      h("div.rowx", h("div.grow", h("div.strong", "Your log on GitHub"), h("div.dim.small", `${s.owner}/${s.repo}`)), h("span.badge.muted", { "data-status": "" }, statusText())),
      syncState.error ? h("div.small.err", syncState.error) : null,
      h("div.dim.small", c.syncedAt ? `Last synced ${new Date(c.syncedAt).toLocaleString()}` : "Not synced yet"),
      ob.length ? h("div.small", `${ob.length} waiting to upload: ${ob.map(o => o.label).join(", ")}`) : h("div.dim.small", "Nothing waiting to upload"),
      h("div.rowx", h("button.ghost", { onclick: () => syncNow() }, "Sync now"), h("button.ghost", { onclick: () => go("connect") }, "Change connection"))),
    h("section.card", h("div.strong", "App"), h("div.dim.small", `Version ${APP_VERSION}. Updates arrive the next time you open the app online.`),
      h("button.ghost", { onclick: checkForUpdates }, "Check for updates")),
    tabbar("more"));
};
VIEWS.exercises = () => {
  const by = {}; for (const e of Object.values(ctx.lib.ex)) (by[e.muscle] = by[e.muscle] || []).push(e);
  return h("div.page", topbar("Exercises", `${Object.keys(ctx.lib.ex).length} in your list`),
    Object.keys(by).sort().map(m => h("section.card", h("div.strong", m), by[m].sort((a, b) => a.name.localeCompare(b.name)).map(e =>
      h("div.rrow", h("span.grow", e.name), h("span.dim.small", `${e.unit} · step ${L.fmtNum(e.step)}`))))),
    h("div.cap", "To add exercises, ask Claude on your PC."), tabbar("more"));
};

// ---------- Connect ----------
VIEWS.connect = () => {
  const s = S.settings() || {};
  const msg = h("div.small#conn-msg", { role: "status" });
  const repo = h("input.txt#repo", { value: s.owner ? `${s.owner}/${s.repo}` : "", placeholder: "owner/repo", autocapitalize: "off", autocomplete: "off", spellcheck: "false" });
  const tok = h("input.txt#token", { type: "password", value: s.token || "", placeholder: "github_pat_…", autocomplete: "off" });
  const btn = h("button.go", { onclick: async () => {
    const m = repo.value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").split("/");
    if (m.length !== 2 || !m[0] || !m[1]) { msg.className = "small err"; msg.textContent = "Type the repo as owner/name, for example Arc-H20/gym-log."; return; }
    if (!tok.value.trim()) { msg.className = "small err"; msg.textContent = "Paste your access token."; return; }
    const prev = S.settings();
    S.setSettings({ owner: m[0], repo: m[1], token: tok.value.trim(), branch: "main" });
    btn.disabled = true; msg.className = "small"; msg.textContent = "Connecting…";
    try {
      const info = await S.testConnection();
      S.setSettings({ owner: m[0], repo: m[1], token: tok.value.trim(), branch: info.branch });
      await S.sync(); buildCtx();
      msg.textContent = `Connected. Found ${ctx.sessions.length} sessions, ${Object.keys(ctx.routines).length} routines and ${Object.keys(ctx.lib.ex).length} exercises.`;
      setTimeout(() => go("home", null, { replace: true }), 900);
    } catch (e) { if (prev) S.setSettings(prev); else S.setSettings(null); msg.className = "small err"; msg.textContent = e.message; btn.disabled = false; }
  } }, "Connect");
  return h("div.page.connect",
    h("div.connect-logo", svg(LOGO)),
    h("h1.title", "Connect your log"),
    h("p.dim", "The app keeps your workouts in your private GitHub repo. Paste the access token Claude helped you make. It only works on that one repo."),
    h("label.eyebrow", { for: "repo" }, "Repo"), repo,
    h("label.eyebrow", { for: "token" }, "Access token"), tok,
    h("div.cap", "Stored only on this phone. It's never uploaded anywhere except to GitHub itself."),
    btn, msg,
    S.settings() ? h("button.linkbtn.c", { onclick: () => go("more") }, "Cancel") : h("div.cap", "Tip: in Chrome's menu, tap \"Add to Home screen\" to install the app."));
};

// ---------- boot ----------
function boot() {
  buildCtx();
  route = parseHash();
  history.replaceState(route, "", location.hash || "#home");
  render();
  if (draft()) requestWake();
  if (S.settings()) syncNow({ quiet: false });
  window.addEventListener("online", () => syncNow({ quiet: true }));
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    // When a new version takes over, reload once so its files are used straight away.
    const hadController = !!navigator.serviceWorker.controller; let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => {});
  }
}
boot();
