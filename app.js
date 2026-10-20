// Memory Palace VR, iteration 1.
// One room = one conceptual domain (D2). Loop: see the centre image (D11) -> place the
// objects (D1) -> walk once, clockwise and left to right (D12, D8) -> test (D4) -> score.
// A missed item plays the wrong sound and snaps the view to where it lived (D14).
// Each fact is an animated scene with absurd voice lines that land on the action (D15).
// Outliers and sources sit on the ceiling (D13). One task on the panel at a time (D7).

const DEG = Math.PI / 180;
const ROOM = { half: 4, height: 3.2 };
const START = { pos: [0, 3.2], look: [0, 1.4, 0] }; // just inside the front door, facing the centre image
const CEILING_STOP = { pos: [0, 1.9], look: [0, ROOM.height, -0.4] };
const CEILING_STOP_NARROW = { pos: [0, 3.6], look: [0, ROOM.height, 0.4] }; // portrait: step back so the board fits across

// Loci in walk order: clockwise from the front door, left to right along each wall (D12).
// Marker shape + colour + number tell loci apart without relying on colour alone (D9).
const LOCI = [
  { wall: "left wall", x: -3.7, z: 1.6, rotY: 90, shape: 32, color: "#E5484D", name: "circle" },
  { wall: "left wall", x: -3.7, z: -1.6, rotY: 90, shape: 3, color: "#F2A33A", name: "triangle" },
  { wall: "back wall", x: -1.6, z: -3.7, rotY: 0, shape: 4, color: "#E8D44D", name: "square", tilt: 45 },
  { wall: "back wall", x: 1.6, z: -3.7, rotY: 0, shape: 5, color: "#3DBE7B", name: "pentagon" },
  { wall: "right wall", x: 3.7, z: -1.6, rotY: -90, shape: 6, color: "#4C8DF6", name: "hexagon" },
  { wall: "right wall", x: 3.7, z: 1.6, rotY: -90, shape: 4, color: "#A86BF0", name: "diamond" },
];
const PLINTH_TOP = 0.9;

const $ = (s) => document.querySelector(s);
const scene = $("a-scene");
let DATA = null;
const state = {
  phase: "loading", carry: 0, placed: Array(LOCI.length).fill(null), // placed[locus] = item index
  history: [], walkStop: 0, testStop: 0, marks: [], log: null,
};

// ---------------------------------------------------------------- entities
function el(tag, attrs = {}, parent = null) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// Text drawn to a canvas texture: crisp at any size, works offline, any character set.
function text(parent, value, opts = {}) {
  const THREE = AFRAME.THREE;
  const w = opts.width || 1, wrap = opts.wrap || 34;
  const ppm = Math.min(1024, 2048 / w); // canvas pixels per metre
  const fontPx = Math.round((w * ppm) / (wrap * 0.5));
  const font = `600 ${fontPx}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const c = document.createElement("canvas");
  let ctx = c.getContext("2d");
  ctx.font = font;
  const maxW = w * ppm;
  const lines = [];
  for (const para of String(value).split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const tryLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(tryLine).width > maxW && line) { lines.push(line); line = word; } else line = tryLine;
    }
    lines.push(line);
  }
  const lineH = Math.round(fontPx * 1.3);
  c.width = Math.ceil(maxW);
  c.height = Math.max(1, lines.length * lineH);
  ctx = c.getContext("2d");
  ctx.font = font;
  ctx.fillStyle = opts.color || "#F4F6FB";
  ctx.textBaseline = "middle";
  const align = opts.align || "center";
  ctx.textAlign = align;
  const x = align === "center" ? c.width / 2 : align === "right" ? c.width : 0;
  lines.forEach((l, i) => ctx.fillText(l, x, i * lineH + lineH / 2));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const e = el("a-entity", { position: opts.pos || "0 0 0.002" }, parent);
  e.dataset.text = value;
  e.setObject3D("mesh", new THREE.Mesh(new THREE.PlaneGeometry(w, c.height / ppm),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
  return e;
}

function buildRoom() {
  const room = $("#room");
  const { half: h, height: H } = ROOM;
  el("a-plane", { width: h * 2, height: h * 2, rotation: "-90 0 0", color: "#3A2F28" }, room);
  el("a-plane", { width: h * 2, height: h * 2, rotation: "90 0 0", position: `0 ${H} 0`, color: "#1E2A44" }, room);
  const wall = "#C9C2B6";
  el("a-plane", { width: h * 2, height: H, position: `0 ${H / 2} ${-h}`, color: wall }, room);
  el("a-plane", { width: h * 2, height: H, position: `${-h} ${H / 2} 0`, rotation: "0 90 0", color: "#C2BBAF" }, room);
  el("a-plane", { width: h * 2, height: H, position: `${h} ${H / 2} 0`, rotation: "0 -90 0", color: "#C2BBAF" }, room);
  // Front wall with the front door the user starts at.
  el("a-plane", { width: h * 2, height: H, position: `0 ${H / 2} ${h}`, rotation: "0 180 0", color: wall }, room);
  el("a-box", { width: 1.3, height: 2.25, depth: 0.08, position: `0 1.125 ${h - 0.05}`, color: "#5A4636" }, room);
  el("a-plane", { width: 1.0, height: 0.04, position: `0 0.01 ${h - 0.6}`, rotation: "-90 0 0", color: "#E8D44D" }, room);

  // Centre image: the domain's anchor (D11).
  el("a-cylinder", { radius: 0.45, height: 0.8, position: "0 0.4 0", color: "#2B3142" }, room);
  const centre = el("a-entity", { position: "0 1.35 0" }, room);
  centreScene = mount(DATA.centre.object, centre);
  text(room, DATA.domain, { pos: "0 2.35 0", width: 3, wrap: 24 });
  text(room, DATA.centre.caption, { pos: "0 2.1 0", width: 2.4, wrap: 32, color: "#FFFFFF" });

  // Loci: plinth against the wall, numbered shape marker above it.
  LOCI.forEach((L, i) => {
    const g = el("a-entity", { position: `${L.x} 0 ${L.z}`, rotation: `0 ${L.rotY} 0` }, room);
    const plinth = el("a-box", { width: 0.8, height: PLINTH_TOP, depth: 0.5, position: `0 ${PLINTH_TOP / 2} 0`, color: "#6D6457", class: "clickable" }, g);
    plinth.dataset.locus = i;
    const mark = el("a-entity", { position: "0 1.85 -0.27" }, g);
    el("a-circle", { radius: 0.24, segments: L.shape, color: L.color, rotation: `0 0 ${L.tilt || (L.shape === 3 ? 90 : 0)}`, material: "shader: flat" }, mark);
    text(mark, String(i + 1), { width: 2.4, wrap: 12, color: "#10131C" });
    L.slot = el("a-entity", { position: `0 ${PLINTH_TOP} 0` }, g);
    L.ring = el("a-ring", { "radius-inner": 0.3, "radius-outer": 0.36, color: "#FFFFFF", position: "0 1.85 -0.26", visible: false, material: "shader: flat",
      animation: "property: scale; from: 1 1 1; to: 1.15 1.15 1.15; dir: alternate; loop: true; dur: 700; easing: easeInOutSine" }, g);
    L.pad = [L.x + 1.7 * Math.sin(L.rotY * DEG), L.z + 1.7 * Math.cos(L.rotY * DEG)];
    plinth.addEventListener("click", () => onLocusClick(i));
    plinth.addEventListener("mouseenter", () => { if (state.phase === "encode" && state.placed[i] === null) plinth.setAttribute("color", "#8F8574"); });
    plinth.addEventListener("mouseleave", () => plinth.setAttribute("color", "#6D6457"));
  });

  // Ceiling: outliers and sources, readable when you look up (D13).
  const board = el("a-entity", { position: `0 ${H - 0.02} 0.4`, rotation: "90 0 0" }, room);
  el("a-plane", { width: 3.4, height: 1.7, color: "#F4F6FB", material: "shader: flat; side: double" }, board);
  const c = DATA.ceiling;
  text(board, "LOOK UP: OUTLIERS", { pos: "0 0.62 0.01", width: 3, wrap: 36, color: "#4352C9" });
  text(board, c.outliers.join("\n"), { pos: "0 0.28 0.01", width: 3.1, wrap: 46, color: "#1B2130" });
  text(board, "SOURCES", { pos: "0 -0.2 0.01", width: 3, wrap: 36, color: "#0D7F7D" });
  text(board, c.sources.join("\n"), { pos: "0 -0.5 0.01", width: 3.1, wrap: 50, color: "#1B2130" });
}

// Each fact is an animated scene from scenes.js; the motion itself encodes the fact (D15).
// One tick drives every live scene's update(phase). Only the scene in focus speaks, for
// VOICE_LOOPS loops, so the room stays calm. In the test a scene speaks only after Reveal.
const VOICE_LOOPS = 2;
const live = new Set();
const clips = {};
let focus = null, playing = null, centreScene = null;

function clip(id) {
  if (!clips[id]) { clips[id] = new Audio(`sounds/voice/${id}.mp3`); clips[id].preload = "auto"; }
  return clips[id];
}

function mount(key, parent, voiced = false) {
  const holder = el("a-entity", {}, parent);
  const s = SCENES[key](holder);
  const entry = { holder, ...s, t0: performance.now(), prev: -1 };
  s.cues.forEach((c) => clip(c.clip));
  live.add(entry);
  if (voiced) speak(entry);
  return entry;
}

// Loop length: the scene's own cycle, stretched so every line ends before the next cue.
function span(e) {
  let ms = e.cycle;
  e.cues.forEach((c, k) => {
    const next = k + 1 < e.cues.length ? e.cues[k + 1].at : e.cues[0].at + 1;
    const dur = clip(c.clip).duration;
    if (dur > 0) ms = Math.max(ms, ((dur + 0.25) * 1000) / (next - c.at));
  });
  return ms;
}

function speak(e) {
  quiet();
  if (!e) return;
  focus = e;
  e.t0 = performance.now();
  e.prev = -1;
}

function quiet() {
  focus = null;
  if (playing) playing.pause();
  playing = null;
}

function tickScenes() {
  const now = performance.now();
  for (const e of live) {
    if (!e.holder.isConnected) { live.delete(e); if (focus === e) quiet(); continue; }
    const t = (now - e.t0) / span(e), phase = t - Math.floor(t);
    e.update(phase);
    if (e === focus && t < VOICE_LOOPS) {
      for (const c of e.cues) {
        if (e.prev < Math.floor(t) + c.at && t >= Math.floor(t) + c.at) {
          if (playing) playing.pause();
          playing = clip(c.clip);
          playing.currentTime = 0;
          playing.play().catch(() => {});
        }
      }
    }
    e.prev = t;
  }
}

AFRAME.registerComponent("fact-scenes", { tick: tickScenes });

function showObject(locus, on, voiced = false) {
  const L = LOCI[locus];
  while (L.slot.firstChild) L.slot.removeChild(L.slot.firstChild);
  L.scene = on && state.placed[locus] !== null ? mount(DATA.items[state.placed[locus]].object, L.slot, voiced) : null;
}

// ---------------------------------------------------------------- panel (D7)
// A small lectern panel beside the user, re-placed after every hop.
// On a portrait screen (phones) the lectern would sit outside the narrow view, so the
// panel docks to the bottom of the screen instead and follows the camera.
const PANEL = { w: 1.05, h: 0.66 };
let panelPlace = null;

function hud() {
  return !scene.is("vr-mode") && innerWidth / innerHeight < 1.2;
}

// A portrait screen sees a narrow slice of the room, so widen the lens until about
// 56 degrees across fit, capped at 100 degrees tall to limit stretching.
function fitLens() {
  const a = innerWidth / innerHeight;
  const fov = scene.is("vr-mode") || a >= 1 ? 80 : Math.min(100, Math.max(80, (2 * Math.atan(Math.tan(28 * DEG) / a)) / DEG));
  $("#cam").setAttribute("camera", "fov", fov);
}

function placePanel() {
  fitLens();
  const p = $("#panel").object3D;
  const rig = $("#rig").object3D;
  const yaw = rig.rotation.y;
  if (hud()) return; // panel-hud positions it every frame
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  p.position.set(rig.position.x + fx * 1.1 + rx * 0.7, panelPlace.y, rig.position.z + fz * 1.1 + rz * 0.7);
  p.rotation.set(panelPlace.tilt * DEG, yaw - 30 * DEG, 0, "YXZ");
}

// Screen-docked panel: far enough to fit the screen width, its bottom edge just above the screen's.
AFRAME.registerComponent("panel-hud", {
  init() { this.pos = new AFRAME.THREE.Vector3(); this.quat = new AFRAME.THREE.Quaternion(); },
  tick() {
    if (!hud()) return;
    const cam = $("#cam"), p = $("#panel").object3D;
    const halfV = (cam.getAttribute("camera").fov * DEG) / 2;
    const tanV = Math.tan(halfV), tanH = tanV * (innerWidth / innerHeight);
    const d = Math.max(PANEL.w / 2 / (tanH * 0.94), 1.1);
    const y = -(tanV * d - PANEL.h / 2 - 0.04 * d);
    cam.object3D.updateMatrixWorld(true);
    cam.object3D.getWorldPosition(this.pos);
    cam.object3D.getWorldQuaternion(this.quat);
    p.position.set(0, y, -d).applyQuaternion(this.quat).add(this.pos);
    p.quaternion.copy(this.quat);
  },
});

function panel(title, body, buttons = [], preview = null, place = { y: 1.12, tilt: -22 }) {
  const p = $("#panel");
  while (p.firstChild) p.removeChild(p.firstChild);
  panelPlace = place;
  placePanel();
  el("a-plane", { width: 1.05, height: 0.66, color: "#1B2130", material: "transparent: true; opacity: 0.9; shader: flat" }, p);
  text(p, title, { pos: "0 0.25 0.003", width: 0.95, wrap: 30, color: "#AEB8FF" });
  text(p, body, { pos: `${preview ? 0.12 : 0} 0.04 0.003`, width: preview ? 0.72 : 0.95, wrap: 34 });
  if (preview) {
    const holder = el("a-entity", { position: "-0.38 -0.1 0.06", scale: "0.4 0.4 0.4" }, p);
    mount(preview, holder, true);
  }
  const w = 0.3, gap = 0.04, x0 = -((buttons.length - 1) * (w + gap)) / 2;
  buttons.forEach(([label, fn, color], i) => {
    const b = el("a-plane", { width: w, height: 0.1, color: color || "#4352C9", position: `${x0 + i * (w + gap)} -0.24 0.004`, class: "clickable", material: "shader: flat" }, p);
    text(b, label, { width: 0.3, wrap: 14 });
    b.addEventListener("click", fn);
    b.addEventListener("mouseenter", () => b.setAttribute("material", "color", "#8C96F0"));
    b.addEventListener("mouseleave", () => b.setAttribute("material", "color", color || "#4352C9"));
  });
}

// ---------------------------------------------------------------- movement (D8)
const wait = (ms) => new Promise((r) => setTimeout(r, ms)); // setTimeout keeps ticking inside a WebXR session

async function fade(to) {
  const f = $("#fade");
  f.setAttribute("visible", true);
  const from = f.getAttribute("material").opacity;
  for (let k = 1; k <= 8; k++) { f.setAttribute("material", "opacity", from + (to - from) * k / 8); await wait(18); }
  if (to === 0) f.setAttribute("visible", false);
}

// Teleport with a short fade, then face the target. Never moves the view smoothly.
async function teleport([x, z], look) {
  await fade(1);
  const rig = $("#rig").object3D, cam = $("#cam");
  const yaw = Math.atan2(-(look[0] - x), -(look[2] - z));
  if (scene.renderer.xr.isPresenting) {
    const head = cam.object3D;
    const ry = yaw - new AFRAME.THREE.Euler().setFromQuaternion(head.quaternion, "YXZ").y;
    rig.rotation.y = ry;
    rig.position.set(x - (head.position.x * Math.cos(ry) + head.position.z * Math.sin(ry)), 0,
      z - (-head.position.x * Math.sin(ry) + head.position.z * Math.cos(ry)));
  } else {
    const lc = cam.components["look-controls"];
    rig.rotation.y = yaw;
    rig.position.set(x, 0, z);
    lc.yawObject.rotation.y = 0;
    lc.pitchObject.rotation.x = Math.atan2(look[1] - 1.6, Math.hypot(look[0] - x, look[2] - z));
  }
  await fade(0);
}

function locusLook(i) { const L = LOCI[i]; return [L.x, PLINTH_TOP + 0.25, L.z]; }

// ---------------------------------------------------------------- loop
function itemFor(locus) { return DATA.items[state.placed[locus]]; }
function where(i) { return `Stop ${i + 1}: ${LOCI[i].wall}, ${LOCI[i].name}`; }

function intro() {
  state.phase = "intro";
  state.log = { build: "iteration-1", list: DATA.list, started: new Date().toISOString(), xr: false, placements: [], marks: [], times: {} };
  panel("Memory Palace", `This room holds one subject: ${DATA.domain.toLowerCase()}. Look at the centre first. That image is what the whole room is about.`,
    [["Start", encodeStart]]);
  speak(centreScene);
}

function encodeStart() {
  state.phase = "encode";
  state.t0 = performance.now();
  state.log.xr = scene.renderer.xr.isPresenting;
  nextCarry();
}

function nextCarry() {
  const n = state.history.length;
  if (n === DATA.items.length) return encodeDone();
  const it = DATA.items[n];
  LOCI.forEach((L, i) => L.ring.setAttribute("visible", state.placed[i] === null));
  const undo = n ? [["Undo", undoPlace, "#5A6378"]] : [];
  panel(`Place ${n + 1} of ${DATA.items.length}: ${it.label}`, `${it.fact}\n\nPoint at any empty stand to place it.`, undo, it.object);
}

function onLocusClick(i) {
  if (state.phase !== "encode" || state.placed[i] !== null) return;
  const item = state.history.length;
  state.placed[i] = item;
  state.history.push(i);
  state.log.placements.push({ item: DATA.items[item].id, locus: i + 1, ms: Math.round(performance.now() - state.t0) });
  showObject(i, true);
  nextCarry();
}

function undoPlace() {
  const i = state.history.pop();
  state.placed[i] = null;
  state.log.placements.pop();
  showObject(i, false);
  nextCarry();
}

function encodeDone() {
  LOCI.forEach((L) => L.ring.setAttribute("visible", false));
  state.log.times.encodeMs = Math.round(performance.now() - state.t0);
  panel("All placed", "Now walk the room once: the centre first, then clockwise, left to right along each wall. You only get one walk.", [["Walk", walkStart]]);
}

async function walkStart() {
  state.phase = "walk";
  state.t0 = performance.now();
  state.walkStop = -1;
  await teleport([0, 1.9], [0, 1.4, 0]);
  speak(centreScene);
  panel("The centre", `${DATA.domain}. ${DATA.centre.caption}`, [["Next", walkNext]], null);
}

async function walkNext() {
  state.walkStop += 1;
  const i = state.walkStop;
  if (i < LOCI.length) {
    await teleport(LOCI[i].pad, locusLook(i));
    speak(LOCI[i].scene);
    const it = itemFor(i);
    panel(`${where(i)}: ${it.label}`, it.fact, [["Next", walkNext]]);
  } else if (i === LOCI.length) {
    quiet();
    const stop = hud() ? CEILING_STOP_NARROW : CEILING_STOP;
    await teleport(stop.pos, stop.look);
    panel("Look up", "The ceiling holds the outliers and the sources for this room.", [["Next", walkNext]], null, { y: 1.95, tilt: 20 });
  } else {
    state.log.times.walkMs = Math.round(performance.now() - state.t0);
    LOCI.forEach((_, k) => showObject(k, false));
    await teleport(START.pos, START.look);
    panel("The test", "Every object is hidden. At each lit stand, say or think what was there, then reveal it and mark yourself honestly.", [["Begin test", testStart]]);
  }
}

function testStart() {
  state.phase = "test";
  state.t0 = performance.now();
  state.testStop = 0;
  testAsk();
}

function testAsk() {
  const i = state.testStop;
  if (i === LOCI.length) return score();
  LOCI.forEach((L, k) => L.ring.setAttribute("visible", k === i));
  quiet();
  state.askedAt = performance.now();
  panel(`${where(i)}`, "What was here? Say it or think it, then reveal.", [["Reveal", () => testReveal(i)]]);
}

function testReveal(i) {
  const it = itemFor(i);
  const revealMs = Math.round(performance.now() - state.askedAt);
  const mark = (result) => {
    state.marks.push({ locus: i + 1, item: it.id, result, revealMs });
    if (result === "got") { state.testStop += 1; testAsk(); } else missed(i);
  };
  panel(it.label, it.fact, [["Got it", () => mark("got"), "#0D7F7D"], ["Missed it", () => mark("missed"), "#B3263A"]], it.object);
}

// D14: wrong sound, then snap to the stand and object that was missed.
async function missed(i) {
  const s = $("#wrong-sound");
  s.currentTime = 0;
  s.play().catch(() => {});
  LOCI[i].ring.setAttribute("visible", false);
  await teleport(LOCI[i].pad, locusLook(i));
  showObject(i, true, true);
  const it = itemFor(i);
  panel(`This is where it lived: ${it.label}`, it.fact, [["Back to test", async () => {
    showObject(i, false);
    await teleport(START.pos, START.look);
    state.testStop += 1;
    testAsk();
  }]]);
}

function score() {
  state.phase = "score";
  quiet();
  LOCI.forEach((L, k) => { L.ring.setAttribute("visible", false); showObject(k, true); });
  const got = state.marks.filter((m) => m.result === "got").length;
  const ms = Math.round(performance.now() - state.t0);
  Object.assign(state.log, { score: got, of: LOCI.length, marks: state.marks, finished: new Date().toISOString() });
  state.log.times.testMs = ms;
  const missedLabels = state.marks.filter((m) => m.result === "missed").map((m) => DATA.items.find((x) => x.id === m.item).label);
  const secs = Math.round(ms / 1000);
  panel(`Score: ${got} / ${LOCI.length}`, `Test time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}.` +
    (missedLabels.length ? `\nMissed: ${missedLabels.join(", ")}.` : "\nNothing missed."),
    [["Save log", saveLog, "#0D7F7D"], ["Again", () => location.reload(), "#5A6378"]]);
}

// Session log for testing: timings and marks only, no names.
function saveLog() {
  const blob = new Blob([JSON.stringify(state.log, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `session_${state.log.started.replace(/[:.]/g, "-")}.json`;
  a.click();
}

// iOS only lets an audio element play from code after it has played once inside a tap.
// On the first tap, start and stop every voice line and the wrong sound silently.
async function unlockAudio() {
  try {
    const tsv = await (await fetch("sounds/voice/lines.tsv")).text();
    tsv.split("\n").map((l) => l.split("\t")[0].trim()).filter(Boolean).forEach(clip);
  } catch (e) { /* clips still load as scenes mount */ }
  const unlock = () => {
    removeEventListener("touchend", unlock, true);
    removeEventListener("click", unlock, true);
    for (const a of [...Object.values(clips), $("#wrong-sound")]) {
      if (a === playing) continue;
      a.muted = true;
      a.play().then(() => { if (a !== playing) a.pause(); a.muted = false; }).catch(() => { a.muted = false; });
    }
  };
  addEventListener("touchend", unlock, true);
  addEventListener("click", unlock, true);
}

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    DATA = await (await fetch("items.json")).json();
  } catch (e) {
    document.body.insertAdjacentHTML("afterbegin", '<p style="position:fixed;z-index:9;padding:1em;background:#fff;font:16px sans-serif">Could not load items.json. Open this page through a web server (see README.md), not as a file.</p>');
    return;
  }
  buildRoom();
  scene.setAttribute("fact-scenes", "");
  scene.setAttribute("panel-hud", "");
  fitLens();
  addEventListener("resize", () => panelPlace && placePanel());
  scene.addEventListener("exit-vr", () => panelPlace && placePanel());
  unlockAudio();
  $("#fade").getObject3D("mesh").renderOrder = 9999; // fade draws over everything
  const lc = $("#cam").components["look-controls"];
  lc.pitchObject.rotation.x = Math.atan2(START.look[1] - 1.6, START.pos[1]);
  intro();
  window.palace = { state, LOCI }; // for automated checks
}

if (scene.hasLoaded) boot(); else scene.addEventListener("loaded", boot);
