// Animated fact scenes for the cardiovascular memory palace.
// Each builder: (parent) => { cycle, cues, update(phase) }.
// - parent: an a-entity (its object3D is used) or a THREE.Object3D.
// - update(phase) is a pure function of phase in [0,1): no time state, so seeking works.
// - No A-Frame animation attributes, no textures, no per-frame allocation.
// Static geometry is cached module-wide and never disposed, so rebuilding a scene
// (stand + panel preview) costs no new GPU buffers. Materials are per build.
// Anatomy: OpenStax Anatomy & Physiology 2e, ch. 19.1 (heart) and 20.1 (vessels).
// Orientation: every scene faces +z (the viewer). The patient's right side is the
// viewer's left (-x), as in a textbook frontal view: right heart = blue, left heart = red.
(function () {
  "use strict";
  if (!window.AFRAME) return;
  const THREE = AFRAME.THREE;
  const V3 = THREE.Vector3;

  // ---------------------------------------------------------------- palette
  const C = {
    blue: 0x4c8df6, red: 0xe5484d,              // oxygen-poor / oxygen-rich blood
    rHeart: 0x8a5379, lHeart: 0xb8424c,          // right (bluish) / left (red) heart muscle
    rAtrium: 0x7f5f95, lAtrium: 0xc65a62,
    artery: 0xc9545c, vein: 0x4f74c4,
    lung: 0xeaa1a8, cartilage: 0xf1e4cf, tissue: 0xe2aa8c,
    o2: 0xffe36b, nutrient: 0x57d38c, ink: 0x15171c, white: 0xf6f3ee,
  };

  // ---------------------------------------------------------------- maths (pure)
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
  const ramp = (p, a, b) => smooth((p - a) / (b - a));
  const easeOut = (p, a, b) => { const x = clamp01((p - a) / (b - a)); return 1 - (1 - x) * (1 - x) * (1 - x); };
  const bump = (p, a, m, b) => (p <= a || p >= b ? 0 : p < m ? smooth((p - a) / (m - a)) : 1 - smooth((p - m) / (b - m)));
  const frac = (x) => x - Math.floor(x);
  const lerp = (a, b, t) => a + (b - a) * t;
  const edgeFade = (u, w) => Math.min(1, u / w, (1 - u) / w);
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- building helpers
  const GEO = new Map();
  const cached = (key, make) => { let g = GEO.get(key); if (!g) { g = make(); GEO.set(key, g); } return g; };

  function attach(parent) {
    const root = (parent && parent.object3D) || parent;
    const g = new THREE.Group();
    g.name = "fact-scene";
    root.add(g);
    return g;
  }
  function mat(color, o) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.55, metalness: 0 }, o || {}));
  }
  function glass(color, opacity, o) {
    return mat(color, Object.assign({ transparent: true, opacity, depthWrite: false, roughness: 0.35 }, o || {}));
  }
  function mesh(geo, m, parent, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    me.scale.set(sx, sy, sz);
    parent.add(me);
    return me;
  }
  const curveOf = (pts) => new THREE.CatmullRomCurve3(pts.map((a) => new V3(a[0], a[1], a[2])), false, "centripetal");

  // Smooth-shaded 20-triangle blob: cheap particle that still reads as round.
  const blobGeo = () => cached("blob", () => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) n.setXYZ(i, p.getX(i), p.getY(i), p.getZ(i));
    return g;
  });
  const sphereGeo = (w, h) => cached(`sph${w}x${h}`, () => new THREE.SphereGeometry(1, w, h));
  const cylGeo = (rad, open) => cached(`cyl${rad}${open}`, () => new THREE.CylinderGeometry(1, 1, 1, rad, 1, !!open));

  function tubeGeo(key, pts, r, seg, rad, grad) {
    return cached(key, () => {
      const g = new THREE.TubeGeometry(curveOf(pts), seg, r, rad, false);
      if (grad) {
        const a = new THREE.Color(grad[0]), b = new THREE.Color(grad[1]), c = new THREE.Color();
        const col = new Float32Array(g.attributes.position.count * 3);
        for (let i = 0; i <= seg; i++) {
          c.lerpColors(a, b, smooth(i / seg));
          for (let j = 0; j <= rad; j++) c.toArray(col, (i * (rad + 1) + j) * 3);
        }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      }
      return g;
    });
  }
  function vessel(key, pts, r, seg, m, parent, rad = 6) {
    return mesh(tubeGeo(key, pts, r, seg, rad), m, parent);
  }
  const vesselMat = (color) => glass(color, 0.62, { roughness: 0.35, emissive: color, emissiveIntensity: 0.12 });

  function particles(n, color, parent, emissive = 0.35) {
    const m = mat(color, { emissive: color, emissiveIntensity: emissive, roughness: 0.3 });
    const im = new THREE.InstancedMesh(blobGeo(), m, n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    parent.add(im);
    return im;
  }
  // Instanced particles whose colour changes per particle (blue -> red in the lungs).
  function tintParticles(n, parent) {
    const im = particles(n, 0xffffff, parent, 0);
    im.material.emissiveIntensity = 0;
    const c = new THREE.Color(C.blue);
    for (let i = 0; i < n; i++) im.setColorAt(i, c);
    return im;
  }
  // One reusable writer per scene (no per-frame allocation).
  function writer(im) {
    const d = new THREE.Object3D();
    return {
      d,
      put(i, x, y, z, s, sy = s, sz = s) { d.position.set(x, y, z); d.scale.set(s, sy, sz); d.updateMatrix(); im.setMatrixAt(i, d.matrix); },
      putV(i, v, s) { d.position.copy(v); d.scale.set(s, s, s); d.updateMatrix(); im.setMatrixAt(i, d.matrix); },
      commit() { d.quaternion.identity(); im.instanceMatrix.needsUpdate = true; },
    };
  }

  // ---------------------------------------------------------------- shared heart
  // Unit heart ~1.05 tall (apex y -0.55 to atria top ~0.52), facing +z.
  // Two lathe ventricles (apex tilted to the patient's left), two atria, auricles.
  const VENT = [[0.001, -0.5], [0.13, -0.43], [0.26, -0.28], [0.35, -0.1], [0.38, 0.06], [0.34, 0.19], [0.23, 0.28], [0.001, 0.31]];
  function heart(parent, opts = {}) {
    const g = new THREE.Group();
    parent.add(g);
    const ventGeo = cached("vent", () => new THREE.LatheGeometry(VENT.map(([x, y]) => new THREE.Vector2(x, y)), 14));
    const vents = new THREE.Group();
    vents.rotation.z = 0.38;
    g.add(vents);
    const em = (c) => ({ emissive: c, emissiveIntensity: 0.1 });
    const rv = mesh(ventGeo, mat(C.rHeart, em(C.rHeart)), vents, -0.13, 0.0, 0.1, 0.82, 0.92, 0.72);
    const lv = mesh(ventGeo, mat(C.lHeart, em(C.lHeart)), vents, 0.09, -0.04, -0.03, 0.92, 1.0, 0.86);
    const sg = sphereGeo(12, 8);
    const ra = mesh(sg, mat(C.rAtrium, em(C.rAtrium)), g, -0.25, 0.36, 0.02, 0.2, 0.17, 0.17);
    const la = mesh(sg, mat(C.lAtrium, em(C.lAtrium)), g, 0.17, 0.38, -0.09, 0.17, 0.15, 0.16);
    // Auricles: small flaps hugging the front of each atrium (recognisable silhouette).
    const rau = mesh(sg, ra.material, ra, 0.45, -0.1, 0.75, 0.5, 0.35, 0.3);
    const lau = mesh(sg, la.material, la, -0.55, -0.2, 0.75, 0.45, 0.32, 0.3);
    rau.rotation.z = 0.5; lau.rotation.z = -0.5;
    // Interventricular groove (coronary artery) down the front: a designed detail.
    if (opts.groove !== false) {
      vessel("groove", [[-0.06, 0.3, 0.33], [-0.02, 0.05, 0.4], [0.06, -0.25, 0.33], [0.16, -0.45, 0.18]], 0.018, 10,
        mat(0xd9a441, { roughness: 0.6 }), g, 4);
    }
    const base = [rv, lv, ra, la].map((m) => m.scale.clone());
    return {
      g, rv, lv, ra, la,
      // v: ventricular squeeze 0..1, a: atrial fill -1..1 (negative = atrial kick)
      pose(v, a) {
        const vs = 1 - 0.13 * v, vy = 1 - 0.05 * v, as = 1 + 0.16 * a;
        rv.scale.set(base[0].x * vs, base[0].y * vy, base[0].z * vs);
        lv.scale.set(base[1].x * vs, base[1].y * vy, base[1].z * vs);
        ra.scale.copy(base[2]).multiplyScalar(as);
        la.scale.copy(base[3]).multiplyScalar(as);
      },
    };
  }
  // Heart-local point -> parent space (heart group at pos, uniform scale s).
  const hp = (pos, s) => (x, y, z) => [pos[0] + x * s, pos[1] + y * s, pos[2] + z * s];

  // Lung: deformed sphere, tapered apex, flat base, flattened medial face. side +1 = viewer right.
  function lungGeo(side) {
    return cached(`lung${side}`, () => {
      const g = new THREE.SphereGeometry(1, 14, 11);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const taper = 1 - 0.35 * Math.max(0, y);
        x *= taper; z *= taper;
        if (y < -0.5) y = -0.5 + (y + 0.5) * 0.35;
        if (x * side < 0) x *= 0.5;
        if (side > 0 && x < 0 && y < 0.05 && z > 0) x *= 0.45; // cardiac notch, left lung
        p.setXYZ(i, x, y, z);
      }
      g.computeVertexNormals();
      return g;
    });
  }

  // Bolus position: leader travels 0 -> 1 + spread as f goes 0 -> 1; i-th particle lags.
  const bolusU = (f, i, n, spread) => f * (1 + spread) - (i / Math.max(1, n - 1)) * spread;

  const SCENES = {};

  // ================================================================ 1. pumping heart (centre)
  // Two circuits: blue out to the lungs, red back; red out to the body, blue back.
  // Hook: the heart has eyes - bug-eyed on the squeeze, blissed out while filling.
  SCENES["pumping-heart"] = (parent) => {
    const root = attach(parent);
    const S = 0.42;
    const rig = new THREE.Group();
    rig.scale.setScalar(S);
    rig.position.y = 0.0;
    root.add(rig);
    const H = heart(rig, { groove: false });
    H.g.scale.setScalar(1.25);
    const red = vesselMat(C.artery), blue = vesselMat(C.vein);
    const P = {
      aorta: [[0.12, 0.0, -0.04], [0.05, 0.38, 0.0], [0.0, 0.74, 0.02], [0.13, 0.92, -0.06], [0.38, 0.88, -0.14], [0.6, 0.58, -0.2], [0.66, 0.0, -0.18], [0.52, -0.52, -0.1], [0.2, -0.8, 0.0]],
      pulL: [[-0.15, -0.06, 0.12], [-0.11, 0.36, 0.32], [-0.03, 0.66, 0.28], [0.22, 0.76, 0.18], [0.52, 0.68, 0.08], [0.88, 0.5, 0.0]],
      pulR: [[-0.15, -0.06, 0.12], [-0.11, 0.36, 0.32], [-0.03, 0.66, 0.28], [-0.26, 0.78, 0.18], [-0.55, 0.68, 0.08], [-0.88, 0.5, 0.0]],
      pvL: [[0.9, 0.3, -0.05], [0.6, 0.32, -0.17], [0.36, 0.42, -0.17], [0.21, 0.47, -0.11]],
      pvR: [[-0.9, 0.3, -0.05], [-0.58, 0.28, -0.32], [-0.1, 0.36, -0.34], [0.15, 0.45, -0.15]],
      ivc: [[-0.2, -0.82, 0.0], [-0.52, -0.56, -0.1], [-0.64, 0.0, -0.12], [-0.5, 0.32, -0.04], [-0.31, 0.43, 0.02]],
      svc: [[-0.3, 1.06, -0.02], [-0.31, 0.8, 0.0], [-0.31, 0.5, 0.02]],
    };
    vessel("hc-aorta", P.aorta, 0.075, 22, red, rig);
    vessel("hc-pulL", P.pulL, 0.066, 16, blue, rig);
    vessel("hc-pulR", P.pulR.slice(2), 0.056, 12, blue, rig);
    vessel("hc-pvL", P.pvL, 0.045, 10, red, rig);
    vessel("hc-pvR", P.pvR, 0.045, 12, red, rig);
    vessel("hc-ivc", P.ivc, 0.07, 14, blue, rig);
    vessel("hc-svc", P.svc, 0.066, 6, blue, rig);
    const curves = {};
    for (const k of ["aorta", "pulL", "pulR", "pvL", "pvR", "ivc"]) curves[k] = curveOf(P[k]);

    // Lungs (pulmonary circuit) and a body tissue bed (systemic circuit).
    const lungMat = mat(C.lung, { roughness: 0.75, emissive: 0xff6b7a, emissiveIntensity: 0 });
    const lungs = [-1, 1].map((s) => mesh(lungGeo(s), lungMat, rig, s * 0.98, 0.42, -0.06, 0.3, 0.46, 0.24));
    const bodyMat = mat(C.tissue, { roughness: 0.7, emissive: 0xff7a4a, emissiveIntensity: 0 });
    const bodyG = new THREE.Group();
    bodyG.position.set(0, -0.86, 0);
    rig.add(bodyG);
    [[-0.17, 0, 0, 0.11], [0, 0.02, 0.07, 0.12], [0.17, 0, 0, 0.11], [-0.08, -0.07, -0.07, 0.1], [0.09, -0.06, -0.06, 0.1]]
      .forEach(([x, y, z, r]) => mesh(blobGeo(), bodyMat, bodyG, x, y, z, r));

    // Eyes (the hook).
    const eyeW = mat(C.white, { roughness: 0.3 }), eyeK = mat(C.ink, { roughness: 0.2 });
    const eyes = [[-0.26, 0.04, 0.44], [0.05, 0.01, 0.47]].map(([x, y, z]) => {
      const e = new THREE.Group();
      e.position.set(x, y, z);
      rig.add(e);
      mesh(sphereGeo(10, 8), eyeW, e, 0, 0, 0, 0.09, 0.1, 0.06);
      mesh(blobGeo(), eyeK, e, 0.012, -0.014, 0.054, 0.042, 0.048, 0.024);
      return e;
    });

    const redP = particles(18, C.red, rig), blueP = particles(18, C.blue, rig);
    const wr = writer(redP), wb = writer(blueP);
    const tmp = new V3();
    const R = 0.06;
    function run(w, idx0, curve, n, f, spread) {
      for (let i = 0; i < n; i++) {
        const u = bolusU(f, i, n, spread);
        if (u <= 0 || u >= 1) { w.put(idx0 + i, 0, 0, 0, 0); continue; }
        curve.getPointAt(u, tmp);
        w.putV(idx0 + i, tmp, R * edgeFade(u, 0.06));
      }
    }
    function update(p) {
      const v = bump(p, 0.03, 0.1, 0.36);
      const fill = ramp(p, 0.46, 0.88) * (1 - ramp(p, 0.9, 1.0));
      const kick = bump(p, 0.9, 0.96, 1.0) + bump(p, -0.1, -0.04, 0.03);
      H.pose(v, fill - 0.5 * kick);
      const out = easeOut(p, 0.04, 0.34), inn = ramp(p, 0.46, 0.92);
      run(wr, 0, curves.aorta, 10, out, 0.55);
      run(wb, 0, curves.pulL, 5, out, 0.45);
      run(wb, 5, curves.pulR, 5, out, 0.45);
      run(wr, 10, curves.pvL, 4, inn, 0.5);
      run(wr, 14, curves.pvR, 4, inn, 0.5);
      run(wb, 10, curves.ivc, 8, inn, 0.6);
      wr.commit(); wb.commit();
      // Gas exchange glow in the lungs / delivery glow in the body between beats.
      lungMat.emissiveIntensity = 0.35 * bump(p, 0.22, 0.34, 0.55);
      bodyMat.emissiveIntensity = 0.3 * bump(p, 0.24, 0.36, 0.55);
      const breathe = 1 + 0.05 * Math.sin(p * Math.PI * 2);
      for (const l of lungs) l.scale.set(0.3 * breathe, 0.46 * (1 + 0.03 * Math.sin(p * Math.PI * 2)), 0.24 * breathe);
      // Bug-eyed on the squeeze, blissful slits while filling.
      const wide = 1 + 0.3 * bump(p, 0.03, 0.08, 0.3);
      const bliss = ramp(p, 0.48, 0.56) * (1 - ramp(p, 0.86, 0.95));
      for (const e of eyes) e.scale.set(wide * (1 + 0.1 * bliss), wide * (1 - 0.82 * bliss), wide);
    }
    update(0);
    return { cycle: 5000, cues: [{ at: 0.04, clip: "heart-out" }, { at: 0.46, clip: "heart-in" }], update };
  };

  // ================================================================ 2. four chambers
  // Translucent chambers: atria upstairs receive from veins, ventricles downstairs pump
  // up the great arteries. AV valves shut when the ventricles squeeze.
  // Hook: the heart is a two-storey house; the arteries leave through the roof as chimneys.
  SCENES["four-blocks"] = (parent) => {
    const root = new THREE.Group();
    root.position.y = -0.035;
    attach(parent).add(root);
    const sg = sphereGeo(14, 10);
    const podR = glass(0x6f7be0, 0.6, { emissive: 0x2c3aa8, emissiveIntensity: 0.3 });
    const podL = glass(0xe25a64, 0.6, { emissive: 0xa01f2b, emissiveIntensity: 0.3 });
    const ATR = [0.11, 0.085, 0.1], VEN = [[0.12, 0.15, 0.11], [0.13, 0.16, 0.12]];
    const ra = mesh(sg, podR, root, -0.13, 0.47, 0, ...ATR), la = mesh(sg, podL, root, 0.13, 0.47, 0, ...ATR);
    const rv = mesh(sg, podR, root, -0.115, 0.215, 0, ...VEN[0]), lv = mesh(sg, podL, root, 0.12, 0.205, 0, ...VEN[1]);
    const muscle = mat(0xa8505a, { roughness: 0.6 });
    mesh(cached("box", () => new THREE.BoxGeometry(1, 1, 1)), muscle, root, 0, 0.31, 0, 0.016, 0.44, 0.2); // septum
    // AV valve rings and leaflets.
    const ringGeo = cached("avring", () => new THREE.TorusGeometry(0.055, 0.008, 5, 16));
    const leafGeo = cached("leaf", () => { const g = new THREE.CircleGeometry(1, 8, 0, Math.PI); g.rotateY(Math.PI / 2); return g; });
    const leafMat = mat(0xfff1dc, { side: THREE.DoubleSide, roughness: 0.5, emissive: 0xfff1dc, emissiveIntensity: 0.25 });
    const leaves = [];
    for (const s of [-1, 1]) {
      const cx = s * 0.125;
      const ring = mesh(ringGeo, muscle, root, cx, 0.372, 0);
      ring.rotation.x = Math.PI / 2;
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(cx + side * 0.055, 0.372, 0);
        root.add(pivot);
        mesh(leafGeo, leafMat, pivot, 0, 0, 0, 1, 0.058, 0.06); // flap extends +y from its hinge
        leaves.push({ pivot, side });
      }
    }
    // Veins into the upstairs, arteries up the middle and out of the roof.
    const vb = vesselMat(C.vein), vr = vesselMat(C.artery);
    const P = {
      svc: [[-0.37, 0.64, 0.0], [-0.31, 0.53, 0.0], [-0.2, 0.48, 0.0]],
      pv: [[0.37, 0.64, 0.0], [0.31, 0.53, 0.0], [0.2, 0.48, 0.0]],
      pt: [[-0.09, 0.24, 0.0], [-0.05, 0.36, 0.0], [-0.045, 0.5, 0.0], [-0.045, 0.735, 0.0]],
      ao: [[0.09, 0.24, 0.0], [0.05, 0.36, 0.0], [0.045, 0.5, 0.0], [0.045, 0.735, 0.0]],
    };
    vessel("fb-svc", P.svc, 0.03, 8, vb, root);
    vessel("fb-pv", P.pv, 0.03, 8, vr, root);
    vessel("fb-pt", P.pt, 0.024, 10, vb, root);
    vessel("fb-ao", P.ao, 0.024, 10, vr, root);
    const rimGeo = cached("rim", () => new THREE.TorusGeometry(0.028, 0.007, 5, 12));
    for (const x of [-0.045, 0.045]) { const r = mesh(rimGeo, x < 0 ? vb : vr, root, x, 0.735, 0); r.rotation.x = Math.PI / 2; }
    // Roof: a terracotta gable (triangular prism) with a cream eave trim.
    const prism = cached("prism", () => { const g = new THREE.CylinderGeometry(1, 1, 1, 3); g.rotateX(-Math.PI / 2); return g; });
    mesh(prism, mat(0xb4654a, { roughness: 0.8 }), root, 0, 0.6, -0.01, 0.4, 0.08, 0.27);
    mesh(cached("box", () => new THREE.BoxGeometry(1, 1, 1)), mat(0xeadbc4, { roughness: 0.7 }), root, 0, 0.558, -0.01, 0.7, 0.012, 0.28);
    const cvs = { svc: curveOf(P.svc), pv: curveOf(P.pv), pt: curveOf(P.pt), ao: curveOf(P.ao) };

    // Particles: 7 per side; precomputed rest positions in atrium and ventricle.
    const N = 9, rnd = rng(42);
    const rest = [];
    for (let k = 0; k < 2 * N; k++) {
      const s = k < N ? -1 : 1;
      rest.push({
        s, i: k % N,
        a: new V3(s * 0.13 + (rnd() - 0.5) * 0.11, 0.47 + (rnd() - 0.5) * 0.07, (rnd() - 0.5) * 0.1),
        v: new V3(s * 0.115 + (rnd() - 0.5) * 0.12, 0.19 + (rnd() - 0.5) * 0.14, (rnd() - 0.5) * 0.11),
      });
    }
    const bP = particles(N, C.blue, root), rP = particles(N, C.red, root);
    const wb = writer(bP), wr = writer(rP);
    const t = new V3(), vc = new V3();
    function update(p) {
      // Chambers: atria swell while receiving, then empty downstairs; ventricles fill then squeeze.
      const aFill = ramp(p, 0.05, 0.3) * (1 - ramp(p, 0.36, 0.5));
      const vS = 1 + 0.08 * ramp(p, 0.36, 0.5) - 0.26 * ramp(p, 0.56, 0.64) + 0.18 * ramp(p, 0.8, 0.98);
      for (const a of [ra, la]) a.scale.set(ATR[0] * (1 + 0.14 * aFill), ATR[1] * (1 + 0.2 * aFill), ATR[2] * (1 + 0.14 * aFill));
      rv.scale.set(VEN[0][0] * vS, VEN[0][1] * (0.5 + 0.5 * vS), VEN[0][2] * vS);
      lv.scale.set(VEN[1][0] * vS, VEN[1][1] * (0.5 + 0.5 * vS), VEN[1][2] * vS);
      // AV valves: open (hanging down) while atria empty, slam flat when ventricles squeeze.
      const open = ramp(p, 0.33, 0.38) * (1 - ramp(p, 0.53, 0.56));
      for (const l of leaves) l.pivot.rotation.z = l.side * lerp(Math.PI / 2, Math.PI - 0.3, open); // shut = flat inward, open = hanging down
      for (const r of rest) {
        const w = r.s < 0 ? wb : wr;
        const st = r.i * 0.022;
        const fin = ramp(p, 0.05 + st, 0.3 + st), fdrop = ramp(p, 0.36 + st * 0.5, 0.5 + st * 0.5);
        const fout = easeOut(p, 0.56 + st * 0.5, 0.78 + st * 0.5);
        let s = 0.021;
        if (fout > 0) {
          if (fout >= 0.999) { w.put(r.i, 0, 0, 0, 0); continue; }
          const art = r.s < 0 ? cvs.pt : cvs.ao;
          if (fout < 0.2) { art.getPointAt(0, t); t.lerpVectors(r.v, t, fout / 0.2); }
          else if (fout < 0.8) art.getPointAt((fout - 0.2) / 0.6, t);
          else { art.getPointAt(1, t); t.y += (fout - 0.8) * 0.5; t.x += r.s * (fout - 0.8) * 0.25; s *= (1 - fout) / 0.2; }
        } else if (fdrop > 0) {
          t.lerpVectors(r.a, r.v, fdrop);
          t.x = lerp(t.x, r.s * 0.125, Math.sin(fdrop * Math.PI) * 0.7); // funnel through the valve
        } else if (fin > 0) {
          const vein = r.s < 0 ? cvs.svc : cvs.pv;
          if (fin < 0.55) vein.getPointAt(fin / 0.55, t);
          else { vein.getPointAt(1, vc); t.lerpVectors(vc, r.a, (fin - 0.55) / 0.45); }
          s *= Math.min(1, fin / 0.1);
        } else { w.put(r.i, 0, 0, 0, 0); continue; }
        // Squeezing ventricles carry their contents with them.
        if (fout === 0 && fdrop > 0.99) {
          const cx = r.s < 0 ? rv.position.x : lv.position.x;
          t.x = cx + (t.x - cx) * vS; t.z *= vS; t.y = 0.21 + (t.y - 0.21) * (0.5 + 0.5 * vS);
        }
        w.putV(r.i, t, s);
      }
      wb.commit(); wr.commit();
    }
    update(0);
    return { cycle: 5000, cues: [{ at: 0.05, clip: "chambers-in" }, { at: 0.56, clip: "chambers-out" }], update };
  };

  // ================================================================ 3. lungs (pulmonary circuit)
  // Right ventricle squeezes blue blood up the pulmonary arteries into translucent lungs
  // (bronchial tree inside); it turns red and returns by the pulmonary veins to the left atrium.
  // Hook: the windpipe wears a snorkel.
  SCENES.lungs = (parent) => {
    const root = attach(parent);
    const HP = [0.0, 0.13, 0.07], HS = 0.24;
    const hg = new THREE.Group();
    hg.position.set(...HP); hg.scale.setScalar(HS);
    root.add(hg);
    const H = heart(hg, { groove: false });
    const h = hp(HP, HS);
    const lungMat = glass(C.lung, 0.5, { emissive: 0xff5a6e, emissiveIntensity: 0.05, roughness: 0.6 });
    const lungs = [-1, 1].map((s) => mesh(lungGeo(s), lungMat, root, s * 0.19, 0.39, -0.01, 0.155, 0.23, 0.12));
    // Trachea, cartilage rings, bronchial tree.
    const cart = mat(C.cartilage, { roughness: 0.6 });
    vessel("lu-trachea", [[0, 0.63, -0.02], [0, 0.56, -0.02], [0, 0.5, -0.02]], 0.02, 3, cart, root, 8);
    const ring = cached("trring", () => new THREE.TorusGeometry(0.021, 0.004, 4, 12));
    for (let k = 0; k < 4; k++) { const r = mesh(ring, cart, root, 0, 0.52 + k * 0.03, -0.02); r.rotation.x = Math.PI / 2; }
    for (const s of [-1, 1]) {
      const hil = [s * 0.11, 0.43, -0.01];
      vessel(`lu-main${s}`, [[0, 0.5, -0.02], [s * 0.06, 0.465, -0.015], hil], 0.013, 5, cart, root, 5);
      const lobes = s > 0 ? [[0.16, 0.52], [0.21, 0.38], [0.17, 0.26]] : [[0.15, 0.53], [0.23, 0.42], [0.2, 0.3], [0.16, 0.24]];
      lobes.forEach(([x, y], k) => {
        const end = [s * x, y, 0.0];
        vessel(`lu-lob${s}${k}`, [hil, [s * (0.11 + x) / 2, (0.43 + y) / 2 + 0.005, -0.005], end], 0.008, 4, cart, root, 4);
        const dx = end[0] - hil[0], dy = end[1] - hil[1], L = Math.hypot(dx, dy);
        for (const tw of [-0.6, 0.6]) {
          const c = Math.cos(tw), sn = Math.sin(tw);
          const tip = [end[0] + ((dx * c - dy * sn) / L) * 0.04, end[1] + ((dx * sn + dy * c) / L) * 0.04, 0.005];
          vessel(`lu-tw${s}${k}${tw}`, [end, tip], 0.0045, 1, cart, root, 4);
        }
      });
    }
    // Snorkel (hook).
    const snork = mat(0xffb020, { roughness: 0.45, emissive: 0xff9000, emissiveIntensity: 0.15 });
    vessel("lu-snork", [[0, 0.615, -0.02], [0, 0.655, -0.02], [0.02, 0.685, -0.02], [0.055, 0.69, -0.02], [0.075, 0.665, -0.02]], 0.012, 10, snork, root, 6);
    const band = mesh(cached("snband", () => new THREE.TorusGeometry(0.024, 0.006, 4, 12)), snork, root, 0, 0.615, -0.02);
    band.rotation.x = Math.PI / 2;
    // Pulmonary circuit paths: RV -> trunk -> lung -> capillaries -> pulmonary vein -> LA.
    const paths = [-1, 1].map((s) => [
      h(-0.12, -0.05, 0.1), h(-0.07, 0.3, 0.22), h(-0.01, 0.56, 0.2),
      [s * 0.07, 0.31, 0.07], [s * 0.14, 0.37, 0.05], [s * 0.21, 0.47, 0.03], [s * 0.25, 0.37, 0.0], [s * 0.2, 0.28, -0.01],
      [s * 0.1, 0.27, -0.02], s > 0 ? h(0.4, 0.4, -0.2) : [-0.02, 0.2, -0.06], h(0.17, 0.38, -0.12),
    ]);
    const vb = vesselMat(C.vein), vr = vesselMat(C.artery);
    vessel("lu-trunk", paths[0].slice(0, 4), 0.016, 8, vb, root);
    [-1, 1].forEach((s, k) => {
      vessel(`lu-pa${s}`, paths[k].slice(2, 6), 0.012, 10, vb, root);
      vessel(`lu-pv${s}`, paths[k].slice(7), 0.011, 10, vr, root);
    });
    const curves = paths.map(curveOf);
    const N = 8;
    const P = tintParticles(2 * N, root);
    const w = writer(P);
    const cB = new THREE.Color(C.blue), cR = new THREE.Color(C.red), cc = new THREE.Color();
    const t = new V3();
    function update(p) {
      const v = bump(p, 0.03, 0.1, 0.3);
      H.pose(v, ramp(p, 0.55, 0.9) * (1 - ramp(p, 0.92, 1)));
      // Leader position along the circuit: out (0..0.47), linger in lung, back (0.62..1).
      const f = 0.47 * easeOut(p, 0.05, 0.4) + 0.15 * ramp(p, 0.4, 0.56) + 0.48 * ramp(p, 0.56, 0.92);
      const ox = ramp(p, 0.4, 0.55); // oxygenated
      for (let k = 0; k < 2; k++) {
        for (let i = 0; i < N; i++) {
          const idx = k * N + i;
          const u = f * 1.25 - (i / (N - 1)) * 0.25 + 0.02;
          if (u <= 0.02 || u >= 1 || p < 0.04) { w.put(idx, 0, 0, 0, 0); continue; }
          curves[k].getPointAt(u, t);
          w.putV(idx, t, 0.015 * edgeFade(u, 0.05));
          // Colour follows the oxygen state of each particle: red once it has passed the lung loop.
          cc.lerpColors(cB, cR, smooth((u - 0.48) / 0.12) * 0.3 + 0.7 * ox * smooth((u - 0.4) / 0.1));
          P.setColorAt(idx, cc);
        }
      }
      w.commit();
      P.instanceColor.needsUpdate = true;
      // Breathing in as the blood arrives: lungs swell and blush with fresh oxygen.
      const inhale = bump(p, 0.25, 0.5, 0.85);
      for (let k = 0; k < 2; k++) lungs[k].scale.set(0.155 * (1 + 0.06 * inhale), 0.23 * (1 + 0.04 * inhale), 0.12 * (1 + 0.06 * inhale));
      lungMat.emissiveIntensity = 0.05 + 0.35 * bump(p, 0.38, 0.5, 0.7);
    }
    update(0);
    return { cycle: 5500, cues: [{ at: 0.05, clip: "lungs-out" }, { at: 0.56, clip: "lungs-back" }], update };
  };

  // ================================================================ 4. left ventricle (dumbbell)
  // Short-axis cross-section: thick round left ventricle wall, thin right ventricle crescent.
  // Hook: the section has legs and arms - it squats a barbell (leg day), then flexes and blasts
  // red blood out to the whole body while the right side gives a puny blue squirt to the lungs.
  SCENES.dumbbell = (parent) => {
    const root = attach(parent);
    const sec = new THREE.Group();
    root.add(sec);
    const D = 0.1, LVX = 0.05, LVR = 0.135;
    const sector = (r0, r1, a0, a1, depth, key) => cached(key, () => {
      const s = new THREE.Shape();
      s.absarc(0, 0, r1, a0, a1, false);
      s.absarc(0, 0, r0, a1, a0, true);
      const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 14 });
      g.translate(0, 0, -depth / 2);
      return g;
    });
    const disc = (r, depth, key) => cached(key, () => { const g = new THREE.CylinderGeometry(r, r, depth, 26); g.rotateX(Math.PI / 2); return g; });
    const lvMat = mat(0x8e2f3d, { emissive: 0x5a1520, emissiveIntensity: 0.25, roughness: 0.6 });
    const rvMat = mat(C.rHeart, { emissive: C.rHeart, emissiveIntensity: 0.12, roughness: 0.6 });
    const lumR = mat(0x9e1c27, { emissive: 0x9e1c27, emissiveIntensity: 0.4, roughness: 0.3 });
    const lumB = mat(0x2f5fc0, { emissive: 0x2f5fc0, emissiveIntensity: 0.4, roughness: 0.3 });
    const lv = mesh(disc(LVR, D, "lvwall"), lvMat, sec, LVX, 0, 0);
    const lvLumen = mesh(disc(0.058, D + 0.006, "lvlum"), lumR, sec, LVX, 0, 0);
    const rvG = new THREE.Group();
    rvG.position.x = LVX;
    sec.add(rvG);
    const A0 = (100 * Math.PI) / 180, A1 = (260 * Math.PI) / 180;
    mesh(sector(LVR - 0.002, 0.2, A0, A1, D * 0.92, "rvwall"), rvMat, rvG);
    const rvLumen = mesh(sector(0.147, 0.183, A0 + 0.12, A1 - 0.12, D * 0.92 + 0.006, "rvlum"), lumB, rvG);
    // Limbs: two-bone chains rebuilt from points each frame (pure function of phase).
    const limbMat = mat(0x9a3644, { roughness: 0.6 });
    const shoe = mat(C.white, { roughness: 0.5 });
    const cg = cylGeo(8, false);
    const mk = () => mesh(cg, limbMat, root);
    const legs = [[-0.04, 0], [0.11, 0]].map(([x]) => ({ x, a: mk(), b: mk(), f: mesh(sphereGeo(8, 6), shoe, root) }));
    const arms = [-1, 1].map((s) => ({ s, a: mk(), b: mk(), h: mesh(sphereGeo(8, 6), limbMat, root) }));
    // Barbell.
    const steel = mat(0xc9ced6, { metalness: 0.8, roughness: 0.3 }), plateM = mat(0x2a2e36, { roughness: 0.5 });
    const bar = new THREE.Group();
    root.add(bar);
    const bx = mesh(cg, steel, bar, 0, 0, 0, 0.008, 0.64, 0.008); bx.rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) for (const [x, r, w] of [[0.255, 0.066, 0.028], [0.288, 0.052, 0.022]]) {
      const pl = mesh(cylGeo(18, false), plateM, bar, s * x, 0, 0, r, w, r); pl.rotation.z = Math.PI / 2;
    }
    const BARX = LVX - 0.02;
    bar.position.x = BARX;
    // Blood blast.
    const rnd = rng(7);
    const NR = 22, NB = 5;
    const shots = [];
    for (let i = 0; i < NR + NB; i++) {
      const blue = i >= NR;
      const th = blue ? lerp(0.6, 2.2, rnd()) + Math.PI * 0.3 : (i / NR) * Math.PI * 2 + rnd() * 0.3;
      const ph = blue ? lerp(0.5, 0.8, rnd()) : lerp(0.95, 1.4, rnd());
      shots.push({ blue, i: blue ? i - NR : i, dx: Math.cos(th) * Math.sin(ph), dy: Math.sin(th) * Math.sin(ph), dz: Math.cos(ph), sp: blue ? lerp(0.06, 0.09, rnd()) : lerp(0.25, 0.32, rnd()), del: rnd() * 0.08 });
    }
    const rP = particles(NR, 0xff5a60, root, 0.7), bP = particles(NB, C.blue, root, 0.6);
    const wr = writer(rP), wb = writer(bP);
    const A = new V3(), B = new V3(), K = new V3(), M = new V3(), up = new V3(0, 1, 0), dir = new V3();
    function bone(m, a, b, r) {
      M.addVectors(a, b).multiplyScalar(0.5);
      dir.subVectors(b, a);
      const L = dir.length();
      m.position.copy(M);
      m.quaternion.setFromUnitVectors(up, dir.divideScalar(L || 1));
      m.scale.set(r, L, r);
    }
    // Knee/elbow: midpoint pushed out along `bend` so both bones keep length L.
    function joint(a, b, L, bx, by, bz) {
      M.addVectors(a, b).multiplyScalar(0.5);
      const d = a.distanceTo(b) / 2;
      const hgt = Math.sqrt(Math.max(0, L * L - d * d));
      K.set(M.x + bx * hgt, M.y + by * hgt, M.z + bz * hgt);
      return K;
    }
    function update(p) {
      // Squat 0.05-0.2, drive up 0.2-0.36 pressing the bar overhead; flex + blast 0.5-0.85; lower 0.88-1.
      const squat = bump(p, 0.05, 0.16, 0.3);
      const press = ramp(p, 0.18, 0.36) * (1 - ramp(p, 0.88, 0.99));
      const flex = bump(p, 0.5, 0.56, 0.86);
      const Y = 0.32 - 0.075 * squat;
      sec.position.y = Y;
      sec.scale.set(1 + 0.04 * squat, 1 - 0.04 * squat, 1);
      // The thick wall contracts: cavity shrinks, wall bulges.
      const lift = 0.35 * press;
      const lvs = 1 + 0.04 * flex + 0.02 * lift;
      lv.scale.set(lvs, lvs, 1);
      const lum = 1 - 0.55 * flex - 0.15 * lift;
      lvLumen.scale.set(lum, lum, 1);
      lumB.emissiveIntensity = 0.4 + 0.4 * flex;
      const barY = Y + 0.23 + 0.085 * press;
      bar.position.y = barY;
      bar.rotation.z = 0.04 * Math.sin(p * Math.PI * 4) * flex;
      // Legs from hip to sneaker; knees pop forward on the squat.
      for (const l of legs) {
        A.set(l.x, Y - 0.12, 0.0); B.set(l.x + (l.x < LVX ? -0.02 : 0.02), 0.018, 0.0);
        joint(A, B, 0.1, 0, 0, 1);
        const knee = M.copy(K);
        const kx = knee.x, ky = knee.y, kz = knee.z;
        bone(l.a, A, K.set(kx, ky, kz), 0.017);
        bone(l.b, K.set(kx, ky, kz), B, 0.015);
        l.f.position.set(B.x, 0.012, 0.018); l.f.scale.set(0.024, 0.014, 0.04);
      }
      // Arms from shoulders to the bar; elbows flare out.
      for (const a of arms) {
        A.set(LVX + a.s * 0.15 - 0.02, Y + 0.08, 0.02);
        B.set(BARX + a.s * 0.17, barY, 0.0);
        joint(A, B, 0.1, a.s, -0.25, 0);
        const ex = K.x, ey = K.y, ez = K.z;
        bone(a.a, A, K.set(ex, ey, ez), 0.016 * (1 + 0.5 * flex));
        bone(a.b, K.set(ex, ey, ez), B, 0.014);
        a.h.position.copy(B); a.h.scale.setScalar(0.02);
      }
      // Blast: ballistic, pure in phase.
      for (const s of shots) {
        const w = s.blue ? wb : wr;
        const tt = (p - 0.53 - s.del) / 0.3;
        if (tt <= 0 || tt >= 1) { w.put(s.i, 0, 0, 0, 0); continue; }
        const ox = s.blue ? LVX - 0.165 : LVX, oz = D / 2;
        const e = 1 - (1 - tt) * (1 - tt);
        w.put(s.i, ox + s.dx * s.sp * e, Y + s.dy * s.sp * e - 0.06 * tt * tt, oz + s.dz * s.sp * e * 0.7, 0.017 * Math.min(1, (1 - tt) * 4, tt * 12));
      }
      wr.commit(); wb.commit();
    }
    update(0);
    return { cycle: 5500, cues: [{ at: 0.05, clip: "lv-lift" }, { at: 0.53, clip: "lv-flex" }], update };
  };

  // ================================================================ 5. arteries (arrow-out)
  // A thick-walled artery arcs AWAY from a small heart; each beat a pressure wave bulges the
  // elastic wall and shoots blood out of the cut end (thick wall visible in section).
  // Hook: a tyre-style pressure gauge screwed into the artery swings into the red.
  SCENES["arrow-out"] = (parent) => {
    const root = attach(parent);
    const HP = [-0.25, 0.2, 0.0], HS = 0.22;
    const hg = new THREE.Group();
    hg.position.set(...HP); hg.scale.setScalar(HS);
    root.add(hg);
    const Hh = heart(hg, { groove: false });
    const h = hp(HP, HS);
    const pts = [h(0.02, 0.1, -0.02), h(0.0, 0.45, 0.0), [-0.21, 0.42, 0.02], [-0.12, 0.52, 0.04], [0.03, 0.53, 0.05], [0.17, 0.47, 0.06], [0.27, 0.42, 0.09], [0.32, 0.4, 0.15]];
    const curve = curveOf(pts);
    const SEG = 40, RAD = 10, R = 0.042;
    // Per-build tube (its vertices bulge per frame).
    const tg = new THREE.TubeGeometry(curve, SEG, R, RAD, false);
    const pos = tg.attributes.position, nor = tg.attributes.normal;
    const centres = new Float32Array(pos.count * 3);
    for (let i = 0; i <= SEG; i++) {
      const c = curve.getPointAt(i / SEG);
      for (let j = 0; j <= RAD; j++) c.toArray(centres, (i * (RAD + 1) + j) * 3);
    }
    pos.setUsage(THREE.DynamicDrawUsage);
    const wallMat = glass(0xd0636b, 0.5, { emissive: 0x8a1f2a, emissiveIntensity: 0.2, side: THREE.DoubleSide, roughness: 0.4 });
    const artery = mesh(tg, wallMat, root);
    artery.frustumCulled = false;
    // Cut end: thick wall in section (tunica media), with an outer adventitia rim.
    const end = curve.getPointAt(1), tan = curve.getTangentAt(1);
    const endG = new THREE.Group();
    endG.position.copy(end);
    endG.quaternion.setFromUnitVectors(new V3(0, 0, 1), tan);
    root.add(endG);
    mesh(cached("artend", () => new THREE.RingGeometry(0.021, R, 18, 1)), mat(0xc4505a, { side: THREE.DoubleSide, roughness: 0.6 }), endG);
    mesh(cached("artend2", () => new THREE.RingGeometry(R - 0.006, R + 0.002, 18, 1)), mat(0xf0c8b0, { side: THREE.DoubleSide }), endG, 0, 0, 0.001);
    // Gauge (hook).
    const G = new THREE.Group();
    G.position.set(0.1, 0.27, 0.11);
    G.rotation.x = -0.25;
    root.add(G);
    const steel = mat(0xb9bec6, { metalness: 0.8, roughness: 0.3 });
    vessel("ga-stem", [[0.1, 0.47, 0.06], [0.1, 0.4, 0.09], [0.1, 0.33, 0.1]], 0.007, 4, steel, root, 5);
    mesh(cached("gface", () => new THREE.CircleGeometry(0.07, 24)), mat(0xf7f4ec, { roughness: 0.6 }), G, 0, 0, 0.001);
    const arc = (a0, a1, col, key) => mesh(cached(key, () => new THREE.RingGeometry(0.048, 0.062, 8, 1, a0, a1 - a0)), mat(col, { emissive: col, emissiveIntensity: 0.3 }), G, 0, 0, 0.002);
    arc(Math.PI * 0.62, Math.PI * 1.0, 0x3dbe7b, "garc1");
    arc(Math.PI * 0.38, Math.PI * 0.62, 0xf2c53a, "garc2");
    arc(0.0, Math.PI * 0.38, 0xe23b3b, "garc3");
    const bez = mesh(cached("gbez", () => new THREE.TorusGeometry(0.071, 0.008, 5, 24)), steel, G);
    void bez;
    const needle = new THREE.Group();
    needle.position.z = 0.006;
    G.add(needle);
    mesh(cached("box", () => new THREE.BoxGeometry(1, 1, 1)), mat(C.ink), needle, 0.026, 0, 0, 0.058, 0.006, 0.003);
    mesh(blobGeo(), mat(C.ink), needle, 0, 0, 0, 0.009, 0.009, 0.004);
    // Blood stream.
    const N = 22;
    const P = particles(N, C.red, root, 0.5);
    const w = writer(P);
    const t = new V3(), endT = tan.clone();
    const beats = [0.05, 0.55];
    function pulse(p, a) { return bump(p, a - 0.01, a + 0.05, a + 0.3); }
    function update(p) {
      // Two beats per loop; flow surges on each beat and keeps creeping between (elastic recoil).
      const surge = 0.35 * easeOut(p, 0.05, 0.27) + 0.35 * easeOut(p, 0.55, 0.77) + 0.3 * p;
      const v = bump(p, 0.02, 0.07, 0.2) + bump(p, 0.52, 0.57, 0.7);
      Hh.pose(v, ramp(p, 0.2, 0.48) * (1 - ramp(p, 0.48, 0.55)) + ramp(p, 0.7, 0.98) * (1 - ramp(p, 0.98, 1)));
      // Pressure wave travelling along the wall.
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG;
        let b = 0;
        for (const a of beats) { const wpos = (p - a) / 0.22; const d = (u - wpos) / 0.11; if (wpos > -0.3 && wpos < 1.4) b += Math.exp(-d * d); }
        const r = 1 + 0.6 * b;
        for (let j = 0; j <= RAD; j++) {
          const k = (i * (RAD + 1) + j) * 3;
          pos.array[k] = centres[k] + nor.array[k] * R * r;
          pos.array[k + 1] = centres[k + 1] + nor.array[k + 1] * R * r;
          pos.array[k + 2] = centres[k + 2] + nor.array[k + 2] * R * r;
        }
      }
      pos.needsUpdate = true;
      for (let i = 0; i < N; i++) {
        const u = frac(i / N + surge) * 1.25;
        if (u < 1) { curve.getPointAt(u, t); w.putV(i, t, 0.017 * Math.min(1, u / 0.06)); }
        else { const e = (u - 1) / 0.25; t.copy(end).addScaledVector(endT, e * 0.09); t.y -= e * e * 0.05; w.putV(i, t, 0.017 * (1 - e)); }
      }
      w.commit();
      const pr = Math.max(pulse(p, 0.05), pulse(p, 0.55));
      needle.rotation.z = lerp(Math.PI * 0.92, Math.PI * 0.12, 0.15 + 0.85 * pr);
    }
    update(0);
    return { cycle: 5000, cues: [{ at: 0.05, clip: "art-away" }, { at: 0.55, clip: "art-pressure" }], update };
  };

  // ================================================================ 6. veins (valve-gate)
  // A thin-walled vein carries blue blood UP to a small heart; calf muscles squeeze it along.
  // When blood slips back, the cup-shaped pocket valves catch it and slam shut.
  // Hook: a stop sign pops up on every slam.
  SCENES["valve-gate"] = (parent) => {
    const root = attach(parent);
    const Y0 = 0.02, TOP = 0.55, L = TOP - Y0, DV = L / 3, VR = 0.056;
    const VALVES = [Y0 + 0.11, Y0 + 0.11 + DV, Y0 + 0.11 + 2 * DV];
    const wall = glass(0x6f8fd0, 0.38, { emissive: 0x2c4c9a, emissiveIntensity: 0.15, side: THREE.DoubleSide });
    mesh(cylGeo(18, true), wall, root, 0, (Y0 + TOP) / 2 + 0.01, 0, VR, L + 0.04, VR);
    for (const y of VALVES) { const r = mesh(cached("vring", () => new THREE.TorusGeometry(VR, 0.005, 4, 20)), mat(0x9fb4e0), root, 0, y, 0); r.rotation.x = Math.PI / 2; }
    // Heart at the top: the vein feeds the right atrium.
    const HP = [0.03, 0.6, 0.0], HS = 0.15;
    const hg = new THREE.Group();
    hg.position.set(...HP); hg.scale.setScalar(HS);
    root.add(hg);
    const Hh = heart(hg, { groove: false });
    // Leaflets: half-ellipse cusps hinged on the wall, free edge toward the heart.
    const leafGeo = cached("cusp", () => { const g = new THREE.CircleGeometry(1, 10, 0, Math.PI); g.rotateY(Math.PI / 2); return g; });
    const cuspMat = mat(0xe9eef8, { side: THREE.DoubleSide, roughness: 0.45, emissive: 0x9fb4e0, emissiveIntensity: 0.15 });
    const LL = 0.072, CLOSED = Math.asin(0.054 / LL), OPEN = 0.07;
    const cusps = [];
    for (const y of VALVES) for (const s of [-1, 1]) {
      const pv = new THREE.Group();
      pv.position.set(s * (VR - 0.002), y, 0);
      root.add(pv);
      mesh(leafGeo, cuspMat, pv, 0, 0, 0, 1, LL, 0.052);
      cusps.push({ pv, s });
    }
    // Skeletal muscle pump either side.
    const musM = mat(0xa9484a, { roughness: 0.65, emissive: 0x5a1010, emissiveIntensity: 0.1 });
    const muscles = [-1, 1].map((s) => mesh(sphereGeo(14, 10), musM, root, s * 0.11, 0.29, -0.03, 0.04, 0.15, 0.05));
    // Tendons make the bellies read as skeletal muscle.
    const tendon = mat(0xefe3cf, { roughness: 0.5 });
    for (const s of [-1, 1]) for (const y of [0.1, 0.48]) mesh(cylGeo(6, false), tendon, root, s * 0.11, y, -0.03, 0.009, 0.08, 0.009);
    // Stop sign (hook).
    const sign = new THREE.Group();
    sign.position.set(0.2, 0.43, 0.06);
    root.add(sign);
    const oct = mesh(cached("oct", () => new THREE.CircleGeometry(0.06, 8)), mat(0xd7263d, { emissive: 0xd7263d, emissiveIntensity: 0.35 }), sign);
    oct.rotation.z = Math.PI / 8;
    mesh(cached("octrim", () => new THREE.RingGeometry(0.052, 0.058, 8, 1)), mat(C.white), sign, 0, 0, 0.001).rotation.z = Math.PI / 8;
    mesh(cached("box", () => new THREE.BoxGeometry(1, 1, 1)), mat(C.white), sign, 0, 0, 0.002, 0.06, 0.016, 0.002);
    const post = mesh(cylGeo(6, false), mat(0x8a8f99, { metalness: 0.6, roughness: 0.4 }), root, 0.2, 0.19, 0.055, 0.005, 0.38, 0.005);
    // Blood: 6 cells resting in each valve pocket at phase 0.
    const N = 18, rnd = rng(11);
    const cells = [];
    for (let i = 0; i < N; i++) {
      const v = i % 3, x = (rnd() - 0.5) * 0.07, z = (rnd() - 0.5) * 0.06;
      cells.push({ x, z, base: VALVES[v], pile: 0.008 + Math.floor(i / 3) * 0.011 + rnd() * 0.004, ro: rnd() * 3 });
    }
    const P = particles(N, C.blue, root, 0.35);
    const w = writer(P);
    const tipH = LL * Math.cos(CLOSED);
    const S1 = 0.04; // slip distance
    function update(p) {
      const up = ramp(p, 0.05, 0.45);
      const slip = ramp(p, 0.55, 0.6);
      const shut = ramp(p, 0.555, 0.585) * (1 - ramp(p, 0.97, 1.0)) + (1 - ramp(p, 0.0, 0.06));
      const closedAmt = Math.min(1, shut);
      for (const c of cusps) c.pv.rotation.z = c.s * lerp(OPEN, CLOSED, closedAmt);
      const sq = bump(p, 0.04, 0.2, 0.45);
      for (let k = 0; k < 2; k++) { const m = muscles[k]; m.scale.set(0.04 * (1 + 0.4 * sq), 0.15 * (1 - 0.08 * sq), 0.05 * (1 + 0.2 * sq)); m.position.x = (k ? 1 : -1) * (0.11 - 0.01 * sq); }
      Hh.pose(bump(p, 0.62, 0.68, 0.8), ramp(p, 0.1, 0.5) * (1 - ramp(p, 0.55, 0.62)));
      for (let i = 0; i < N; i++) {
        const c = cells[i];
        const restY = c.base + c.pile + tipH * (1 - Math.abs(c.x) / VR) * 0.85;
        let y = restY + (DV + S1) * up - S1 * slip;
        // Caught on the next valve's closed cusps.
        const above = c.base + DV;
        if (slip > 0) y = Math.max(y, above + c.pile + tipH * (1 - Math.abs(c.x) / VR) * 0.85);
        let yy = Y0 + frac((y - Y0) / L) * L;
        const s = 0.021 * Math.min(1, (yy - Y0) / 0.04, (TOP - yy) / 0.03);
        // Squeezed to the middle while passing an open valve.
        let near = 1;
        for (const vy of VALVES) near = Math.min(near, Math.abs(yy - vy - 0.03));
        const pinch = 1 - 0.45 * (1 - closedAmt) * Math.max(0, 1 - near / 0.05);
        w.d.rotation.set(c.ro, c.ro * 0.7, 0);
        w.put(i, c.x * pinch, yy, c.z * pinch, Math.max(0, s), Math.max(0, s) * 0.45, Math.max(0, s));
      }
      w.commit();
      const pop = ramp(p, 0.555, 0.6), hide = ramp(p, 0.88, 0.96);
      const sc = (pop + 0.25 * bump(p, 0.57, 0.6, 0.66)) * (1 - hide);
      sign.scale.setScalar(Math.max(0.0001, sc));
      post.visible = sc > 0.001;
      sign.visible = sc > 0.001;
    }
    update(0);
    return { cycle: 5000, cues: [{ at: 0.05, clip: "vein-up" }, { at: 0.55, clip: "vein-stop" }], update };
  };

  // ================================================================ 7. capillary net
  // Arteriole (red) to venule (blue) through a net of capillaries. The front capillary's wall
  // is a single layer of flat endothelial cells (with nuclei). Red cells squeeze through single
  // file, then oxygen (gold) and nutrients (green) pass out to the tissue cells and the blood turns blue.
  // Hook: the tissue cells have eyes and do a happy hop when their delivery arrives.
  SCENES.net = (parent) => {
    const root = attach(parent);
    const CY = 0.32, CZ = 0.06, CR = 0.04, CX = 0.25;
    mesh(cylGeo(12, false), mat(C.artery, { emissive: C.artery, emissiveIntensity: 0.1 }), root, -0.33, 0.33, -0.06, 0.04, 0.6, 0.04);
    mesh(cylGeo(12, false), mat(C.vein, { emissive: C.vein, emissiveIntensity: 0.1 }), root, 0.33, 0.33, -0.06, 0.046, 0.6, 0.046);
    // Background capillaries with a red -> blue gradient.
    const gradM = mat(0xffffff, { vertexColors: true, roughness: 0.5 });
    [[0.13, -0.11, 0.03], [0.5, -0.11, -0.03], [0.24, -0.15, 0.05]].forEach(([y, z, wv], k) => {
      const pts = [[-0.32, y, z], [-0.16, y + wv, z - 0.01], [0, y - wv, z], [0.16, y + wv, z + 0.01], [0.32, y, z]];
      mesh(tubeGeo(`net-bg${k}`, pts, 0.011, 18, 5, [C.red, C.blue]), gradM, root);
    });
    // Front capillary: connectors + endothelial cell tiles (one cell thick).
    const cpath = [[-0.33, 0.47, -0.06], [-0.33, 0.39, -0.04], [-0.3, CY + 0.005, 0.03], [-CX, CY, CZ], [0, CY, CZ], [CX, CY, CZ], [0.3, CY + 0.005, 0.03], [0.33, 0.39, -0.04], [0.33, 0.47, -0.06]];
    const curve = curveOf(cpath);
    const endoA = glass(0xf6c3be, 0.6, { side: THREE.DoubleSide, emissive: 0xc06060, emissiveIntensity: 0.12 });
    const endoB = glass(0xe79aa6, 0.6, { side: THREE.DoubleSide, emissive: 0xc06060, emissiveIntensity: 0.12 });
    const nucM = mat(0x7d5ba6, { roughness: 0.5 });
    const ROWS = 4, PER = 3, TL = (2 * CX) / ROWS;
    for (let r = 0; r < ROWS; r++) for (let k = 0; k < PER; k++) {
      const th0 = (k / PER) * Math.PI * 2 + (r % 2) * (Math.PI / PER);
      const geo = cached(`endo${r % 2}${k}`, () => new THREE.CylinderGeometry(CR, CR, TL - 0.006, 6, 1, true, th0 + 0.04, (Math.PI * 2) / PER - 0.08));
      const tile = mesh(geo, (r + k) % 2 ? endoA : endoB, root, -CX + TL * (r + 0.5), CY, CZ);
      tile.rotation.z = Math.PI / 2;
      const thm = th0 + Math.PI / PER;
      // Cylinder theta: x = sin, z = cos (in the tile's local frame before the z-rotation).
      // After the z-rotation the tile's local (sin, cos) maps to world (y, z).
      mesh(blobGeo(), nucM, root, -CX + TL * (r + 0.5), CY + Math.sin(thm) * CR * 1.03, CZ + Math.cos(thm) * CR * 1.03, 0.02, 0.011, 0.011);
    }
    // Connector stubs into arteriole and venule.
    vessel("net-cin", cpath.slice(1, 4), CR, 6, glass(0xf2a0a0, 0.45, { side: THREE.DoubleSide }), root);
    vessel("net-cout", cpath.slice(5, 8), CR, 6, glass(0xa8b8f0, 0.45, { side: THREE.DoubleSide }), root);
    // Tissue cells with eyes.
    const cellM = mat(C.tissue, { roughness: 0.7, emissive: 0xffc070, emissiveIntensity: 0 });
    const eyeM = mat(C.ink, { roughness: 0.3 });
    const CELLS = [[-0.17, 0.47, 0.04], [0.0, 0.48, 0.02], [0.17, 0.47, 0.04], [-0.12, 0.17, 0.05], [0.05, 0.165, 0.03], [0.2, 0.175, 0.02]];
    const cellG = CELLS.map(([x, y, z]) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      root.add(g);
      mesh(sphereGeo(10, 8), cellM, g, 0, 0, 0, 0.058, 0.046, 0.045);
      for (const s of [-1, 1]) mesh(blobGeo(), eyeM, g, s * 0.014, 0.008, 0.043, 0.0065, 0.009, 0.004);
      return g;
    });
    // Red cells.
    const NR = 5;
    const rbcM = mat(C.red, { emissive: C.red, emissiveIntensity: 0.3, roughness: 0.35 });
    const rbc = new THREE.InstancedMesh(blobGeo(), rbcM, NR);
    rbc.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rbc.frustumCulled = false;
    root.add(rbc);
    const wr = writer(rbc);
    // Deliveries: gold O2 dots and green nutrients, each to a cell.
    const rnd = rng(5);
    const NO = 14, NN = 6;
    const drops = [];
    for (let i = 0; i < NO + NN; i++) {
      const nut = i >= NO, cell = i % 6;
      const t0 = 0.57 + (nut ? (i - NO) / NN : i / NO) * 0.2 + rnd() * 0.02;
      const [x, y, z] = CELLS[cell];
      drops.push({ nut, i: nut ? i - NO : i, cell, t0, sx: x + (rnd() - 0.5) * 0.06, sz: CZ + (rnd() - 0.5) * 0.02,
        ex: x + (rnd() - 0.5) * 0.04, ey: y + (y > CY ? -0.035 : 0.035), ez: z + 0.01 + (rnd() - 0.5) * 0.03 });
    }
    const oP = particles(NO, C.o2, root, 0.8), nP = particles(NN, C.nutrient, root, 0.6);
    const wo = writer(oP), wn = writer(nP);
    const cR = new THREE.Color(C.red), cB = new THREE.Color(C.blue);
    const t = new V3(), t2 = new V3(), Z = new V3(0, 0, 1), dir = new V3();
    const hop = new Float32Array(6);
    function update(p) {
      // Leader: in through the arteriole, squeeze into the capillary, crawl while delivering, out.
      const f = lerp(0.06, 0.5, easeOut(p, 0.05, 0.45)) + 0.12 * ramp(p, 0.45, 0.85) + 0.42 * ramp(p, 0.85, 1.0);
      const deox = ramp(p, 0.58, 0.82);
      rbcM.color.lerpColors(cR, cB, deox);
      rbcM.emissive.copy(rbcM.color);
      for (let i = 0; i < NR; i++) {
        const u = f - i * 0.075;
        if (u <= 0.02 || u >= 0.98 || p < 0.03) { wr.put(i, 0, 0, 0, 0); continue; }
        curve.getPointAt(u, t);
        curve.getPointAt(Math.min(1, u + 0.01), t2);
        dir.subVectors(t2, t).normalize();
        wr.d.quaternion.setFromUnitVectors(Z, dir);
        // Disc outside, bullet-shaped and squeezed single-file inside the capillary.
        const inCap = smooth((CX + 0.02 - Math.abs(t.x)) / 0.05);
        const r = lerp(0.04, 0.029, inCap), th = lerp(0.014, 0.036, inCap);
        wr.put(i, t.x, t.y, t.z, r, r, th);
      }
      wr.commit();
      wr.d.quaternion.identity();
      hop.fill(0);
      for (const d of drops) {
        const w = d.nut ? wn : wo;
        const k = (p - d.t0) / 0.13;
        if (k <= 0 || k >= 1.25) { w.put(d.i, 0, 0, 0, 0); continue; }
        const e = smooth(Math.min(1, k));
        const y0 = CY + (d.ey > CY ? CR : -CR), x = lerp(d.sx, d.ex, e), y = lerp(y0, d.ey, e), z = lerp(d.sz, d.ez, e) + Math.sin(e * Math.PI) * 0.03;
        const s = (d.nut ? 0.014 : 0.016) * Math.min(1, k * 6) * (k > 1 ? (1.25 - k) / 0.25 : 1);
        w.put(d.i, x, y, z, s);
        hop[d.cell] = Math.max(hop[d.cell], bump(k, 0.85, 1.0, 1.25));
      }
      wo.commit(); wn.commit();
      for (let k = 0; k < cellG.length; k++) {
        const g = cellG[k], hh = hop[k];
        g.position.y = CELLS[k][1] + (CELLS[k][1] > CY ? 1 : -1) * 0.012 * hh;
        g.scale.set(1 + 0.08 * hh, 1 - 0.06 * hh, 1 + 0.08 * hh);
      }
      cellM.emissiveIntensity = 0.25 * ramp(p, 0.6, 0.75) * (1 - ramp(p, 0.88, 1));
    }
    update(0);
    return { cycle: 5500, cues: [{ at: 0.06, clip: "cap-squeeze" }, { at: 0.57, clip: "cap-deliver" }], update };
  };

  window.SCENES = SCENES;
})();
