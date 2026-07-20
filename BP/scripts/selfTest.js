/**
 * Pure-logic smoke tests, run once at world startup. These exercise real
 * production code (against plain-object stand-ins for Container/ItemStack)
 * and never touch @minecraft/server, so they need no experimental toggles
 * and no in-game GameTest harness - just plain JS assertions logged to the
 * content log.
 */
import { addItemsToInventory } from "./InventoryUtils.js";
import { keyFor } from "./ChunkLoaderManager.js";
import {
  formatRouteEntry,
  parseRouteEntry,
  shortDimName,
  normalizeDimensionId,
} from "./RouteEntry.js";

function fakeInventory(size) {
  const slots = new Array(size).fill(null);
  return {
    size,
    getItem: (i) => slots[i],
    setItem: (i, item) => {
      slots[i] = item ? { ...item } : null;
    },
  };
}

function fakeItemStack(typeId, amount, maxAmount = 64) {
  return {
    typeId,
    amount,
    maxAmount,
    clone() {
      return fakeItemStack(this.typeId, this.amount, this.maxAmount);
    },
  };
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function testStackingIntoPartialSlotBeforeEmpty(failures) {
  const inv = fakeInventory(3);
  inv.setItem(0, fakeItemStack("minecraft:redstone", 60));
  const left = addItemsToInventory(
    inv,
    fakeItemStack("minecraft:redstone", 20),
    20,
  );
  assert(left === 0, "stacking: all items should fit (partial + empty slot)", failures);
  assert(
    inv.getItem(0).amount === 64,
    "stacking: existing slot should top up to max first",
    failures,
  );
  assert(
    inv.getItem(1).amount === 16,
    "stacking: overflow should land in the next empty slot",
    failures,
  );
}

function testStackingReportsLeftoverWhenFull(failures) {
  const inv = fakeInventory(1);
  inv.setItem(0, fakeItemStack("minecraft:redstone", 64));
  const left = addItemsToInventory(
    inv,
    fakeItemStack("minecraft:redstone", 5),
    5,
  );
  assert(
    left === 5,
    "stacking: full inventory should report all items as leftover, never lose them",
    failures,
  );
}

function testStackingIgnoresMismatchedType(failures) {
  const inv = fakeInventory(1);
  inv.setItem(0, fakeItemStack("minecraft:cobblestone", 10));
  const left = addItemsToInventory(
    inv,
    fakeItemStack("minecraft:redstone", 5),
    5,
  );
  assert(
    left === 5,
    "stacking: should not merge into a differently-typed stack",
    failures,
  );
}

function testChunkLoaderKeysAreUniquePerDimensionAndLocation(failures) {
  const a = keyFor("overworld", 10, 64, -20);
  const b = keyFor("nether", 10, 64, -20);
  const c = keyFor("overworld", 10, 64, -20);
  const d = keyFor("overworld", 11, 64, -20);
  assert(
    a !== b,
    "chunk loader keys: same coords in different dimensions must differ (avoids merging unrelated loaders)",
    failures,
  );
  assert(
    a === c,
    "chunk loader keys: identical dimension+coords must produce the same key (dedupe/reuse)",
    failures,
  );
  assert(
    a !== d,
    "chunk loader keys: different coords must produce different keys",
    failures,
  );
}

function testRouteEntryRoundTripsThroughFormatAndParse(failures) {
  // formatRouteEntry/parseRouteEntry normalize whatever dimension id
  // spelling they're given down to the short form world.getDimension()
  // is proven to accept (this is the fix for cross-dimension routes that
  // established but silently never transported: a "minecraft:"-prefixed
  // id round-tripped verbatim made world.getDimension() throw, which was
  // caught and swallowed by the caller's own defensive try/catch).
  const str = formatRouteEntry("minecraft:nether", 123, 64, -456);
  const parsed = parseRouteEntry(str, "minecraft:overworld");
  assert(
    parsed &&
      parsed.dimensionId === "nether" &&
      parsed.x === 123 &&
      parsed.y === 64 &&
      parsed.z === -456,
    "route entry: format -> parse round-trips coordinates and normalizes the dimension id",
    failures,
  );
}

function testRouteEntryFallsBackToSourceDimensionForLegacyEntries(failures) {
  const legacy = "123,64,-456"; // v2.5/v3.0-3.1 format: no dimension field
  const parsed = parseRouteEntry(legacy, "minecraft:the_end");
  assert(
    parsed &&
      parsed.dimensionId === "the_end" &&
      parsed.x === 123 &&
      parsed.y === 64 &&
      parsed.z === -456,
    "route entry: a dimension-less legacy entry resolves to the caller's (normalized) fallback dimension",
    failures,
  );
}

function testRouteEntryHandlesMissingOrMalformedInput(failures) {
  assert(
    parseRouteEntry(undefined, "minecraft:overworld") === null,
    "route entry: an empty/undefined entry parses to null instead of throwing",
    failures,
  );
  assert(
    parseRouteEntry("not,enough", "minecraft:overworld") === null,
    "route entry: a malformed entry (wrong part count) parses to null instead of throwing",
    failures,
  );
}

function testNormalizeDimensionIdHandlesEveryRealisticSpelling(failures) {
  assert(
    normalizeDimensionId("minecraft:overworld") === "overworld",
    "normalizeDimensionId: strips the minecraft: prefix",
    failures,
  );
  assert(
    normalizeDimensionId("nether") === "nether",
    "normalizeDimensionId: leaves an already-short id unchanged",
    failures,
  );
  assert(
    normalizeDimensionId("MINECRAFT:THE_END") === "the_end",
    "normalizeDimensionId: is case-insensitive",
    failures,
  );
  assert(
    normalizeDimensionId("minecraft:overworld") === normalizeDimensionId("overworld"),
    "normalizeDimensionId: prefixed and short forms of the same dimension normalize identically (this is the actual fix - a route stored via one spelling must resolve the same way a route stored via the other does)",
    failures,
  );
}

function testShortDimNameCoversAllThreeDimensions(failures) {
  assert(
    shortDimName("minecraft:overworld") === "OW",
    "shortDimName: overworld maps to OW",
    failures,
  );
  assert(
    shortDimName("minecraft:nether") === "NETHER",
    "shortDimName: nether maps to NETHER",
    failures,
  );
  assert(
    shortDimName("minecraft:the_end") === "END",
    "shortDimName: the_end maps to END",
    failures,
  );
}

export function runSelfTests() {
  const failures = [];
  testStackingIntoPartialSlotBeforeEmpty(failures);
  testStackingReportsLeftoverWhenFull(failures);
  testStackingIgnoresMismatchedType(failures);
  testChunkLoaderKeysAreUniquePerDimensionAndLocation(failures);
  testRouteEntryRoundTripsThroughFormatAndParse(failures);
  testRouteEntryFallsBackToSourceDimensionForLegacyEntries(failures);
  testRouteEntryHandlesMissingOrMalformedInput(failures);
  testNormalizeDimensionIdHandlesEveryRealisticSpelling(failures);
  testShortDimNameCoversAllThreeDimensions(failures);

  if (failures.length === 0) {
    console.log("[Wireless Hopper] Self-test: all checks passed.");
  } else {
    console.warn(
      `[Wireless Hopper] Self-test: ${failures.length} check(s) failed:\n` +
        failures.map((f) => ` - ${f}`).join("\n"),
    );
  }
  return failures;
}
