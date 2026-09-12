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
    this.audio.init();
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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    this.lamp = this._addFlickerLight(
      theme.palette.lampColor,
      theme.palette.lampIntensity * POINT_LIGHT_SCALE,
      -3.6,
      1.9,
      -1
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

    this.colliders = [];
    this.state = { paintingMoved: false, safeOpen: false, hasKey: false, won: false };
    this.keypadDigits = "";
    this.hovered = null;
    this._lastPrompt = null;

    this._buildDesk();
    this._buildRackAndCrate();
    this._buildPaintingAndSafe();
    this._buildDoor();

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

    const floorMat = new THREE.MeshStandardMaterial({ map: floorFns[theme.floor.fn](), roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const ceilMat = new THREE.MeshStandardMaterial({ map: TX.ceilingTexture(theme.ceiling.base), roughness: 1 });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3.2;
    this.scene.add(ceiling);

    const wallMat = new THREE.MeshStandardMaterial({ map: texFns[theme.wall.fn](), roughness: 0.95 });
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

    this.colliders = [];
  }

  _addCollider(minX, maxX, minZ, maxZ) {
    this.colliders.push({ minX, maxX, minZ, maxZ });
  }

  _buildDesk() {
    const theme = this.theme;
    const woodMat = new THREE.MeshStandardMaterial({ map: TX.woodTexture(theme.desk.woodBase), roughness: 0.8 });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 0.8), woodMat);
    desk.position.set(-4.0, 0.425, -1.2);
    this.stageGroup.add(desk);
    this._addCollider(-4.0 - 0.85, -4.0 + 0.85, -1.2 - 0.4, -1.2 + 0.4);

    const noteMat = new THREE.MeshStandardMaterial({
      map: TX.noteTexture(theme.note.lines, { bg: theme.note.bg, textColor: theme.note.textColor, font: theme.note.font }),
    });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), noteMat);
    note.rotation.x = -Math.PI / 2;
    note.position.set(-3.75, 0.856, -1.0);
    this.stageGroup.add(note);

    const plaqueMat = new THREE.MeshStandardMaterial({
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
        this.audio.click();
        this.cb.onNote(true, theme.note.lines.map((l) => l.trim()));
        document.exitPointerLock();
        this.modalOpen = true;
      },
    };
  }

  _buildRackAndCrate() {
    const theme = this.theme;
    const rackMat = new THREE.MeshStandardMaterial({ map: TX.rackTexture(), roughness: 1 });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.1, 0.4), rackMat);
    rack.position.set(-1.8, 1.05, 4.75);
    this.stageGroup.add(rack);
    this._addCollider(-1.8 - 1.3, -1.8 + 1.3, 4.75 - 0.2, 5.0);

    const crateMat = new THREE.MeshStandardMaterial({ map: TX.crateTexture(theme.crate.base, theme.crate.band), roughness: 0.85 });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.3, 0.5), crateMat);
    crate.position.set(2.2, 0.65, 4.7);
    this.stageGroup.add(crate);
    this._addCollider(2.2 - 0.7, 2.2 + 0.7, 4.7 - 0.25, 5.0);

    // second half of the code, stenciled on the crate the player can see
    // but can't open — forces exploring the whole room, not just the desk.
    const tagMat = new THREE.MeshStandardMaterial({ map: TX.tagTexture(this.currentCode().slice(2), theme.tag) });
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.2), tagMat);
    tag.position.set(2.2, 0.65, 4.44);
    tag.rotation.y = Math.PI;
    this.stageGroup.add(tag);

    this.crateInteractable = {
      mesh: crate,
      getPrompt: () => `[E] Try ${theme.crate.label}`,
      onInteract: () => {
        this.audio.denied();
        this.cb.onToast(theme.crate.deniedText);
      },
    };
  }

  _buildPaintingAndSafe() {
    const theme = this.theme;
    const coverTex = TX.paintingCoverTexture(theme.coverKind);

    const frameMat = new THREE.MeshStandardMaterial({ map: TX.woodTexture("#caa15a") });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 1.05), frameMat);
    frame.position.set(4.9, 1.7, -1.2);
    this.stageGroup.add(frame);

    const coverMat = new THREE.MeshStandardMaterial({ map: coverTex });
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), coverMat);
    cover.position.set(4.85, 1.7, -1.2);
    cover.rotation.y = -Math.PI / 2;
    this.stageGroup.add(cover);

    const safeMat = new THREE.MeshStandardMaterial({
      map: TX.safeFrontTexture(theme.safe.base, theme.safe.dial),
      roughness: 0.6,
      metalness: 0.4,
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

    const keyMat = new THREE.MeshStandardMaterial({ map: TX.metalTexture("#d8b34a"), metalness: 0.7, roughness: 0.3 });
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
        this.cb.onInventory([theme.key.label]);
        this.cb.onToast(`You picked up the ${theme.key.label}.`);
      },
    };
  }

  _buildDoor() {
    const theme = this.theme;
    const frameMat = new THREE.MeshStandardMaterial({ map: TX.woodTexture("#2a1c12") });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.12), frameMat);
    frame.position.set(0, 1.15, -4.94);
    this.stageGroup.add(frame);

    const hinge = new THREE.Object3D();
    hinge.position.set(-0.55, 0, -4.9);
    this.stageGroup.add(hinge);

    const doorMat = new THREE.MeshStandardMaterial({ map: TX.woodTexture("#5a3d24"), roughness: 0.7 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.1, 0.07), doorMat);
    door.position.set(0.525, 1.15, 0);
    hinge.add(door);

    const knobMat = new THREE.MeshStandardMaterial({ map: TX.metalTexture("#d8b34a"), metalness: 0.8, roughness: 0.3 });
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
        this._tween(1.3, (p) => {
          hinge.rotation.y = -p * 1.9;
        });
        const elapsed = (performance.now() - this.startTime) / 1000;
        setTimeout(() => {
          if (isFinalStage) {
            this.audio.victory();
            this.cb.onWin(elapsed);
          } else {
            this.cb.onToast(theme.door.advanceToast);
            this.stageIndex += 1;
            this._buildStage();
          }
        }, 1100);
      },
    };
  }

  _tween(duration, onUpdate, onComplete) {
    this.tweens.push({ t: 0, duration, onUpdate, onComplete });
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
