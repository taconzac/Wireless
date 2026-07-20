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
 *   "dimensionId,x,y,z"     - the destination's own dimension id (exactly
 *                             the string Bedrock's own `Dimension.id`
 *                             getter returned when the link was created),
 *                             so it round-trips through `world.getDimension()`
 *                             without needing to guess a format.
 *
 * Every new link is written in the v3.2+ format regardless of whether the
 * destination happens to share the source's dimension - there is only one
 * write path. The legacy 3-part format is only ever encountered when
 * reading an entry created before this version; it is never rewritten in
 * place, so old saves are never touched, only interpreted leniently.
 */

/** Builds the string stored in a `container_N` dynamic property. */
export function formatRouteEntry(dimensionId, x, y, z) {
  return `${dimensionId},${x},${y},${z}`;
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
    return { dimensionId, x: Number(x), y: Number(y), z: Number(z) };
  }

  if (parts.length === 3) {
    const [x, y, z] = parts;
    return { dimensionId: fallbackDimensionId, x: Number(x), y: Number(y), z: Number(z) };
  }

  return null;
}

/** Short display tag for a dimension id, for menus/dropdowns. */
export function shortDimName(dimensionId) {
  const id = (dimensionId || "").replace("minecraft:", "");
  if (id === "nether") return "NETHER";
  if (id === "the_end") return "END";
  return "OW";
}
