/* eslint-disable @lwc/lwc/no-async-operation -- a WebGL render loop needs requestAnimationFrame */
import { AGENTS } from "c/xrayDemoData";

/** World coordinates (1 unit = 1 voxel). */
export const SURF = 0.25; // walking height on the grass
export const ZT = 4.65; // tunnel walking depth: front slice, so diggers stay visible from the 30° camera
export const SX = -7.5; // shaft column x
export const ZF = 0.4; // flag row z
export const BUCKET_Z = 5.45; // bucket hangs just outside the cliff face
export const BUCKET_REST = SURF + 0.9; // bucket height when parked at the top
export const PIP_FETCH = [SX + 1.6, SURF, 4.75]; // where Pip collects the card

const COLS = 24;
const ROWS = 10;
const colX = (c) => c - 11.5;

const VERBS = {
  dig: "digging",
  walk: "walking",
  run: "running",
  climb: "climbing",
  point: "explaining",
  cross: "watching",
  idle: "ready"
};
const SKY = [
  [0, "#8ec5ff", "#ffe2b8"],
  [0.45, "#5aa7ff", "#d6ecff"],
  [0.78, "#3b2a6b", "#ff9a5a"],
  [1, "#0b1430", "#2b2a5a"]
];
const lerp = (a, b, t) => a + (b - a) * t;
const mixHex = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return `#${A.map((v, i) =>
    Math.round(lerp(v, B[i], t))
      .toString(16)
      .padStart(2, "0")
  ).join("")}`;
};

const CREW = {
  ada: {
    x: -9.8,
    z: 2.2,
    face: 1,
    skin: "#8d5a3b",
    shirt: "#c8743c",
    shirtD: "#a85f2e",
    pants: "#4b3b2a",
    hat: "brim",
    tool: "pick"
  },
  theo: {
    x: -11.0,
    z: -2.6,
    face: 1,
    skin: "#f1c7a5",
    shirt: "#3f7fbf",
    shirtD: "#336aa1",
    pants: "#2f3b52",
    hat: "cap",
    tool: "rod"
  },
  pip: {
    x: -6.2,
    z: 2.6,
    face: 1,
    skin: "#c68a62",
    shirt: "#e85d4a",
    shirtD: "#c84b3a",
    pants: "#2b2b3a",
    hat: "hair",
    pack: "#3c6e47",
    s: 0.9
  },
  noor: {
    x: 9.2,
    z: 2.4,
    face: -1,
    skin: "#a8714f",
    shirt: "#7b5cc4",
    shirtD: "#664ba8",
    pants: "#34304a",
    hat: "bun"
  },
  rex: {
    x: 5.0,
    z: 1.5,
    face: -1,
    skin: "#e0b08c",
    shirt: "#5b6b7a",
    shirtD: "#4a5866",
    pants: "#2a2f36",
    hat: "beanie",
    tool: "clip",
    s: 1.1,
    state: "cross"
  }
};

/**
 * The isometric voxel dig site. Owns the three.js scene, the crew and the HTML labels.
 * The director (c/xrayDirector) moves the crew and calls the public methods.
 */
export class XrayWorld {
  constructor({ THREE, host, labels, layout, onAgentClick, reduceMotion }) {
    this.T = THREE;
    this.layout = layout;
    this.LAYERS = layout.layers;
    this.ARTIFACTS = layout.artifacts;
    this.FLAGS = layout.flags;
    this.layerByKey = Object.fromEntries(layout.layers.map((l) => [l.k, l]));
    this.host = host;
    this.labelsEl = labels;
    this.onAgentClick = onAgentClick;
    this.reduce = reduceMotion;
    this.speed = 1;
    this.chars = {};
    this.xray = true;
    this.follow = true;
    this.big = false;
    this.focusRef = null;
    this.focusZoom = 1;
    this.yaw = 0;
    this.night = 0;
    this.pinTarget = null;
    this.removed = new Set();
    this.popping = [];
    this.extent = {};
    this.dustPool = [];
    this.lamps = [];
    this.labels = {};
    this.charMeshes = [];
    this.found = new Set();
    this.flash = new Set();
    this.flagsOn = new Set();
  }

  floorOf(key) {
    return this.layerByKey[key].floor;
  }

  layerOfRow(r) {
    return this.LAYERS.find((l) => l.rows.includes(r));
  }

  /** x position of a buried component, or null if it is not drawn. */
  artifactX(name) {
    const a = this.ARTIFACTS[name];
    return a ? colX(a.c) : null;
  }

  /** x position of an object's survey flag, or null. */
  flagX(objectName) {
    return this.FLAGS.find(([n]) => n === objectName)?.[1] ?? null;
  }

  /** Briefly lights up the buried outlines of the named components (a "listing" pulse). */
  pulse(names) {
    names.forEach((name) => {
      const a = this.art[name];
      if (!a || this.found.has(name)) return;
      a.ghost.material.opacity = 1;
      a.ghost.material.color.set("#ffd84d");
      setTimeout(() => {
        a.ghost.material.opacity = a.decoy ? 0.35 : 0.75;
        a.ghost.material.color.set(a.decoy ? "#9bb8d6" : "#7fd3ff");
      }, 1400 / this.speed);
    });
  }

  /* ---------- lifecycle ---------- */

  start() {
    const T = this.T;
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    // Size the canvas with inline styles: it is added by script, so the component's
    // scoped CSS does not reach it. Without this, high-DPI screens show the canvas at
    // its 2x drawing size (zoomed and offset) while the HTML labels stay at 1x.
    Object.assign(this.renderer.domElement.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block"
    });
    this.host.insertBefore(this.renderer.domElement, this.host.firstChild);
    this.scene = new T.Scene();
    this.cam = new T.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.tmp = new T.Vector3();
    this.camT = new T.Vector3(0, -4.3, 0.5);
    this.camWant = this.camT.clone();
    this.camH = this.fitH();
    this.buildLights();
    this.buildTerrain();
    this.buildProps();
    this.buildArtifacts();
    this.buildCrew();
    this.buildLabels();
    this.bindInput();
    this.resetWorld();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
    this.last = performance.now();
    const tick = (now) => {
      this.frame(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** True when the canvas is drawn at exactly the panel's size (guards the high-DPI bug). */
  fitsHost() {
    const c = this.renderer.domElement.getBoundingClientRect();
    const h = this.host.getBoundingClientRect();
    return (
      Math.abs(c.width - h.width) <= 2 && Math.abs(c.height - h.height) <= 2
    );
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
  }

  resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w && h) {
      this.renderer.setSize(w, h, false);
    }
  }

  fitH() {
    const w = this.host.clientWidth || 1200;
    const h = this.host.clientHeight || 640;
    return Math.max(22, 31 / (w / h));
  }

  /* ---------- building ---------- */

  mat(color, extra) {
    return new this.T.MeshStandardMaterial({
      color,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
      ...extra
    });
  }

  box(w, h, d, color, x, y, z, parent, extra) {
    const mesh = new this.T.Mesh(
      new this.T.BoxGeometry(w, h, d),
      this.mat(color, extra)
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    (parent ?? this.scene).add(mesh);
    return mesh;
  }

  buildLights() {
    const T = this.T;
    this.hemi = new T.HemisphereLight(0xe6f2ff, 0x5a4030, 0.62);
    this.scene.add(this.hemi);
    this.sun = new T.DirectionalLight(0xffffff, 0.95);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, {
      left: -22,
      right: 22,
      top: 22,
      bottom: -22,
      near: 1,
      far: 140
    });
    this.sun.shadow.bias = -0.0006;
    this.sun.target.position.set(0, -4, 0);
    this.scene.add(this.sun, this.sun.target);
    const starGeo = new T.BufferGeometry();
    const pts = [];
    for (let i = 0; i < 180; i++) {
      pts.push(
        -80 + Math.random() * 30,
        10 + Math.random() * 40,
        -80 + Math.random() * 30
      );
    }
    starGeo.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
    this.stars = new T.Points(
      starGeo,
      new T.PointsMaterial({
        color: 0xffffff,
        size: 2,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0
      })
    );
    this.scene.add(this.stars);
  }

  buildTerrain() {
    const T = this.T;
    this.LAYERS.forEach((l) => {
      const top = -l.rows[0];
      const bottom = -(l.rows[1] + 1);
      this.box(24, top - bottom, 8, l.color, 0, (top + bottom) / 2, -1);
    });
    this.voxels = new T.InstancedMesh(
      new T.BoxGeometry(0.98, 0.98, 0.98),
      this.mat("#ffffff"),
      COLS * ROWS * 2
    );
    this.voxels.castShadow = true;
    this.voxels.receiveShadow = true;
    const color = new T.Color();
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        for (let d = 0; d < 2; d++) {
          const base = new T.Color(this.layerOfRow(r).color);
          const v = 0.9 + ((c * 7 + r * 13 + d * 5) % 9) / 45;
          color.setRGB(base.r * v, base.g * v, base.b * v);
          this.voxels.setColorAt(this.vIdx(c, r, d), color);
        }
      }
    }
    this.scene.add(this.voxels);
    this.backing = new T.InstancedMesh(
      new T.PlaneGeometry(1, 1),
      new T.MeshStandardMaterial({ color: "#2a1c12", roughness: 1 }),
      COLS * ROWS
    );
    this.backing.receiveShadow = true;
    this.scene.add(this.backing);
    const grass = "#6f9a4f";
    this.box(24, 0.25, 8, grass, 0, 0.125, -1);
    this.box(4, 0.25, 2, grass, -10, 0.125, 4);
    this.box(19, 0.25, 2, grass, 2.5, 0.125, 4);
  }

  buildProps() {
    const T = this.T;
    [
      [-10, -4],
      [-6.5, -4.2],
      [-2, -4.1],
      [2.5, -4.3],
      [11, -3.8],
      [11.2, -1.2],
      [-11.3, 3.9]
    ].forEach(([x, z], i) => {
      this.box(0.3, 0.9, 0.3, "#6b4a2b", x, SURF + 0.45, z);
      this.box(1.1, 1.1, 1.1, i % 2 ? "#4f8a43" : "#5d9a4c", x, SURF + 1.35, z);
      this.box(0.7, 0.7, 0.7, i % 2 ? "#5d9a4c" : "#6aa858", x, SURF + 2.1, z);
    });
    [
      [-4, -1.5],
      [1, -2.8],
      [2.8, -0.6],
      [-3.6, -3.2]
    ].forEach(([x, z]) =>
      this.box(0.45, 0.3, 0.4, "#9aa3ad", x, SURF + 0.15, z)
    );
    // ladder: just behind where Ada climbs (she climbs at z = ZT)
    const ladderZ = ZT - 0.38;
    this.box(0.08, 10.2, 0.08, "#a07a4a", SX - 0.32, -4.95, ladderZ);
    this.box(0.08, 10.2, 0.08, "#a07a4a", SX + 0.32, -4.95, ladderZ);
    for (let y = -9.8; y < 0.2; y += 0.5) {
      this.box(0.64, 0.06, 0.06, "#a07a4a", SX, y, ladderZ);
    }
    // crane over the cliff edge: the bucket travels down the OUTSIDE of the face,
    // so it is always visible and never collides with Ada in the shaft
    this.box(0.14, 2.1, 0.14, "#6b4a2b", SX + 0.75, SURF + 1.05, 4.35);
    this.box(0.14, 0.14, 1.35, "#6b4a2b", SX + 0.75, SURF + 2.05, 4.95);
    this.box(0.1, 0.5, 0.1, "#6b4a2b", SX + 0.75, SURF + 1.75, 4.55);
    const wheel = new T.Mesh(
      new T.CylinderGeometry(0.16, 0.16, 0.08, 12),
      this.mat("#3a2a1c")
    );
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(SX + 0.75, SURF + 1.9, BUCKET_Z);
    this.scene.add(wheel);
    this.rope = this.box(0.03, 1, 0.03, "#d9c39a", SX + 0.75, 0, BUCKET_Z);
    this.bucket = new T.Group();
    const pail = new T.Mesh(
      new T.CylinderGeometry(0.34, 0.25, 0.46, 12),
      this.mat("#7a5634")
    );
    pail.castShadow = true;
    this.bucket.add(pail);
    this.bucketCard = this.box(
      0.06,
      0.4,
      0.5,
      "#fbf6ea",
      0,
      0.38,
      0,
      this.bucket,
      { emissive: "#ffd84d", emissiveIntensity: 0.35 }
    );
    this.bucket.position.set(SX + 0.75, BUCKET_REST, BUCKET_Z);
    this.scene.add(this.bucket);
    // tent
    const tent = new T.Mesh(
      new T.ConeGeometry(2.3, 2.9, 4),
      this.mat("#ece0c4")
    );
    tent.rotation.y = Math.PI / 4;
    tent.position.set(7, SURF + 1.45, -2);
    tent.castShadow = true;
    tent.receiveShadow = true;
    this.scene.add(tent);
    this.box(0.06, 0.9, 0.06, "#8b7351", 7, SURF + 3.3, -2);
    this.box(0.5, 0.3, 0.04, "#ff6a3d", 7.27, SURF + 3.6, -2);
    const door = new T.Mesh(
      new T.ConeGeometry(0.8, 1.5, 3),
      this.mat("#3a2a1c")
    );
    door.position.set(7.55, SURF + 0.75, -0.75);
    door.rotation.y = 0.4;
    this.scene.add(door);
    // evidence board on an easel
    this.board = new T.Group();
    this.board.position.set(10.3, SURF, 1.0);
    this.board.rotation.y = Math.PI / 4;
    this.scene.add(this.board);
    this.box(0.1, 2.7, 0.1, "#6b4a2b", -1.1, 1.3, -0.2, this.board);
    this.box(0.1, 2.7, 0.1, "#6b4a2b", 1.1, 1.3, -0.2, this.board);
    this.box(2.9, 1.9, 0.12, "#b98a5a", 0, 1.85, 0, this.board);
    this.box(3.05, 0.12, 0.16, "#7a5634", 0, 2.85, 0, this.board);
    this.box(3.05, 0.12, 0.16, "#7a5634", 0, 0.85, 0, this.board);
    this.mini = new T.Group();
    this.mini.position.set(0, 1.85, 0.08);
    this.board.add(this.mini);
    // flags
    this.flags = this.FLAGS.map(([, x]) => {
      const g = new T.Group();
      g.position.set(x, SURF, ZF);
      this.box(0.06, 1.1, 0.06, "#3a2a1c", 0, 0.55, 0, g);
      this.box(0.5, 0.3, 0.04, "#ffd84d", 0.27, 0.95, 0, g);
      g.scale.set(0.001, 0.001, 0.001);
      this.scene.add(g);
      return g;
    });
    // lanterns
    const lamp = (x, y, z, range) => {
      this.box(0.18, 0.24, 0.18, "#ffe9a8", x, y, z, null, {
        emissive: "#ffcf6b",
        emissiveIntensity: 0.4
      });
      const light = new T.PointLight(0xffc56b, 0, range, 2);
      light.position.set(x, y, z + 0.2);
      this.scene.add(light);
      this.lamps.push(light);
    };
    lamp(SX - 0.9, SURF + 1.6, 4.7, 9);
    lamp(7.6, SURF + 1.4, -0.4, 8);
    lamp(9.6, SURF + 2.9, 2.0, 8);
    this.LAYERS.filter((l) => l.floor != null).forEach((l) =>
      lamp(SX + 1, l.floor + 1.45, 3.25, 6)
    );
    // dust
    const dustMat = this.mat("#dcc196");
    for (let i = 0; i < 90; i++) {
      const m = new T.Mesh(new T.BoxGeometry(0.11, 0.11, 0.11), dustMat);
      m.visible = false;
      this.scene.add(m);
      this.dustPool.push({ m, life: 0, v: new T.Vector3() });
    }
  }

  buildArtifacts() {
    const T = this.T;
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const g = canvas.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,216,77,1)");
    grad.addColorStop(1, "rgba(255,216,77,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const glowTex = new T.CanvasTexture(canvas);
    this.art = {};
    Object.entries(this.ARTIFACTS).forEach(([id, a]) => {
      const x = colX(a.c);
      const y = this.floorOf(a.layer) + 0.55;
      const mesh = this.box(
        0.62,
        0.62,
        0.62,
        a.decoy ? "#cbb998" : "#efe0b8",
        x,
        y,
        ZT,
        null,
        { emissive: "#ffd84d", emissiveIntensity: 0 }
      );
      const ghost = new T.Mesh(
        new T.BoxGeometry(0.7, 0.7, 0.7),
        new T.MeshBasicMaterial({
          color: a.decoy ? "#9bb8d6" : "#7fd3ff",
          wireframe: true,
          transparent: true,
          opacity: a.decoy ? 0.35 : 0.75,
          depthTest: false
        })
      );
      ghost.position.set(x, y, ZT);
      ghost.renderOrder = 999;
      this.scene.add(ghost);
      const glow = new T.Sprite(
        new T.SpriteMaterial({
          map: glowTex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: T.AdditiveBlending
        })
      );
      glow.scale.set(2.6, 2.6, 1);
      glow.position.set(x, y, ZT + 0.4);
      this.scene.add(glow);
      this.art[id] = { ...a, x, y, mesh, ghost, glow };
    });
  }

  buildCrew() {
    Object.entries(CREW).forEach(([k, o]) => {
      this.chars[k] = this.makeChar(k, o);
    });
  }

  makeChar(k, o) {
    const T = this.T;
    const root = new T.Group();
    root.userData.k = k;
    const add = (w, h, d, c, x, y, z, parent) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), this.mat(c));
      m.position.set(x, y, z);
      m.castShadow = true;
      m.userData.k = k;
      (parent ?? root).add(m);
      this.charMeshes.push(m);
      return m;
    };
    const pivot = (x, y, z) => {
      const g = new T.Group();
      g.position.set(x, y, z);
      root.add(g);
      return g;
    };
    const legB = pivot(0, 0.72, -0.13);
    const legF = pivot(0, 0.72, 0.13);
    [legB, legF].forEach((L) => {
      add(0.24, 0.7, 0.24, o.pants, 0, -0.35, 0, L);
      add(0.32, 0.12, 0.27, "#2b1d14", 0.04, -0.68, 0, L);
    });
    add(0.34, 0.62, 0.52, o.shirt, 0, 1.03, 0);
    if (o.pack) add(0.2, 0.46, 0.42, o.pack, -0.28, 1.05, 0);
    add(0.42, 0.42, 0.42, o.skin, 0, 1.55, 0);
    add(0.03, 0.07, 0.07, "#1a120c", 0.215, 1.6, 0.1);
    add(0.03, 0.07, 0.07, "#1a120c", 0.215, 1.6, -0.1);
    add(0.02, 0.03, 0.14, "#7a3a2a", 0.215, 1.45, 0);
    const hats = {
      brim: () => {
        add(0.74, 0.06, 0.74, "#cdb37a", 0, 1.79, 0);
        add(0.42, 0.22, 0.42, "#d8c08a", 0, 1.92, 0);
        add(0.43, 0.05, 0.43, "#8b5a2b", 0, 1.84, 0);
      },
      cap: () => {
        add(0.45, 0.14, 0.45, "#e2b33c", 0, 1.83, 0);
        add(0.24, 0.04, 0.38, "#c99a24", 0.32, 1.78, 0);
      },
      hair: () => {
        add(0.46, 0.14, 0.46, "#2a1a10", -0.01, 1.82, 0);
        add(0.16, 0.12, 0.16, "#2a1a10", 0, 1.94, 0.1);
      },
      beanie: () => {
        add(0.46, 0.22, 0.46, "#2f4f4f", 0, 1.86, 0);
        add(0.14, 0.14, 0.14, "#2f4f4f", 0, 2.04, 0);
      },
      bun: () => {
        add(0.46, 0.13, 0.46, "#1a1210", -0.02, 1.82, 0);
        add(0.2, 0.2, 0.2, "#1a1210", -0.3, 1.74, 0);
        add(0.03, 0.08, 0.36, "#1a120c", 0.225, 1.6, 0);
      }
    };
    hats[o.hat]?.();
    const armB = pivot(0, 1.28, -0.35);
    const armF = pivot(0, 1.28, 0.35);
    [armB, armF].forEach((A, j) => {
      add(0.16, 0.58, 0.16, j ? o.shirt : o.shirtD, 0, -0.29, 0, A);
      add(0.17, 0.14, 0.17, o.skin, 0, -0.63, 0, A);
    });
    if (o.tool === "pick") {
      add(0.06, 0.7, 0.06, "#6b4a2b", 0, -0.95, 0, armF);
      add(0.44, 0.08, 0.08, "#9aa3ad", 0, -1.28, 0, armF);
    }
    if (o.tool === "clip")
      add(0.28, 0.36, 0.05, "#c9b38a", 0.12, -0.6, 0.06, armF);
    if (o.tool === "rod") {
      add(0.05, 1.1, 0.05, "#f2f2f2", 0.05, -0.2, 0, armF);
      add(0.055, 0.3, 0.055, "#ff6a3d", 0.05, 0.2, 0, armF);
    }
    const carry = add(0.05, 0.3, 0.4, "#fbf6ea", 0.16, -0.62, -0.1, armF);
    carry.visible = false;
    root.scale.setScalar(o.s ?? 1);
    this.scene.add(root);
    return {
      k,
      root,
      legF,
      legB,
      armF,
      armB,
      carry,
      home: o,
      x: o.x,
      y: SURF,
      z: o.z,
      face: o.face,
      state: o.state ?? "idle",
      s: o.s ?? 1
    };
  }

  buildLabels() {
    const make = (tag, cls, text) => {
      const el = document.createElement(tag);
      el.className = cls;
      if (text !== undefined) el.textContent = text;
      this.labelsEl.appendChild(el);
      return el;
    };
    Object.entries(AGENTS).forEach(([k, a]) => {
      const tag = make("button", "tag3");
      tag.type = "button";
      tag.style.setProperty("--c", a.color);
      tag.setAttribute("aria-label", `Chat with ${a.name}, ${a.role}`);
      const name = document.createElement("span");
      name.textContent = a.name;
      const verb = document.createElement("small");
      verb.textContent = "ready";
      tag.append(name, verb);
      tag.addEventListener("click", () => this.onAgentClick?.(k));
      this.labels[`tag_${k}`] = tag;
      this.labels[`verb_${k}`] = verb;
      const bubble = make("div", "bub3");
      bubble.hidden = true;
      this.labels[`bub_${k}`] = bubble;
    });
    this.LAYERS.forEach((l) => {
      const el = make("div", "layer3");
      const title = document.createElement("span");
      title.textContent = l.label;
      const count = document.createElement("small");
      el.append(title, count);
      this.labels[`layer_${l.k}`] = count;
      this.labels[`layerEl_${l.k}`] = el;
    });
    this.FLAGS.forEach(([name], i) => {
      const el = make("div", "flag3", name);
      el.hidden = true;
      this.labels[`flag_${i}`] = el;
    });
    Object.entries(this.ARTIFACTS).forEach(([id, a]) => {
      const el = make("div", a.decoy ? "art3 decoy" : "art3");
      const icon = document.createElement("b");
      icon.textContent = a.icon;
      el.append(icon, document.createTextNode(a.title));
      el.hidden = true;
      this.labels[`art_${id}`] = el;
    });
    this.labels.pin = make("div", "pin3");
    this.labels.pin.hidden = true;
    this.setLayerCounts();
  }

  bindInput() {
    const T = this.T;
    const canvas = this.renderer.domElement;
    const ray = new T.Raycaster();
    const ndc = new T.Vector2();
    let down = null;
    let moved = false;
    const hit = (e) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      ray.setFromCamera(ndc, this.cam);
      return ray.intersectObjects(this.charMeshes, false)[0];
    };
    canvas.addEventListener("pointerdown", (e) => {
      down = { x: e.clientX, yaw: this.yaw };
      moved = false;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (down) {
        const dx = e.clientX - down.x;
        if (Math.abs(dx) > 4) moved = true;
        this.yaw = Math.max(-0.7, Math.min(0.7, down.yaw - dx * 0.004));
      }
      canvas.style.cursor = hit(e) ? "pointer" : down ? "grabbing" : "grab";
    });
    canvas.addEventListener("pointerup", (e) => {
      if (down && !moved) {
        const h = hit(e);
        if (h) this.onAgentClick?.(h.object.userData.k);
      }
      down = null;
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.focusZoom = Math.max(
          0.6,
          Math.min(3, this.focusZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
        );
        if (!this.focusRef) this.focusRef = this.camT.clone();
      },
      { passive: false }
    );
  }

  /* ---------- world state ---------- */

  vIdx(c, r, d) {
    return (c * ROWS + r) * 2 + d;
  }

  resetWorld() {
    const T = this.T;
    const m4 = new T.Matrix4();
    const zero = new T.Matrix4().makeScale(0, 0, 0);
    this.removed.clear();
    this.popping.length = 0;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        for (let d = 0; d < 2; d++) {
          m4.makeTranslation(colX(c), -r - 0.5, 3.5 + d);
          this.voxels.setMatrixAt(this.vIdx(c, r, d), m4);
        }
        this.backing.setMatrixAt(c * ROWS + r, zero);
      }
    }
    this.voxels.instanceMatrix.needsUpdate = true;
    this.voxels.instanceColor.needsUpdate = true;
    this.backing.instanceMatrix.needsUpdate = true;
    for (let r = 0; r < ROWS; r++) this.removeVoxel(4, r, false);
    this.LAYERS.forEach((l) => {
      this.extent[l.k] = { lo: SX, hi: SX };
    });
    this.found.clear();
    this.flash.clear();
    Object.values(this.art).forEach((a) => {
      a.ghost.visible = this.xray;
      a.glow.material.opacity = 0;
      a.mesh.material.emissiveIntensity = 0;
      a.mesh.position.z = ZT;
      a.mesh.rotation.y = 0;
    });
    this.flagsOn.clear();
    this.flags.forEach((f) => f.scale.set(0.001, 0.001, 0.001));
    this.FLAGS.forEach((f, i) => {
      this.labels[`flag_${i}`].hidden = true;
    });
    while (this.mini.children.length) this.mini.remove(this.mini.children[0]);
    this.bucket.position.y = BUCKET_REST;
    this.bucketCard.visible = false;
    Object.values(this.chars).forEach((c) => {
      Object.assign(c, {
        x: c.home.x,
        y: SURF,
        z: c.home.z,
        face: c.home.face,
        state: c.home.state ?? "idle",
        carve: null
      });
      c.carry.visible = false;
      this.unsay(c.k);
    });
    this.unpin();
  }

  removeVoxel(c, r, animate) {
    const key = c * ROWS + r;
    if (this.removed.has(key)) return;
    this.removed.add(key);
    const T = this.T;
    this.backing.setMatrixAt(
      key,
      new T.Matrix4().makeTranslation(colX(c), -r - 0.5, 3.01)
    );
    this.backing.instanceMatrix.needsUpdate = true;
    if (animate && !this.reduce) {
      this.popping.push({ c, r, t: 0 });
      if (Math.random() < 0.6) this.dust(colX(c), -r - 0.5, 4.6, 2);
    } else {
      const zero = new T.Matrix4().makeScale(0, 0, 0);
      this.voxels.setMatrixAt(this.vIdx(c, r, 0), zero);
      this.voxels.setMatrixAt(this.vIdx(c, r, 1), zero);
      this.voxels.instanceMatrix.needsUpdate = true;
    }
  }

  /** Extends the tunnel in a layer so it reaches x. */
  carve(layer, x, animate) {
    const e = this.extent[layer];
    if (x > e.hi) e.hi = x;
    if (x < e.lo) e.lo = x;
    for (let c = 0; c < COLS; c++) {
      const cx = colX(c);
      if (cx >= e.lo - 0.01 && cx <= e.hi + 0.01) {
        this.layerByKey[layer].rows.forEach((r) =>
          this.removeVoxel(c, r, animate)
        );
      }
    }
  }

  reveal(id, instant) {
    const a = this.art[id];
    this.found.add(id);
    a.ghost.visible = false;
    a.mesh.position.z = ZT + 0.25;
    if (!instant) {
      this.flash.add(id);
      this.dust(a.x, a.y, ZT + 0.6, 14);
      setTimeout(() => this.flash.delete(id), 1000);
    }
  }

  showFlag(i, instant) {
    this.flagsOn.add(i);
    this.labels[`flag_${i}`].hidden = false;
    if (!instant) this.dust(this.FLAGS[i][1], SURF, ZF, 4);
  }

  addMiniCard() {
    const m = this.mini.children.length;
    const card = new this.T.Mesh(
      new this.T.BoxGeometry(0.7, 0.45, 0.03),
      this.mat("#fbf6ea")
    );
    card.position.set(
      -0.95 + (m % 3) * 0.95,
      0.55 - Math.floor(m / 3) * 0.6,
      0
    );
    card.rotation.z = m % 2 ? 0.05 : -0.05;
    this.mini.add(card);
  }

  dust(x, y, z, n) {
    if (this.reduce) return;
    for (let i = 0; i < n; i++) {
      const p = this.dustPool.find((d) => d.life <= 0);
      if (!p) return;
      p.life = 1;
      p.m.visible = true;
      p.m.position.set(x, y, z);
      p.v.set(
        (Math.random() - 0.5) * 3,
        1.5 + Math.random() * 2.5,
        Math.random() * 2
      );
    }
  }

  say(k, text) {
    const b = this.labels[`bub_${k}`];
    b.textContent = text;
    b.dataset.text = text;
    b.hidden = false;
  }

  unsay(k, text) {
    const b = this.labels[`bub_${k}`];
    if (!text || b.dataset.text === text) b.hidden = true;
  }

  pin(id, text) {
    this.pinTarget = id;
    this.labels.pin.textContent = text;
    this.labels.pin.hidden = false;
  }

  unpin() {
    this.pinTarget = null;
    this.labels.pin.hidden = true;
  }

  setChatting(k) {
    Object.keys(AGENTS).forEach((key) =>
      this.labels[`tag_${key}`].classList.toggle("chatting", key === k)
    );
  }

  /** Layer labels show the real counts from the org's index. */
  setLayerCounts() {
    this.LAYERS.forEach((l) => {
      this.labels[`layer_${l.k}`].textContent =
        l.k === "now" ? `${l.count} objects` : `${l.count} components`;
    });
  }

  setXray(on) {
    this.xray = on;
    Object.entries(this.art).forEach(([id, a]) => {
      a.ghost.visible = on && !this.found.has(id);
    });
  }

  /** ref: crew key, a [x, y, z] point, or null for the overview. */
  focus(ref, zoom = 1) {
    this.focusRef =
      typeof ref === "string"
        ? this.chars[ref]
        : ref
          ? new this.T.Vector3(...ref)
          : null;
    this.focusZoom = zoom;
  }

  overview() {
    this.yaw = 0;
    this.follow = true;
    this.focus(null, 1);
  }

  /** p: 0 (morning) → 1 (night). Returns the CSS sky gradient. */
  setSky(p) {
    let i = 0;
    while (i < SKY.length - 2 && p > SKY[i + 1][0]) i++;
    const [a, topA, botA] = SKY[i];
    const [b, topB, botB] = SKY[i + 1];
    const k = Math.min(1, Math.max(0, (p - a) / (b - a)));
    this.night = Math.max(0, (p - 0.8) / 0.2);
    const dusk = Math.max(0, (p - 0.55) / 0.3);
    const ang = Math.PI * Math.min(1, p / 0.9);
    this.sun.position.set(-30 * Math.cos(ang), 8 + 34 * Math.sin(ang), 24);
    this.sun.color.set(
      this.night > 0
        ? mixHex("#ff9a5a", "#7d8cff", this.night)
        : mixHex("#ffffff", "#ffb27a", Math.min(1, dusk))
    );
    this.sun.intensity = lerp(0.95, 0.28, this.night);
    this.hemi.intensity = lerp(0.62, 0.32, this.night);
    this.hemi.color.set(mixHex("#e6f2ff", "#5a68b0", this.night));
    this.stars.material.opacity = this.night;
    const lampK = Math.max(0, (p - 0.6) / 0.4);
    this.lamps.forEach((L, j) => {
      L.intensity =
        j < 3 ? 1.6 * lampK : Math.max(p > 0.3 ? 0.6 : 0, 1.2 * lampK);
    });
    const sky = `linear-gradient(${mixHex(topA, topB, k)}, ${mixHex(botA, botB, k)})`;
    this.host.style.background = sky;
    return sky;
  }

  /* ---------- per frame ---------- */

  frame(now) {
    const T = this.T;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = now / 1000;
    const w = 9 * this.speed;
    Object.values(this.chars).forEach((c) => {
      let lf = 0;
      let lb = 0;
      let af = 0.08;
      let ab = -0.08;
      let bob = 0;
      let rotY = c.face > 0 ? -0.5 : Math.PI + 0.5;
      if (c.state === "walk") {
        const s = Math.sin(t * w);
        lf = 0.55 * s;
        lb = -lf;
        af = -0.45 * s;
        ab = -af;
        bob = Math.abs(Math.cos(t * w)) * 0.05;
      } else if (c.state === "run") {
        const s = Math.sin(t * w * 1.4);
        lf = 0.8 * s;
        lb = -lf;
        af = 1.2;
        ab = 1.1;
        bob = Math.abs(Math.cos(t * w * 1.4)) * 0.08;
      } else if (c.state === "climb") {
        const s = Math.sin(t * w * 0.8);
        lf = 0.4 * s;
        lb = -lf;
        af = 2.9 + 0.2 * s;
        ab = 2.9 - 0.2 * s;
        rotY = Math.PI / 2;
      } else if (c.state === "dig") {
        const s = Math.max(0, Math.sin(t * 8 * this.speed));
        af = 2.7 - 2.4 * s;
        ab = 0.7;
        lf = 0.25;
        lb = -0.2;
        if (s > 0.97 && (!c.lastHit || t - c.lastHit > 0.4)) {
          c.lastHit = t;
          this.dust(c.x + 0.9 * c.face, c.y + 0.3, ZT + 0.3, 5);
        }
      } else if (c.state === "point") {
        af = 1.55;
        ab = 0.1;
      } else if (c.state === "cross") {
        af = 1.05;
        ab = 1.05;
      } else {
        bob = Math.sin(t * 2) * 0.012;
      }
      c.legF.rotation.z = lf;
      c.legB.rotation.z = lb;
      c.armF.rotation.z = af;
      c.armB.rotation.z = ab;
      c.root.position.set(c.x, c.y + bob, c.z);
      c.root.rotation.y += (rotY - c.root.rotation.y) * Math.min(1, dt * 10);
      if (c.carve)
        this.carve(c.carve, c.x + 0.6 * Math.sign(c.dirX || 1), true);
    });
    // block pops
    const m4 = new T.Matrix4();
    const q = new T.Quaternion();
    for (let i = this.popping.length - 1; i >= 0; i--) {
      const p = this.popping[i];
      p.t += dt * 4 * this.speed;
      const s = Math.max(0, 1 - p.t);
      for (let d = 0; d < 2; d++) {
        m4.compose(
          new T.Vector3(colX(p.c), -p.r - 0.5 + p.t * 0.3, 3.5 + d + p.t * 0.6),
          q,
          new T.Vector3(s, s, s)
        );
        this.voxels.setMatrixAt(this.vIdx(p.c, p.r, d), m4);
      }
      this.voxels.instanceMatrix.needsUpdate = true;
      if (p.t >= 1) this.popping.splice(i, 1);
    }
    this.dustPool.forEach((p) => {
      if (p.life <= 0) return;
      p.life -= dt * 1.3;
      p.v.y -= 9 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += dt * 4;
      if (p.life <= 0) p.m.visible = false;
    });
    this.found.forEach((id) => {
      const a = this.art[id];
      a.glow.material.opacity = lerp(
        a.glow.material.opacity,
        this.flash.has(id) ? 1 : 0.45,
        dt * 3
      );
      a.mesh.material.emissiveIntensity = 0.35 + Math.sin(t * 3) * 0.15;
      a.mesh.rotation.y += dt * 0.8;
    });
    const top = SURF + 1.85;
    const by = this.bucket.position.y + 0.15;
    this.rope.scale.y = Math.max(0.01, top - by);
    this.rope.position.y = (top + by) / 2;
    this.flags.forEach((f, i) => {
      const s = this.flagsOn.has(i)
        ? Math.min(1, (f.scale.x || 0) + dt * 4)
        : 0.001;
      f.scale.set(s, s, s);
    });
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.cam);
    this.updateLabels();
  }

  updateCamera(dt) {
    const T = this.T;
    const fh = this.fitH();
    if (this.follow) {
      if (this.focusRef?.root)
        this.camWant = new T.Vector3(
          this.focusRef.x,
          this.focusRef.y + 0.8,
          this.focusRef.z
        );
      else if (this.focusRef) this.camWant = this.focusRef;
      else this.camWant = new T.Vector3(0, -4.3, 0.5);
      this.camWantH =
        fh / (this.focusRef ? this.focusZoom : this.focusZoom || 1);
    }
    const k = 1 - Math.exp(-2.4 * dt);
    this.camT.lerp(this.camWant, k);
    this.camH += ((this.camWantH ?? fh) - this.camH) * k;
    const aspect = (this.host.clientWidth || 1) / (this.host.clientHeight || 1);
    Object.assign(this.cam, {
      left: (-this.camH * aspect) / 2,
      right: (this.camH * aspect) / 2,
      top: this.camH / 2,
      bottom: -this.camH / 2
    });
    this.cam.updateProjectionMatrix();
    const off = new T.Vector3(
      Math.sin(Math.PI / 4 + this.yaw),
      0.82,
      Math.cos(Math.PI / 4 + this.yaw)
    ).normalize();
    this.cam.position.copy(this.camT).addScaledVector(off, 80);
    this.cam.lookAt(this.camT);
  }

  project(x, y, z) {
    this.tmp.set(x, y, z).project(this.cam);
    return [
      (this.tmp.x * 0.5 + 0.5) * this.host.clientWidth,
      (-this.tmp.y * 0.5 + 0.5) * this.host.clientHeight
    ];
  }

  place(el, x, y, z, ax = "-50%", ay = "-100%") {
    if (!el || el.hidden) return;
    const [sx, sy] = this.project(x, y, z);
    el.style.transform = `translate(${sx}px, ${sy}px) translate(${ax}, ${ay})`;
  }

  /**
   * Pushes overlapping labels upward until none overlap.
   * items: [{sx, sy, w, h}] in screen px, anchored bottom-centre. Mutates sy.
   */
  declutter(items, gap = 4) {
    items.sort((a, b) => b.sy - a.sy);
    for (let pass = 0; pass < 6; pass++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = items[i];
          const b = items[j];
          const overlapX = Math.abs(a.sx - b.sx) < (a.w + b.w) / 2 + gap;
          const overlapY = a.sy > b.sy - b.h - gap && a.sy - a.h < b.sy + gap;
          if (overlapX && overlapY && !(a.fixed && b.fixed)) {
            if (a.fixed) b.sy = a.sy - a.h - gap;
            else a.sy = b.sy - b.h - gap;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return items;
  }

  /** Width/height of a label, measured once per content change. */
  size(el) {
    const key = el.textContent;
    if (el._sizeKey !== key || !el._w) {
      el._w = el.offsetWidth || 80;
      el._h = el.offsetHeight || 22;
      el._sizeKey = key;
    }
    return [el._w, el._h];
  }

  updateLabels() {
    // crew tags first: they win any overlap
    const tags = Object.values(this.chars).map((c) => {
      const [sx, sy] = this.project(c.x, c.y + 2.25 * c.s, c.z);
      this.labels[`verb_${c.k}`].textContent = VERBS[c.state] ?? "ready";
      const [w, h] = this.size(this.labels[`tag_${c.k}`]);
      return { k: c.k, sx, sy, w, h };
    });
    this.declutter(tags);
    tags.forEach((o) => {
      this.labels[`tag_${o.k}`].style.transform =
        `translate(${o.sx}px, ${o.sy}px) translate(-50%, -100%)`;
      const b = this.labels[`bub_${o.k}`];
      if (!b.hidden)
        b.style.transform = `translate(${o.sx}px, ${o.sy - o.h - 8}px) translate(-50%, -100%)`;
    });
    this.LAYERS.forEach((l) =>
      this.place(
        this.labels[`layerEl_${l.k}`],
        -12.2,
        -(l.rows[0] + 1),
        5,
        "-100%",
        "-50%"
      )
    );
    // flags and artifact labels: decluttered among themselves, and kept off the crew tags
    const others = [];
    this.FLAGS.forEach(([, x], i) => {
      const el = this.labels[`flag_${i}`];
      if (el.hidden) return;
      const [sx, sy] = this.project(x, SURF + 1.25, ZF);
      const [w, h] = this.size(el);
      others.push({ el, sx, sy, w, h });
    });
    Object.entries(this.art).forEach(([id, a]) => {
      const el = this.labels[`art_${id}`];
      el.hidden = !(this.found.has(id) || (a.decoy && this.xray));
      if (el.hidden) return;
      const [sx, sy] = this.project(a.x, a.y + 0.55, ZT + 0.5);
      const [w, h] = this.size(el);
      others.push({ el, sx, sy, w, h });
    });
    const fixed = tags.map((t) => ({ ...t, fixed: true }));
    const all = this.declutter([...fixed, ...others]);
    all.forEach((o) => {
      if (!o.fixed)
        o.el.style.transform = `translate(${o.sx}px, ${o.sy}px) translate(-50%, -100%)`;
    });
    if (this.pinTarget) {
      const a = this.art[this.pinTarget];
      this.place(this.labels.pin, a.x, a.y + 1.25, ZT + 0.5);
    }
  }
}
