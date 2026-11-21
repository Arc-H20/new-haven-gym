// Training logic, ported from the Obsidian plugin's _system/gym-lib.md. Pure functions over Markdown text.
(function () {
"use strict";
const ROTATION = ["Upper", "Lower", "Push", "Pull", "Legs"];
const STRENGTH_DAYS = ["Upper", "Lower"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const norm = s => (s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

function parseLibrary(text) {
  const rows = parseTable(text);
  const head = (rows.shift() || []).map(norm);
  const col = k => head.indexOf(k);
  const ex = {}, alias = {};
  for (const r of rows) {
    const name = r[col("exercise")];
    if (!name) continue;
    const unit = /pin/i.test(r[col("unit")] || "") ? "pin" : "kg";
    const step = parseFloat(r[col("step")]) || (unit === "pin" ? 1 : 2.5);
    const muscle = r[col("muscle")] || "Other";
    const aliases = (r[col("aliases")] || "").split(",").map(s => s.trim()).filter(Boolean);
    ex[name] = { name, unit, step, muscle, aliases };
    for (const a of [name, ...aliases]) {
      alias[norm(a)] = name;
      alias[norm(a).replace(/s$/, "")] = alias[norm(a).replace(/s$/, "")] || name;
    }
  }
  return { ex, alias };
}
function parseTable(text) {
  const rows = [];
  for (const line of (text || "").split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
    if (cells.every(c => /^:?-{2,}:?$/.test(c) || c === "")) continue;
    rows.push(cells);
  }
  return rows;
}

function resolve(lib, raw) {
  const n = norm(raw);
  return lib.alias[n] || lib.alias[n.replace(/s$/, "")] || null;
}

function levenshtein(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return d[a.length][b.length];
}

function suggest(lib, raw) {
  const n = norm(raw);
  let best = null, score = Infinity;
  for (const [k, name] of Object.entries(lib.alias)) {
    const s = levenshtein(n, k) / Math.max(n.length, k.length);
    if (s < score) { score = s; best = name; }
  }
  return score <= 0.45 ? best : null;
}

// Routine items: "- Name", "- Name (8-12)", "- Name 3 sets (8-12)", "- Name 4 sets (3-5) top set".
// A "+" bullet means "superset with the one above". "RIR: 1-3" under a day sets its reps-in-reserve goal.
const ITEM_RE = /^\s*([-*+])\s+(.+?)\s*(?:(\d+)\s*sets?)?\s*(?:\((\d+)\s*[-–]\s*(\d+)\))?\s*(top\s*set)?\s*$/i;
const RIR_RE = /^\s*rir\s*:\s*(\d+)\s*(?:[-–]\s*(\d+))?/i;
function routineItem(routines, routine, name) {
  const r = routines[routine];
  return r ? r.items.find(i => i.name === name) || null : null;
}

function repRange(routines, routine, name) {
  const r = routines[routine];
  if (!r) return [8, 12];
  const it = r.items.find(i => i.name === name);
  return (it && it.range) || r.range;
}

// "60x8 90x3@2 22.5x 12.5" -> [{w:60,r:8},{w:90,r:3,rir:2},{w:22.5,r:null},{w:12.5,r:null}]. "@2" = 2 reps in reserve.
function parseSets(str) {
  const sets = [], bad = [];
  for (const tok of (str || "").split(/[\s,]+/).filter(Boolean)) {
    const m = tok.match(/^(\d+(?:\.\d+)?)(?:[x×*](\d+)?)?(?:@(\d+(?:\.\d+)?))?$/i);
    if (m) sets.push(m[3] != null ? { w: +m[1], r: m[2] != null ? +m[2] : null, rir: +m[3] } : { w: +m[1], r: m[2] != null ? +m[2] : null });
    else bad.push(tok);
  }
  return { sets, bad };
}

const fmtNum = n => (Math.round(n * 100) / 100).toString();
const rirTag = s => s.rir != null && s.rir !== "" ? `@${fmtNum(+s.rir)}` : "";
const fmtSet = s => (s.r == null ? `${fmtNum(s.w)}x` : `${fmtNum(s.w)}x${s.r}`) + rirTag(s);
const fmtSetPretty = s => (s.r == null ? `${fmtNum(s.w)}×?` : `${fmtNum(s.w)}×${s.r}`) + rirTag(s);
const fmtWeight = (w, unit) => unit === "pin" ? `pin ${fmtNum(w)}` : `${fmtNum(w)} kg`;

function parseSession(text, path) {
  const fm = {};
  let body = text || "";
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    for (const l of m[1].split("\n")) {
      const i = l.indexOf(":");
      if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
    body = body.slice(m[0].length);
  }
  const entries = [];
  for (const line of body.split("\n")) {
    const mm = line.match(/^\s*[-*]\s+(.+?)\s*(?:\[(kg|pin)\])?\s*:\s*(.*)$/i);
    if (!mm) continue;
    let rest = mm[3], note = "";
    const ni = rest.indexOf("//");
    if (ni >= 0) { note = rest.slice(ni + 2).trim(); rest = rest.slice(0, ni); }
    rest = rest.trim();
    const skipped = rest === "" || /^(skip(ped)?|x|-)$/i.test(rest);
    entries.push({ name: mm[1].trim(), unit: mm[2] ? mm[2].toLowerCase() : null,
      sets: skipped ? [] : parseSets(rest).sets, skipped, note, deload: /\bdeload\b/i.test(note) });
  }
  return { path, date: fm.date || (path.match(/\d{4}-\d{2}-\d{2}/) || [""])[0], routine: fm.routine || "", entries,
    duration: fm.duration ? parseInt(fm.duration, 10) || null : null };
}

function history(sessions, name) {
  const h = [];
  for (const s of sessions)
    for (const e of s.entries)
      if (e.name === name) h.push({ ...e, date: s.date, routine: s.routine, path: s.path });
  return h;
}

// Working sets = the sets done at the session's top weight; lighter sets before them count as warm-ups.
function working(sets) {
  const ws = (sets || []).filter(s => s.w != null);
  if (!ws.length) return { top: null, sets: [] };
  const top = Math.max(...ws.map(s => s.w));
  return { top, sets: ws.filter(s => s.w === top) };
}

// Sets that count towards weekly volume. With reps in reserve logged: 3 RIR or less (close enough to failure
// to drive growth). Without it: anything at 80%+ of the top weight.
const HARD_RIR = 3;
function hardSets(sets) {
  const { top } = working(sets);
  if (top == null) return [];
  return sets.filter(s => s.w != null && (s.rir != null ? s.rir <= HARD_RIR : s.w >= top * 0.8));
}

function bestSet(sets) {
  const { top, sets: ws } = working(sets);
  if (top == null) return null;
  return { w: top, r: Math.max(...ws.map(s => s.r || 0)) };
}
const better = (a, b) => a && (!b || a.w > b.w || (a.w === b.w && a.r > b.r));

// Estimated one-rep max (Epley). Only meaningful for kg lifts with recorded reps.
function e1rm(w, r) { return w && r ? w * (1 + Math.min(r, 12) / 30) : null; }
function bestE1rm(sets) {
  let b = null;
  for (const s of sets || []) { const v = e1rm(s.w, s.r); if (v && (!b || v > b)) b = v; }
  return b;
}
const round2 = x => Math.round(x * 100) / 100;
function roundTo(x, step) { return round2(Math.round(x / step) * step); }
function lighter(top, pct, step) {
  let w = roundTo(top * pct, step);
  if (w >= top) w = round2(top - step);
  return Math.max(w, step);
}

// Top-set style: sets before the first top-weight set are warm-ups, sets after it are back-offs.
function splitTopSet(sets) {
  const ws = (sets || []).filter(s => s.w != null);
  if (!ws.length) return null;
  const top = Math.max(...ws.map(s => s.w));
  const ti = ws.findIndex(s => s.w === top);
  return { warm: ws.slice(0, ti), top: ws[ti], backs: ws.slice(ti + 1) };
}

// Score for comparing sets of different weight and reps (Epley-style), so 11×12 beats 12×8.
const setScore = s => s && s.w != null && s.r ? s.w * (1 + Math.min(s.r, 15) / 30) : 0;
function bestScore(sets) { return Math.max(0, ...(sets || []).map(setScore)); }

// Sessions in a row since the best performance last improved, plus that best's top weight. A deload resets it.
function stallInfo(entries) {
  let best = 0, bestTop = null, bestSetV = null, since = 0;
  for (const e of entries) {
    if (e.deload) { best = 0; bestTop = null; bestSetV = null; since = 0; continue; }
    const sc = bestScore(e.sets);
    if (!sc) continue; // no reps recorded: can't tell either way
    if (sc > best + 1e-9) { best = sc; bestTop = working(e.sets).top; bestSetV = bestSet(e.sets); since = 0; } else since++;
  }
  return { since, bestTop, best: bestSetV };
}
const stallCount = entries => stallInfo(entries).since;

function target(ctx, name, routine) {
  const { lib, routines, sessions } = ctx;
  const range = repRange(routines, routine, name);
  const item = routineItem(routines, routine, name);
  const style = item ? item.style : "double";
  const all = history(sessions, name);
  const done = all.filter(h => !h.skipped && h.sets.length);
  // Skips only count once the exercise has been done at least once; before that it's just new.
  let skips = 0;
  if (done.length) for (let i = all.length - 1; i >= 0 && all[i].skipped; i--) skips++;
  // Prefer sessions that used the same rep range (so Upper and Push share history, Lower and Legs don't).
  const same = done.filter(h => { const r = repRange(routines, h.routine, name); return r[0] === range[0] && r[1] === range[1]; });
  const pool = same.length ? same : done;
  const last = pool.filter(h => !h.deload).at(-1);
  const lastAny = pool.at(-1);
  const defUnit = lib.ex[name] ? lib.ex[name].unit : "kg";
  const nSets = item && item.sets ? item.sets : null;
  const rir = routines[routine] ? routines[routine].rir : null;
  const base = { range, skips, style, sets: nSets, rir, last: last || null, lastAny: lastAny || null };
  if (!last) return fitSets({ ...base, kind: "new", unit: defUnit, weight: null,
    reps: style === "topset" ? [range[0]] : [range[0], range[0], range[0]],
    backoff: style === "topset" ? { w: null, reps: [range[1], range[1]] } : null,
    text: "No history yet. Pick a starting weight." });
  const unit = last.unit || defUnit;
  const step = lib.ex[name] ? lib.ex[name].step : (unit === "pin" ? 1 : 2.5);
  const res = { ...base, unit, step, e1rm: unit === "kg" ? bestE1rm(last.sets) : null };
  const normal = style === "topset" ? topSetTarget(res, last, range, step, unit) : doubleTarget(res, last, range, step, unit, routine);

  // Same level for 3 sessions in a row: suggest a deload, unless the latest session was one
  // or is already lighter than the deload weight (e.g. easing back after time off).
  const { since: stall, bestTop } = stallInfo(pool);
  const top = working(last.sets).top;
  const w = bestTop != null ? lighter(bestTop, 0.9, step) : null;
  if (stall >= 2 && w != null && top > w && lastAny && !lastAny.deload && normal.kind !== "ref" && normal.kind !== "repeat") {
    let reps, backoff = null;
    if (style === "topset") {
      const sp = splitTopSet(last.sets);
      reps = [sp.top.r || range[0]];
      backoff = { w: lighter(w, 0.9, step), reps: (sp.backs.length ? sp.backs : [{}, {}]).map(b => b.r || range[1]) };
    } else {
      reps = working(last.sets).sets.map(s => s.r || range[0]);
    }
    return fitSets({ ...res, kind: "deload", stall, weight: w, prev: top, reps, backoff,
      text: `No progress in ${stall} sessions. Deload: drop to ${fmtWeight(w, unit)} with the same reps, then build back up next time. Changing the rep range in Edit Routines is another option.`,
      alt: fitSets(normal) });
  }
  return fitSets(normal);
}

// Matches the number of working sets to the routine's set count ("3 sets"), when it has one.
// Top-set style: 1 top set + (sets - 1) back-off sets.
function fitSets(t) {
  if (!t.sets || !t.reps) return t;
  const size = (arr, n, fill) => arr.length >= n ? arr.slice(0, n) : [...arr, ...Array(n - arr.length).fill(fill)];
  if (t.style === "topset") {
    if (t.backoff) t = { ...t, backoff: { ...t.backoff, reps: size(t.backoff.reps, Math.max(0, t.sets - 1), t.backoff.reps.at(-1) != null ? t.backoff.reps.at(-1) : t.range[1]) } };
    return t;
  }
  return { ...t, reps: size(t.reps, t.sets, t.range[0]) };
}

function doubleTarget(res, last, range, step, unit, routine) {
  const { top, sets } = working(last.sets);
  if (last.routine !== routine && sets.every(s => s.r != null && (s.r < range[0] || s.r > range[1]))) {
    return { ...res, kind: "ref", weight: top, reps: sets.map(() => range[0]),
      text: `Last done on ${last.routine} day. Pick a weight you can do for ${range[0]}–${range[1]} reps.` };
  }
  const known = sets.filter(s => s.r != null);
  if (known.length && known.every(s => s.r >= range[1])) {
    const w = round2(top + step);
    return { ...res, kind: "up", weight: w, prev: top, reps: sets.map(() => range[0]),
      text: `Hit ${range[1]}+ reps last time. Go up to ${fmtWeight(w, unit)}.` };
  }
  // Every set in range with 4+ reps in reserve: the weight is too light, go up now.
  if (known.length && known.every(s => s.rir != null && s.rir >= 4 && s.r >= range[0])) {
    const w = round2(top + step);
    return { ...res, kind: "up", weight: w, prev: top, reps: sets.map(() => range[0]),
      text: `Felt easy last time (4+ reps in reserve). Go up to ${fmtWeight(w, unit)}.` };
  }
  if (sets.some(s => s.r == null)) {
    return { ...res, kind: "repeat", weight: top, reps: sets.map(s => s.r != null ? Math.min(range[1], s.r + 1) : range[0]),
      text: `Reps weren't recorded last time. Repeat ${fmtWeight(top, unit)} and log them.` };
  }
  const reps = sets.map(s => Math.min(range[1], s.r + 1));
  return { ...res, kind: "reps", weight: top, reps, text: `Same weight, one more rep: ${reps.join(", ")}.` };
}

function topSetTarget(res, last, range, step, unit) {
  const sp = splitTopSet(last.sets);
  const nBacks = Math.max(sp.backs.length, 2);
  const lb = sp.backs.filter(s => s.w < sp.top.w);
  const lastBackR = lb.length && lb.every(s => s.r != null) ? Math.min(...lb.map(s => s.r)) : null;
  const backReps = keep => Array.from({ length: nBacks }, () => keep && lastBackR != null ? Math.min(range[1] + 3, lastBackR + 1) : range[1]);
  if (sp.top.r == null) {
    return { ...res, kind: "repeat", weight: sp.top.w, reps: [range[0]],
      backoff: { w: lighter(sp.top.w, 0.9, step), reps: backReps(false) },
      text: `Reps weren't recorded last time. Repeat ${fmtWeight(sp.top.w, unit)} for the top set and log them.` };
  }
  if (sp.top.r >= range[1]) {
    const w = round2(sp.top.w + step);
    return { ...res, kind: "up", weight: w, prev: sp.top.w, reps: [range[0]],
      backoff: { w: lighter(w, 0.9, step), reps: backReps(false) },
      text: `Top set hit ${sp.top.r} reps. Go up to ${fmtWeight(w, unit)}, then lighter back-off sets.` };
  }
  const bw = lb.length ? Math.max(...lb.map(s => s.w)) : lighter(sp.top.w, 0.9, step);
  return { ...res, kind: "reps", weight: sp.top.w, reps: [sp.top.r + 1],
    backoff: { w: bw, reps: backReps(true) },
    text: `Beat your top set by one rep (${sp.top.r + 1}), then the back-off sets.` };
}

// Planned sets for today: last session's warm-ups as they were, working sets at the target.
function plan(t) {
  if (t.style === "topset") {
    const sp = t.last ? splitTopSet(t.last.sets) : null;
    const warm = sp ? sp.warm.map(s => ({ w: s.w, r: "", tr: s.r != null ? s.r : "" })) : [];
    const top = { w: t.weight == null ? "" : t.weight, r: "", tr: t.reps[0] };
    const backs = (t.backoff ? t.backoff.reps : []).map(r => ({ w: t.backoff.w == null ? "" : t.backoff.w, r: "", tr: r }));
    return [...warm, top, ...backs];
  }
  if (!t.last || t.kind === "new") return t.reps.map(r => ({ w: "", r: "", tr: r }));
  const { top } = working(t.last.sets);
  const out = [];
  let k = 0;
  const want = t.sets ? t.reps.length : Infinity;
  for (const s of t.last.sets) {
    if (s.w === top) { if (k < want) out.push({ w: t.weight, r: "", tr: t.reps[k] != null ? t.reps[k] : t.range[0] }); k++; }
    else out.push({ w: s.w, r: "", tr: s.r != null ? s.r : "" });
  }
  for (; k < want && k < t.reps.length; k++) out.push({ w: t.weight, r: "", tr: t.reps[k] });
  return out;
}

// One-line target, e.g. "22.5 kg × 11 · 11 · 9" or "100 kg × 5, then 2 × 90 kg × 6".
function targetLine(t, unit) {
  const u = unit || t.unit;
  if (t.weight == null) return "";
  const main = `${fmtWeight(t.weight, u)} × ${t.reps.join(" · ")}`;
  if (t.style === "topset" && t.backoff && t.backoff.w != null)
    return `${main}, then ${t.backoff.reps.length} × ${fmtWeight(t.backoff.w, u)} × ${t.backoff.reps[0]}`;
  return main;
}

const sumVol = es => es.filter(e => e.unit === "kg").reduce((n, e) => n + e.sets.reduce((m, x) => m + (x.w || 0) * (x.r || 0), 0), 0);
const sumSets = es => es.reduce((n, e) => n + e.sets.filter(x => x.r != null).length, 0);

// Numbers for the end-of-session card. `prior` is every session before this one; `targets` maps name -> target used.
function sessionSummary(ctx, s, prior, targets) {
  const done = s.entries.filter(e => !e.skipped && e.sets.length);
  const bests = [];
  let hit = 0, planned = 0;
  for (const e of done) {
    let prev = null, prevE = null;
    for (const p of prior) for (const pe of p.entries) if (pe.name === e.name && !pe.skipped && pe.unit === e.unit) {
      const b = bestSet(pe.sets); if (better(b, prev)) prev = b;
      const v = bestE1rm(pe.sets); if (v && (!prevE || v > prevE)) prevE = v;
    }
    const cur = bestSet(e.sets);
    if (prev && cur && cur.r && better(cur, prev)) bests.push({ name: e.name, cur, prev, unit: e.unit });
    else if (e.unit === "kg" && prevE) {
      const v = bestE1rm(e.sets);
      if (v && v > prevE + 0.5) bests.push({ name: e.name, e1rm: v, prevE, unit: "kg" });
    }
    const t = targets && targets[e.name];
    if (t && t.weight != null && t.kind !== "new" && t.kind !== "ref") {
      const want = t.style === "topset" ? [t.reps[0]] : t.reps;
      planned += want.length;
      const got = e.sets.filter(x => x.w >= t.weight && x.r != null).map(x => x.r).sort((a, b) => b - a);
      want.forEach((r, k) => { if (got[k] != null && got[k] >= r) hit++; });
    }
  }
  const lastSame = prior.filter(p => p.routine === s.routine).at(-1) || null;
  let cmp = null;
  if (lastSame) {
    const ld = lastSame.entries.filter(e => !e.skipped && e.sets.length);
    cmp = { date: lastSame.date, sets: sumSets(ld), vol: Math.round(sumVol(ld)), duration: lastSame.duration, exercises: ld.length };
  }
  return { routine: s.routine, date: s.date, path: s.path, duration: s.duration || null, exercises: done.length,
    skipped: s.entries.length - done.length, sets: sumSets(done), vol: Math.round(sumVol(done)), bests, hit, planned, cmp };
}

function nextRoutine(sessions) {
  const last = sessions.filter(s => ROTATION.includes(s.routine)).at(-1);
  if (!last) return ROTATION[0];
  return ROTATION[(ROTATION.indexOf(last.routine) + 1) % ROTATION.length];
}

function isoDate(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function parseIso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function prettyDate(s, withYear) {
  const d = parseIso(s);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}`;
}
const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function formatEntry(e) {
  const sets = (e.sets || []).filter(s => s.w != null && s.w !== "");
  let l = e.skipped || !sets.length ? `- ${e.name}: skipped` : `- ${e.name} [${e.unit}]: ${sets.map(fmtSet).join(" ")}`;
  if (e.note && e.note.trim()) l += ` // ${e.note.trim().replace(/\n/g, " ")}`;
  return l;
}

function formatSession(s) {
  return ["---", `date: ${s.date}`, `routine: ${s.routine}`, ...(s.duration ? [`duration: ${s.duration}`] : []), "---",
    `# ${s.routine} · ${prettyDate(s.date, true)}`, "",
    ...s.entries.map(formatEntry), ""].join("\n");
}

function routineSection(lines, routine) {
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    if (start >= 0) { end = i; break; }
    if (m[1] === routine) start = i;
  }
  return { start, end };
}

// Replaces one routine's rep range and exercise list in Routines. Headings and description lines are kept.
function parseRoutines(text, lib) {
  const routines = {};
  let cur = null, ssNext = 0;
  for (const line of (text || "").split("\n")) {
    const hd = line.match(/^##\s+(.+?)\s*$/);
    if (hd) { cur = { name: hd[1], range: [8, 12], rir: null, items: [] }; routines[cur.name] = cur; ssNext = 0; continue; }
    if (!cur) continue;
    const r = line.match(/^\s*reps\s*:\s*(\d+)\s*[-–]\s*(\d+)/i);
    if (r) { cur.range = [+r[1], +r[2]]; continue; }
    const rr = line.match(RIR_RE);
    if (rr) { cur.rir = [+rr[1], rr[2] != null ? +rr[2] : +rr[1]]; continue; }
    const it = line.match(ITEM_RE);
    if (it) {
      const name = (lib && resolve(lib, it[2])) || it[2];
      const item = { name, sets: it[3] ? +it[3] : null, range: it[4] ? [+it[4], +it[5]] : null, style: it[6] ? "topset" : "double", ss: null };
      const prev = cur.items.at(-1);
      if (it[1] === "+" && prev) { if (!prev.ss) prev.ss = String.fromCharCode(65 + ssNext++); item.ss = prev.ss; }
      cur.items.push(item);
    }
  }
  return routines;
}

// Returns Routines.md text with one day's exercise list replaced. Headings and description lines are kept.
function replaceRoutineItems(text, routine, items) {
  const lines = (text || "").split("\n");
  let { start, end } = routineSection(lines, routine);
  if (start < 0) {
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", `## ${routine}`); start = lines.length - 1; end = lines.length;
  }
  const keep = []; let insertAt = -1;
  for (let i = start + 1; i < end; i++) {
    if (/^\s*[-*+]\s+/.test(lines[i])) { if (insertAt < 0) insertAt = keep.length; continue; }
    keep.push(lines[i]);
  }
  while (keep.length && keep[keep.length - 1].trim() === "") keep.pop();
  if (insertAt < 0 || insertAt > keep.length) insertAt = keep.length;
  const block = items.map((it, k) => `${it.ss && k > 0 && items[k - 1].ss === it.ss ? "+" : "-"} ${it.name}${it.sets ? ` ${it.sets} sets` : ""}${it.range ? ` (${it.range[0]}-${it.range[1]})` : ""}${it.style === "topset" ? " top set" : ""}`);
  keep.splice(insertAt, 0, ...block);
  return [...lines.slice(0, start + 1), ...keep, "", ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
}

// Hard sets per muscle for sessions in [from, to] (ISO dates, inclusive).
function muscleSets(ctx, from, to) {
  const out = {};
  for (const s of ctx.sessions) {
    if (s.date < from || s.date > to) continue;
    for (const e of s.entries) {
      if (e.skipped) continue;
      const m = ctx.lib.ex[e.name] ? ctx.lib.ex[e.name].muscle : "Other";
      out[m] = (out[m] || 0) + hardSets(e.sets).length;
    }
  }
  return out;
}

// Default rest in seconds: heavy compounds on strength days get 3 min, the rest 2 min or 90 s.
const COMPOUND = /press|squat|deadlift|rdl|row|pulldown|pull-up|chin-up|dip|lunge|hip thrust|leg press/i;
function restFor(routine, name, settings) {
  const st = settings || {};
  if (COMPOUND.test(name)) return STRENGTH_DAYS.includes(routine) ? (st.strength || 180) : (st.hyper || 120);
  return st.accessory || 90;
}

const GymLib = { ROTATION, STRENGTH_DAYS, MONTHS, DAYS, norm, parseTable, parseLibrary, resolve, suggest, parseRoutines, routineItem, repRange,
  parseSets, fmtNum, fmtSet, fmtSetPretty, fmtWeight, parseSession, history, working, hardSets, bestSet, e1rm, bestE1rm, target, plan, targetLine,
  sessionSummary, nextRoutine, isoDate, parseIso, prettyDate, daysBetween, weekStart, formatEntry, formatSession, replaceRoutineItems, muscleSets, restFor };
if (typeof module !== "undefined") module.exports = GymLib; else self.GymLib = GymLib;
})();
