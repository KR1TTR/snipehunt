/*
 * Snipe Hunt -- game engine and net session logic.
 *
 * No page code in here: the Net object takes actions ({type: "draw"}, ...)
 * and produces plain state that app.js draws. Everything is saved to the
 * browser's storage by app.js after each action.
 */
"use strict";

// ---------------------------------------------------------------------------
// Theme: every bit of wording lives here so it can be changed in one place.
// ---------------------------------------------------------------------------
const THEME = {
  title: "SNIPE HUNT",
  setting: "the woods",
  creature: "the snipe",
  creature_name: "Snipe",
  creature_letter: "S",
  pit_name: "Bog",
  pit_letter: "B",
  mover_name: "Giant owl",
  mover_letter: "O",
  weapon: "bag",
  ammo: "try",              // a miss uses one up; after the last, the snipe leaves
  ammos: "tries",
  verb: "swing",            // what you do with the weapon (on screen: "Swing E")
  // Warnings heard from a neighboring square.
  warn_creature: "You hear a soft winnowing call nearby.",
  warn_pit: "You hear frogs croaking.",
  warn_mover: "You hear a hoot overhead.",
  // Events.
  die_creature: "The snipe bursts out of the grass right under the hunter's feet and " +
                "zigzags off into the night. It got away. Game over.",
  die_pit: "The hunter sinks into the bog. Game over.",
  mover_event: "A giant owl swoops down and carries the hunter off!",
  creature_wakes: "The noise flushed the snipe, and it slipped off through the grass.",
  creature_sleeps: "The snipe stays hidden.",
  creature_gets_you: "The startled snipe ran straight into the hunter and flushed off " +
                     "into the night. It got away. Game over.",
  win: "Got it! {call} bagged the snipe! The net wins! Snipe are real after all!",
  fire: "{call} swings the bag {dirname}...",
  miss: "The bag comes up empty.",
  ask_fire: "Do you swing the bag, and which way?",
  hold_fire: "{call} holds onto the bag.",
  no_reply_hold: "No reply from {call}. Holding onto the bag and moving on.",
  out_of_ammo: "That was the last try. The snipe has heard enough commotion and slips away " +
               "for the night. Game over.",
  wall: "The woods end to the {dirname}. The hunter stays put.",
  creature_was: "The snipe was hiding at {square}.",
};

const DIRS = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const DIRNAMES = { N: "north", S: "south", E: "east", W: "west" };
const NATO = {
  A: "Alfa", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", F: "Foxtrot", G: "Golf",
  H: "Hotel", I: "India", J: "Juliett", K: "Kilo", L: "Lima", M: "Mike", N: "November",
  O: "Oscar", P: "Papa", Q: "Quebec", R: "Romeo", S: "Sierra", T: "Tango", U: "Uniform",
  V: "Victor", W: "Whiskey", X: "X-ray", Y: "Yankee", Z: "Zulu", 0: "Zero", 1: "One",
  2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight",
  9: "Niner", "/": "Stroke",
};
// Loose callsign check: letters/digits/slash, at least one letter and one digit.
const CALLSIGN = /^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9/]{3,}$/;

// Net info fields, kept between sessions and used as preamble placeholders.
const NETINFO_KEYS = ["net", "ncs", "ncs_name", "net_day", "net_time", "frequency"];

const DEFAULTS = { cols: 5, rows: 4, pits: 2, movers: 1, shots: 5, range: 1, wake: 0.75 };
const LIMITS = { cols: [2, 10], rows: [2, 10], pits: [0, 10], movers: [0, 10],
                 shots: [1, 20], range: [1, 10], wake: [0, 1] };
// wake: chance that a miss flushes the snipe to a neighboring square (default 75%).

// {placeholders} are filled in on the Preamble tab.
const DEFAULT_PREAMBLE =
`CQ, CQ, CQ. Calling the {net} into session. My name is {ncs_name}, {ncs}, and I am your net control station for this session.

This is a directed net. Please direct all check-ins and traffic through net control. This is an open net, and all that is required to participate is a valid amateur callsign. All licensed amateur radio operators are welcome to check in.

This net meets {net_day} at {net_time} on {frequency}.
The purpose of this net is to test directed radio communication in the event of an emergency, practiced via playing a cooperative game.

The game is called Snipe Hunt, and is played in the style of Hunt the Wumpus. Each player will be drawn by lottery each turn until the round is over. Each turn will consist of the drawn station choosing a direction of travel, followed by a choice of whether or not to use the weapon and the direction of use.
Net control will read out the clues to the locations of the hazards and the snipe. All that is needed to follow along is paper and pencil. Tonight's game field is a {cols} by {rows} grid, with the letters A-{cols_end} across the top designating the columns, and the numbers 1-{rows} along the side designating the rows.

Listen for the clues. They come only from the squares directly north, south, east and west of the hunter, never diagonally. Frogs croaking means a bog is next to the hunter. A hoot overhead means the giant owl is nearby, and it may carry the hunter off and drop them somewhere else on the grid. A soft winnowing call means the snipe is right next door.

The hunter carries a bag. When you hear the snipe, you can swing the bag at one of the squares right next to the hunter. Each miss makes noise and will likely flush the snipe to a new hiding spot, and after {shots} misses the snipe slips away for the night.

Play continues until the game is won by a player capturing the snipe. The game is lost when the snipe gets away, the hunter falls into a bog, the hunter runs out of tries, or net control ends the game.

At this time we will begin taking check-ins. Please give your call phonetically using the NATO alphabet, and your name. When you are called by net control, please give any traffic you may have, and say whether or not you wish to be a player.
`;

function fmt(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}
function clock(d = new Date(), seconds = true) {
  return d.toTimeString().slice(0, seconds ? 8 : 5);
}

// Random numbers: Math.random normally, or repeatable with ?seed=N in the URL.
function makeRng(seed) {
  if (seed == null || seed === "" || isNaN(seed)) return Math.random;
  let a = Number(seed) >>> 0;
  return function () {  // mulberry32
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const choose = (rng, arr) => arr[Math.floor(rng() * arr.length)];
function shuffled(rng, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Game: one hunt on the grid. Squares are numbered 0..cols*rows-1, row by row.
// ---------------------------------------------------------------------------
class Game {
  constructor(o, rng) {
    this.rng = rng;
    Object.assign(this, {
      cols: o.cols, rows: o.rows, shots: o.shots, range: o.range, wake: o.wake,
      over: false, won: false, result: "",
    });
    if (o.hunter !== undefined) {  // restoring a saved game
      Object.assign(this, o);
      return;
    }
    const needed = 2 + o.pits + o.movers;
    if (needed > o.cols * o.rows) throw new Error("Too many hazards for this grid size.");
    const picks = shuffled(rng, [...Array(o.cols * o.rows).keys()]).slice(0, needed);
    this.hunter = picks[0];
    this.creature = picks[1];
    this.pits = picks.slice(2, 2 + o.pits);
    this.movers = picks.slice(2 + o.pits);
    this.visited = [this.hunter];
  }

  toJSON() {
    const { rng, ...rest } = this;
    return rest;
  }

  label(i) { return String.fromCharCode(65 + (i % this.cols)) + (Math.floor(i / this.cols) + 1); }

  step(i, d) {
    const c = (i % this.cols) + DIRS[d][0], r = Math.floor(i / this.cols) + DIRS[d][1];
    return c >= 0 && c < this.cols && r >= 0 && r < this.rows ? r * this.cols + c : null;
  }
  neighbors(i) { return Object.keys(DIRS).map(d => this.step(i, d)).filter(n => n !== null); }
  openDirs(i) { return Object.keys(DIRS).filter(d => this.step(i, d) !== null); }

  warningKinds() {
    const near = this.neighbors(this.hunter), out = [];
    if (near.includes(this.creature)) out.push("creature");
    if (this.pits.some(p => near.includes(p))) out.push("pit");
    if (this.movers.some(m => near.includes(m))) out.push("mover");
    return out;
  }
  warnings() { return this.warningKinds().map(k => THEME["warn_" + k]); }

  _visit() { if (!this.visited.includes(this.hunter)) this.visited.push(this.hunter); }

  move(d) {
    if (d === "H") return ["The hunter holds position."];
    const nxt = this.step(this.hunter, d);
    if (nxt === null) return [fmt(THEME.wall, { dirname: DIRNAMES[d] })];
    this.hunter = nxt;
    return [`The hunter moves ${DIRNAMES[d]} to ${this.label(nxt)}.`, ...this._resolve()];
  }

  _resolve() {
    const events = [];
    for (let guard = 0; guard < 10; guard++) {  // movers can chain
      this._visit();
      if (this.hunter === this.creature) {
        events.push(THEME.die_creature);
        this.over = true;
        this.result = `the ${THEME.creature_name.toLowerCase()} got away (the hunter stepped on it)`;
        return events;
      }
      if (this.pits.includes(this.hunter)) {
        events.push(THEME.die_pit);
        this.over = true;
        this.result = `hunter lost in a ${THEME.pit_name.toLowerCase()}`;
        return events;
      }
      if (this.movers.includes(this.hunter)) {
        const here = this.hunter;
        const choices = [...Array(this.cols * this.rows).keys()].filter(i => i !== here);
        this.hunter = choose(this.rng, choices);
        events.push(`${THEME.mover_event} It drops the hunter at ${this.label(this.hunter)}.`);
        continue;
      }
      break;
    }
    return events;
  }

  shoot(d, call) {
    if (this.shots <= 0) return [`No ${THEME.ammos} left.`];
    this.shots -= 1;
    const fire = fmt(THEME.fire, { call, dirname: DIRNAMES[d] });
    let sq = this.hunter;
    for (let i = 0; i < this.range; i++) {
      sq = this.step(sq, d);
      if (sq === null) break;
      if (sq === this.creature) {
        this.over = this.won = true;
        this.result = `bagged by ${call}`;
        return [fire, fmt(THEME.win, { call })];
      }
    }
    const events = [fire, THEME.miss];
    if (this.shots === 0) {  // last try: the snipe leaves, no need to say where it went
      events.push(fmt(THEME.out_of_ammo, { ammo: THEME.ammo, ammos: THEME.ammos }));
      this.over = true;
      this.result = `the ${THEME.creature_name.toLowerCase()} got away (out of ${THEME.ammos})`;
      return events;
    }
    if (this.rng() < this.wake) {
      this.creature = choose(this.rng, this.neighbors(this.creature));
      events.push(THEME.creature_wakes);
      if (this.creature === this.hunter) {
        events.push(THEME.creature_gets_you);
        this.over = true;
        this.result = `the ${THEME.creature_name.toLowerCase()} got away (startled into the hunter)`;
        return events;
      }
    } else {
      events.push(THEME.creature_sleeps);
    }
    return events;
  }
}

// ---------------------------------------------------------------------------
// Net: one net session -- check-ins, lottery, games, transcript.
// ---------------------------------------------------------------------------
class Net {
  constructor(config, rng, saved) {
    this.config = config;     // net info, preamble, settings, phonetic (kept between sessions)
    this.rng = rng;
    this.stations = [];       // {call, name, time, player, inout}
    this.lottery = [];        // players still to be drawn this round
    this.moved = [];          // {call, how}  how: moved / skipped
    this.drawn = null;        // the player whose turn it is
    this.step = "move";       // within a turn: move, then "fire" (swing the bag)
    this.game = null;
    this.gameNo = 0;
    this.wins = 0;
    this.phase = "setup";     // setup | ready | turn | over
    this.round = 0;
    this.sensed = {};         // square label -> warning kinds felt there
    this.trail = [];          // square labels in the order first reached
    this.script = [];         // lines for net control to read right now
    this.transcript = [];
    this.games = [];          // one summary per finished game, for the log
    this.notice = "";
    this.started = new Date().toISOString();
    if (saved) {
      Object.assign(this, saved);
      if (saved.game) this.game = new Game(saved.game, rng);
    }
  }

  toJSON() {
    const { config, rng, notice, ...rest } = this;
    return rest;
  }

  get settings() { return this.config.settings; }

  // --- text helpers ---------------------------------------------------------
  _emit(kind, text) {
    const line = { t: clock(), kind, text };
    this.transcript.push(line);
    this.script.push(line);
  }
  air(text) { this._emit("air", text); }
  ncs(text) { this._emit("ncs", text); }

  spoken(call) {
    if (!this.config.phonetic) return call;
    return `${call} (${[...call].map(ch => NATO[ch] || ch).join(" ")})`;
  }
  addressed(call) {
    const s = this.station(call);
    return s && s.name ? `${this.spoken(call)}, ${s.name}` : this.spoken(call);
  }

  // --- list helpers ---------------------------------------------------------
  station(call) { return this.stations.find(s => s.call === call); }
  active() { return this.phase === "ready" || this.phase === "turn"; }
  inGame(call) {
    return this.lottery.includes(call) || call === this.drawn || this.moved.some(m => m.call === call);
  }
  _join(call) {
    if (this.active() && !this.inGame(call)) {
      this.lottery.push(call);
      this.ncs(`${call} joins the lottery.`);
    }
  }
  _leave(call) {
    this.lottery = this.lottery.filter(c => c !== call);
    this.moved = this.moved.filter(m => m.call !== call);
    if (call === this.drawn && this.phase === "turn") {
      this.script = [];
      this.air(`${call} has left the game. Moving on.`);
      this.drawn = null;
      this.phase = "ready";
    }
    this._checkRound();
  }
  _checkRound() {
    if (this.phase !== "ready" || this.lottery.length || !this.moved.length) return;
    const done = this.round;
    this.round += 1;
    this.lottery = this.moved.map(m => m.call).filter(c => (this.station(c) || {}).player);
    this.moved = [];
    this.air(`That completes round ${done}. All players are back in the lottery for round ${this.round}.`);
  }

  // --- game helpers ---------------------------------------------------------
  _notePosition() {
    const g = this.game, here = g.label(g.hunter);
    this.sensed[here] = g.warningKinds();
    if (!this.trail.includes(here)) this.trail.push(here);
  }
  _situation() {
    const g = this.game;
    const ways = g.openDirs(g.hunter).map(d => DIRNAMES[d]).join(", ");
    this.air(`${this.addressed(this.drawn)}, you're up. The hunter is at ${g.label(g.hunter)}. ` +
             `Open directions: ${ways}.`);
    for (const w of g.warnings().length ? g.warnings() : ["Nothing unusual here."]) this.air(w);
    this.air(`${g.shots} ${g.shots === 1 ? THEME.ammo : THEME.ammos} left. Which way do you move?`);
  }
  _finishTurn(how) {
    this.moved.push({ call: this.drawn, how });
    this.drawn = null;
    if (this.game.over) this._endGame();
    else { this.phase = "ready"; this._checkRound(); }
  }
  _endGame() {
    const g = this.game;
    this.phase = "over";
    this.drawn = null;
    this.wins += g.won ? 1 : 0;
    this.games.push({
      no: this.gameNo, size: `${g.cols}x${g.rows}`, result: g.won ? "won" : "lost",
      detail: g.result, rounds: this.round, at: g.label(g.creature), time: clock(new Date(), false),
    });
    this.air(`Game ${this.gameNo} over in round ${this.round}. Tonight's record: ` +
             `${this.wins} won, ${this.gameNo - this.wins} lost.`);
    this.air(fmt(THEME.creature_was, { square: g.label(g.creature) }));
  }

  // --- actions ----------------------------------------------------------------
  act(a) {
    this.notice = "";
    const handler = this["do_" + a.type];
    if (handler) handler.call(this, a);
    else this.notice = `Unknown action: ${a.type}`;
  }

  do_add(a) {
    const call = String(a.call || "").trim().toUpperCase();
    const name = String(a.name || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 40);
    if (!CALLSIGN.test(call)) { this.notice = `'${a.call || ""}' doesn't look like a callsign.`; return; }
    const existing = this.station(call);
    if (existing) {
      if (name && name !== existing.name) { existing.name = name; this.ncs(`${call} is ${name}.`); }
      else this.notice = `${call} is already checked in.`;
      return;
    }
    const player = !!a.player;
    this.stations.push({ call, name, player, inout: false, time: clock(new Date(), false) });
    this.ncs(`Check-in: ${name ? call + ", " + name : call}${player ? " (player)" : ""}`);
    if (player) this._join(call);
  }

  do_rename(a) {
    const s = this.station(a.call);
    if (s) s.name = String(a.name || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 40);
  }

  do_flag(a) {
    const s = this.station(a.call);
    if (!s || !["player", "inout"].includes(a.flag)) return;
    s[a.flag] = !!a.value;
    if (a.value) s[a.flag === "player" ? "inout" : "player"] = false;
    if (s.player) {
      this.ncs(`${s.call} marked as a player.`);
      this._join(s.call);
    } else {
      if (s.inout) this.ncs(`${s.call} marked no traffic / in-out.`);
      if (this.inGame(s.call)) this._leave(s.call);
    }
  }

  do_delete(a) {
    if (!this.station(a.call)) return;
    this.stations = this.stations.filter(s => s.call !== a.call);
    this.ncs(`${a.call} removed from the check-in list.`);
    if (this.inGame(a.call)) this._leave(a.call);
  }

  do_settings(a) {
    const s = this.settings;
    for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
      if (!(k in a)) continue;
      let v = Number(a[k]);
      if (isNaN(v)) continue;
      if (k !== "wake") v = Math.round(v);
      s[k] = Math.min(hi, Math.max(lo, v));
    }
    if (2 + s.pits + s.movers > s.cols * s.rows) {
      this.notice = "Too many hazards for that grid; reduced.";
      s.pits = Math.min(s.pits, s.cols * s.rows - 2);
      s.movers = Math.min(s.movers, s.cols * s.rows - 2 - s.pits);
    }
    if ("phonetic" in a) this.config.phonetic = !!a.phonetic;
    else if (this.active()) this.notice = this.notice || "Grid/hazard settings take effect next game.";
  }

  do_netinfo(a) {
    for (const k of NETINFO_KEYS) {
      if (!(k in a)) continue;
      const v = String(a[k]).split(/\s+/).filter(Boolean).join(" ").slice(0, 80);
      this.config[k] = k === "ncs" ? v.toUpperCase() : v;
    }
  }

  do_preamble(a) {
    this.config.preamble = a.reset ? DEFAULT_PREAMBLE : String(a.text || "").slice(0, 20000);
    if (a.reset) this.notice = "Preamble reset to the default.";
  }

  do_new_game() {
    const s = this.settings;
    this.game = new Game(s, this.rng);
    this.gameNo += 1;
    this.round = 1;
    this.lottery = this.stations.filter(st => st.player).map(st => st.call);
    this.moved = [];
    this.drawn = null;
    this.sensed = {};
    this.trail = [];
    this.script = [];
    this.phase = "ready";
    const g = this.game;
    const setting = THEME.setting.charAt(0).toUpperCase() + THEME.setting.slice(1);
    this.air(`${THEME.title}, game ${this.gameNo}. ${setting} are a grid, columns A to ` +
             `${String.fromCharCode(64 + g.cols)}, rows 1 to ${g.rows}. Row 1 is north.`);
    this.air(`The hunter sets out from ${g.label(g.hunter)} with ${g.shots} ${THEME.ammos}.`);
    for (const w of g.warnings()) this.air(w);
    this._notePosition();
  }

  do_draw() {
    if (this.phase !== "ready") return;
    this._checkRound();
    if (!this.lottery.length) {
      this.notice = "Nobody in the lottery. Tick Player next to some check-ins.";
      return;
    }
    this.drawn = choose(this.rng, this.lottery);
    this.lottery = this.lottery.filter(c => c !== this.drawn);
    this.phase = "turn";
    this.step = "move";
    this.script = [];
    this.air(`Round ${this.round} lottery draw: ${this.addressed(this.drawn)}.`);
    this._situation();
  }

  do_move(a) {
    const g = this.game;
    if (this.phase !== "turn" || this.step !== "move") return;
    if (!["N", "S", "E", "W", "H"].includes(a.move)) { this.notice = "Pick a move (or Hold) first."; return; }
    this.script = [];
    for (const e of g.move(a.move)) this.air(e);
    this._notePosition();
    if (g.over) { this._finishTurn("moved"); return; }
    if (g.shots <= 0) {
      this.air(`No ${THEME.ammos} left, so that ends ${this.drawn}'s turn.`);
      this._finishTurn("moved");
      return;
    }
    // Step 2: tell the station what they sense here, then ask about firing.
    this.step = "fire";
    for (const w of g.warnings().length ? g.warnings() : ["Nothing unusual here."]) this.air(w);
    this.air(`${this.drawn}, ${g.shots} ${g.shots === 1 ? THEME.ammo : THEME.ammos} left. ` +
             THEME.ask_fire);
  }

  do_fire(a) {
    const g = this.game;
    if (this.phase !== "turn" || this.step !== "fire") return;
    const fire = a.fire || "-";
    if (!["N", "S", "E", "W", "-"].includes(fire)) return;
    const call = this.drawn;
    this.script = [];
    if (fire === "-") this.air(fmt(THEME.hold_fire, { call }));
    else {
      for (const e of g.shoot(fire, call)) this.air(e);
      this._notePosition();  // the creature may have moved next to us
    }
    this._finishTurn("moved");
  }

  do_skip() {
    if (this.phase !== "turn") return;
    this.script = [];
    if (this.step === "fire") {
      // They moved but went quiet before deciding: count it as not swinging.
      this.air(fmt(THEME.no_reply_hold, { call: this.drawn }));
      this._finishTurn("moved");
    } else {
      this.air(`No reply from ${this.drawn}. Moving on.`);
      this._finishTurn("skipped");
    }
  }

  do_abandon() {
    if (!this.active()) return;
    this.script = [];
    this.ncs("Net control ended the game early.");
    this.game.over = true;
    this.game.result = "ended early by net control";
    this._endGame();
  }

  // --- the page's view of everything --------------------------------------------
  state() {
    const g = this.game;
    const out = {
      theme: THEME, settings: this.settings, phonetic: !!this.config.phonetic, phase: this.phase,
      stations: this.stations, lottery: this.lottery, moved: this.moved, drawn: this.drawn,
      step: this.step, round: this.round, game_no: this.gameNo, wins: this.wins,
      script: this.script, transcript: this.transcript, notice: this.notice, game: null,
      config: this.config, started: this.started,
    };
    if (g) {
      out.game = {
        cols: g.cols, rows: g.rows, hunter: g.label(g.hunter),
        visited: g.visited.map(v => g.label(v)), sensed: this.sensed, trail: this.trail,
        shots: g.shots, max_shots: this.settings.shots, open: g.openDirs(g.hunter),
        over: g.over, won: g.won,
        hazards: {
          creature: [g.label(g.creature)],
          pit: g.pits.map(p => g.label(p)).sort(),
          mover: g.movers.map(m => g.label(m)).sort(),
        },
      };
    }
    return out;
  }

  // --- session log -------------------------------------------------------------
  logFilename() {
    const d = new Date(this.started), p = n => String(n).padStart(2, "0");
    return `snipehunt-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-` +
           `${p(d.getHours())}${p(d.getMinutes())}.txt`;
  }

  sessionText() {
    const c = this.config, start = new Date(this.started), now = new Date();
    const rule = "-".repeat(64), pad = (s, n) => String(s).padEnd(n);
    const out = [
      `${THEME.title} -- NET SESSION LOG`, rule,
      `Net:          ${c.net || "(not set)"}`,
      `Net control:  ${c.ncs || "(not set)"}${c.ncs_name ? ", " + c.ncs_name : ""}`,
      `Frequency:    ${c.frequency || "(not set)"}`,
      `Date:         ${start.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}`,
      `Started:      ${clock(start, false)}    Last updated: ${clock(now, false)}`, "",
    ];
    const players = this.stations.filter(s => s.player).length;
    const inout = this.stations.filter(s => s.inout).length;
    out.push(`CHECK-INS (${this.stations.length} total: ${players} players, ${inout} no traffic / ` +
             `in-out, ${this.stations.length - players - inout} other)`, rule,
             `${pad("Time", 7)}${pad("Callsign", 12)}${pad("Name", 22)}Status`);
    for (const s of this.stations) {
      const status = s.player ? "Player" : s.inout ? "No traffic / in-out" : "";
      out.push(`${pad(s.time, 7)}${pad(s.call, 12)}${pad(s.name, 22)}${status}`.trimEnd());
    }
    if (!this.stations.length) out.push("(none)");

    out.push("", `GAMES (${this.games.length} played: ${this.wins} won, ` +
                 `${this.games.length - this.wins} lost)`, rule);
    for (const gm of this.games) {
      out.push(`Game ${gm.no}  ${gm.time}  ${gm.size} grid  ${pad(gm.result.toUpperCase(), 5)} ` +
               `after ${gm.rounds} round(s): ${gm.detail}. ${THEME.creature_name} at ${gm.at}.`);
    }
    if (this.active()) out.push(`Game ${this.gameNo} still in progress (round ${this.round}).`);
    else if (!this.games.length) out.push("(none)");

    out.push("", "TRANSCRIPT  (>> = read on air)", rule);
    for (const l of this.transcript) out.push(`${l.t}  ${l.kind === "air" ? ">> " : "   "}${l.text}`);
    return out.join("\n") + "\n";
  }
}
