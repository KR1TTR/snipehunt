let S = null;
let pick = { move: null, fire: null };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let KIND = { creature: "S", pit: "B", mover: "O" };  // replaced from the theme on load
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
$("gmView").checked = store.get("nethunt.gm") === "1";
$("addAsPlayer").checked = store.get("nethunt.addAsPlayer") !== "0";

// ---------- storage: everything lives in this browser ----------
const CONFIG_KEY = "snipehunt.config";     // net info, preamble, game settings (kept between nets)
const SESSION_KEY = "snipehunt.session";   // tonight's check-ins, games and transcript
const EXPORTED_KEY = "snipehunt.exported"; // transcript length at the last log export
function loadJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

function cleanConfig(saved) {
  const c = { preamble: DEFAULT_PREAMBLE, phonetic: false, settings: { ...DEFAULTS } };
  for (const k of NETINFO_KEYS) c[k] = "";
  if (saved && typeof saved === "object") {
    for (const k of [...NETINFO_KEYS, "preamble"]) if (typeof saved[k] === "string") c[k] = saved[k];
    c.phonetic = !!saved.phonetic;
    for (const k of Object.keys(DEFAULTS)) {
      const v = saved.settings && saved.settings[k];
      if (typeof v === "number" && v >= LIMITS[k][0] && v <= LIMITS[k][1]) c.settings[k] = v;
    }
  }
  return c;
}

const rng = makeRng(new URLSearchParams(location.search).get("seed"));
const config = cleanConfig(loadJSON(CONFIG_KEY));
let net;
try {
  const saved = loadJSON(SESSION_KEY);
  net = new Net(config, rng, saved);
  if (saved && saved.transcript && saved.transcript.length) {
    net.notice = `Picked up where you left off (session started ${clock(new Date(net.started), false)}).`;
  }
} catch (e) {
  console.error(e);
  net = new Net(config, rng);
  net.notice = "The saved session couldn't be read, so a new one was started.";
}
let lastExport = Number(store.get(EXPORTED_KEY)) || 0;
let storageOK = true;
let logHandle = null;   // file chosen for auto-saving the log (Chrome/Edge only)

function persist() {
  const a = saveJSON(CONFIG_KEY, config), b = saveJSON(SESSION_KEY, net);
  storageOK = a && b;
  if (logHandle) writeLogFile();
}

async function api(action) {
  const prev = S ? S.drawn + "/" + S.step : "";
  if (action) {
    try { net.act(action); }
    catch (e) { console.error(e); net.notice = "Something went wrong: " + e.message; }
    persist();
  }
  S = net.state();
  if (!storageOK) S.notice = (S.notice ? S.notice + " " : "") +
    "This browser isn't letting the page save, so export the log before closing.";
  KIND = { creature: S.theme.creature_letter, pit: S.theme.pit_letter, mover: S.theme.mover_letter };
  if (S.drawn + "/" + S.step !== prev) pick = { move: null, fire: null };
  render();
}

// ---------- session log: export, auto-save, new session ----------
function downloadText(name, text, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function markExported() {
  lastExport = net.transcript.length;
  store.set(EXPORTED_KEY, String(lastExport));
  renderLogStatus();
}
function exportLog() {
  downloadText(net.logFilename(), net.sessionText());
  markExported();
}
let writing = Promise.resolve();
function writeLogFile() {
  const handle = logHandle;
  writing = writing.then(async () => {
    const w = await handle.createWritable();
    await w.write(net.sessionText());
    await w.close();
    markExported();
  }).catch(e => {
    console.error(e);
    logHandle = null;
    net.notice = "Auto-save to the log file stopped. Use Export log, or pick the file again.";
    api();
  });
}
async function chooseLogFile() {
  try {
    logHandle = await window.showSaveFilePicker({
      suggestedName: net.logFilename(),
      types: [{ description: "Text file", accept: { "text/plain": [".txt"] } }],
    });
    writeLogFile();
    renderLogStatus();
  } catch (e) { /* cancelled */ }
}
function renderLogStatus() {
  const el = $("logStatus");
  if (!el) return;
  if (logHandle) { el.innerHTML = `Auto-saving the log to <b>${esc(logHandle.name)}</b>.`; return; }
  const pending = net.transcript.length > 0 && net.transcript.length !== lastExport;
  let html = pending
    ? "Log not exported since the last change. It's kept in this browser until you start a new session."
    : net.transcript.length ? "Log exported." : "";
  if ("showSaveFilePicker" in window && net.transcript.length)
    html += ` <a href="#" id="autoSaveLink">Auto-save to a file…</a>`;
  el.innerHTML = html;
  const link = $("autoSaveLink");
  if (link) link.onclick = (e) => { e.preventDefault(); chooseLogFile(); };
}
async function newSession() {
  const unsaved = net.transcript.length && net.transcript.length !== lastExport;
  if (unsaved && confirm("This session's log hasn't been exported. Export it now before clearing?")) exportLog();
  if (!confirm("Start a new session? This clears tonight's check-ins, games and transcript. " +
               "Your preamble, net info and settings stay.")) return;
  net = new Net(config, rng);
  logHandle = null;
  lastExport = 0;
  store.set(EXPORTED_KEY, "0");
  pick = { move: null, fire: null };
  persist();
  await api();
  renderLogStatus();
}

// ---------- backup and restore of settings ----------
function backupSettings() {
  const d = new Date(), p = n => String(n).padStart(2, "0");
  downloadText(`snipehunt-settings-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`,
               JSON.stringify({ app: "snipehunt", version: 1, config }, null, 2), "application/json");
}
async function restoreSettings(file) {
  try {
    const data = JSON.parse(await file.text());
    const restored = cleanConfig(data.config || data);
    Object.assign(config, restored);
    persist();
    net.notice = "Settings restored from " + file.name + ".";
    await api();
    renderPreamble(true);
  } catch (e) {
    alert("That file couldn't be read as a Snipe Hunt backup.");
  }
}

function label(c, r) { return String.fromCharCode(65 + c) + (r + 1); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function renderBoard() {
  const b = $("board"), g = S.game;
  const cols = g ? g.cols : S.settings.cols, rows = g ? g.rows : S.settings.rows;
  b.style.gridTemplateColumns = `24px repeat(${cols}, minmax(0, 1fr))`;
  const gm = $("gmView").checked;
  let html = `<div></div>`;
  for (let c = 0; c < cols; c++) html += `<div class="axis">${String.fromCharCode(65 + c)}</div>`;
  for (let r = 0; r < rows; r++) {
    html += `<div class="axis">${r + 1}</div>`;
    for (let c = 0; c < cols; c++) {
      const L = label(c, r);
      const visited = g && g.visited.includes(L);
      const here = g && g.hunter === L;
      let inner = `<span class="lbl">${L}</span>`;
      if (g) {
        const step = g.trail.indexOf(L);
        if (step > 0) inner += `<span class="step">#${step}</span>`;
        if (gm || g.over) {
          // A square can hold more than one thing (the snipe can be flushed into a bog or
          // the owl's square). The snipe's box is drawn smaller so it nests inside the
          // hazard's box, and the hazard's letter moves to the corner.
          const kinds = ["pit", "mover", "creature"].filter(k => g.hazards[k].includes(L));
          const shared = kinds.length > 1;
          for (const k of kinds) {
            const cls = k === "creature" ? "creature" : `${k}${shared ? " shared" : ""}`;
            inner += `<div class="gm ${cls}" title="${esc(S.theme[k + "_name"])}">${KIND[k]}</div>`;
          }
        }
        if (here) inner += `<div class="token" title="Hunter">H</div>`;
        const sensed = g.sensed[L];
        if (sensed && sensed.length)
          inner += `<div class="sense">${sensed.map(k => `<span class="dot ${k}">${KIND[k]}</span>`).join("")}</div>`;
      }
      html += `<div class="cell${visited ? " visited" : ""}${here ? " here" : ""}">${inner}</div>`;
    }
  }
  b.innerHTML = html;
  const t = S.theme;
  $("legend").innerHTML = ["creature", "pit", "mover"].map(k =>
      `<span><span class="dot ${k}">${KIND[k]}</span> <b>${esc(t[k + "_name"])}:</b> “${esc(t["warn_" + k])}”</span>`
    ).join("") +
    `<span>#n = order first reached</span>` +
    (gm ? `<span>Dashed = hidden hazard (GM view)</span>` : "");
}

function renderHeader() {
  const g = S.game;
  $("title").textContent = S.theme.title;
  document.title = S.theme.title + " — Net Control";
  $("gameNo").textContent = S.game_no || "–";
  $("roundNo").textContent = S.round || "–";
  $("record").textContent = `${S.wins}–${S.game_no - S.wins - (g && !g.over ? 1 : 0)}`;
  $("shotsLabel").textContent = cap(S.theme.ammos);
  $("l_shots").textContent = `${cap(S.theme.ammos)} per game`;
  $("l_range").textContent = `${cap(S.theme.weapon)} range (squares)`;
  const max = g ? g.max_shots : S.settings.shots, left = g ? g.shots : max;
  $("shots").innerHTML = Array.from({length: max}, (_, i) => `<i class="${i < left ? "" : "used"}"></i>`).join("");
  $("phonetic").checked = S.phonetic;
}

function renderScript() {
  $("script").innerHTML = S.script.length
    ? S.script.map(l => `<p class="${l.kind === "air" ? "say" : "ncs"}">${esc(l.text)}</p>`).join("")
    : `<p class="ncs">Add check-ins and tick <b>Player</b>, then press <b>Start game</b>.</p>`;
  $("notice").textContent = S.notice || "";
}

function compass(kind, open, sel, canUse) {
  const btn = (d) => {
    const ok = canUse && open.includes(d);
    return `<button class="${kind}${sel === d ? " sel" : ""}" data-${kind}="${d}" ${ok ? "" : "disabled"}>${d}</button>`;
  };
  const midVal = kind === "move" ? "H" : "-";
  const midTxt = kind === "move" ? "Hold" : "Don't " + S.theme.verb;
  return `<div class="compass">
    <span></span>${btn("N")}<span></span>
    ${btn("W")}<button class="mid${sel === midVal ? " sel" : ""}" data-${kind}="${midVal}" ${canUse ? "" : "disabled"}>${midTxt}</button>${btn("E")}
    <span></span>${btn("S")}<span></span></div>`;
}

function playerCount() { return S.stations.filter(s => s.player).length; }

function renderControls() {
  const el = $("controls"), g = S.game;
  if (S.phase === "setup" || S.phase === "over") {
    const sizes = [[5, 4], [5, 5]];
    const cur = S.settings;
    const known = sizes.some(([c, r]) => c === cur.cols && r === cur.rows);
    const seg = sizes.map(([c, r]) => {
      const on = c === cur.cols && r === cur.rows;
      return `<button class="${on ? "on" : ""}" data-grid="${c}x${r}" aria-pressed="${on}">
        ${c} × ${r}<small>A–${String.fromCharCode(64 + c)}, rows 1–${r} · ${c * r} squares</small></button>`;
    }).join("") + (known ? "" : `<button class="on" disabled>${cur.cols} × ${cur.rows}<small>custom (Settings)</small></button>`);
    el.innerHTML = `<h2>${S.phase === "over" ? (g.won ? "Net wins!" : "Game over") : "Ready"}</h2>
      <div class="seglabel">Grid for the next game</div>
      <div class="seg">${seg}</div>
      <button class="primary big" data-act="new_game">${S.phase === "over" ? "Start next game" : "Start game"}</button>
      <div class="hint">Everyone ticked as Player goes into the lottery. The check-in list carries over between games.</div>`;
    return;
  }
  if (S.phase === "ready") {
    const waiting = S.lottery.length + (S.lottery.length ? 0 : S.moved.length);
    el.innerHTML = `<h2>Round ${S.round}</h2>
      <button class="primary big" data-act="draw" ${waiting ? "" : "disabled"}>Draw next player</button>
      <div class="hint">${waiting
        ? `${S.lottery.length} left in the lottery this round, ${S.moved.length} moved.`
        : "<b>No players yet.</b> Tick <b>Player</b> next to check-ins to put them in the lottery."}</div>
      <div class="row" style="margin-top:12px"><button data-act="abandon">End game early</button></div>`;
    return;
  }
  const footer = `<div class="row" style="margin-top:8px">
      <button data-act="skip">No reply — skip</button>
      <button data-act="left">Station left the game</button>
    </div>
    <div class="hint">Keys: arrows pick a direction, H = hold, Enter = submit.</div>`;
  if (S.step === "move") {
    const mv = pick.move === null ? "" : pick.move === "H" ? " — hold position" : ` ${pick.move}`;
    el.innerHTML = `<div class="upnow"><small>Now up</small>${esc(S.drawn)}<span class="step-tag">Step 1 · Move</span></div>
      <div class="pads one"><div class="pad"><h3>Which way do they move?</h3>${compass("move", g.open, pick.move, true)}</div></div>
      <button class="primary big" data-act="submit_move" ${pick.move !== null ? "" : "disabled"}>${pick.move === null ? "Pick a move" : "Move" + mv}</button>
      ${footer}`;
  } else {
    const verb = cap(S.theme.verb);
    const lbl = pick.fire === null ? `Pick a direction, or don't ${S.theme.verb}`
      : pick.fire === "-" ? `Don't ${S.theme.verb}` : `${verb} ${pick.fire}`;
    const cls = pick.fire && pick.fire !== "-" ? "firebtn" : "primary";
    el.innerHTML = `<div class="upnow"><small>Now up</small>${esc(S.drawn)}<span class="step-tag fire">Step 2 · ${esc(verb)}?</span></div>
      <div class="pads one"><div class="pad"><h3>${esc(verb)} the ${esc(S.theme.weapon)} which way?</h3>${compass("fire", g.open, pick.fire, true)}</div></div>
      <button class="${cls} big" data-act="submit_fire" ${pick.fire !== null ? "" : "disabled"}>${lbl}</button>
      ${footer}`;
  }
}

function renderRoundLists() {
  const active = S.phase === "ready" || S.phase === "turn";
  const lot = S.lottery.slice().sort();
  let left = (S.drawn ? `<div class="chip current">${esc(S.drawn)} <small>drawn</small></div>` : "") +
    lot.map(c => `<div class="chip">${esc(c)}</div>`).join("");
  if (!left) left = `<div class="empty">${active ? "Empty" : "—"}</div>`;
  let right = S.moved.map(m => `<div class="chip moved">${esc(m.call)}
    <small>${m.how === "skipped" ? "no reply" : "✓"}</small></div>`).join("");
  if (!right) right = `<div class="empty">${active ? "Nobody yet" : "—"}</div>`;
  $("roundLists").innerHTML =
    `<div><h3>Lottery <span>${S.lottery.length}</span></h3><div class="chips">${left}</div></div>
     <div><h3>Moved <span>${S.moved.length}</span></h3><div class="chips">${right}</div></div>`;
}

function renderMaster() {
  const st = S.stations;
  const players = st.filter(s => s.player).length, inout = st.filter(s => s.inout).length;
  $("counts").innerHTML = `<b>${st.length}</b> check-ins · <b>${players}</b> players · <b>${inout}</b> no traffic / in-out`;
  $("master").innerHTML = st.length
    ? st.map(s => `<tr class="${s.player ? "player" : s.inout ? "inout" : ""}">
        <td class="tm">${esc(s.time || "")}</td>
        <td class="cs">${esc(s.call)}<span class="nm">${esc(s.name || "—")}
          <button title="Edit name" data-rename="${esc(s.call)}">✎</button></span></td>
        <td><input type="checkbox" data-flag="player" data-call="${esc(s.call)}" ${s.player ? "checked" : ""} aria-label="${esc(s.call)} is a player"></td>
        <td><input type="checkbox" data-flag="inout" data-call="${esc(s.call)}" ${s.inout ? "checked" : ""} aria-label="${esc(s.call)} no traffic or in-out"></td>
        <td><button title="Remove from list" data-delete="${esc(s.call)}">✕</button></td></tr>`).join("")
    : `<tr><td colspan="5" class="empty" style="text-align:left">No check-ins yet</td></tr>`;
}

function renderLog() {
  const log = $("log");
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  log.innerHTML = S.transcript.map(l =>
    `<div class="${l.kind === "air" ? "say" : "ncs"}"><span class="t">${l.t}</span>${esc(l.text)}</div>`).join("");
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function render() {
  renderHeader(); renderBoard(); renderScript(); renderControls();
  renderRoundLists(); renderMaster(); renderLog(); renderPreamble(false); renderLogStatus();
}

document.addEventListener("click", (e) => {
  const t = e.target.closest("button");
  if (!t || t.disabled) return;
  if (t.dataset.rename) {
    const st = S.stations.find(x => x.call === t.dataset.rename);
    const name = prompt(`Name for ${t.dataset.rename}:`, st ? st.name : "");
    if (name !== null) api({ type: "rename", call: t.dataset.rename, name });
    return;
  }
  if (t.dataset.tab) { showTab(t.dataset.tab); return; }
  if (t.dataset.pmode) { showPreambleMode(t.dataset.pmode); return; }
  if (t.dataset.grid) {
    const [cols, rows] = t.dataset.grid.split("x").map(Number);
    api({ type: "settings", cols, rows });
    return;
  }
  if (t.dataset.move !== undefined) { pick.move = t.dataset.move; renderControls(); return; }
  if (t.dataset.fire !== undefined) { pick.fire = t.dataset.fire; renderControls(); return; }
  if (t.dataset.delete) {
    if (confirm(`Remove ${t.dataset.delete} from the check-in list?`)) api({ type: "delete", call: t.dataset.delete });
    return;
  }
  const act = t.dataset.act;
  if (act === "submit_move") api({ type: "move", move: pick.move });
  else if (act === "submit_fire") api({ type: "fire", fire: pick.fire });
  else if (act === "left") api({ type: "flag", call: S.drawn, flag: "player", value: false });
  else if (act === "abandon") { if (confirm("End this game now?")) api({ type: "abandon" }); }
  else if (act) api({ type: act });
});

document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.flag) api({ type: "flag", call: t.dataset.call, flag: t.dataset.flag, value: t.checked });
});

$("newGameBtn").onclick = () => {
  if (S.phase === "turn" || S.phase === "ready") {
    if (!confirm("A game is in progress. Start a new one anyway?")) return;
    api({ type: "abandon" }).then(() => api({ type: "new_game" }));
  } else api({ type: "new_game" });
};
$("addForm").onsubmit = async (e) => {
  e.preventDefault();
  const call = $("addCall").value.trim();
  if (!call) { $("addCall").focus(); return; }
  await api({ type: "add", call, name: $("addName").value.trim(), player: $("addAsPlayer").checked });
  if (!S.notice) { $("addCall").value = ""; $("addName").value = ""; }
  $("addCall").focus();
};
$("addAsPlayer").onchange = () => store.set("nethunt.addAsPlayer", $("addAsPlayer").checked ? "1" : "0");
$("gmView").onchange = () => { store.set("nethunt.gm", $("gmView").checked ? "1" : "0"); renderBoard(); };
$("phonetic").onchange = () => api({ type: "settings", phonetic: $("phonetic").checked });

$("settingsBtn").onclick = () => {
  const s = S.settings;
  for (const k of ["cols", "rows", "pits", "movers", "shots", "range"]) $("s_" + k).value = s[k];
  $("s_wake").value = Math.round(s.wake * 100);
  $("settingsDlg").showModal();
};
$("settingsDlg").addEventListener("close", () => {
  if ($("settingsDlg").returnValue !== "save") return;
  const a = { type: "settings" };
  for (const k of ["cols", "rows", "pits", "movers", "shots", "range"]) a[k] = $("s_" + k).value;
  a.wake = Number($("s_wake").value) / 100;
  api(a);
});

$("saveLog").onclick = $("exportBtn").onclick = exportLog;
$("newSession").onclick = newSession;
$("backupBtn").onclick = backupSettings;
$("restoreBtn").onclick = () => $("restoreFile").click();
$("restoreFile").onchange = (e) => { if (e.target.files[0]) restoreSettings(e.target.files[0]); e.target.value = ""; };

// ---------- tabs and preamble ----------
function showTab(name) {
  $("gameView").hidden = name !== "game";
  $("preambleView").hidden = name !== "preamble";
  document.querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === name));
  store.set("nethunt.tab", name);
  if (name === "preamble") renderPreamble(true);
}
let pmode = "read";
function showPreambleMode(m) {
  if (pmode === "edit" && m === "read") savePreamble();
  pmode = m;
  $("preambleRead").hidden = m !== "read";
  $("preambleEdit").hidden = m !== "edit";
  document.querySelectorAll("[data-pmode]").forEach(b => b.classList.toggle("on", b.dataset.pmode === m));
  if (m === "edit") $("preambleText").focus(); else renderPreamble(false);
}
function placeholders() {
  const c = S.config, st = S.settings, t = S.theme;
  return {
    net: c.net, ncs: c.ncs, ncs_name: c.ncs_name,
    net_day: c.net_day, net_time: c.net_time, frequency: c.frequency, cols: st.cols,
    date: new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
    title: t.title.split(" ").map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(" "),
    cols_end: String.fromCharCode(64 + st.cols), rows: st.rows, range: st.range, shots: st.shots,
    weapon: t.weapon, ammos: t.ammos, verb: t.verb, creature: t.creature,
    warn_creature: t.warn_creature, warn_pit: t.warn_pit, warn_mover: t.warn_mover,
  };
}
function fillPreamble(text) {
  const ph = placeholders();
  return esc(text).replace(/\{(\w+)\}/g, (m, k) =>
    k in ph ? (ph[k] === "" || ph[k] == null ? `<mark>${k}?</mark>` : esc(ph[k])) : m);
}
function renderPreamble(loadInputs) {
  if (!S) return;
  const c = S.config;
  if (loadInputs) {
    for (const k of NETINFO_KEYS) if (document.activeElement !== $("ni_" + k)) $("ni_" + k).value = c[k];
    if (document.activeElement !== $("preambleText")) $("preambleText").value = c.preamble;
  }
  $("preambleRead").innerHTML = fillPreamble(pmode === "edit" ? $("preambleText").value : c.preamble);
  $("phList").innerHTML = Object.keys(placeholders()).map(k => `<code>{${k}}</code>`).join(" ") +
    `<br>Filled in automatically from net info, the grid settings and the game wording. ` +
    `Highlighted ones still need a value.`;
}
let niTimer = null;
for (const k of NETINFO_KEYS) {
  $("ni_" + k).addEventListener("input", () => {
    clearTimeout(niTimer);
    niTimer = setTimeout(async () => {
      const info = { type: "netinfo" };
      for (const key of NETINFO_KEYS) info[key] = $("ni_" + key).value;
      await api(info);
      $("niSaved").textContent = "Saved";
      setTimeout(() => $("niSaved").textContent = "", 1500);
    }, 400);
  });
}
async function savePreamble() {
  await api({ type: "preamble", text: $("preambleText").value });
  $("pSaved").textContent = "Saved " + new Date().toLocaleTimeString();
}
$("pSave").onclick = savePreamble;
$("pReset").onclick = async () => {
  if (!confirm("Replace your preamble with the default text?")) return;
  await api({ type: "preamble", reset: true });
  $("preambleText").value = S.config.preamble;
  $("pSaved").textContent = "Reset to default";
};
$("preambleText").addEventListener("input", () => { $("pSaved").textContent = "Unsaved changes"; });
window.addEventListener("beforeunload", (e) => {
  if (S && $("preambleText").value !== S.config.preamble) { e.preventDefault(); e.returnValue = ""; }
});

document.addEventListener("keydown", (e) => {
  if (!S || ["INPUT", "TEXTAREA"].includes(e.target.tagName) || $("settingsDlg").open
      || $("gameView").hidden) return;
  if (S.phase === "ready" && e.key === "Enter") { e.preventDefault(); api({ type: "draw" }); return; }
  if (S.phase !== "turn") return;
  const map = { ArrowUp: "N", ArrowDown: "S", ArrowRight: "E", ArrowLeft: "W" };
  const key = S.step === "fire" ? "fire" : "move";
  if (map[e.key]) {
    e.preventDefault();
    if (S.game.open.includes(map[e.key])) { pick[key] = map[e.key]; renderControls(); }
  } else if (e.key === "h" || e.key === "H") {
    pick[key] = key === "move" ? "H" : "-"; renderControls();
  } else if (e.key === "Enter" && pick[key] !== null) {
    e.preventDefault();
    api(key === "move" ? { type: "move", move: pick.move } : { type: "fire", fire: pick.fire });
  }
});

api().then(() => { if (store.get("nethunt.tab") === "preamble") showTab("preamble"); });

// Installable and usable offline when served over https (or from localhost).
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(e => console.warn("Offline support unavailable:", e));
}
