import * as THREE from "three";
import * as TX from "./textures";
import { AudioEngine } from "./audio";

const ROOM_HALF = 5; // half-width (X) and half-depth (Z) of a single room
const ROOM_DEPTH = ROOM_HALF * 2;
const EYE_HEIGHT = 1.65;
const DOOR_HALF_WIDTH = 0.65;
const DOOR_HEIGHT = 2.3;

// Three.js (since r155) uses physically-based light units: PointLight
// intensity is candela, so small numbers are nearly invisible at
// room-scale distances. Theme palettes specify a friendly 0-2 "brightness
// dial" and these constants convert that into real candela/lux values.
const POINT_LIGHT_SCALE = 30;
const AMBIENT_LIGHT_SCALE = 1.6;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function freshRoomState() {
  return {
    readNote: false,
    hasTool: false,
    crateOpened: false,
    hasFuse: false,
    paintingMoved: false,
    safeOpen: false,
    hasSmallKey: false,
    lockboxOpen: false,
    hasKey: false,
    doorOpen: false,
  };
}

export class EscapeRoomGame {
  // `plan` is the randomized layout (see lib/roomPlan.js) — generated once
  // by whoever starts the game (solo player, or a multiplayer host) so a
  // replay of the same theme gets different codes, tools, and hiding
  // spots, and so every player in a shared room sees the identical layout.
  constructor(container, theme, callbacks, network = null, plan = null) {
    this.container = container;
    this.theme = theme;
    this.plan = plan;
    this.cb = callbacks;
    this.audio = new AudioEngine();
    this.network = network;
    this.remotePlayers = new Map();
    this.lastMoveSent = 0;
    if (this.network) {
      this.network.onMessage = (msg) => this._onNetworkMessage(msg);
    }

    this.keys = {};
    this.velocity = new THREE.Vector3();
    this.playerRadius = 0.35;
    this.bobPhase = 0;

    this.isLocked = false;
    this.modalOpen = false;
    this.hovered = null;
    this.tweens = [];
    this.raf = null;
    this.clock = new THREE.Clock();
    this.time = 0;
    this.ambianceTimer = 0;
    this.flickerLights = [];

    this.rooms = [];
    this.inventoryItems = [];
    this.keypadDigits = null; // { roomIndex, digits } while a keypad is open
    this.startTime = null;
    this.won = false;
    this._currentRoomIndex = -1;

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onClickCanvas = this._onClickCanvas.bind(this);
    this._animate = this._animate.bind(this);
  }

  start() {
    this._buildScene();
    this._addEvents();
    this.startTime = performance.now();
    this._animate();
  }

  _addEvents() {
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    window.addEventListener("resize", this._onResize);
    this.renderer.domElement.addEventListener("click", this._onClickCanvas);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    window.removeEventListener("resize", this._onResize);
    if (this.renderer) {
      this.renderer.domElement.removeEventListener("click", this._onClickCanvas);
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    if (document.pointerLockElement === this.renderer?.domElement) {
      document.exitPointerLock();
    }
    if (this.network) this.network.onMessage = null;
    for (const id of Array.from(this.remotePlayers.keys())) this._removeAvatar(id);
  }

  lock() {
    // Sound is off: audio.init() is intentionally never called, so every
    // AudioEngine method's `if (!this.ctx) return;` guard makes it a no-op.
    this.renderer.domElement.requestPointerLock();
  }

  _onClickCanvas() {
    if (!this.isLocked && !this.modalOpen) this.lock();
  }

  _onPointerLockChange() {
    this.isLocked = document.pointerLockElement === this.renderer.domElement;
    this.cb.onLockChange(this.isLocked);
  }

  _onMouseMove(e) {
    if (!this.isLocked) return;
    const sensitivity = 0.0022;
    this.yawObject.rotation.y -= e.movementX * sensitivity;
    this.pitchObject.rotation.x -= e.movementY * sensitivity;
    const maxPitch = Math.PI / 2 - 0.05;
    this.pitchObject.rotation.x = Math.max(
      -maxPitch,
      Math.min(maxPitch, this.pitchObject.rotation.x)
    );
  }

  _onKeyDown(e) {
    this.keys[e.code] = true;
    if (this.isLocked && e.code.startsWith("Arrow")) e.preventDefault();
    if (e.code === "KeyE" && this.isLocked && this.hovered) {
      this.hovered.onInteract();
    }
    if (e.code === "KeyH" && this.isLocked) {
      this.showHint();
    }
  }

  _onKeyUp(e) {
    this.keys[e.code] = false;
  }

  _onResize() {
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  roomOffsetZ(i) {
    return -i * ROOM_DEPTH;
  }

  getCurrentRoomIndex() {
    const n = this.rooms.length;
    const idx = Math.round(-this.yawObject.position.z / ROOM_DEPTH);
    return Math.min(n - 1, Math.max(0, idx));
  }

  // ---------- scene construction ----------

  _buildScene() {
    const theme = this.theme;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(theme.palette.fog, 6, 18);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.05,
      100
    );
    this.camera = camera;

    this.pitchObject = new THREE.Object3D();
    this.pitchObject.add(camera);

    this.yawObject = new THREE.Object3D();
    this.yawObject.position.set(0, EYE_HEIGHT, 3.6);
    this.yawObject.add(this.pitchObject);
    scene.add(this.yawObject);

    // No MSAA and a capped pixel ratio: with several real-time point lights
    // per room, antialiasing was the single biggest GPU cost and caused
    // visible frame drops on anything but a high-end GPU.
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.5;
    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);

    // lighting — one set per room, added as each room is built below.
    scene.add(
      new THREE.AmbientLight(theme.palette.ambient, theme.palette.ambientIntensity * AMBIENT_LIGHT_SCALE)
    );

    this._buildAmbiance();

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 3.2;
    this.colliders = [];

    const n = this.plan.rooms.length;
    this._buildLevelShell(n);
    this.rooms = [];
    for (let i = 0; i < n; i++) {
      const room = {
        index: i,
        offsetZ: this.roomOffsetZ(i),
        plan: this.plan.rooms[i],
        isFinal: i === n - 1,
        ...freshRoomState(),
      };
      this.rooms.push(room);
      this._buildRoomLighting(room);
      this._buildDoorway(room);
      this._buildDesk(room);
      this._buildRackAndCrate(room);
      this._buildFuse(room);
      this._buildPaintingAndSafe(room);
      this._buildLockbox(room);
      this._buildDecor(room);
      this._buildArchitecture(room);
      if (i === 0) this._buildFragmentPlaque(room);
    }
    this._buildSouthWall();

    // Note: safes and keys are deliberately left out here. Three.js's
    // Raycaster.intersectObjects does not check mesh.visible at all, so a
    // hidden-but-present mesh is still perfectly interactable — including
    // one it should be *impossible* to reach yet. Objects that aren't
    // available from the start are added/removed from this array instead,
    // which is the only thing that actually gates what the raycaster can
    // hit. Rooms beyond the first are also physically unreachable at
    // first (locked doors + distance), but the same rule still applies.
    this.interactables = [];
    for (const room of this.rooms) {
      this.interactables.push(
        room.noteInteractable,
        room.crateInteractable,
        room.toolInteractable,
        room.fuseInteractable,
        room.paintingInteractable,
        room.lockboxInteractable,
        room.doorInteractable
      );
    }
    this.interactables = this.interactables.filter(Boolean);

    this.cb.onInventory([]);
    this._reportRoom(true);
  }

  _buildLevelShell(n) {
    const theme = this.theme;
    const texFns = {
      panelWallTexture: () => TX.panelWallTexture(theme.wall.base, theme.wall.accent),
      rockWallTexture: () => TX.rockWallTexture(theme.wall.base),
      stoneWallTexture: () => TX.stoneWallTexture(theme.wall.base),
      wallTexture: () => TX.wallTexture(theme.wall.base),
    };
    const floorFns = {
      floorTexture: () => TX.floorTexture(theme.floor.base),
      metalFloorTexture: () => TX.metalFloorTexture(theme.floor.base),
      rockFloorTexture: () => TX.rockFloorTexture(theme.floor.base),
      stoneFloorTexture: () => TX.stoneFloorTexture(theme.floor.base),
    };

    const totalLength = ROOM_DEPTH * n;
    this.levelMaxZ = ROOM_HALF; // room 0's south (spawn) wall
    this.levelMinZ = this.roomOffsetZ(n - 1) - ROOM_HALF; // last room's far wall
    const centerZ = (this.levelMinZ + this.levelMaxZ) / 2;

    const floorTex = floorFns[theme.floor.fn]();
    floorTex.repeat.y *= n;
    const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, totalLength), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, centerZ);
    this.scene.add(floor);

    const ceilMat = new THREE.MeshLambertMaterial({ map: TX.ceilingTexture(theme.ceiling.base) });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, totalLength), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, 3.2, centerZ);
    this.scene.add(ceiling);

    const wallTex = texFns[theme.wall.fn]();
    wallTex.repeat.y *= n;
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
    const wallGeo = new THREE.PlaneGeometry(totalLength, 3.2);

    const east = new THREE.Mesh(wallGeo, wallMat);
    east.position.set(ROOM_HALF, 1.6, centerZ);
    east.rotation.y = -Math.PI / 2;
    this.scene.add(east);

    const west = new THREE.Mesh(wallGeo, wallMat);
    west.position.set(-ROOM_HALF, 1.6, centerZ);
    west.rotation.y = Math.PI / 2;
    this.scene.add(west);

    this._doorwayWallMat = new THREE.MeshLambertMaterial({ map: texFns[theme.wall.fn]() });
  }

  _buildSouthWall() {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, 3.2), this._doorwayWallMat);
    wall.position.set(0, 1.6, this.levelMaxZ);
    wall.rotation.y = Math.PI;
    this.scene.add(wall);
    this._addCollider(-ROOM_HALF, ROOM_HALF, this.levelMaxZ - 0.1, this.levelMaxZ + 0.1);
  }

  _buildRoomLighting(room) {
    const theme = this.theme;
    const oz = room.offsetZ;
    const [lx, ly, lz] = theme.lampPosition || [-3.6, 1.9, -1];
    room.lamp = this._addFlickerLight(
      theme.palette.lampColor,
      theme.palette.lampIntensity * POINT_LIGHT_SCALE,
      lx,
      ly,
      lz + oz
    );

    const fill = new THREE.PointLight(theme.palette.fillColor, theme.palette.fillIntensity * POINT_LIGHT_SCALE, 12, 2);
    fill.position.set(0, 2.7, 1 + oz);
    this.scene.add(fill);
    room.fill = fill;
    if (room.index === 0) this._fillBaseIntensity = fill.intensity;

    const glow = new THREE.PointLight(theme.palette.glowColor, theme.palette.glowIntensity * POINT_LIGHT_SCALE, 14, 2);
    glow.position.set(0, 3.0, -2 + oz);
    this.scene.add(glow);
  }

  _addFlickerLight(color, intensity, x, y, z) {
    const light = new THREE.PointLight(color, intensity, 9, 2);
    light.position.set(x, y, z);
    light._base = intensity;
    light._seed = Math.random() * 100;
    this.scene.add(light);
    this.flickerLights.push(light);
    return light;
  }

  _buildAmbiance() {
    const theme = this.theme;
    if (theme.ambiance === "headlamp") {
      const spot = new THREE.SpotLight(0xfff2d0, 80, 9, Math.PI / 6.5, 0.5, 1.4);
      spot.position.set(0, 0, 0.1);
      const target = new THREE.Object3D();
      target.position.set(0, 0, -1);
      this.camera.add(spot);
      this.camera.add(target);
      spot.target = target;
    }
  }

  // Per-room structural detail (windows, portholes, beams, an arch) —
  // repeated in every room of the theme so each one reads as the same
  // kind of place, not just a reskinned box.
  _buildArchitecture(room) {
    const id = this.theme.id;
    if (id === "train") this._buildTrainWindows(room);
    else if (id === "mine") this._buildMineBeams(room);
    else if (id === "submarine") this._buildSubmarineFittings(room);
    else if (id === "castle") this._buildCastleArch(room);
    if (this.theme.ambiance === "torches") {
      const intensity = this.theme.palette.lampIntensity * POINT_LIGHT_SCALE * 0.75;
      this._addFlickerLight(this.theme.palette.lampColor, intensity, 2.0, 1.9, 4.6 + room.offsetZ);
      this._addFlickerLight(this.theme.palette.lampColor, intensity, 4.6, 1.9, 1.5 + room.offsetZ);
    }
  }

  _buildTrainWindows(room) {
    const oz = room.offsetZ;
    const winMat = new THREE.MeshLambertMaterial({ map: TX.trainWindowTexture() });
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x1a1c1e });
    for (const wallX of [-4.96, 4.96]) {
      for (const z of [1.5, -3.3]) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.55), winMat);
        win.position.set(wallX, 2.05, z + oz);
        win.rotation.y = wallX < 0 ? Math.PI / 2 : -Math.PI / 2;
        this.scene.add(win);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.65, 1.42), frameMat);
        frame.position.set(wallX + (wallX < 0 ? -0.01 : 0.01), 2.05, z + oz);
        this.scene.add(frame);
      }
    }
    const railMat = new THREE.MeshLambertMaterial({ color: 0x8a8f94 });
    for (const wallX of [-4.85, 4.85]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 8, 8), railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(wallX, 2.6, oz);
      this.scene.add(rail);
    }
  }

  _buildMineBeams(room) {
    const oz = room.offsetZ;
    const beamMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#3d2b1f") });
    for (const z of [-3, 0, 3]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(10, 0.26, 0.3), beamMat);
      beam.position.set(0, 3.05, z + oz);
      this.scene.add(beam);
    }
    for (const x of [-4.7, 4.7]) {
      for (const z of [-4.7, 4.7]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), beamMat);
        post.position.set(x, 1.6, z + oz);
        this.scene.add(post);
        this._addCollider(x - 0.18, x + 0.18, z + oz - 0.18, z + oz + 0.18);
      }
    }
  }

  _buildSubmarineFittings(room) {
    const oz = room.offsetZ;
    const rimMat = new THREE.MeshLambertMaterial({ color: 0x8a9296 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x0a2030, emissive: 0x0e3a50, emissiveIntensity: 0.4 });
    for (const z of [1.5, -3.3]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 20), rimMat);
      rim.position.set(-4.95, 1.8, z + oz);
      rim.rotation.y = Math.PI / 2;
      this.scene.add(rim);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), glassMat);
      glass.position.set(-4.93, 1.8, z + oz);
      glass.rotation.y = Math.PI / 2;
      this.scene.add(glass);
    }
    const pipeMat = new THREE.MeshLambertMaterial({ color: 0x5a6266 });
    for (const z of [-2, 2]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 10, 10), pipeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, 3.05, z + oz);
      this.scene.add(pipe);
    }
  }

  _buildCastleArch(room) {
    const oz = room.offsetZ;
    const stoneMat = new THREE.MeshLambertMaterial({ map: TX.stoneWallTexture("#5a554c") });
    const keystone = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.16), stoneMat);
    keystone.position.set(0, 2.5, -4.9 + oz);
    this.scene.add(keystone);
    [-0.75, 0.75].forEach((x) => {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.16), stoneMat);
      support.position.set(x, 2.2, -4.9 + oz);
      this.scene.add(support);
    });

    const slitMat = new THREE.MeshLambertMaterial({ color: 0x0a0806 });
    const glowMat = new THREE.MeshLambertMaterial({ color: 0x3a4a6a, emissive: 0x2a3a5a, emissiveIntensity: 0.5 });
    for (const z of [1.0, -3.3]) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 1.1), glowMat);
      glow.position.set(-4.94, 1.9, z + oz);
      glow.rotation.y = Math.PI / 2;
      this.scene.add(glow);
      const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.9), slitMat);
      slit.position.set(-4.96, 1.9, z + oz);
      slit.rotation.y = Math.PI / 2;
      this.scene.add(slit);
    }

    const rugMat = new THREE.MeshLambertMaterial({ color: 0x5a1f1f });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.6), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-2.6, 0.006, -1.2 + oz);
    this.scene.add(rug);
  }

  _addCollider(minX, maxX, minZ, maxZ) {
    this.colliders.push({ minX, maxX, minZ, maxZ });
  }

  // The wall between this room and the next (or, for the final room, the
  // wall at the far end of the level) with an actual doorway cut into it
  // — two flanking wall segments plus a lintel over the gap, and a real
  // door filling that gap. While locked, the door has its own collider;
  // once unlocked it swings open and that collider is removed, so walking
  // into the next room is real movement, not a scene rebuild.
  _buildDoorway(room) {
    const theme = this.theme;
    const z = room.offsetZ - ROOM_HALF;
    const wallMat = this._doorwayWallMat;

    const segWidth = ROOM_HALF - DOOR_HALF_WIDTH;
    const left = new THREE.Mesh(new THREE.PlaneGeometry(segWidth, 3.2), wallMat);
    left.position.set(-(DOOR_HALF_WIDTH + segWidth / 2), 1.6, z);
    this.scene.add(left);
    this._addCollider(-ROOM_HALF, -DOOR_HALF_WIDTH, z - 0.15, z + 0.15);

    const right = new THREE.Mesh(new THREE.PlaneGeometry(segWidth, 3.2), wallMat);
    right.position.set(DOOR_HALF_WIDTH + segWidth / 2, 1.6, z);
    this.scene.add(right);
    this._addCollider(DOOR_HALF_WIDTH, ROOM_HALF, z - 0.15, z + 0.15);

    const lintelH = 3.2 - DOOR_HEIGHT;
    const lintel = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_HALF_WIDTH * 2, lintelH), wallMat);
    lintel.position.set(0, DOOR_HEIGHT + lintelH / 2, z);
    this.scene.add(lintel);

    const frameMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#2a1c12") });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(DOOR_HALF_WIDTH * 2 + 0.25, DOOR_HEIGHT, 0.12), frameMat);
    frame.position.set(0, DOOR_HEIGHT / 2, z - 0.04);
    this.scene.add(frame);

    const hinge = new THREE.Object3D();
    hinge.position.set(-DOOR_HALF_WIDTH, 0, z);
    this.scene.add(hinge);

    const doorMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#5a3d24") });
    const door = new THREE.Mesh(new THREE.BoxGeometry(DOOR_HALF_WIDTH * 2 - 0.05, DOOR_HEIGHT - 0.05, 0.07), doorMat);
    door.position.set(DOOR_HALF_WIDTH, (DOOR_HEIGHT - 0.05) / 2, 0);
    hinge.add(door);

    const knobMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#d8b34a") });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), knobMat);
    knob.position.set(DOOR_HALF_WIDTH * 2 - 0.15, (DOOR_HEIGHT - 0.05) / 2 - 0.1, 0.06);
    hinge.add(knob);

    room.doorHinge = hinge;
    room.doorCollider = { minX: -DOOR_HALF_WIDTH, maxX: DOOR_HALF_WIDTH, minZ: z - 0.12, maxZ: z + 0.12 };
    this.colliders.push(room.doorCollider);

    room.doorInteractable = {
      mesh: door,
      getPrompt: () => (room.hasKey ? theme.door.unlockPrompt : theme.door.lockedPrompt),
      onInteract: () => {
        if (room.doorOpen) return;
        if (!room.hasKey) {
          this.audio.denied();
          this.cb.onToast(theme.door.lockedText);
          return;
        }
        const elapsed = (performance.now() - this.startTime) / 1000;
        if (room.isFinal) this._winGame(room, elapsed);
        else this._openDoor(room);
      },
    };
  }

  _buildDesk(room) {
    const theme = this.theme;
    const oz = room.offsetZ;
    const woodMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture(theme.desk.woodBase) });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 0.8), woodMat);
    desk.position.set(-4.0, 0.425, -1.2 + oz);
    this.scene.add(desk);
    this._addCollider(-4.0 - 0.85, -4.0 + 0.85, -1.2 + oz - 0.4, -1.2 + oz + 0.4);

    const noteLines = room.isFinal ? theme.finalNoteLines : this._noteLinesFor(room);
    const noteMat = new THREE.MeshLambertMaterial({
      map: TX.noteTexture(noteLines, { bg: theme.note.bg, textColor: theme.note.textColor, font: theme.note.font }),
    });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), noteMat);
    note.rotation.x = -Math.PI / 2;
    note.position.set(-3.75, 0.856, -1.0 + oz);
    this.scene.add(note);

    if (!room.isFinal) {
      const plaqueMat = new THREE.MeshLambertMaterial({
        map: TX.plaqueTexture(room.plan.plaqueValue, theme.plaque),
      });
      const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), plaqueMat);
      plaque.position.set(-4.98, 1.9, -1.2 + oz);
      plaque.rotation.y = Math.PI / 2;
      this.scene.add(plaque);
    }

    room.noteInteractable = {
      mesh: note,
      getPrompt: () => "[E] Read note",
      onInteract: () => {
        room.readNote = true;
        this.audio.click();
        this.cb.onNote(true, noteLines.map((l) => l.trim()));
        document.exitPointerLock();
        this.modalOpen = true;
      },
    };
  }

  _noteLinesFor(room) {
    if (room.plan.puzzleType === "sum") {
      return [
        "OVERRIDE NOTICE",
        "",
        '"Combine the two numbers',
        "you find in this room —",
        "add them together for",
        'the code."',
      ];
    }
    return this.theme.note.lines;
  }

  // The cross-room fragment: only in room 0, and only needed to solve the
  // FINAL room — forcing the player to remember (or walk back to) the
  // first room instead of finding everything they need in one place.
  _buildFragmentPlaque(room) {
    const theme = this.theme;
    const oz = room.offsetZ;
    const mat = new THREE.MeshLambertMaterial({
      map: TX.plaqueTexture(this.plan.crossFragment, {
        title: theme.fragmentPlaqueTitle,
        subtitle: "Override code",
        bg: theme.plaque.bg,
        border: theme.plaque.border,
        textColor: theme.plaque.textColor,
        font: theme.plaque.font,
      }),
    });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), mat);
    plaque.position.set(2.5, 1.9, -4.85 + oz);
    plaque.rotation.y = Math.PI;
    this.scene.add(plaque);
  }

  _buildRackAndCrate(room) {
    const theme = this.theme;
    const oz = room.offsetZ;
    const rackMat = new THREE.MeshLambertMaterial({ map: TX.rackTexture() });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.1, 0.4), rackMat);
    rack.position.set(-1.8, 1.05, 4.75 + oz);
    this.scene.add(rack);
    this._addCollider(-1.8 - 1.3, -1.8 + 1.3, 4.75 + oz - 0.2, 5.0 + oz);

    const crateMat = new THREE.MeshLambertMaterial({ map: TX.crateTexture(theme.crate.base, theme.crate.band) });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.3, 0.5), crateMat);
    crate.position.set(2.2, 0.65, 4.7 + oz);
    this.scene.add(crate);
    this._addCollider(2.2 - 0.7, 2.2 + 0.7, 4.7 + oz - 0.25, 5.0 + oz);

    // Second half of the code, stenciled inside the crate — but the lid's
    // stuck shut until the player finds a tool to pry it with. Hidden
    // (not just "behind a locked prompt") so it can't be read until then.
    const tagMat = new THREE.MeshLambertMaterial({ map: TX.tagTexture(room.plan.tagValue, theme.tag) });
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), tagMat);
    tag.position.set(2.2, 0.65, 4.44 + oz);
    tag.rotation.y = Math.PI;
    tag.visible = false;
    this.scene.add(tag);
    room.tagMesh = tag;

    room.crateInteractable = {
      mesh: crate,
      getPrompt: () => {
        if (room.crateOpened) return null;
        return room.hasTool ? `[E] Pry ${theme.crate.label} open` : `[E] Try ${theme.crate.label}`;
      },
      onInteract: () => {
        if (room.crateOpened) return;
        if (!room.hasTool) {
          this.audio.denied();
          this.cb.onToast(theme.crate.deniedText);
          return;
        }
        this._openCrate(room);
      },
    };

    // The tool that opens the crate — hidden at one of several possible
    // spots in the room (see lib/roomPlan.js), different each room and
    // each playthrough, so it takes exploring, not memorizing.
    const toolMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#8a8f94") });
    const toolShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), toolMat);
    toolShaft.rotation.z = Math.PI / 2;
    const ts = room.plan.toolSpot;
    toolShaft.position.set(ts.x, ts.y, ts.z + oz);
    this.scene.add(toolShaft);
    room.toolMesh = toolShaft;

    const toolHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    toolHitbox.position.copy(toolShaft.position);
    this.scene.add(toolHitbox);

    room.toolInteractable = {
      mesh: toolHitbox,
      getPrompt: () => `[E] Pick up ${room.plan.toolLabel}`,
      onInteract: () => {
        this._takeTool(room);
      },
    };
  }

  _buildPaintingAndSafe(room) {
    const theme = this.theme;
    const oz = room.offsetZ;
    const coverTex = TX.paintingCoverTexture(theme.coverKind);

    const frameMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#caa15a") });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 1.05), frameMat);
    frame.position.set(4.9, 1.7, -1.2 + oz);
    this.scene.add(frame);

    const coverMat = new THREE.MeshLambertMaterial({ map: coverTex });
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), coverMat);
    cover.position.set(4.85, 1.7, -1.2 + oz);
    cover.rotation.y = -Math.PI / 2;
    this.scene.add(cover);
    room.coverMesh = cover;

    const safeMat = new THREE.MeshLambertMaterial({
      map: TX.safeFrontTexture(theme.safe.base, theme.safe.dial),
    });
    const safe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), safeMat);
    safe.position.set(5.05, 1.55, -1.2 + oz);
    safe.visible = false;
    this.scene.add(safe);
    room.safeMesh = safe;

    room.paintingInteractable = {
      mesh: cover,
      getPrompt: () => theme.painting.interactText,
      onInteract: () => {
        this._movePainting(room);
      },
    };

    room.safeInteractable = {
      mesh: safe,
      getPrompt: () => {
        if (room.safeOpen) return null;
        return room.hasFuse ? `[E] Open ${theme.safe.label}` : `[E] Try ${theme.safe.label}`;
      },
      onInteract: () => {
        if (room.safeOpen) return;
        if (!room.hasFuse) {
          this.audio.denied();
          this.cb.onToast(theme.noPowerText);
          return;
        }
        this.audio.click();
        this.keypadDigits = { roomIndex: room.index, digits: "" };
        this.cb.onKeypadDigits("");
        this.cb.onKeypad(true);
        document.exitPointerLock();
        this.modalOpen = true;
      },
    };

    // The safe doesn't hold the door key directly — it holds a small key
    // that only fits the lockbox elsewhere in the room (see
    // _buildLockbox). That's where the real door key is hidden, so
    // cracking the safe isn't the last step.
    const smallKeyMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#c9c9c9") });
    const smallKey = new THREE.Group();
    const sShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.16, 8), smallKeyMat);
    sShaft.rotation.z = Math.PI / 2;
    const sBow = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 8, 16), smallKeyMat);
    sBow.position.x = -0.08;
    smallKey.add(sShaft, sBow);
    smallKey.position.set(4.8, 1.55, -1.2 + oz);
    smallKey.visible = false;
    this.scene.add(smallKey);
    room.smallKeyMesh = smallKey;

    // THREE.Group has no raycast() method, so the visual key (a group of
    // two meshes) can never be hit directly by the raycaster. Use a small
    // invisible hitbox mesh, kept in sync with the group, as the actual
    // interaction target.
    const smallKeyHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    smallKeyHitbox.position.copy(smallKey.position);
    this.scene.add(smallKeyHitbox);

    room.smallKeyInteractable = {
      mesh: smallKeyHitbox,
      getPrompt: () => `[E] Pick up ${theme.smallKey.label}`,
      onInteract: () => {
        this._takeSmallKey(room);
      },
    };
  }

  // The lockbox the safe's small key opens — and inside it, the actual
  // door key. One more link in the unlock chain: cracking the safe isn't
  // enough, what's inside it unlocks something else in the room.
  _buildLockbox(room) {
    const theme = this.theme;
    const oz = room.offsetZ;

    const woodMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#3a2c1a") });
    const bandMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#6b6f74") });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.38), woodMat);
    box.position.set(1.6, 0.16, 2.5 + oz);
    this.scene.add(box);
    this._addCollider(1.6 - 0.3, 1.6 + 0.3, 2.5 + oz - 0.22, 2.5 + oz + 0.22);
    room.lockboxMesh = box;

    const band = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.07, 0.4), bandMat);
    band.position.set(1.6, 0.16, 2.5 + oz);
    this.scene.add(band);

    const keyMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#d8b34a") });
    const key = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), keyMat);
    shaft.rotation.z = Math.PI / 2;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 8, 16), keyMat);
    bow.position.x = -0.11;
    key.add(shaft, bow);
    key.position.set(1.6, 0.34, 2.5 + oz);
    key.visible = false;
    this.scene.add(key);
    room.keyMesh = key;

    const keyHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    keyHitbox.position.copy(key.position);
    this.scene.add(keyHitbox);

    room.keyInteractable = {
      mesh: keyHitbox,
      getPrompt: () => `[E] Pick up ${theme.key.label}`,
      onInteract: () => {
        this._takeKey(room);
      },
    };

    room.lockboxInteractable = {
      mesh: box,
      getPrompt: () => {
        if (room.lockboxOpen) return null;
        return room.hasSmallKey ? `[E] Unlock ${theme.lockbox.label}` : `[E] Try ${theme.lockbox.label}`;
      },
      onInteract: () => {
        if (room.lockboxOpen) return;
        if (!room.hasSmallKey) {
          this.audio.denied();
          this.cb.onToast(theme.lockbox.deniedText);
          return;
        }
        this._openLockbox(room);
      },
    };
  }

  // A second scattered pickup, independent of the tool/crate — the safe
  // won't open without it even once the code is known, so there are two
  // separate things to go find, not just one.
  _buildFuse(room) {
    const oz = room.offsetZ;
    const mat = new THREE.MeshLambertMaterial({ color: 0xc9a13a, emissive: 0x5a3a10, emissiveIntensity: 0.3 });
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.22, 10), mat);
    fuse.rotation.z = Math.PI / 2;
    const fs = room.plan.fuseSpot;
    fuse.position.set(fs.x, fs.y, fs.z + oz);
    this.scene.add(fuse);
    room.fuseMesh = fuse;

    const hitbox = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hitbox.position.copy(fuse.position);
    this.scene.add(hitbox);

    room.fuseInteractable = {
      mesh: hitbox,
      getPrompt: () => `[E] Pick up ${room.plan.fuseLabel}`,
      onInteract: () => {
        this._takeFuse(room);
      },
    };
  }

  _tween(duration, onUpdate, onComplete) {
    this.tweens.push({ t: 0, duration, onUpdate, onComplete });
  }

  // ---------- shared/networked puzzle actions ----------
  // Progress is shared co-op: whichever player finds the tool, cracks the
  // safe, or unlocks a door, everyone in the room sees it. Each method
  // here performs the actual state mutation + visuals, and runs both for
  // the local player's own interaction (broadcast: true, the default) and
  // for an incoming network message reporting another player's action
  // (broadcast: false, so it doesn't echo back out). `silent` skips the
  // toast (used only when fast-forwarding a newly-joined player's client
  // to the room's current progress) and `instant` skips animating a
  // reveal tween the player wasn't present to see start.

  _takeTool(room, { broadcast = true, silent = false } = {}) {
    if (room.hasTool) return;
    room.hasTool = true;
    if (room.toolMesh) room.toolMesh.visible = false;
    this.audio.pickup();
    const label = room.plan.toolLabel;
    if (!this.inventoryItems.includes(label)) {
      this.inventoryItems.push(label);
      this.cb.onInventory([...this.inventoryItems]);
    }
    if (!silent) this.cb.onToast(`The ${label} has been picked up.`);
    this.interactables = this.interactables.filter((i) => i !== room.toolInteractable);
    if (broadcast) this._sendAction(room.index, "hasTool");
  }

  _takeFuse(room, { broadcast = true, silent = false } = {}) {
    if (room.hasFuse) return;
    room.hasFuse = true;
    if (room.fuseMesh) room.fuseMesh.visible = false;
    this.audio.pickup();
    const label = room.plan.fuseLabel;
    if (!this.inventoryItems.includes(label)) {
      this.inventoryItems.push(label);
      this.cb.onInventory([...this.inventoryItems]);
    }
    if (!silent) this.cb.onToast(`The ${label} has been picked up.`);
    this.interactables = this.interactables.filter((i) => i !== room.fuseInteractable);
    if (broadcast) this._sendAction(room.index, "hasFuse");
  }

  _openCrate(room, { broadcast = true, silent = false, instant = false } = {}) {
    if (room.crateOpened) return;
    room.crateOpened = true;
    this.audio.creak();
    const tag = room.tagMesh;
    if (tag) {
      tag.visible = true;
      tag.material.transparent = true;
      tag.material.needsUpdate = true;
      if (instant) {
        tag.material.opacity = 1;
        tag.scale.setScalar(1);
      } else {
        tag.material.opacity = 0;
        tag.scale.setScalar(0.6);
        this._tween(0.4, (p) => {
          tag.material.opacity = p;
          tag.scale.setScalar(0.6 + 0.4 * p);
        });
      }
    }
    if (!silent) this.cb.onToast(this.theme.crate.openToast);
    if (broadcast) this._sendAction(room.index, "crateOpened");
  }

  _movePainting(room, { broadcast = true, silent = false, instant = false } = {}) {
    if (room.paintingMoved) return;
    room.paintingMoved = true;
    this.audio.creak();
    const cover = room.coverMesh;
    const safe = room.safeMesh;
    const finish = () => {
      if (cover) cover.visible = false;
      if (safe) safe.visible = true;
      this.interactables = this.interactables.filter((i) => i !== room.paintingInteractable);
      if (room.safeInteractable && !this.interactables.includes(room.safeInteractable)) {
        this.interactables.push(room.safeInteractable);
      }
      if (!silent) this.cb.onToast(this.theme.painting.revealToast);
    };
    if (cover) {
      cover.material.transparent = true;
      cover.material.needsUpdate = true;
      if (instant) {
        cover.scale.setScalar(0.001);
        cover.material.opacity = 0;
        finish();
      } else {
        this._tween(
          0.5,
          (p) => {
            cover.scale.setScalar(1 - p);
            cover.material.opacity = 1 - p;
          },
          finish
        );
      }
    } else {
      finish();
    }
    if (broadcast) this._sendAction(room.index, "paintingMoved");
  }

  _openSafe(room, { broadcast = true, silent = false } = {}) {
    if (room.safeOpen) return;
    room.safeOpen = true;
    this.audio.unlock();
    if (room.smallKeyMesh) room.smallKeyMesh.visible = true;
    if (room.smallKeyInteractable && !this.interactables.includes(room.smallKeyInteractable)) {
      this.interactables.push(room.smallKeyInteractable);
    }
    if (!silent) this.cb.onToast(`The ${this.theme.safe.label} clicks open.`);
    if (broadcast) this._sendAction(room.index, "safeOpen");
  }

  _takeSmallKey(room, { broadcast = true, silent = false } = {}) {
    if (room.hasSmallKey) return;
    room.hasSmallKey = true;
    if (room.smallKeyMesh) room.smallKeyMesh.visible = false;
    this.audio.pickup();
    const label = this.theme.smallKey.label;
    if (!this.inventoryItems.includes(label)) {
      this.inventoryItems.push(label);
      this.cb.onInventory([...this.inventoryItems]);
    }
    if (!silent) this.cb.onToast(`The ${label} has been picked up.`);
    this.interactables = this.interactables.filter((i) => i !== room.smallKeyInteractable);
    if (broadcast) this._sendAction(room.index, "hasSmallKey");
  }

  // What the safe's small key actually unlocks — the door key is hidden
  // inside this, not in the safe itself.
  _openLockbox(room, { broadcast = true, silent = false } = {}) {
    if (room.lockboxOpen) return;
    room.lockboxOpen = true;
    this.audio.creak();
    if (room.keyMesh) room.keyMesh.visible = true;
    if (room.keyInteractable && !this.interactables.includes(room.keyInteractable)) {
      this.interactables.push(room.keyInteractable);
    }
    if (!silent) this.cb.onToast(this.theme.lockbox.openToast);
    if (broadcast) this._sendAction(room.index, "lockboxOpen");
  }

  _takeKey(room, { broadcast = true, silent = false } = {}) {
    if (room.hasKey) return;
    room.hasKey = true;
    if (room.keyMesh) room.keyMesh.visible = false;
    this.audio.pickup();
    const label = this.theme.key.label;
    if (!this.inventoryItems.includes(label)) {
      this.inventoryItems.push(label);
      this.cb.onInventory([...this.inventoryItems]);
    }
    if (!silent) this.cb.onToast(`The ${label} has been picked up.`);
    if (broadcast) this._sendAction(room.index, "hasKey");
  }

  // Swings the door open and removes its collider so the doorway is
  // really, physically walkable — no scene rebuild, no teleport.
  _openDoor(room, { broadcast = true, silent = false, instant = false } = {}) {
    if (room.doorOpen) return;
    room.doorOpen = true;
    this.colliders = this.colliders.filter((c) => c !== room.doorCollider);
    const finish = () => {
      if (!silent) this.cb.onToast(this.theme.door.advanceToast);
    };
    if (instant) {
      if (room.doorHinge) room.doorHinge.rotation.y = -1.9;
      finish();
    } else {
      this.audio.unlock();
      this.audio.creak();
      this._tween(1.3, (p) => {
        if (room.doorHinge) room.doorHinge.rotation.y = -p * 1.9;
      });
      finish();
    }
    if (broadcast) this._sendAction(room.index, "doorOpen");
  }

  _winGame(room, elapsed, { broadcast = true, animateDoor = true } = {}) {
    if (this.won) return;
    if (broadcast) this._sendAction(room.index, "win");
    const run = () => {
      this.won = true;
      this.audio.victory();
      this.cb.onWin(elapsed);
    };
    room.doorOpen = true;
    this.colliders = this.colliders.filter((c) => c !== room.doorCollider);
    if (animateDoor && room.doorHinge) {
      this.audio.unlock();
      this.audio.creak();
      const dur = 1.3;
      this._tween(dur, (p) => {
        room.doorHinge.rotation.y = -p * 1.9;
      });
      setTimeout(run, dur * 1000 + 150);
    } else {
      run();
    }
  }

  _sendAction(roomIndex, kind, payload = null) {
    if (this.network) this.network.send({ t: "action", roomIndex, kind, payload });
  }

  // ---------- multiplayer ----------

  _onNetworkMessage(msg) {
    if (msg.t === "playerJoined") this._spawnAvatar(msg.id, msg.color);
    else if (msg.t === "playerLeft") this._removeAvatar(msg.id);
    else if (msg.t === "move") this._updateAvatarTarget(msg.id, msg.x, msg.z, msg.yaw);
    else if (msg.t === "action") this._applyNetworkAction(msg.roomIndex, msg.kind);
  }

  _applyNetworkAction(roomIndex, kind) {
    const opts = { broadcast: false };
    const room = this.rooms[roomIndex];
    if (kind === "win") {
      const elapsed = (performance.now() - this.startTime) / 1000;
      this._winGame(room, elapsed, opts);
      return;
    }
    if (!room) return;
    if (kind === "hasTool") this._takeTool(room, opts);
    else if (kind === "crateOpened") this._openCrate(room, opts);
    else if (kind === "hasFuse") this._takeFuse(room, opts);
    else if (kind === "paintingMoved") this._movePainting(room, opts);
    else if (kind === "safeOpen") this._openSafe(room, opts);
    else if (kind === "hasSmallKey") this._takeSmallKey(room, opts);
    else if (kind === "lockboxOpen") this._openLockbox(room, opts);
    else if (kind === "hasKey") this._takeKey(room, opts);
    else if (kind === "doorOpen") this._openDoor(room, opts);
  }

  // Fast-forwards a newly-joined client to the room's current progress:
  // silently/instantly replay whichever steps are already done in each
  // room, in order, then place the other players. The joiner still spawns
  // at the very start and has to walk to catch up — but every door
  // that's already open stays open, so that walk is quick.
  applyJoinSnapshot(msg) {
    const opts = { broadcast: false, silent: true, instant: true };
    for (let i = 0; i < msg.roomStates.length; i++) {
      const s = msg.roomStates[i];
      const room = this.rooms[i];
      if (!room || !s) continue;
      if (s.hasTool) this._takeTool(room, opts);
      if (s.crateOpened) this._openCrate(room, opts);
      if (s.hasFuse) this._takeFuse(room, opts);
      if (s.paintingMoved) this._movePainting(room, opts);
      if (s.safeOpen) this._openSafe(room, opts);
      if (s.hasSmallKey) this._takeSmallKey(room, opts);
      if (s.lockboxOpen) this._openLockbox(room, opts);
      if (s.hasKey) this._takeKey(room, opts);
      if (s.doorOpen) this._openDoor(room, opts);
    }
    for (const p of msg.players) this._spawnAvatar(p.id, p.color, p.x, p.z, p.yaw);
  }

  _spawnAvatar(id, color, x = 0, z = 3.6, yaw = 0) {
    if (this.remotePlayers.has(id)) return;
    const mat = new THREE.MeshLambertMaterial({ color });
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.85, 4, 8), mat);
    body.position.y = 0.92;
    group.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat);
    head.position.y = 1.5;
    group.add(head);
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.08, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x1a1a1a })
    );
    visor.position.set(0, 1.5, -0.2);
    group.add(visor);
    group.position.set(x, 0, z);
    group.rotation.y = yaw;
    this.scene.add(group);
    this.remotePlayers.set(id, { group, targetX: x, targetZ: z, targetYaw: yaw });
  }

  _removeAvatar(id) {
    const av = this.remotePlayers.get(id);
    if (!av) return;
    av.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
    this.scene.remove(av.group);
    this.remotePlayers.delete(id);
  }

  _updateAvatarTarget(id, x, z, yaw) {
    let av = this.remotePlayers.get(id);
    if (!av) {
      this._spawnAvatar(id, "#999999", x, z, yaw);
      av = this.remotePlayers.get(id);
    }
    av.targetX = x;
    av.targetZ = z;
    av.targetYaw = yaw;
  }

  _updateAvatars(delta) {
    if (this.remotePlayers.size === 0) return;
    const t = Math.min(1, delta * 10);
    for (const av of this.remotePlayers.values()) {
      av.group.position.x += (av.targetX - av.group.position.x) * t;
      av.group.position.z += (av.targetZ - av.group.position.z) * t;
      let dy = av.targetYaw - av.group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      av.group.rotation.y += dy * t;
    }
  }

  // ---------- set dressing ----------
  // Small reusable clutter props (crates, barrels, wall tools, hanging
  // chains, a practical lantern) so each room reads like a physical
  // escape-room build instead of four bare shapes in a box. Driven by
  // each theme's `decor` list.

  _buildDecor(room) {
    const list = this.theme.decor;
    if (!list) return;
    const oz = room.offsetZ;
    for (const d of list) {
      const z = d.z + oz;
      if (d.type === "crateStack") this._addCrateStack(d.x, z, d.base, d.band, d.ry || 0);
      else if (d.type === "barrel") this._addBarrel(d.x, z, d.color, d.count || 1);
      else if (d.type === "wallTool") this._addWallTool(d.x, d.y, z, d.ry || 0, d.tool, d.color);
      else if (d.type === "chain") this._addChainMount(d.x, d.y, z, d.ry || 0);
      else if (d.type === "lanternProp") this._addLanternProp(d.x, d.y, z, d.glass);
      else if (d.type === "pedestal") this._addPedestal(d.x, z, d.h, d.base, d.band);
    }
  }

  _addCrateStack(x, z, base = "#33261a", band = "#6b5a3a", ry = 0) {
    const mat = new THREE.MeshLambertMaterial({ map: TX.crateTexture(base, band) });
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), mat);
    bottom.position.set(x, 0.275, z);
    bottom.rotation.y = ry;
    this.scene.add(bottom);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.4, 0.48), mat);
    top.position.set(x + 0.1, 0.55 + 0.2, z - 0.05);
    top.rotation.y = ry + 0.3;
    this.scene.add(top);
    this._addCollider(x - 0.4, x + 0.4, z - 0.4, z + 0.4);
  }

  _addBarrel(x, z, color = "#5a4530", count = 1) {
    const mat = new THREE.MeshLambertMaterial({ map: TX.crateTexture(color, "#2a2016") });
    for (let i = 0; i < count; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.62, 14), mat);
      barrel.position.set(x + i * 0.62, 0.31, z);
      this.scene.add(barrel);
    }
    this._addCollider(x - 0.32, x + (count - 1) * 0.62 + 0.32, z - 0.32, z + 0.32);
  }

  _addWallTool(x, y, z, ry, tool = "pickaxe", color = "#8a8f94") {
    const woodMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#4a3220") });
    const metalMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture(color) });
    const group = new THREE.Group();
    if (tool === "pickaxe" || tool === "shovel") {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), woodMat);
      handle.rotation.z = Math.PI / 2.3;
      group.add(handle);
      const head = new THREE.Mesh(
        tool === "pickaxe" ? new THREE.BoxGeometry(0.35, 0.05, 0.05) : new THREE.BoxGeometry(0.22, 0.28, 0.02),
        metalMat
      );
      head.position.set(0.42, 0.18, 0);
      group.add(head);
    } else if (tool === "sword") {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.015), metalMat);
      const hilt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 8), woodMat);
      hilt.position.y = -0.42;
      group.add(blade, hilt);
    } else if (tool === "valve") {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 16), metalMat);
      const spokeA = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), metalMat);
      spokeA.rotation.z = Math.PI / 2;
      const spokeB = spokeA.clone();
      spokeB.rotation.x = Math.PI / 2;
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), metalMat);
      pipe.rotation.x = Math.PI / 2;
      pipe.position.z = -0.2;
      group.add(wheel, spokeA, spokeB, pipe);
    }
    group.position.set(x, y, z);
    group.rotation.y = ry;
    this.scene.add(group);
  }

  _addChainMount(x, y, z, ry) {
    const woodMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#3a2c1a") });
    const metalMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#6b6f74") });
    const group = new THREE.Group();
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.05), woodMat);
    group.add(board);
    [-0.18, 0.18].forEach((cx) => {
      for (let i = 0; i < 4; i++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 6, 10), metalMat);
        link.rotation.x = i % 2 === 0 ? 0 : Math.PI / 2;
        link.position.set(cx, -0.12 - i * 0.08, 0.04);
        group.add(link);
      }
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.02, 6, 12), metalMat);
      cuff.position.set(cx, -0.12 - 4 * 0.08, 0.04);
      group.add(cuff);
    });
    group.position.set(x, y, z);
    group.rotation.y = ry;
    this.scene.add(group);
  }

  _addPedestal(x, z, h = 0.4, base = "#1a1a1a", band = "#333") {
    const mat = new THREE.MeshLambertMaterial({ map: TX.crateTexture(base, band) });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), mat);
    box.position.set(x, h / 2, z);
    this.scene.add(box);
    this._addCollider(x - 0.3, x + 0.3, z - 0.3, z + 0.3);
  }

  _addLanternProp(x, y, z, glassColor = "#dff2ff") {
    const metalMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#2a2a2a") });
    const glassMat = new THREE.MeshLambertMaterial({
      color: glassColor,
      transparent: true,
      opacity: 0.55,
      emissive: glassColor,
      emissiveIntensity: 0.6,
    });
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.05, 10), metalMat);
    group.add(base);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 8, 1, true), glassMat);
    cage.position.y = 0.15;
    group.add(cage);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.06, 0.05, 10), metalMat);
    top.position.y = 0.28;
    group.add(top);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 12, Math.PI), metalMat);
    handle.rotation.z = Math.PI;
    handle.position.y = 0.4;
    group.add(handle);
    group.position.set(x, y, z);
    this.scene.add(group);
  }

  // ---------- keypad ----------

  keypadPress(d) {
    if (!this.keypadDigits || this.keypadDigits.digits.length >= 4) return;
    this.keypadDigits.digits += d;
    this.cb.onKeypadDigits(this.keypadDigits.digits);
  }

  keypadClear() {
    if (!this.keypadDigits) return;
    this.keypadDigits.digits = "";
    this.cb.onKeypadDigits("");
  }

  keypadSubmit() {
    if (!this.keypadDigits) return;
    const room = this.rooms[this.keypadDigits.roomIndex];
    if (room && this.keypadDigits.digits === room.plan.code) {
      this.cb.onKeypad(false);
      this.modalOpen = false;
      this._openSafe(room);
      this.lock();
    } else {
      this.audio.denied();
      this.cb.onKeypadShake();
      this.keypadDigits.digits = "";
      this.cb.onKeypadDigits("");
    }
  }

  closeKeypad() {
    this.keypadDigits = null;
    this.cb.onKeypad(false);
    this.modalOpen = false;
    this.lock();
  }

  closeNote() {
    this.cb.onNote(false);
    this.modalOpen = false;
    this.lock();
  }

  // ---------- hints ----------
  // Nudges toward the next step without spelling out the exact answer —
  // no numbers, no "look at the plaque and the crate" spoilers.

  getHint() {
    const theme = this.theme;
    const room = this.rooms[this.getCurrentRoomIndex()];
    if (!room.readNote) return "Something on the desk is worth a closer look.";
    if (!room.hasTool) return `You won't get that ${theme.crate.label} open with your bare hands. Something else in this room could help.`;
    if (!room.crateOpened) return `Try that thing you picked up on the ${theme.crate.label}.`;
    if (!room.paintingMoved) return `That ${theme.painting.label} on the wall looks like it could move.`;
    if (!room.hasFuse) return "Something in this room needs power before it'll do anything. Keep looking.";
    if (!room.safeOpen) {
      if (room.plan.puzzleType === "sum") return "The two numbers you've found need to be added together.";
      if (room.isFinal) return "This code's first half isn't in this room — it's somewhere you've already been.";
      return "The code is hiding in plain sight — written in more than one place.";
    }
    if (!room.hasSmallKey) return "You just opened something. Did you take everything out of it?";
    if (!room.lockboxOpen) return `That ${theme.lockbox.label} won't budge on its own — try what you're holding on it.`;
    if (!room.hasKey) return "You just opened something else. Did you take everything out of it?";
    if (!room.doorOpen) return `You're ready. Find the ${theme.door.label} and use what you're holding.`;
    return room.isFinal ? "You're through — go." : "Keep going; the next room is through that door.";
  }

  showHint() {
    this.cb.onToast(this.getHint());
  }

  // ---------- loop ----------

  _animate() {
    this.raf = requestAnimationFrame(this._animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.time += delta;

    this._updateTweens(delta);
    this._updateMovement(delta);
    this._updateFlicker(delta);
    this._updateAmbiance(delta);
    this._updateInteraction();
    this._updateAvatars(delta);
    this._reportRoom(false);

    this.renderer.render(this.scene, this.camera);
  }

  _reportRoom(force) {
    const idx = this.getCurrentRoomIndex();
    if (force || idx !== this._currentRoomIndex) {
      this._currentRoomIndex = idx;
      this.cb.onStage(idx, this.rooms.length, this.theme.stageLabels[idx]);
    }
  }

  _updateTweens(delta) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += delta;
      const p = Math.min(tw.t / tw.duration, 1);
      tw.onUpdate(easeOutCubic(p));
      if (p >= 1) {
        tw.onComplete && tw.onComplete();
        this.tweens.splice(i, 1);
      }
    }
  }

  _updateMovement(delta) {
    if (!this.isLocked) return;
    const speed = 2.6;
    const damping = Math.pow(0.0008, delta);
    this.velocity.x *= damping;
    this.velocity.z *= damping;

    const forward =
      (this.keys["KeyW"] || this.keys["ArrowUp"] ? 1 : 0) -
      (this.keys["KeyS"] || this.keys["ArrowDown"] ? 1 : 0);
    const strafe =
      (this.keys["KeyD"] || this.keys["ArrowRight"] ? 1 : 0) -
      (this.keys["KeyA"] || this.keys["ArrowLeft"] ? 1 : 0);

    if (forward || strafe) {
      const yaw = this.yawObject.rotation.y;
      const dirX = -Math.sin(yaw) * forward + Math.cos(yaw) * strafe;
      const dirZ = -Math.cos(yaw) * forward - Math.sin(yaw) * strafe;
      const len = Math.hypot(dirX, dirZ) || 1;
      this.velocity.x += (dirX / len) * speed * delta * 6;
      this.velocity.z += (dirZ / len) * speed * delta * 6;
    }

    const maxSpeed = speed;
    const currentSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (currentSpeed > maxSpeed) {
      this.velocity.x = (this.velocity.x / currentSpeed) * maxSpeed;
      this.velocity.z = (this.velocity.z / currentSpeed) * maxSpeed;
    }

    const r = this.playerRadius;
    const xBound = ROOM_HALF - 0.3 - r;
    const blocked = (x, z) =>
      this.colliders.some((box) => x + r > box.minX && x - r < box.maxX && z + r > box.minZ && z - r < box.maxZ);

    // Resolve X and Z movement independently so sliding along a wall or
    // furniture edge stays smooth instead of snapping/jittering.
    let nx = this.yawObject.position.x + this.velocity.x * delta;
    nx = Math.max(-xBound, Math.min(xBound, nx));
    if (blocked(nx, this.yawObject.position.z)) {
      nx = this.yawObject.position.x;
      this.velocity.x = 0;
    }

    let nz = this.yawObject.position.z + this.velocity.z * delta;
    // Loose safety clamp for the far ends of the whole level — the real
    // blocking (side walls, doorway segments, closed doors) comes from
    // explicit colliders above, this just stops the player wandering into
    // the void beyond the last room.
    nz = Math.max(this.levelMinZ - 1, Math.min(this.levelMaxZ - 0.3 - r, nz));
    if (blocked(nx, nz)) {
      nz = this.yawObject.position.z;
      this.velocity.z = 0;
    }

    const moved = Math.hypot(nx - this.yawObject.position.x, nz - this.yawObject.position.z);
    this.yawObject.position.x = nx;
    this.yawObject.position.z = nz;

    if (moved > 0.0005) {
      this.bobPhase += delta * 9;
      this.yawObject.position.y = EYE_HEIGHT + Math.sin(this.bobPhase) * 0.035;
      if (Math.sin(this.bobPhase) > 0.92 && Math.cos(this.bobPhase) > 0) {
        this.audio.footstep();
      }
    } else {
      this.yawObject.position.y += (EYE_HEIGHT - this.yawObject.position.y) * 0.2;
    }

    if (this.network) {
      const now = performance.now();
      if (now - this.lastMoveSent > 66) {
        this.lastMoveSent = now;
        this.network.send({
          t: "move",
          x: this.yawObject.position.x,
          z: this.yawObject.position.z,
          yaw: this.yawObject.rotation.y,
        });
      }
    }
  }

  _updateFlicker() {
    for (const light of this.flickerLights) {
      const t = this.time * 6 + light._seed;
      light.intensity = light._base + Math.sin(t) * light._base * 0.04 + (Math.random() - 0.5) * light._base * 0.06;
    }
  }

  _updateAmbiance(delta) {
    const theme = this.theme;
    this.ambianceTimer += delta;
    const room = this.rooms[this.getCurrentRoomIndex()];

    if (theme.ambiance === "shake" && this.isLocked) {
      this.camera.position.x = Math.sin(this.time * 13) * 0.008;
      this.camera.position.y = Math.sin(this.time * 8.3) * 0.005;
      if (this.ambianceTimer > 0.55) {
        this.ambianceTimer = 0;
        this.audio.clack();
      }
    } else if (theme.ambiance === "alarm" && room && room.fill) {
      const pulse = Math.sin(this.time * 2.4) * 0.5 + 0.5;
      room.fill.intensity = this._fillBaseIntensity * (0.4 + 0.9 * pulse);
      if (this.ambianceTimer > 4.2) {
        this.ambianceTimer = 0;
        this.audio.klaxon();
      }
    }
  }

  _updateInteraction() {
    if (!this.isLocked) {
      if (this.hovered || this._lastPrompt) {
        this.hovered = null;
        this._lastPrompt = null;
        this.cb.onPrompt(null);
      }
      return;
    }
    this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
    const meshes = this.interactables.map((i) => i.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    let found = null;
    if (hits.length > 0) {
      found = this.interactables.find((i) => i.mesh === hits[0].object) || null;
    }
    if (found && found.getPrompt() === null) found = null;
    this.hovered = found;

    const nextPrompt = found ? found.getPrompt() : null;
    if (nextPrompt !== this._lastPrompt) {
      this._lastPrompt = nextPrompt;
      this.cb.onPrompt(nextPrompt);
    }
  }
}
