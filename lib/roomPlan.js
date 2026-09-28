// Generates the randomized, per-playthrough layout for a theme's rooms:
// which tool/fuse variant appears in which room, where they're hidden,
// and the codes. Every non-final room logs a "relay fragment" that the
// NEXT room's code needs — a daisy chain running the length of the whole
// game, not just a first-room-to-last-room shortcut, so losing track of
// any one link blocks everything after it.
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

const RELIC_SPOTS = [
  { x: 3.8, y: 0.06, z: 3.6 },
  { x: -2.5, y: 0.06, z: -1.0 },
  { x: 0.8, y: 0.06, z: -4.2 },
  { x: -4.0, y: 0.5, z: 4.0 },
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
  const relicLabels = shuffle(theme.relic.variants);

  // relayFragments[i] is logged only in room i and is required to
  // complete room (i+1)'s code — so room 0 feeds room 1, room 1 feeds
  // room 2, and so on. There's one fewer of these than rooms (the final
  // room doesn't hand anything forward).
  const relayFragments = [];
  for (let i = 0; i < n - 1; i++) relayFragments.push(String(randInt(10, 99)));

  const rooms = [];
  for (let i = 0; i < n; i++) {
    const spotOrder = shuffle([0, 1, 2, 3]);
    const relicSpotOrder = shuffle([0, 1, 2, 3]);
    const isFinal = i === n - 1;
    // Room 1 (the middle room, when there is one) gets a different kind
    // of challenge: add two numbers together instead of just reading two
    // halves back to back.
    const puzzleType = !isFinal && i === 1 && n > 2 ? "sum" : "concat";
    // Not every room's final unlock is a lockbox: the middle room instead
    // needs a scattered relic carried over and physically fitted into a
    // socket by the door — the safe's code just clears the socket to
    // accept it.
    const mechanic = !isFinal && i === 1 && n > 2 ? "socket" : "lockbox";

    let plaqueValue = null;
    let tagValue;
    let code;
    if (i === 0) {
      // The only room with nothing to carry in from earlier — fully
      // self-contained, same as before.
      plaqueValue = String(randInt(10, 99));
      tagValue = String(randInt(10, 99));
      code = plaqueValue + tagValue;
    } else if (puzzleType === "sum") {
      // One number lives in this room's crate; the other is the relay
      // fragment logged back in the previous room — you have to have
      // carried it forward to add them together.
      const a = randInt(1000, 9900);
      tagValue = String(a);
      code = String(a + Number(relayFragments[i - 1]));
    } else {
      tagValue = String(randInt(10, 99));
      code = relayFragments[i - 1] + tagValue;
    }

    rooms.push({
      index: i,
      code,
      puzzleType,
      mechanic,
      plaqueValue,
      tagValue,
      // The fragment THIS room logs for the next one (null in the final
      // room, which has nothing left to hand off).
      relayFragment: i < n - 1 ? relayFragments[i] : null,
      toolLabel: toolLabels[i % toolLabels.length],
      fuseLabel: fuseLabels[i % fuseLabels.length],
      toolSpot: TOOL_SPOTS[spotOrder[0]],
      fuseSpot: FUSE_SPOTS[spotOrder[1]],
      relicLabel: mechanic === "socket" ? relicLabels[i % relicLabels.length] : null,
      relicSpot: mechanic === "socket" ? RELIC_SPOTS[relicSpotOrder[0]] : null,
    });
  }

  return { rooms };
}
