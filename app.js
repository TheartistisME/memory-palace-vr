// Memory Palace VR, iteration 1.
// One room = one conceptual domain (D2). Loop: see the centre image (D11) -> place the
// objects (D1) -> walk once, clockwise and left to right (D12, D8) -> test (D4) -> score.
// A missed item plays the wrong sound and snaps the view to where it lived (D14).
// Each fact is an animated scene with absurd voice lines that land on the action (D15).
// Outliers and sources sit on the ceiling (D13). One task on the panel at a time (D7).
// Iteration 1.2: Start teaches the first placement on stand 1 (D16); text in 13 languages (D17);
// each stand takes the look of the fact it holds (D18); gentle mode for older users (D19).

const DEG = Math.PI / 180;
const ROOM = { half: 4, height: 3.2 };
const START = { pos: [0, 3.2], look: [0, 1.4, 0] }; // just inside the front door, facing the centre image
const CEILING_STOP = { pos: [0, 1.9], look: [0, ROOM.height, -0.4] };
const CEILING_STOP_NARROW = { pos: [0, 3.6], look: [0, ROOM.height, 0.4] }; // portrait: step back so the board fits across

// Loci in walk order: clockwise from the front door, left to right along each wall (D12).
// Marker shape + colour + number tell loci apart without relying on colour alone (D9).
// Shape names come from the language's `shapes` list, in this order.
const LOCI = [
  { wall: "left", x: -3.7, z: 1.6, rotY: 90, shape: 32, color: "#E5484D" },
  { wall: "left", x: -3.7, z: -1.6, rotY: 90, shape: 3, color: "#F2A33A" },
  { wall: "back", x: -1.6, z: -3.7, rotY: 0, shape: 4, color: "#E8D44D", tilt: 45 },
  { wall: "back", x: 1.6, z: -3.7, rotY: 0, shape: 5, color: "#3DBE7B" },
  { wall: "right", x: 3.7, z: -1.6, rotY: -90, shape: 6, color: "#4C8DF6" },
  { wall: "right", x: 3.7, z: 1.6, rotY: -90, shape: 4, color: "#A86BF0" },
];
const PLINTH_TOP = 0.9;

const $ = (s) => document.querySelector(s);
const scene = $("a-scene");
let DATA = null;
const state = {
  phase: "loading", carry: 0, placed: Array(LOCI.length).fill(null), // placed[locus] = item index
  history: [], walkStop: 0, testStop: 0, marks: [], log: null,
};

// ---------------------------------------------------------------- language and settings (D17, D19)
// Saved per browser. Language: ?lang= in the link, then the saved choice, then the device language.
const settings = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("palace.settings")) || {}; } catch (e) { /* private mode */ }
  const codes = I18N.LANGS.map((l) => l.code);
  const device = (navigator.languages || [navigator.language]).map((l) => String(l).slice(0, 2).toLowerCase());
  const lang = [new URLSearchParams(location.search).get("lang"), saved.lang, ...device].find((c) => codes.includes(c)) || "en";
  return { lang, gentle: !!saved.gentle };
})();

function saveSettings() {
  try { localStorage.setItem("palace.settings", JSON.stringify(settings)); } catch (e) { /* private mode */ }
}

const lang = () => I18N.LANGS.find((l) => l.code === settings.lang);

function t(key, vars = {}) {
  const s = (I18N.UI[settings.lang] || {})[key] ?? I18N.UI.en[key];
  return typeof s === "string" ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : s;
}

// Room content in the chosen language, falling back to the English in items.json.
const tr = () => (DATA.translations || {})[settings.lang] || {};
const domain = () => tr().domain || DATA.domain;
const caption = () => tr().caption || DATA.centre.caption;
const label = (it) => (tr().items?.[it.id] || [])[0] || it.label;
const fact = (it) => (tr().items?.[it.id] || [])[1] || it.fact;
const outliers = () => tr().outliers || DATA.ceiling.outliers;

// ---------------------------------------------------------------- entities
function el(tag, attrs = {}, parent = null) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

// Words for line wrapping. Intl.Segmenter also splits scripts without spaces (Chinese, Japanese).
const segmenters = {};
function words(para) {
  if (!(window.Intl && Intl.Segmenter)) return para.split(/(\s+)/);
  const s = segmenters[settings.lang] || (segmenters[settings.lang] = new Intl.Segmenter(settings.lang, { granularity: "word" }));
  return Array.from(s.segment(para), (x) => x.segment);
}

function wrapLines(ctx, value, maxW) {
  const lines = [];
  const fits = (str) => ctx.measureText(str.trim()).width <= maxW;
  for (const para of String(value).split("\n")) {
    let segs = [];
    for (const w of words(para)) {
      if (segs.join("").trim() && !fits(segs.join("") + w)) {
        // Never start a line with "。", "：", ")" and the like: carry the word before it down too.
        const closing = /^[\p{Pe}\p{Pf}\p{Po}]/u.test(w) && !/^[¿¡]/.test(w);
        const carry = closing && segs.length > 1 ? [segs.pop()] : [];
        while (segs.length > 1 && /^[\p{Ps}\p{Pi}¿¡]$/u.test(segs[segs.length - 1])) carry.unshift(segs.pop()); // nor end one with an opening bracket
        lines.push(segs.join("").trim());
        segs = carry.length ? [...carry, w] : [w.trimStart()];
      } else segs.push(w);
      let line = segs.join("");
      if (fits(line)) continue;
      while (line.length > 1 && !fits(line)) { // one word wider than the line: break it
        let k = line.length - 1;
        while (k > 1 && !fits(line.slice(0, k))) k--;
        lines.push(line.slice(0, k));
        line = line.slice(k);
      }
      segs = [line];
    }
    lines.push(segs.join("").trim());
  }
  return lines;
}

// Text drawn to a canvas texture: crisp at any size, works offline, any character set.
// opts.maxH (metres) shrinks the font until the text fits, so longer languages never overflow.
function text(parent, value, opts = {}) {
  const THREE = AFRAME.THREE;
  const w = opts.width || 1, wrap = opts.wrap || 34;
  const ppm = Math.min(1024, 2048 / w); // canvas pixels per metre
  const maxW = w * ppm;
  let fontPx = Math.round(maxW / (wrap * 0.5));
  const fontOf = (px) => `600 ${px}px system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`;
  const c = document.createElement("canvas");
  let ctx = c.getContext("2d");
  let lines;
  for (let k = 0; ; k++) {
    ctx.font = fontOf(fontPx);
    lines = wrapLines(ctx, value, maxW);
    if (!opts.maxH || k >= 8 || lines.length * fontPx * 1.3 <= opts.maxH * ppm) break;
    fontPx = Math.floor(fontPx * 0.9);
  }
  const lineH = Math.round(fontPx * 1.3);
  c.width = Math.ceil(maxW);
  c.height = Math.max(1, lines.length * lineH);
  ctx = c.getContext("2d");
  ctx.font = fontOf(fontPx);
  ctx.direction = lang().dir || "ltr";
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
  e.h = c.height / ppm;
  e.setObject3D("mesh", new THREE.Mesh(new THREE.PlaneGeometry(w, e.h),
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
  roomText.centre = el("a-entity", {}, room);

  // Loci: plinth against the wall, numbered shape marker above it.
  LOCI.forEach((L, i) => {
    const g = el("a-entity", { position: `${L.x} 0 ${L.z}`, rotation: `0 ${L.rotY} 0` }, room);
    const plinth = el("a-box", { width: 0.8, height: PLINTH_TOP, depth: 0.5, position: `0 ${PLINTH_TOP / 2} 0`, color: "#6D6457", class: "clickable" }, g);
    plinth.dataset.locus = i;
    Object.assign(L, { g, plinth, theme: null, guide: null });
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
  roomText.board = el("a-entity", {}, board);
  buildRoomText();
}

// Everything in the room that changes with the language. Sources stay as cited.
const roomText = { centre: null, board: null };
function buildRoomText() {
  for (const g of Object.values(roomText)) while (g.firstChild) g.removeChild(g.firstChild);
  text(roomText.centre, domain(), { pos: "0 2.35 0", width: 3, wrap: 24, maxH: 0.25 });
  text(roomText.centre, caption(), { pos: "0 2.1 0", width: 2.4, wrap: 32, color: "#FFFFFF", maxH: 0.36 });
  const b = roomText.board;
  text(b, t("ceilingOutliers"), { pos: "0 0.62 0.01", width: 3, wrap: 36, color: "#4352C9", maxH: 0.14 });
  text(b, outliers().join("\n"), { pos: "0 0.28 0.01", width: 3.1, wrap: 46, color: "#1B2130", maxH: 0.46 });
  text(b, t("ceilingSources"), { pos: "0 -0.2 0.01", width: 3, wrap: 36, color: "#0D7F7D", maxH: 0.14 });
  text(b, DATA.ceiling.sources.join("\n"), { pos: "0 -0.5 0.01", width: 3.1, wrap: 50, color: "#1B2130" });
}

// ---------------------------------------------------------------- stand looks (D18)
// Once a fact is placed, its stand takes a look drawn from that fact, so stands differ by
// more than their number. The plain box stays as an invisible click target.
const STANDS = {
  blocks(g, c, a) { // four chambers: two light blocks (atria) on two dark ones (ventricles)
    for (const [x, y, col] of [[-0.2, 0.225, c], [0.2, 0.225, c], [-0.2, 0.675, a], [0.2, 0.675, a]])
      el("a-box", { width: 0.38, height: 0.43, depth: 0.48, position: `${x} ${y} 0`, color: col }, g);
  },
  lobes(g, c, a) { // a pair of lungs
    for (const x of [-0.19, 0.19]) el("a-cylinder", { radius: 0.18, height: 0.86, position: `${x} 0.43 0`, color: c, "segments-radial": 24 }, g);
    el("a-box", { width: 0.8, height: 0.04, depth: 0.46, position: "0 0.88 0", color: a }, g);
  },
  heavy(g, c, a) { // the thickest wall: a squat, heavy block
    el("a-box", { width: 0.92, height: 0.2, depth: 0.56, position: "0 0.1 0", color: a }, g);
    el("a-box", { width: 0.8, height: 0.56, depth: 0.5, position: "0 0.48 0", color: c }, g);
    el("a-box", { width: 0.92, height: 0.14, depth: 0.56, position: "0 0.83 0", color: a }, g);
  },
  tapered(g, c, a) { // leads away: a column with arrows pointing out from its middle
    el("a-cone", { "radius-bottom": 0.3, "radius-top": 0.2, height: 0.86, position: "0 0.43 0", color: c, "segments-radial": 24 }, g);
    el("a-cylinder", { radius: 0.26, height: 0.04, position: "0 0.88 0", color: a }, g);
    el("a-box", { width: 0.3, height: 0.05, depth: 0.03, position: "0 0.5 0.26", color: a }, g);
    for (const side of [-1, 1]) el("a-cone", { "radius-bottom": 0.07, "radius-top": 0, height: 0.12, position: `${side * 0.2} 0.5 0.26`, rotation: `0 0 ${-90 * side}`, color: a }, g);
  },
  barred(g, c, a) { // valves: a gate of bars across the front
    el("a-box", { width: 0.8, height: 0.9, depth: 0.42, position: "0 0.45 -0.04", color: c }, g);
    for (const x of [-0.27, -0.09, 0.09, 0.27]) el("a-cylinder", { radius: 0.025, height: 0.8, position: `${x} 0.45 0.2`, color: a }, g);
    el("a-box", { width: 0.76, height: 0.05, depth: 0.05, position: "0 0.45 0.2", color: a }, g);
  },
  lattice(g, c, a) { // one cell thick: an open net of thin rods
    for (const x of [-0.36, 0.36]) for (const z of [-0.2, 0.2])
      el("a-cylinder", { radius: 0.025, height: 0.86, position: `${x} 0.43 ${z}`, color: c }, g);
    for (const y of [0.15, 0.4, 0.65]) {
      for (const z of [-0.2, 0.2]) el("a-box", { width: 0.74, height: 0.025, depth: 0.025, position: `0 ${y} ${z}`, color: c }, g);
      for (const x of [-0.36, 0.36]) el("a-box", { width: 0.025, height: 0.025, depth: 0.42, position: `${x} ${y} 0`, color: c }, g);
    }
    el("a-box", { width: 0.8, height: 0.04, depth: 0.46, position: "0 0.88 0", color: a }, g);
  },
};

function setStand(i) {
  const L = LOCI[i];
  if (L.theme) { L.theme.remove(); L.theme = null; }
  const n = state.placed[i];
  const spec = n === null ? null : DATA.items[n].stand;
  const build = spec && STANDS[spec.shape];
  L.plinth.setAttribute("material", "visible", !build);
  if (build) { L.theme = el("a-entity", {}, L.g); build(L.theme, spec.color, spec.accent || spec.color); }
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
  if (tts) { pendingFocus = e; return; } // gentle mode: the scene speaks after the panel is read
  focus = e;
  e.t0 = performance.now();
  e.prev = -1;
}

function quiet() {
  focus = null;
  pendingFocus = null;
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

// Gentle mode reads each panel aloud with the device's voice for the chosen language.
// Devices without a voice for that language skip it rather than read it in the wrong accent.
let tts = null, pendingFocus = null;
function readAloud(parts) {
  const synth = window.speechSynthesis;
  if (!settings.gentle || !synth) return;
  const resume = focus || pendingFocus;
  quiet();
  pendingFocus = resume;
  synth.cancel();
  tts = null;
  const L = lang(), voices = synth.getVoices();
  const voice = voices.find((v) => v.lang.replace("_", "-") === L.tts) || voices.find((v) => v.lang.toLowerCase().startsWith(L.code));
  if (voices.length && !voice) return releaseVoice();
  const u = new SpeechSynthesisUtterance(parts.filter(Boolean).join("\n"));
  u.lang = L.tts;
  if (voice) u.voice = voice;
  u.rate = 0.9;
  tts = u;
  const done = () => { if (tts !== u) return; tts = null; releaseVoice(); };
  u.onend = u.onerror = done;
  setTimeout(done, 1500 + u.text.length * 90); // some browsers never fire onend
  synth.speak(u);
}

function releaseVoice() {
  const e = pendingFocus;
  pendingFocus = null;
  if (e) speak(e);
}

function showObject(locus, on, voiced = false) {
  const L = LOCI[locus];
  while (L.slot.firstChild) L.slot.removeChild(L.slot.firstChild);
  L.scene = on && state.placed[locus] !== null ? mount(DATA.items[state.placed[locus]].object, L.slot, voiced) : null;
}

// ---------------------------------------------------------------- panel (D7)
// A small lectern panel beside the user, re-placed after every hop.
// On a portrait screen (phones) the lectern would sit outside the narrow view, so the
// panel docks to the bottom of the screen instead and follows the camera.
const PANEL = { w: 1.05, h: 0.66 }; // h follows the content (see panel())
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
  const y = panelPlace.y + (PANEL.h - 0.66) / 2; // taller panels grow upwards, so the buttons stay in reach
  const side = panelPlace.side ?? 0.7;
  p.position.set(rig.position.x + fx * 1.1 + rx * side, y, rig.position.z + fz * 1.1 + rz * side);
  p.rotation.set(panelPlace.tilt * DEG, yaw - 30 * DEG, 0, "YXZ");
}

// Screen-docked panel: far enough to fit the screen width, its bottom edge just above the screen's.
AFRAME.registerComponent("panel-hud", {
  init() { this.pos = new AFRAME.THREE.Vector3(); this.quat = new AFRAME.THREE.Quaternion(); },
  tick() {
    if (!hud()) return;
    const cam = $("#cam"), p = $("#panel").object3D;
    const halfV = (cam.getAttribute("camera").fov * DEG) / 2;
    // Taller panels (long text, the language list) sit further back so they still fit.
    const tanV = Math.tan(halfV), tanH = tanV * (innerWidth / innerHeight);
    const d = Math.max(PANEL.w / 2 / (tanH * 0.94), PANEL.h / (tanV * 1.25), 1.1);
    const y = -(tanV * d - PANEL.h / 2 - 0.04 * d);
    cam.object3D.updateMatrixWorld(true);
    cam.object3D.getWorldPosition(this.pos);
    cam.object3D.getWorldQuaternion(this.quat);
    p.position.set(0, y, -d).applyQuaternion(this.quat).add(this.pos);
    p.quaternion.copy(this.quat);
  },
});

// The panel grows to fit its text, so every language fits without tiny type.
// buttons: [label, onClick, colour]; cols > 0 lays them out as a grid (the language list).
// previewQuiet shows the preview without its voice lines (the gentle-mode hint).
function panel({ step = "", title, body = "", buttons = [], cols = 0, preview = null, previewQuiet = false, place = { y: 1.12, tilt: -22 } }) {
  const p = $("#panel");
  while (p.firstChild) p.removeChild(p.firstChild);
  panelPlace = place;
  const pad = 0.04, W = PANEL.w;
  const bg = el("a-plane", { width: W, height: 0.1, color: "#1B2130", material: "transparent: true; opacity: 0.9; shader: flat" }, p); // first, so it draws under the text
  const stepEl = step ? text(p, step, { width: 0.95, wrap: 56, color: "#8C96B8", maxH: 0.05 }) : null;
  const titleEl = text(p, title, { width: 0.95, wrap: 30, color: "#AEB8FF", maxH: 0.13 });
  const bodyEl = body ? text(p, body, { width: preview ? 0.72 : 0.95, wrap: 34, maxH: 0.5 }) : null;
  const bodyH = Math.max(bodyEl ? bodyEl.h : 0, preview ? 0.3 : 0);
  cols = cols || buttons.length || 1;
  const rows = Math.ceil(buttons.length / cols), bh = rows > 1 ? 0.08 : 0.1, rowGap = 0.025;
  const buttonsH = rows ? rows * bh + (rows - 1) * rowGap : 0;
  const H = pad * 2 + (stepEl ? stepEl.h + 0.012 : 0) + titleEl.h + (bodyH ? 0.025 + bodyH : 0) + (rows ? 0.035 + buttonsH : 0);
  PANEL.h = H;
  placePanel();
  let y = H / 2 - pad;
  const put = (e, x, h) => { e.setAttribute("position", `${x} ${y - h / 2} 0.003`); y -= h; };
  if (stepEl) { put(stepEl, 0, stepEl.h); y -= 0.012; }
  put(titleEl, 0, titleEl.h);
  if (bodyH) {
    y -= 0.025;
    const mid = y - bodyH / 2;
    if (bodyEl) bodyEl.setAttribute("position", `${preview ? 0.12 : 0} ${mid} 0.003`);
    if (preview) {
      const f = previewFit(preview);
      mount(preview, el("a-entity", { position: `${-0.37 - f.cx * f.s} ${mid - f.cy * f.s} ${0.03 - f.cz * f.s}`, scale: `${f.s} ${f.s} ${f.s}` }, p), !previewQuiet);
    }
    y -= bodyH;
  }
  y -= 0.035;
  const gap = 0.03, w = Math.min(0.3, (W - 0.08 - gap * (cols - 1)) / cols);
  buttons.forEach(([lab, fn, color = "#4352C9"], i) => {
    const r = Math.floor(i / cols), k = i % cols, inRow = Math.min(cols, buttons.length - r * cols);
    const x = (k - (inRow - 1) / 2) * (w + gap), by = y - bh / 2 - r * (bh + rowGap);
    const b = el("a-plane", { width: w, height: bh, color, position: `${x} ${by} 0.004`, class: "clickable", material: "shader: flat" }, p);
    text(b, lab, { width: w * 0.94, wrap: 14, maxH: bh * 0.85 });
    b.addEventListener("click", fn);
    b.addEventListener("mouseenter", () => b.setAttribute("material", "color", "#8C96F0"));
    b.addEventListener("mouseleave", () => b.setAttribute("material", "color", color));
  });
  bg.setAttribute("height", H);
  readAloud([title, body]);
}

// Scale and centre for a scene shown in the panel: fits a 0.23 m square beside the text.
// Measured once per scene from a detached copy.
const fits = {};
function previewFit(key) {
  if (fits[key]) return fits[key];
  const g = new AFRAME.THREE.Group();
  SCENES[key](g).update(0.25);
  g.updateMatrixWorld(true);
  const box = new AFRAME.THREE.Box3().setFromObject(g), size = box.getSize(new AFRAME.THREE.Vector3()), c = box.getCenter(new AFRAME.THREE.Vector3());
  const s = Math.min(0.5, 0.23 / Math.max(size.x, size.y, 0.01));
  return (fits[key] = { s, cx: c.x, cy: c.y, cz: c.z });
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
function where(i) { return t("stop", { n: i + 1, wall: t(`wall_${LOCI[i].wall}`), shape: t("shapes")[i] }); }
const total = () => DATA.items.length;
const MENU = { y: 1.12, tilt: -22, side: 0.45 }; // wide menus sit nearer the middle so they fit a laptop screen

function intro() {
  state.phase = "intro";
  state.log = { build: "iteration-1.2", list: DATA.list, started: new Date().toISOString(), xr: false,
    lang: settings.lang, gentle: settings.gentle, placements: [], marks: [], times: {} };
  panel({ title: t("appTitle"), body: t("introBody", { domain: domain() }), place: MENU, buttons: [
    [t("start"), encodeStart],
    [t("language"), languagePanel, "#5A6378"],
    [t(settings.gentle ? "gentleOn" : "gentleOff"), toggleGentle, settings.gentle ? "#0D7F7D" : "#5A6378"],
  ] });
  speak(centreScene);
}

// D17: pick a language. The room and every panel redraw in it straight away.
function languagePanel() {
  if (state.phase !== "intro") return;
  panel({ title: t("chooseLanguage"), cols: 4, place: MENU, buttons: [
    ...I18N.LANGS.map((l) => [l.name, () => setLang(l.code), l.code === settings.lang ? "#0D7F7D" : "#4352C9"]),
    [t("back"), intro, "#5A6378"],
  ] });
}

function setLang(code) {
  settings.lang = code;
  saveSettings();
  document.documentElement.lang = code;
  buildRoomText();
  intro();
}

// D19: gentle mode for older users and people with memory difficulties.
function toggleGentle() {
  if (state.phase !== "intro") return;
  settings.gentle = !settings.gentle;
  saveSettings();
  if (!settings.gentle) { if (window.speechSynthesis) speechSynthesis.cancel(); tts = null; return intro(); }
  panel({ title: t("gentleTitle"), body: t("gentleBody"), place: MENU, buttons: [[t("ok"), intro]] });
}

// D16: Start teaches by doing. Turn to stand 1, light it up, and have the user place the first fact there.
async function encodeStart() {
  if (state.phase !== "intro") return;
  state.phase = "guide";
  state.t0 = performance.now();
  state.log.xr = scene.renderer.xr.isPresenting;
  Object.assign(state.log, { lang: settings.lang, gentle: settings.gentle });
  LOCI.forEach((L, i) => L.ring.setAttribute("visible", i === 0));
  showGuide(0);
  await teleport(START.pos, locusLook(0));
  if (state.phase !== "guide") return; // already placed during the fade
  const it = DATA.items[0];
  panel({ step: t("step1"), title: t("guideTitle", { label: label(it) }), body: t("guideBody", { fact: fact(it) }), preview: it.object });
}

// A bouncing arrow and "Tap here" over the stand, and the stand itself pulses.
function showGuide(i) {
  const L = LOCI[i];
  L.guide = el("a-entity", {}, L.g);
  const arrow = el("a-entity", { animation: "property: position; from: 0 1.12 0.05; to: 0 1.3 0.05; dir: alternate; loop: true; dur: 600; easing: easeInOutSine" }, L.guide);
  el("a-cone", { "radius-bottom": 0.13, "radius-top": 0, height: 0.28, rotation: "180 0 0", color: "#E8D44D", material: "shader: flat" }, arrow);
  const tag = text(L.guide, t("tapHere"), { pos: "0 2.45 -0.24", width: 1.1, wrap: 9, maxH: 0.3 });
  el("a-plane", { width: 1.2, height: tag.h + 0.08, position: "0 2.45 -0.245", color: "#1B2130", material: "shader: flat" }, L.guide);
  L.plinth.setAttribute("animation__glow", "property: material.color; type: color; from: #6D6457; to: #E8C24D; dir: alternate; loop: true; dur: 600");
}

function hideGuide(i) {
  const L = LOCI[i];
  if (L.guide) { L.guide.remove(); L.guide = null; }
  L.plinth.removeAttribute("animation__glow");
  L.plinth.setAttribute("material", "color", "#6D6457");
}

function guideDone() {
  hideGuide(0);
  LOCI[0].ring.setAttribute("visible", false);
  state.phase = "guided";
  panel({ step: t("step1"), title: t("guideDoneTitle"),
    body: t("guideDoneBody", { label: label(DATA.items[0]), n: total() - 1 }),
    buttons: [[t("ok"), async () => {
      if (state.phase !== "guided") return;
      state.phase = "encode";
      await teleport(START.pos, START.look);
      nextCarry();
    }]] });
}

function nextCarry() {
  const n = state.history.length;
  if (n === total()) return encodeDone();
  const it = DATA.items[n];
  LOCI.forEach((L, i) => L.ring.setAttribute("visible", state.placed[i] === null));
  const undo = n ? [[t("undo"), undoPlace, "#5A6378"]] : [];
  panel({ step: t("step1"), title: t("placeTitle", { n: n + 1, total: total(), label: label(it) }), body: t("placeBody", { fact: fact(it) }), buttons: undo, preview: it.object });
}

function place(i) {
  const item = state.history.length;
  state.placed[i] = item;
  state.history.push(i);
  state.log.placements.push({ item: DATA.items[item].id, locus: i + 1, ms: Math.round(performance.now() - state.t0) });
  showObject(i, true);
  setStand(i);
}

function onLocusClick(i) {
  if (state.phase === "guide" && i === 0) { place(0); return guideDone(); }
  if (state.phase !== "encode" || state.placed[i] !== null) return;
  place(i);
  nextCarry();
}

function undoPlace() {
  if (state.phase !== "encode" || !state.history.length) return;
  const i = state.history.pop();
  state.placed[i] = null;
  state.log.placements.pop();
  showObject(i, false);
  setStand(i);
  nextCarry();
}

function encodeDone() {
  LOCI.forEach((L) => L.ring.setAttribute("visible", false));
  state.log.times.encodeMs = Math.round(performance.now() - state.t0);
  panel({ step: t("step1"), title: t("allPlacedTitle"), body: t("allPlacedBody"), buttons: [[t("walk"), walkStart]] });
}

async function walkStart() {
  state.phase = "walk";
  state.t0 = performance.now();
  state.walkStop = -1;
  await teleport([0, 1.9], [0, 1.4, 0]);
  speak(centreScene);
  panel({ step: t("step2"), title: t("centreTitle"), body: `${domain()}. ${caption()}`, buttons: [[t("next"), walkNext]] });
}

async function walkNext() {
  state.walkStop += 1;
  const i = state.walkStop;
  if (i < LOCI.length) {
    await teleport(LOCI[i].pad, locusLook(i));
    speak(LOCI[i].scene);
    const it = itemFor(i);
    panel({ step: t("step2"), title: `${where(i)}: ${label(it)}`, body: fact(it), buttons: [[t("next"), walkNext]] });
  } else if (i === LOCI.length) {
    quiet();
    const stop = hud() ? CEILING_STOP_NARROW : CEILING_STOP;
    await teleport(stop.pos, stop.look);
    panel({ step: t("step2"), title: t("lookUpTitle"), body: t("lookUpBody"), buttons: [[t("next"), walkNext]], place: { y: 1.95, tilt: 20 } });
  } else {
    state.log.times.walkMs = Math.round(performance.now() - state.t0);
    LOCI.forEach((_, k) => showObject(k, false));
    await teleport(START.pos, START.look);
    panel({ step: t("step3"), title: t("testTitle"), body: t("testBody"), buttons: [[t("beginTest"), testStart]] });
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
  state.hinted = false;
  const buttons = [[t("reveal"), () => testReveal(i)]];
  if (settings.gentle) buttons.unshift([t("hint"), () => testHint(i), "#5A6378"]);
  panel({ step: t("step3"), title: where(i), body: t("askBody"), buttons });
}

// Gentle mode: show the object on its stand, silent and unlabelled, before the answer (cued recall).
function testHint(i) {
  if (state.phase !== "test" || state.testStop !== i) return;
  state.hinted = true;
  showObject(i, true);
  panel({ step: t("step3"), title: where(i), body: t("hintBody"), preview: itemFor(i).object, previewQuiet: true, buttons: [[t("reveal"), () => testReveal(i)]] });
}

function testReveal(i) {
  const it = itemFor(i);
  const revealMs = Math.round(performance.now() - state.askedAt);
  const mark = (result) => {
    state.marks.push({ locus: i + 1, item: it.id, result, revealMs, hint: state.hinted });
    showObject(i, false);
    if (result === "got") { state.testStop += 1; testAsk(); } else missed(i);
  };
  panel({ step: t("step3"), title: label(it), body: fact(it), preview: it.object,
    buttons: [[t("gotIt"), () => mark("got"), "#0D7F7D"], [t("missedIt"), () => mark("missed"), "#B3263A"]] });
}

// D14: wrong sound, then snap to the stand and object that was missed. Gentle mode uses a soft chime.
async function missed(i) {
  const s = $(settings.gentle ? "#gentle-sound" : "#wrong-sound");
  s.currentTime = 0;
  s.play().catch(() => {});
  LOCI[i].ring.setAttribute("visible", false);
  await teleport(LOCI[i].pad, locusLook(i));
  showObject(i, true, true);
  const it = itemFor(i);
  panel({ step: t("step3"), title: t(settings.gentle ? "gentleMissedTitle" : "missedTitle", { label: label(it) }), body: fact(it), buttons: [[t("backToTest"), async () => {
    showObject(i, false);
    await teleport(START.pos, START.look);
    state.testStop += 1;
    testAsk();
  }]] });
}

function score() {
  state.phase = "score";
  quiet();
  LOCI.forEach((L, k) => { L.ring.setAttribute("visible", false); showObject(k, true); });
  const got = state.marks.filter((m) => m.result === "got").length;
  const ms = Math.round(performance.now() - state.t0);
  Object.assign(state.log, { score: got, of: LOCI.length, marks: state.marks, finished: new Date().toISOString() });
  state.log.times.testMs = ms;
  const missedLabels = state.marks.filter((m) => m.result === "missed").map((m) => label(DATA.items.find((x) => x.id === m.item)));
  const secs = Math.round(ms / 1000), time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const list = missedLabels.join(t("listSep"));
  panel({ title: t(settings.gentle ? "gentleScoreTitle" : "scoreTitle", { got, total: LOCI.length }),
    body: `${t("testTime", { time })}\n` + (list ? t(settings.gentle ? "practiseList" : "missedList", { list }) : t("nothingMissed")),
    buttons: [[t("saveLog"), saveLog, "#0D7F7D"], [t("again"), () => location.reload(), "#5A6378"]] });
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
    if (window.speechSynthesis && settings.gentle && !tts) speechSynthesis.speak(new SpeechSynthesisUtterance(" ")); // iOS: unlock speech in a tap
    for (const a of [...Object.values(clips), $("#wrong-sound"), $("#gentle-sound")]) {
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
  document.documentElement.lang = settings.lang;
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
  window.palace = { state, LOCI, settings, setLang }; // for automated checks
}

if (scene.hasLoaded) boot(); else scene.addEventListener("loaded", boot);
