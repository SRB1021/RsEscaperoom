import * as THREE from "three";
import {
  floorTexture,
  wallTexture,
  ceilingTexture,
  woodTexture,
  noteTexture,
  plaqueTexture,
  bookshelfTexture,
  safeFrontTexture,
  metalTexture,
} from "./textures";
import { AudioEngine } from "./audio";

const ROOM_HALF = 5;
const EYE_HEIGHT = 1.65;
const CODE = "1987";

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export class EscapeRoomGame {
  constructor(container, callbacks) {
    this.container = container;
    this.cb = callbacks;
    this.audio = new AudioEngine();

    this.keys = {};
    this.velocity = new THREE.Vector3();
    this.playerPos = new THREE.Vector3(0, 0, 3.6);
    this.playerRadius = 0.35;
    this.bobPhase = 0;
    this.distanceWalked = 0;

    this.isLocked = false;
    this.modalOpen = false;
    this.hovered = null;
    this.tweens = [];
    this.raf = null;
    this.clock = new THREE.Clock();

    this.state = {
      paintingMoved: false,
      safeOpen: false,
      hasKey: false,
      won: false,
    };
    this.keypadDigits = "";
    this.startTime = null;

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
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x14111a, 5, 16);
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
    this.yawObject.position.set(this.playerPos.x, EYE_HEIGHT, this.playerPos.z);
    this.yawObject.add(this.pitchObject);
    scene.add(this.yawObject);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    this.renderer = renderer;
    this.container.appendChild(renderer.domElement);

    // lighting
    scene.add(new THREE.AmbientLight(0x6a6478, 1.1));
    this.lamp = new THREE.PointLight(0xffb066, 3.2, 10, 2);
    this.lamp.position.set(-3.6, 1.9, -1);
    scene.add(this.lamp);

    const fill = new THREE.PointLight(0x6f83b8, 1.3, 12, 2);
    fill.position.set(0, 2.7, 1);
    scene.add(fill);

    const ceilingGlow = new THREE.PointLight(0xffe8c0, 1.1, 14, 2);
    ceilingGlow.position.set(0, 3.0, -2);
    scene.add(ceilingGlow);

    this._buildRoom();
    this._buildDesk();
    this._buildBookshelf();
    this._buildPaintingAndSafe();
    this._buildDoor();

    this.interactables = [
      this.noteInteractable,
      this.cabinetInteractable,
      this.paintingInteractable,
      this.safeInteractable,
      this.doorInteractable,
    ].filter(Boolean);

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 3.2;
  }

  _buildRoom() {
    const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const ceilMat = new THREE.MeshStandardMaterial({ map: ceilingTexture(), roughness: 1 });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 3.2;
    this.scene.add(ceiling);

    const wallMat = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.95 });
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
    const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture("#4a3220"), roughness: 0.8 });
    const desk = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.85, 0.8), woodMat);
    desk.position.set(-4.0, 0.425, -1.2);
    this.scene.add(desk);
    this._addCollider(-4.0 - 0.85, -4.0 + 0.85, -1.2 - 0.4, -1.2 + 0.4);

    // legs give it some silhouette from the front
    const noteMat = new THREE.MeshStandardMaterial({
      map: noteTexture(["A note, half-torn,", "left on the desk...", "\"The safe remembers", "the year on the", "diploma.\""]),
    });
    const note = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), noteMat);
    note.rotation.x = -Math.PI / 2;
    note.position.set(-3.75, 0.856, -1.0);
    this.scene.add(note);

    const plaqueMat = new THREE.MeshStandardMaterial({ map: plaqueTexture("1987") });
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), plaqueMat);
    plaque.position.set(-4.98, 1.9, -1.2);
    plaque.rotation.y = Math.PI / 2;
    this.scene.add(plaque);

    this.noteInteractable = {
      mesh: note,
      getPrompt: () => "[E] Read note",
      onInteract: () => {
        this.audio.click();
        this.cb.onNote(true, [
          "A note, half-torn, left on the desk...",
          "",
          '"The safe remembers the year on the diploma."',
        ]);
        document.exitPointerLock();
        this.modalOpen = true;
      },
    };
  }

  _buildBookshelf() {
    const shelfMat = new THREE.MeshStandardMaterial({ map: bookshelfTexture(), roughness: 1 });
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.1, 0.4), shelfMat);
    shelf.position.set(-1.8, 1.05, 4.75);
    this.scene.add(shelf);
    this._addCollider(-1.8 - 1.3, -1.8 + 1.3, 4.75 - 0.2, 5.0);

    const cabinetMat = new THREE.MeshStandardMaterial({ map: woodTexture("#33261a"), roughness: 0.85 });
    const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.3, 0.5), cabinetMat);
    cabinet.position.set(2.2, 0.65, 4.7);
    this.scene.add(cabinet);
    this._addCollider(2.2 - 0.7, 2.2 + 0.7, 4.7 - 0.25, 5.0);

    this.cabinetInteractable = {
      mesh: cabinet,
      getPrompt: () => "[E] Try cabinet",
      onInteract: () => {
        this.audio.denied();
        this.cb.onToast("It's locked. Nothing useful here.");
      },
    };
  }

  _buildPaintingAndSafe() {
    const paintingTex = (() => {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 320;
      const ctx = c.getContext("2d");
      const grad = ctx.createLinearGradient(0, 0, 0, 320);
      grad.addColorStop(0, "#6b4a8a");
      grad.addColorStop(1, "#2a1f40");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 320);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(180, 70, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(20,15,30,0.6)";
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 200 + i * 15);
        ctx.lineTo(256, 160 + i * 18);
        ctx.lineTo(256, 320);
        ctx.lineTo(0, 320);
        ctx.fill();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();

    const frameMat = new THREE.MeshStandardMaterial({ map: woodTexture("#caa15a") });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.3, 1.05), frameMat);
    frame.position.set(4.9, 1.7, -1.2);
    this.scene.add(frame);

    const paintingMat = new THREE.MeshStandardMaterial({ map: paintingTex });
    const painting = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.15), paintingMat);
    painting.position.set(4.85, 1.7, -1.2);
    painting.rotation.y = -Math.PI / 2;
    this.scene.add(painting);
    this.paintingMesh = painting;
    this.paintingFrame = frame;

    const safeMat = new THREE.MeshStandardMaterial({ map: safeFrontTexture(), roughness: 0.6, metalness: 0.4 });
    const safe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.6), safeMat);
    safe.position.set(4.95, 1.55, -1.2);
    safe.visible = false;
    this.scene.add(safe);
    this.safeMesh = safe;

    this.paintingInteractable = {
      mesh: painting,
      getPrompt: () => "[E] Move painting aside",
      onInteract: () => {
        if (this.state.paintingMoved) return;
        this.state.paintingMoved = true;
        this.audio.creak();
        this._tween(0.5, (p) => {
          painting.scale.setScalar(1 - p);
          painting.material.opacity = 1 - p;
        }, () => {
          painting.visible = false;
          safe.visible = true;
          this.cb.onToast("A wall safe. It needs a code.");
        });
        painting.material.transparent = true;
      },
    };

    this.safeInteractable = {
      mesh: safe,
      getPrompt: () => (this.state.safeOpen ? null : "[E] Open keypad"),
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

    // key, spawned once the safe opens
    const keyMat = new THREE.MeshStandardMaterial({ map: metalTexture("#d8b34a"), metalness: 0.7, roughness: 0.3 });
    const key = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 8), keyMat);
    shaft.rotation.z = Math.PI / 2;
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.02, 8, 16), keyMat);
    bow.position.x = -0.11;
    key.add(shaft, bow);
    key.position.set(4.6, 1.55, -1.2);
    key.visible = false;
    this.scene.add(key);
    this.keyMesh = key;

    this.keyInteractable = {
      mesh: key,
      getPrompt: () => "[E] Pick up key",
      onInteract: () => {
        this.state.hasKey = true;
        key.visible = false;
        this.audio.pickup();
        this.cb.onInventory(["Brass Key"]);
        this.cb.onToast("You picked up the brass key.");
      },
    };
  }

  _buildDoor() {
    const frameMat = new THREE.MeshStandardMaterial({ map: woodTexture("#2a1c12") });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.12), frameMat);
    frame.position.set(0, 1.15, -4.94);
    this.scene.add(frame);

    const hinge = new THREE.Object3D();
    hinge.position.set(-0.55, 0, -4.9);
    this.scene.add(hinge);

    const doorMat = new THREE.MeshStandardMaterial({ map: woodTexture("#5a3d24"), roughness: 0.7 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.05, 2.1, 0.07), doorMat);
    door.position.set(0.525, 1.15, 0);
    hinge.add(door);

    const knobMat = new THREE.MeshStandardMaterial({ map: metalTexture("#d8b34a"), metalness: 0.8, roughness: 0.3 });
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), knobMat);
    knob.position.set(0.95, 1.05, 0.06);
    hinge.add(knob);

    this.doorHinge = hinge;
    this.doorMesh = door;

    this.doorInteractable = {
      mesh: door,
      getPrompt: () => (this.state.hasKey ? "[E] Unlock door" : "[E] Try door"),
      onInteract: () => {
        if (this.state.won) return;
        if (!this.state.hasKey) {
          this.audio.denied();
          this.cb.onToast("It's locked. You need a key.");
          return;
        }
        this.state.won = true;
        this.audio.unlock();
        this.audio.creak();
        this._tween(1.3, (p) => {
          hinge.rotation.y = -p * 1.9;
        });
        const elapsed = (performance.now() - this.startTime) / 1000;
        setTimeout(() => {
          this.audio.victory();
          this.cb.onWin(elapsed);
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
    if (this.keypadDigits === CODE) {
      this.state.safeOpen = true;
      this.audio.unlock();
      this.cb.onKeypad(false);
      this.modalOpen = false;
      this.keyMesh.visible = true;
      this.interactables.push(this.keyInteractable);
      this.cb.onToast("The safe clicks open.");
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

    this._updateTweens(delta);
    this._updateMovement(delta);
    this._updateLamp(delta);
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

    const forward = (this.keys["KeyW"] ? 1 : 0) - (this.keys["KeyS"] ? 1 : 0);
    const strafe = (this.keys["KeyD"] ? 1 : 0) - (this.keys["KeyA"] ? 1 : 0);

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

    let nx = this.yawObject.position.x + this.velocity.x * delta;
    let nz = this.yawObject.position.z + this.velocity.z * delta;

    const r = this.playerRadius;
    const bound = ROOM_HALF - 0.3 - r;
    nx = Math.max(-bound, Math.min(bound, nx));
    nz = Math.max(-bound, Math.min(bound, nz));

    for (const box of this.colliders) {
      if (
        nx + r > box.minX &&
        nx - r < box.maxX &&
        nz + r > box.minZ &&
        nz - r < box.maxZ
      ) {
        // resolve along the axis of least penetration
        const overlapX = Math.min(nx + r - box.minX, box.maxX - (nx - r));
        const overlapZ = Math.min(nz + r - box.minZ, box.maxZ - (nz - r));
        if (overlapX < overlapZ) {
          nx = this.yawObject.position.x;
        } else {
          nz = this.yawObject.position.z;
        }
      }
    }

    const moved = Math.hypot(nx - this.yawObject.position.x, nz - this.yawObject.position.z);
    this.yawObject.position.x = nx;
    this.yawObject.position.z = nz;

    this.distanceWalked += moved;
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

  _updateLamp(delta) {
    this._lampT = (this._lampT || 0) + delta;
    this.lamp.intensity = 3.2 + Math.sin(this._lampT * 6) * 0.12 + (Math.random() - 0.5) * 0.15;
  }

  _updateInteraction() {
    if (!this.isLocked) {
      if (this.hovered) {
        this.hovered = null;
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

    if (found !== this.hovered) {
      this.hovered = found;
      this.cb.onPrompt(found ? found.getPrompt() : null);
    } else if (found) {
      // prompt text can change (e.g. door locked -> unlock) without hover changing
      this.cb.onPrompt(found.getPrompt());
    }
  }
}
