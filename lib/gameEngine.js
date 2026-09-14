import * as THREE from "three";
import * as TX from "./textures";
import { AudioEngine } from "./audio";

const ROOM_HALF = 5;
const EYE_HEIGHT = 1.65;

// Three.js (since r155) uses physically-based light units: PointLight
// intensity is candela, so small numbers are nearly invisible at
// room-scale distances. Theme palettes specify a friendly 0-2 "brightness
// dial" and these constants convert that into real candela/lux values.
const POINT_LIGHT_SCALE = 30;
const AMBIENT_LIGHT_SCALE = 1.6;

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class EscapeRoomGame {
  constructor(container, theme, callbacks) {
    this.container = container;
    this.theme = theme;
    this.cb = callbacks;
    this.audio = new AudioEngine();

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

    this.state = {
      paintingMoved: false,
      safeOpen: false,
      hasKey: false,
      won: false,
    };
    this.keypadDigits = "";
    this.startTime = null;
    this.stageIndex = 0;
    this.totalStages = theme.codes.length;

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

    // lighting
    scene.add(
      new THREE.AmbientLight(theme.palette.ambient, theme.palette.ambientIntensity * AMBIENT_LIGHT_SCALE)
    );

    const [lampX, lampY, lampZ] = theme.lampPosition || [-3.6, 1.9, -1];
    this.lamp = this._addFlickerLight(
      theme.palette.lampColor,
      theme.palette.lampIntensity * POINT_LIGHT_SCALE,
      lampX,
      lampY,
      lampZ
    );

    this.fill = new THREE.PointLight(theme.palette.fillColor, theme.palette.fillIntensity * POINT_LIGHT_SCALE, 12, 2);
    this.fill.position.set(0, 2.7, 1);
    scene.add(this.fill);
    this._fillBaseIntensity = this.fill.intensity;

    const glow = new THREE.PointLight(theme.palette.glowColor, theme.palette.glowIntensity * POINT_LIGHT_SCALE, 14, 2);
    glow.position.set(0, 3.0, -2);
    scene.add(glow);

    this._buildRoom();
    this._buildAmbiance();
    this._buildArchitecture();

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 3.2;

    this._buildStage();
  }

  // Rebuilds everything that's specific to one stage/room of the theme
  // (desk+note, rack+crate, painting+safe+key, door) with that stage's
  // code, while keeping the room shell, camera, and lighting untouched.
  // Called once for stage 0 and again each time a door is unlocked before
  // the final stage.
  _buildStage() {
    this.tweens = [];
    this._disposeStageGroup();
    this.stageGroup = new THREE.Group();
    this.scene.add(this.stageGroup);

    // Start from the persistent architecture colliders (corner posts etc.)
    // rather than an empty array — those aren't rebuilt per stage.
    this.colliders = [...(this.baseColliders || [])];
    this.state = {
      readNote: false,
      hasTool: false,
      crateOpened: false,
      paintingMoved: false,
      safeOpen: false,
      hasKey: false,
      won: false,
    };
    this.inventoryItems = [];
    this.keypadDigits = "";
    this.hovered = null;
    this._lastPrompt = null;

    this._buildDesk();
    this._buildRackAndCrate();
    this._buildPaintingAndSafe();
    this._buildDoor();
    this._buildDecor();

    // Note: the safe and key are deliberately left out here. Three.js's
    // Raycaster.intersectObjects does not check mesh.visible at all, so a
    // hidden-but-present mesh is still perfectly interactable — including
    // one it should be *impossible* to reach yet. Objects that aren't
    // available from the start are added/removed from this array instead
    // (see _buildPaintingAndSafe / keypadSubmit), which is the only thing
    // that actually gates what the raycaster can hit.
    this.interactables = [
      this.noteInteractable,
      this.crateInteractable,
      this.toolInteractable,
      this.paintingInteractable,
      this.doorInteractable,
    ].filter(Boolean);

    this.yawObject.position.set(0, EYE_HEIGHT, 3.6);
    this.yawObject.rotation.y = 0;
    this.pitchObject.rotation.x = 0;
    this.velocity.set(0, 0, 0);

    this.cb.onInventory([]);
    this.cb.onStage(this.stageIndex, this.totalStages, this.theme.stageLabels[this.stageIndex]);
  }

  _disposeStageGroup() {
    if (!this.stageGroup) return;
    this.stageGroup.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    });
    this.scene.remove(this.stageGroup);
  }

  currentCode() {
    return this.theme.codes[this.stageIndex];
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
    if (theme.ambiance === "torches") {
      const torchIntensity = theme.palette.lampIntensity * POINT_LIGHT_SCALE * 0.75;
      this._addFlickerLight(theme.palette.lampColor, torchIntensity, 2.0, 1.9, 4.6);
      this._addFlickerLight(theme.palette.lampColor, torchIntensity, 4.6, 1.9, 1.5);
    } else if (theme.ambiance === "headlamp") {
      const spot = new THREE.SpotLight(0xfff2d0, 80, 9, Math.PI / 6.5, 0.5, 1.4);
      spot.position.set(0, 0, 0.1);
      const target = new THREE.Object3D();
      target.position.set(0, 0, -1);
      this.camera.add(spot);
      this.camera.add(target);
      spot.target = target;
    }
  }

  // One-time structural detail per theme (windows, portholes, beams, an
  // arch) added straight to the scene — not the per-stage stageGroup —
  // since it's part of the room's fixed architecture, not a puzzle prop.
  _buildArchitecture() {
    const id = this.theme.id;
    if (id === "train") this._buildTrainWindows();
    else if (id === "mine") this._buildMineBeams();
    else if (id === "submarine") this._buildSubmarineFittings();
    else if (id === "castle") this._buildCastleArch();
  }

  _buildTrainWindows() {
    const winMat = new THREE.MeshLambertMaterial({ map: TX.trainWindowTexture() });
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x1a1c1e });
    const zPositions = [1.5, -3.3];
    for (const wallX of [-4.96, 4.96]) {
      for (const z of zPositions) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.55), winMat);
        win.position.set(wallX, 2.05, z);
        win.rotation.y = wallX < 0 ? Math.PI / 2 : -Math.PI / 2;
        this.scene.add(win);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.65, 1.42), frameMat);
        frame.position.set(wallX + (wallX < 0 ? -0.01 : 0.01), 2.05, z);
        this.scene.add(frame);
      }
    }
    // overhead luggage rail, both sides
    const railMat = new THREE.MeshLambertMaterial({ color: 0x8a8f94 });
    for (const wallX of [-4.85, 4.85]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 8, 8), railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(wallX, 2.6, 0);
      this.scene.add(rail);
    }
  }

  _buildMineBeams() {
    const beamMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#3d2b1f") });
    for (const z of [-3, 0, 3]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(10, 0.26, 0.3), beamMat);
      beam.position.set(0, 3.05, z);
      this.scene.add(beam);
    }
    for (const x of [-4.7, 4.7]) {
      for (const z of [-4.7, 4.7]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), beamMat);
        post.position.set(x, 1.6, z);
        this.scene.add(post);
        this._addBaseCollider(x - 0.18, x + 0.18, z - 0.18, z + 0.18);
      }
    }
  }

  _buildSubmarineFittings() {
    const rimMat = new THREE.MeshLambertMaterial({ color: 0x8a9296 });
    const glassMat = new THREE.MeshLambertMaterial({ color: 0x0a2030, emissive: 0x0e3a50, emissiveIntensity: 0.4 });
    for (const z of [1.5, -3.3]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.06, 8, 20), rimMat);
      rim.position.set(-4.95, 1.8, z);
      rim.rotation.y = Math.PI / 2;
      this.scene.add(rim);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), glassMat);
      glass.position.set(-4.93, 1.8, z);
      glass.rotation.y = Math.PI / 2;
      this.scene.add(glass);
    }
    const pipeMat = new THREE.MeshLambertMaterial({ color: 0x5a6266 });
    for (const z of [-2, 2]) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 10, 10), pipeMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, 3.05, z);
      this.scene.add(pipe);
    }
  }

  _buildCastleArch() {
    const stoneMat = new THREE.MeshLambertMaterial({ map: TX.stoneWallTexture("#5a554c") });
    const keystone = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 0.16), stoneMat);
    keystone.position.set(0, 2.5, -4.9);
    this.scene.add(keystone);
    [-0.75, 0.75].forEach((x) => {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.16), stoneMat);
      support.position.set(x, 2.2, -4.9);
      this.scene.add(support);
    });

    const slitMat = new THREE.MeshLambertMaterial({ color: 0x0a0806 });
    const glowMat = new THREE.MeshLambertMaterial({ color: 0x3a4a6a, emissive: 0x2a3a5a, emissiveIntensity: 0.5 });
    for (const z of [1.0, -3.3]) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 1.1), glowMat);
      glow.position.set(-4.94, 1.9, z);
      glow.rotation.y = Math.PI / 2;
      this.scene.add(glow);
      const slit = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.9), slitMat);
      slit.position.set(-4.96, 1.9, z);
      slit.rotation.y = Math.PI / 2;
      this.scene.add(slit);
    }

    const rugMat = new THREE.MeshLambertMaterial({ color: 0x5a1f1f });
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2.6), rugMat);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-2.6, 0.006, -1.2);
    this.scene.add(rug);
  }

  _buildRoom() {
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

    const floorMat = new THREE.MeshLambertMaterial({ map: floorFns[theme.floor.fn]() });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const ceilMat = new THREE.MeshLambertMaterial({ map: TX.ceilingTexture(theme.ceiling.base) });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3.2;
    this.scene.add(ceiling);

    const wallMat = new THREE.MeshLambertMaterial({ map: texFns[theme.wall.fn]() });
    const wallGeo = new THREE.PlaneGeometry(ROOM_HALF * 2, 3.2);

    const north = new THREE.Mesh(wallGeo, wallMat);
    north.position.set(0, 1.6, -ROOM_HALF);
    this.scene.add(north);

    const south = new THREE.Mesh(wallGeo, wallMat);
    south.position.set(0, 1.6, ROOM_HALF);
    south.rotation.y = Math.PI;
    this.scene.add(south);

    const east = new THREE.Mesh(wallGeo, wallMat);
    east.position.set(ROOM_HALF, 1.6, 0);
    east.rotation.y = -Math.PI / 2;
    this.scene.add(east);

    const west = new THREE.Mesh(wallGeo, wallMat);
    west.position.set(-ROOM_HALF, 1.6, 0);
    west.rotation.y = Math.PI / 2;
    this.scene.add(west);

    this.baseColliders = [];
  }

  _addBaseCollider(minX, maxX, minZ, maxZ) {
    this.baseColliders.push({ minX, maxX, minZ, maxZ });
  }

  _addCollider(minX, maxX, minZ, maxZ) {
    this.colliders.push({ minX, maxX, minZ, maxZ });
  }

  _buildDesk() {
    const theme = this.theme;
    const woodMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture(theme.desk.woodBase) });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 0.8), woodMat);
    desk.position.set(-4.0, 0.425, -1.2);
    this.stageGroup.add(desk);
    this._addCollider(-4.0 - 0.85, -4.0 + 0.85, -1.2 - 0.4, -1.2 + 0.4);

    const noteMat = new THREE.MeshLambertMaterial({
      map: TX.noteTexture(theme.note.lines, { bg: theme.note.bg, textColor: theme.note.textColor, font: theme.note.font }),
    });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), noteMat);
    note.rotation.x = -Math.PI / 2;
    note.position.set(-3.75, 0.856, -1.0);
    this.stageGroup.add(note);

    const plaqueMat = new THREE.MeshLambertMaterial({
      map: TX.plaqueTexture(this.currentCode().slice(0, 2), theme.plaque),
    });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), plaqueMat);
    plaque.position.set(-4.98, 1.9, -1.2);
    plaque.rotation.y = Math.PI / 2;
    this.stageGroup.add(plaque);

    this.noteInteractable = {
      mesh: note,
      getPrompt: () => "[E] Read note",
      onInteract: () => {
        this.state.readNote = true;
        this.audio.click();
        this.cb.onNote(true, theme.note.lines.map((l) => l.trim()));
        document.exitPointerLock();
        this.modalOpen = true;
      },
    };
  }

  _buildRackAndCrate() {
    const theme = this.theme;
    const rackMat = new THREE.MeshLambertMaterial({ map: TX.rackTexture() });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.1, 0.4), rackMat);
    rack.position.set(-1.8, 1.05, 4.75);
    this.stageGroup.add(rack);
    this._addCollider(-1.8 - 1.3, -1.8 + 1.3, 4.75 - 0.2, 5.0);

    const crateMat = new THREE.MeshLambertMaterial({ map: TX.crateTexture(theme.crate.base, theme.crate.band) });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.3, 0.5), crateMat);
    crate.position.set(2.2, 0.65, 4.7);
    this.stageGroup.add(crate);
    this._addCollider(2.2 - 0.7, 2.2 + 0.7, 4.7 - 0.25, 5.0);

    // Second half of the code, stenciled inside the crate — but the lid's
    // stuck shut until the player finds a tool to pry it with. Hidden
    // (not just "behind a locked prompt") so it can't be read until then.
    const tagMat = new THREE.MeshLambertMaterial({ map: TX.tagTexture(this.currentCode().slice(2), theme.tag) });
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), tagMat);
    tag.position.set(2.2, 0.65, 4.44);
    tag.rotation.y = Math.PI;
    tag.visible = false;
    this.stageGroup.add(tag);

    this.crateInteractable = {
      mesh: crate,
      getPrompt: () => {
        if (this.state.crateOpened) return null;
        return this.state.hasTool ? `[E] Pry ${theme.crate.label} open` : `[E] Try ${theme.crate.label}`;
      },
      onInteract: () => {
        if (this.state.crateOpened) return;
        if (!this.state.hasTool) {
          this.audio.denied();
          this.cb.onToast(theme.crate.deniedText);
          return;
        }
        this.state.crateOpened = true;
        this.audio.creak();
        tag.visible = true;
        tag.material.transparent = true;
        tag.material.needsUpdate = true;
        tag.material.opacity = 0;
        tag.scale.setScalar(0.6);
        this._tween(0.4, (p) => {
          tag.material.opacity = p;
          tag.scale.setScalar(0.6 + 0.4 * p);
        });
        this.cb.onToast(theme.crate.openToast);
      },
    };

    // The tool that opens the crate — sitting out in the open elsewhere in
    // the room, so reading the crate's clue takes exploring first.
    const toolMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#8a8f94") });
    const toolShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.55, 8), toolMat);
    toolShaft.rotation.z = Math.PI / 2;
    toolShaft.position.set(0.5, 0.06, 4.5);
    this.stageGroup.add(toolShaft);
    this.toolMesh = toolShaft;

    const toolHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    toolHitbox.position.copy(toolShaft.position);
    this.stageGroup.add(toolHitbox);

    this.toolInteractable = {
      mesh: toolHitbox,
      getPrompt: () => `[E] Pick up ${theme.tool.label}`,
      onInteract: () => {
        this.state.hasTool = true;
        toolShaft.visible = false;
        this.audio.pickup();
        this.inventoryItems.push(theme.tool.label);
        this.cb.onInventory([...this.inventoryItems]);
        this.cb.onToast(`You picked up the ${theme.tool.label}.`);
        this.interactables = this.interactables.filter((i) => i !== this.toolInteractable);
      },
    };
  }

  _buildPaintingAndSafe() {
    const theme = this.theme;
    const coverTex = TX.paintingCoverTexture(theme.coverKind);

    const frameMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#caa15a") });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 1.05), frameMat);
    frame.position.set(4.9, 1.7, -1.2);
    this.stageGroup.add(frame);

    const coverMat = new THREE.MeshLambertMaterial({ map: coverTex });
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), coverMat);
    cover.position.set(4.85, 1.7, -1.2);
    cover.rotation.y = -Math.PI / 2;
    this.stageGroup.add(cover);

    const safeMat = new THREE.MeshLambertMaterial({
      map: TX.safeFrontTexture(theme.safe.base, theme.safe.dial)
    });
    const safe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3), safeMat);
    safe.position.set(5.05, 1.55, -1.2);
    safe.visible = false;
    this.stageGroup.add(safe);

    this.paintingInteractable = {
      mesh: cover,
      getPrompt: () => theme.painting.interactText,
      onInteract: () => {
        if (this.state.paintingMoved) return;
        this.state.paintingMoved = true;
        this.audio.creak();
        cover.material.transparent = true;
        cover.material.needsUpdate = true;
        this._tween(
          0.5,
          (p) => {
            cover.scale.setScalar(1 - p);
            cover.material.opacity = 1 - p;
          },
          () => {
            cover.visible = false;
            safe.visible = true;
            this.interactables = this.interactables.filter((i) => i !== this.paintingInteractable);
            this.interactables.push(this.safeInteractable);
            this.cb.onToast(theme.painting.revealToast);
          }
        );
      },
    };

    this.safeInteractable = {
      mesh: safe,
      getPrompt: () => (this.state.safeOpen ? null : `[E] Open ${theme.safe.label}`),
      onInteract: () => {
        if (this.state.safeOpen) return;
        this.audio.click();
        this.keypadDigits = "";
        this.cb.onKeypadDigits(this.keypadDigits);
        this.cb.onKeypad(true);
        document.exitPointerLock();
        this.modalOpen = true;
      },
    };

    const keyMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#d8b34a") });
    const key = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), keyMat);
    shaft.rotation.z = Math.PI / 2;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 8, 16), keyMat);
    bow.position.x = -0.11;
    key.add(shaft, bow);
    key.position.set(4.8, 1.55, -1.2);
    key.visible = false;
    this.stageGroup.add(key);
    this.keyMesh = key;

    // THREE.Group has no raycast() method, so the visual key (a group of
    // two meshes) can never be hit directly by the raycaster. Use a small
    // invisible hitbox mesh, kept in sync with the group, as the actual
    // interaction target.
    const keyHitbox = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    keyHitbox.position.copy(key.position);
    this.stageGroup.add(keyHitbox);

    this.keyInteractable = {
      mesh: keyHitbox,
      getPrompt: () => `[E] Pick up ${theme.key.label}`,
      onInteract: () => {
        this.state.hasKey = true;
        key.visible = false;
        this.audio.pickup();
        this.inventoryItems.push(theme.key.label);
        this.cb.onInventory([...this.inventoryItems]);
        this.cb.onToast(`You picked up the ${theme.key.label}.`);
      },
    };
  }

  _buildDoor() {
    const theme = this.theme;
    const frameMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#2a1c12") });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.12), frameMat);
    frame.position.set(0, 1.15, -4.94);
    this.stageGroup.add(frame);

    const hinge = new THREE.Object3D();
    hinge.position.set(-0.55, 0, -4.9);
    this.stageGroup.add(hinge);

    const doorMat = new THREE.MeshLambertMaterial({ map: TX.woodTexture("#5a3d24") });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.1, 0.07), doorMat);
    door.position.set(0.525, 1.15, 0);
    hinge.add(door);

    const knobMat = new THREE.MeshLambertMaterial({ map: TX.metalTexture("#d8b34a") });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), knobMat);
    knob.position.set(0.95, 1.05, 0.06);
    hinge.add(knob);

    this.doorHinge = hinge;

    this.doorInteractable = {
      mesh: door,
      getPrompt: () => (this.state.hasKey ? theme.door.unlockPrompt : theme.door.lockedPrompt),
      onInteract: () => {
        if (this.state.won) return;
        if (!this.state.hasKey) {
          this.audio.denied();
          this.cb.onToast(theme.door.lockedText);
          return;
        }
        const isFinalStage = this.stageIndex >= this.totalStages - 1;
        if (isFinalStage) this.state.won = true;
        this.audio.unlock();
        this.audio.creak();
        const doorTweenDuration = 1.3;
        this._tween(doorTweenDuration, (p) => {
          hinge.rotation.y = -p * 1.9;
        });
        const elapsed = (performance.now() - this.startTime) / 1000;
        // Wait for the door-swing tween to fully finish before cutting to
        // the win screen or tearing down/rebuilding the stage — otherwise
        // the animation gets cut off mid-swing, which reads as a glitch.
        setTimeout(() => {
          if (isFinalStage) {
            this.audio.victory();
            this.cb.onWin(elapsed);
          } else {
            this.cb.onToast(theme.door.advanceToast);
            this.stageIndex += 1;
            this._buildStage();
          }
        }, doorTweenDuration * 1000 + 150);
      },
    };
  }

  _tween(duration, onUpdate, onComplete) {
    this.tweens.push({ t: 0, duration, onUpdate, onComplete });
  }

  // ---------- set dressing ----------
  // Small reusable clutter props (crates, barrels, wall tools, hanging
  // chains, a practical lantern) so each room reads like a physical
  // escape-room build instead of four bare shapes in a box. Driven by
  // each theme's `decor` list.

  _buildDecor() {
    const list = this.theme.decor;
    if (!list) return;
    for (const d of list) {
      if (d.type === "crateStack") this._addCrateStack(d.x, d.z, d.base, d.band, d.ry || 0);
      else if (d.type === "barrel") this._addBarrel(d.x, d.z, d.color, d.count || 1);
      else if (d.type === "wallTool") this._addWallTool(d.x, d.y, d.z, d.ry || 0, d.tool, d.color);
      else if (d.type === "chain") this._addChainMount(d.x, d.y, d.z, d.ry || 0);
      else if (d.type === "lanternProp") this._addLanternProp(d.x, d.y, d.z, d.glass);
      else if (d.type === "pedestal") this._addPedestal(d.x, d.z, d.h, d.base, d.band);
    }
  }

  _addCrateStack(x, z, base = "#33261a", band = "#6b5a3a", ry = 0) {
    const mat = new THREE.MeshLambertMaterial({ map: TX.crateTexture(base, band) });
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), mat);
    bottom.position.set(x, 0.275, z);
    bottom.rotation.y = ry;
    this.stageGroup.add(bottom);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.4, 0.48), mat);
    top.position.set(x + 0.1, 0.55 + 0.2, z - 0.05);
    top.rotation.y = ry + 0.3;
    this.stageGroup.add(top);
    this._addCollider(x - 0.4, x + 0.4, z - 0.4, z + 0.4);
  }

  _addBarrel(x, z, color = "#5a4530", count = 1) {
    const mat = new THREE.MeshLambertMaterial({ map: TX.crateTexture(color, "#2a2016") });
    for (let i = 0; i < count; i++) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.62, 14), mat);
      barrel.position.set(x + i * 0.62, 0.31, z);
      this.stageGroup.add(barrel);
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
    this.stageGroup.add(group);
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
    this.stageGroup.add(group);
  }

  _addPedestal(x, z, h = 0.4, base = "#1a1a1a", band = "#333") {
    const mat = new THREE.MeshLambertMaterial({ map: TX.crateTexture(base, band) });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, h, 0.5), mat);
    box.position.set(x, h / 2, z);
    this.stageGroup.add(box);
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
    this.stageGroup.add(group);
  }

  // ---------- keypad ----------

  keypadPress(d) {
    if (this.keypadDigits.length >= 4) return;
    this.keypadDigits += d;
    this.cb.onKeypadDigits(this.keypadDigits);
  }

  keypadClear() {
    this.keypadDigits = "";
    this.cb.onKeypadDigits(this.keypadDigits);
  }

  keypadSubmit() {
    if (this.keypadDigits === this.currentCode()) {
      this.state.safeOpen = true;
      this.audio.unlock();
      this.cb.onKeypad(false);
      this.modalOpen = false;
      this.keyMesh.visible = true;
      this.interactables.push(this.keyInteractable);
      this.cb.onToast(`The ${this.theme.safe.label} clicks open.`);
      this.lock();
    } else {
      this.audio.denied();
      this.cb.onKeypadShake();
      this.keypadDigits = "";
      this.cb.onKeypadDigits(this.keypadDigits);
    }
  }

  closeKeypad() {
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
    const s = this.state;
    if (!s.readNote) return "Something on the desk is worth a closer look.";
    if (!s.hasTool) return "You won't get that crate open with your bare hands. Something else in the room could help.";
    if (!s.crateOpened) return `Try that thing you picked up on the ${theme.crate.label}.`;
    if (!s.paintingMoved) return `That ${theme.painting.label} on the wall looks like it could move.`;
    if (!s.safeOpen) return "The code is hiding in plain sight — written in more than one place.";
    if (!s.hasKey) return "You just opened something. Did you take everything out of it?";
    return `You're ready. Find the ${theme.door.label} and use what you're holding.`;
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

    this.renderer.render(this.scene, this.camera);
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
    const bound = ROOM_HALF - 0.3 - r;
    const blocked = (x, z) =>
      this.colliders.some((box) => x + r > box.minX && x - r < box.maxX && z + r > box.minZ && z - r < box.maxZ);

    // Resolve X and Z movement independently so sliding along a wall or
    // furniture edge stays smooth instead of snapping/jittering.
    let nx = this.yawObject.position.x + this.velocity.x * delta;
    nx = Math.max(-bound, Math.min(bound, nx));
    if (blocked(nx, this.yawObject.position.z)) {
      nx = this.yawObject.position.x;
      this.velocity.x = 0;
    }

    let nz = this.yawObject.position.z + this.velocity.z * delta;
    nz = Math.max(-bound, Math.min(bound, nz));
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

    if (theme.ambiance === "shake" && this.isLocked) {
      this.camera.position.x = Math.sin(this.time * 13) * 0.008;
      this.camera.position.y = Math.sin(this.time * 8.3) * 0.005;
      if (this.ambianceTimer > 0.55) {
        this.ambianceTimer = 0;
        this.audio.clack();
      }
    } else if (theme.ambiance === "alarm") {
      const pulse = Math.sin(this.time * 2.4) * 0.5 + 0.5;
      this.fill.intensity = this._fillBaseIntensity * (0.4 + 0.9 * pulse);
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
