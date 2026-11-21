// Local cache of the private log repo plus an upload queue. Everything works offline from the cache;
// GitHub is only touched by sync() and flush().
"use strict";
const Store = (() => {
  const K = { settings: "ng.settings", cache: "ng.cache", outbox: "ng.outbox", draft: "ng.draft", prefs: "ng.prefs" };
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  const settings = () => read(K.settings, null);
  const setSettings = s => write(K.settings, s);
  const cache = () => read(K.cache, { files: {}, syncedAt: null });
  const setCache = c => write(K.cache, c);
  const outbox = () => read(K.outbox, []);
  const setOutbox = o => write(K.outbox, o);
  const draft = () => read(K.draft, null);
  const setDraft = d => write(K.draft, d);
  const prefs = () => read(K.prefs, { strength: 180, hyper: 120, accessory: 90, sound: true });
  const setPrefs = p => write(K.prefs, p);

  // UTF-8 safe base64.
  const b64enc = s => { const b = new TextEncoder().encode(s); let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); };
  const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));

  class GhError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

  async function gh(path, opts = {}) {
    const s = settings();
    if (!s || !s.token) throw new GhError("Not connected to GitHub yet.", 0);
    let res;
    try {
      res = await fetch(`https://api.github.com${path}`, { ...opts, cache: "no-store", headers: {
        Accept: "application/vnd.github+json", Authorization: `Bearer ${s.token}`, "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.body ? { "Content-Type": "application/json" } : {}) } });
    } catch { throw new GhError("No connection. Your data is safe on this phone.", -1); }
    if (res.status === 404 && opts.allow404) return null;
    if (!res.ok) {
      const msg = res.status === 401 ? "GitHub didn't accept the token. It may have expired: make a new one and paste it in Settings."
        : res.status === 403 || res.status === 404 ? `The token can't reach ${s.owner}/${s.repo}. Check the repo name, and that the token has Contents: Read and write for it.`
        : res.status === 409 ? "The file changed on GitHub at the same time. It'll retry."
        : `GitHub answered ${res.status}. It'll retry later.`;
      throw new GhError(msg, res.status);
    }
    return res.status === 204 ? null : res.json();
  }
  const repoPath = () => { const s = settings(); return `/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}`; };
  const enc = p => p.split("/").map(encodeURIComponent).join("/");

  async function testConnection() {
    const r = await gh(repoPath());
    return { branch: r.default_branch, private: r.private };
  }

  // Pulls every .md file whose blob changed since the last sync.
  async function sync() {
    const s = settings();
    const tree = await gh(`${repoPath()}/git/trees/${encodeURIComponent(s.branch || "main")}?recursive=1`);
    const c = cache();
    const next = {};
    const want = tree.tree.filter(t => t.type === "blob" && /\.md$/i.test(t.path));
    await Promise.all(want.map(async t => {
      const old = c.files[t.path];
      if (old && old.sha === t.sha) { next[t.path] = old; return; }
      const blob = await gh(`${repoPath()}/git/blobs/${t.sha}`);
      next[t.path] = { sha: t.sha, text: b64dec(blob.content) };
    }));
    const fresh = { files: next, syncedAt: Date.now() };
    setCache(fresh);
    return fresh;
  }

  async function getFile(path) {
    const s = settings();
    const r = await gh(`${repoPath()}/contents/${enc(path)}?ref=${encodeURIComponent(s.branch || "main")}`, { allow404: true });
    return r ? { sha: r.sha, text: b64dec(r.content) } : null;
  }
  async function putFile(path, text, sha, message) {
    const s = settings();
    const r = await gh(`${repoPath()}/contents/${enc(path)}`, { method: "PUT",
      body: JSON.stringify({ message, content: b64enc(text), branch: s.branch || "main", ...(sha ? { sha } : {}) }) });
    const c = cache(); c.files[path] = { sha: r.content.sha, text }; setCache(c);
    return r;
  }

  // Queue items: {id, kind: "session", path, entriesText, fullText, label} or {kind: "routine", routine, items, label}.
  function enqueue(item) {
    const o = outbox(); o.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), ...item }); setOutbox(o);
    applyLocal(item);
  }
  // Mirrors a queued change into the cache so the app shows it before it uploads.
  function applyLocal(item) {
    const c = cache();
    if (item.kind === "session") {
      const ex = c.files[item.path];
      c.files[item.path] = { sha: ex ? ex.sha : null, text: ex ? ex.text.replace(/\s*$/, "") + "\n" + item.entriesText + "\n" : item.fullText, pending: true };
    } else if (item.kind === "routine") {
      const p = item.path; const ex = c.files[p];
      c.files[p] = { sha: ex ? ex.sha : null, text: GymLib.replaceRoutineItems(ex ? ex.text : "# Routines\n", item.routine, item.items), pending: true };
    }
    setCache(c);
  }

  let flushing = null;
  function flush() { if (!flushing) flushing = doFlush().finally(() => { flushing = null; }); return flushing; }
  async function doFlush() {
    let o = outbox(); const done = [];
    let error = null;
    for (const item of o) {
      try {
        if (item.kind === "session") {
          const cur = await getFile(item.path);
          const text = cur ? cur.text.replace(/\s*$/, "") + "\n" + item.entriesText + "\n" : item.fullText;
          await putFile(item.path, text, cur && cur.sha, `Log ${item.label}`);
        } else if (item.kind === "routine") {
          const cur = await getFile(item.path);
          const text = GymLib.replaceRoutineItems(cur ? cur.text : "# Routines\n", item.routine, item.items);
          await putFile(item.path, text, cur && cur.sha, `Update ${item.routine} routine`);
        }
        done.push(item.id);
      } catch (e) { error = e; break; }
    }
    o = outbox().filter(x => !done.includes(x.id)); setOutbox(o);
    if (error) throw error;
    return done.length;
  }

  return { settings, setSettings, cache, setCache, outbox, draft, setDraft, prefs, setPrefs, testConnection, sync, enqueue, flush, GhError };
})();
self.Store = Store;
