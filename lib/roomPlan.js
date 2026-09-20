// Generates the randomized, per-playthrough layout for a theme's rooms:
// which tool/fuse variant appears in which room, where they're hidden,
// and the codes (including the cross-room dependency, where the final
// room's code is completed by a fragment logged back in the first room).
// Called once by whoever starts the game (solo player, or the host in a
// multiplayer room) so everyone in a session sees the identical layout —
// but a fresh call (a new solo game, or a new hosted room) reshuffles
// everything.

const TOOL_SPOTS = [
  { x: 0.5, y: 0.06, z: 4.5 },
  { x: -1.0, y: 0.06, z: -3.7 },
  { x: 3.5, y: 0.06, z: -1.8 },
  { x: -3.3, y: 0.06, z: 2.0 },
];

const FUSE_SPOTS = [
  { x: 0, y: 0.3, z: -3.5 },
  { x: -3.5, y: 0.3, z: 1.5 },
  { x: 3.0, y: 0.3, z: -2.0 },
  { x: -2.0, y: 0.3, z: 3.0 },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function generateRoomPlan(theme) {
  const n = theme.stageLabels.length;
  const toolLabels = shuffle(theme.toolVariants);
  const fuseLabels = shuffle(theme.fuseVariants);
  const crossFragment = String(randInt(10, 99));

  const rooms = [];
  for (let i = 0; i < n; i++) {
    const spotOrder = shuffle([0, 1, 2, 3]);
    const isFinal = i === n - 1;
    // Room 1 (the middle room, when there is one) gets a different kind
    // of challenge: add two numbers together instead of just reading two
    // halves back to back.
    const puzzleType = !isFinal && i === 1 && n > 2 ? "sum" : "concat";

    let plaqueValue;
    let tagValue;
    let code;
    if (isFinal) {
      tagValue = String(randInt(10, 99));
      plaqueValue = null; // no plaque in the final room — see crossFragment
      code = crossFragment + tagValue;
    } else if (puzzleType === "sum") {
      const a = randInt(1000, 4999);
      const b = randInt(1000, 9999 - a);
      plaqueValue = String(a);
      tagValue = String(b);
      code = String(a + b);
    } else {
      plaqueValue = String(randInt(10, 99));
      tagValue = String(randInt(10, 99));
      code = plaqueValue + tagValue;
    }

    rooms.push({
      index: i,
      code,
      puzzleType,
      plaqueValue,
      tagValue,
      toolLabel: toolLabels[i % toolLabels.length],
      fuseLabel: fuseLabels[i % fuseLabels.length],
      toolSpot: TOOL_SPOTS[spotOrder[0]],
      fuseSpot: FUSE_SPOTS[spotOrder[1]],
    });
  }

  return { rooms, crossFragment };
}
