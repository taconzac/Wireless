/**
 * Serialization for a single routing destination stored on a hopper's
 * `container_N` dynamic property.
 *
 * v2.5 / v3.0-3.1 format (still read, never written by this version):
 *   "x,y,z"                 - always implicitly the source hopper's own
 *                             dimension, since routing had no cross-
 *                             dimension concept yet.
 *
 * v3.2+ format:
 *   "dimensionId,x,y,z"     - a normalized dimension id (see
 *                             normalizeDimensionId below).
 *
 * Every new link is written in the v3.2+ format regardless of whether the
 * destination happens to share the source's dimension - there is only one
 * write path. The legacy 3-part format is only ever encountered when
 * reading an entry created before this version; it is never rewritten in
 * place, so old saves are never touched, only interpreted leniently.
 */

/**
 * Normalizes any reasonable dimension id spelling down to one of
 * "overworld" / "nether" / "the_end" - the form `world.getDimension()` is
 * proven to accept, and the only form this addon ever used successfully
 * before cross-dimensional routing existed.
 *
 * This exists because `Dimension.id` does NOT reliably return that form at
 * runtime - confirmed directly from an actual game trace, where the same
 * hopper's routing entries were found stored as both "nether" and
 * "minecraft:nether" depending on when each link was made. Whichever of
 * those two `world.getDimension()` doesn't accept fails silently (caught
 * by the caller's own defensive try/catch), so a route in the "wrong"
 * format just never transports, with no visible error - exactly the
 * symptom reported. Normalizing at both the write and read boundary means
 * every route - old or new, whichever format it happened to get written
 * in - resolves the same, correct way from now on. No migration needed:
 * because normalization happens on *read*, this self-heals every
 * previously-written entry automatically.
 */
export function normalizeDimensionId(dimensionId) {
  const stripped = String(dimensionId || "")
    .toLowerCase()
    .replace("minecraft:", "");
  if (stripped === "overworld" || stripped === "nether" || stripped === "the_end") {
    return stripped;
  }
  return stripped || String(dimensionId || "");
}

/** Builds the string stored in a `container_N` dynamic property. */
export function formatRouteEntry(dimensionId, x, y, z) {
  return `${normalizeDimensionId(dimensionId)},${x},${y},${z}`;
}

/**
 * Parses a `container_N` value, resolving legacy (dimension-less) entries
 * against the caller-supplied fallback (the source hopper's own dimension
 * id at read time).
 * @returns {{dimensionId: string, x: number, y: number, z: number} | null}
 */
export function parseRouteEntry(locStr, fallbackDimensionId) {
  if (!locStr) return null;
  const parts = locStr.split(",");

  if (parts.length === 4) {
    const [dimensionId, x, y, z] = parts;
    return {
      dimensionId: normalizeDimensionId(dimensionId),
      x: Number(x),
      y: Number(y),
      z: Number(z),
    };
  }

  if (parts.length === 3) {
    const [x, y, z] = parts;
    return {
      dimensionId: normalizeDimensionId(fallbackDimensionId),
      x: Number(x),
      y: Number(y),
      z: Number(z),
    };
  }

  return null;
}

/** Short display tag for a dimension id, for menus/dropdowns. */
export function shortDimName(dimensionId) {
  const id = normalizeDimensionId(dimensionId);
  if (id === "nether") return "NETHER";
  if (id === "the_end") return "END";
  return "OW";
}
