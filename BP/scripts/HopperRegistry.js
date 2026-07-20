/**
 * A persistent index of where each player's Wireless Hoppers are, kept on a
 * world dynamic property. This exists because `dimension.getEntities()`
 * only ever returns entities in *currently simulated* chunks - searching
 * all three dimensions live (as earlier versions of the linking wizard did)
 * can only ever find hoppers in a dimension someone is presently standing
 * in. A hopper sitting in the Nether is essentially never "live" while a
 * player links from the Overworld, so it could never appear in the wizard's
 * dropdown at all. This registry is small (owner + custom name per
 * location, keyed by dimension+coordinates), updated at placement/rename/
 * break time, and self-healed for pre-existing hoppers the first time the
 * main tick loop ever sees them again after upgrading.
 *
 * A second, related problem this file solves: even with the registry
 * making a remote hopper *visible* in the dropdown, actually writing the
 * new route requires a live entity reference (routing data lives on the
 * source hopper's own dynamic properties, unchanged from v2.5) - and the
 * whole point of cross-dimension linking is that the source often isn't
 * loaded at link time. The "pending links" queue below records that intent
 * and the main tick loop applies it automatically the next time that
 * specific hopper is loaded, running the exact same validation
 * (recursion/port-limit/duplicate checks) the immediate path does.
 */
import { world } from "@minecraft/server";
import { formatRouteEntry, parseRouteEntry, normalizeDimensionId } from "./RouteEntry.js";

const REGISTRY_PROPERTY = "wh:hopper_registry";
const PENDING_LINKS_PROPERTY = "wh:pending_links";

function loadRegistry() {
  try {
    const raw = world.getDynamicProperty(REGISTRY_PROPERTY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveRegistry(registry) {
  try {
    world.setDynamicProperty(REGISTRY_PROPERTY, JSON.stringify(registry));
  } catch (e) {}
}

/** Adds/updates a hopper's registry entry. Skips the write if unchanged. */
export function registerHopper(dimensionId, x, y, z, ownerName, customName) {
  const key = formatRouteEntry(dimensionId, x, y, z);
  const normalizedCustomName = customName || null;
  const registry = loadRegistry();
  const existing = registry[key];
  if (existing && existing.ownerName === ownerName && existing.customName === normalizedCustomName) {
    return;
  }
  registry[key] = { ownerName, customName: normalizedCustomName };
  saveRegistry(registry);
}

/** Removes a hopper's registry entry (called when it's broken). */
export function unregisterHopper(dimensionId, x, y, z) {
  const key = formatRouteEntry(dimensionId, x, y, z);
  const registry = loadRegistry();
  if (key in registry) {
    delete registry[key];
    saveRegistry(registry);
  }
}

/**
 * @returns {{dimensionId: string, x: number, y: number, z: number, customName: string | null}[]}
 *   every hopper this owner has, regardless of whether it's currently loaded.
 */
export function getHoppersForOwner(ownerName) {
  const registry = loadRegistry();
  const results = [];
  for (const [key, data] of Object.entries(registry)) {
    if (data.ownerName !== ownerName) continue;
    // The key is always in formatRouteEntry's 4-part shape (it was built
    // with formatRouteEntry above), so there's no dimension-less case to
    // fall back for here - the second argument is never actually used.
    const parsed = parseRouteEntry(key, undefined);
    if (parsed) results.push({ ...parsed, customName: data.customName });
  }
  return results;
}

function loadPendingLinks() {
  try {
    const raw = world.getDynamicProperty(PENDING_LINKS_PROPERTY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function savePendingLinks(links) {
  try {
    world.setDynamicProperty(PENDING_LINKS_PROPERTY, JSON.stringify(links));
  } catch (e) {}
}

/**
 * Cheap existence check (no JSON.parse) so the main tick loop can skip the
 * pending-links path entirely on the overwhelmingly common tick where
 * nothing is queued.
 */
export function hasPendingLinks() {
  try {
    const raw = world.getDynamicProperty(PENDING_LINKS_PROPERTY);
    return !!raw && raw !== "[]";
  } catch (e) {
    return false;
  }
}

/**
 * Queues a link to be established once the source hopper next loads. Both
 * dimension ids are normalized here so a match in popPendingLinksFor() can
 * never fail just because the caller passed a raw `Dimension.id` string on
 * one side and an already-normalized one (e.g. from the registry) on the
 * other - every value that ever reaches storage goes through the same
 * normalization, regardless of which of the two call sites it came from.
 */
export function queuePendingLink(sourceDimensionId, sourceX, sourceY, sourceZ, destDimensionId, destX, destY, destZ) {
  const links = loadPendingLinks();
  links.push({
    sourceDimensionId: normalizeDimensionId(sourceDimensionId),
    sourceX,
    sourceY,
    sourceZ,
    destDimensionId: normalizeDimensionId(destDimensionId),
    destX,
    destY,
    destZ,
  });
  savePendingLinks(links);
}

/**
 * Removes and returns every pending link whose source matches the given
 * location, for the main tick loop to apply against a now-live entity.
 * Normalizes its own dimension id argument for the same reason as above.
 */
export function popPendingLinksFor(sourceDimensionId, sourceX, sourceY, sourceZ) {
  const normalizedSourceDimensionId = normalizeDimensionId(sourceDimensionId);
  const links = loadPendingLinks();
  const matching = [];
  const remaining = [];
  for (const link of links) {
    if (
      link.sourceDimensionId === normalizedSourceDimensionId &&
      link.sourceX === sourceX &&
      link.sourceY === sourceY &&
      link.sourceZ === sourceZ
    ) {
      matching.push(link);
    } else {
      remaining.push(link);
    }
  }
  if (matching.length > 0) {
    savePendingLinks(remaining);
  }
  return matching;
}
