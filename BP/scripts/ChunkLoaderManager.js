// Ported from the myGen Chunk Loader's core trick: an invisible entity
// carrying the `minecraft:tick_world` component keeps a small radius of
// chunks simulating around it, with no tickingarea commands, no cheats,
// and no player-placed block required.
//
// A loader is spawned only when a hopper is about to deliver items to a
// destination, and stays alive for as long as at least one hopper still
// has a route pointing at that destination - not on an idle timer. One
// loader is shared by every hopper that routes to the same destination,
// so duplicate loaders are never created.
//
// Earlier versions despawned a loader ~15s after its last delivery
// attempt, on the theory that it could simply be respawned again next
// time it was needed. That doesn't actually hold: Bedrock's script API
// cannot force-load a chunk that has gone fully cold (confirmed directly
// via [TRACE-DELIVER] - `spawnEntity` throws `LocationInUnloadedChunkError`
// for a destination that has no player nearby), so once an idle-timed-out
// loader let its chunk unload, that destination could only ever recover if
// a player physically visited again. Since routes are meant to run
// unattended, that made every configured destination a ticking time bomb
// that would eventually stop working outright, in every dimension - not
// something specific to the Nether. Keeping a loader alive for as long as
// its destination is still configured is the only version of this that
// can't fail that way.

const LOADER_ENTITY_ID = "wr:chunk_loader";
const ACTIVATE_EVENT = "wr_loader:activate";

function isEntityValid(entity) {
  if (!entity) return false;
  try {
    return typeof entity.isValid === "function"
      ? entity.isValid()
      : entity.isValid !== false;
  } catch {
    return false;
  }
}

export function keyFor(dimensionId, x, y, z) {
  return `${dimensionId}:${x}:${y}:${z}`;
}

class ChunkLoaderManager {
  constructor() {
    /** @type {Map<string, { entity: import("@minecraft/server").Entity }>} */
    this.loaders = new Map();
  }

  /**
   * Ensure a chunk loader is active at the given block location. Safe to
   * call every tick - reuses the existing loader for this destination if
   * one is already active, and does nothing further once one is.
   *
   * If the destination chunk isn't currently simulated at all, Bedrock's
   * script API cannot force it to load (there is no non-cheat way to load
   * a chunk no player has ever been near); this silently no-ops and the
   * caller's own per-tick retry loop tries again next tick until the
   * destination becomes reachable (typically: a player visits it, or
   * linking to it - see the linking handler in main.js - bootstraps it
   * immediately since the player is standing right there).
   *
   * @returns {{ active: boolean, spawnError?: unknown }} `active` is true
   * if a loader is confirmed running at this destination (existing or
   * freshly spawned) after this call; `spawnError`, when present, is the
   * error `spawnEntity` threw on a failed attempt - exposed so a caller
   * chasing "why doesn't this destination ever load" can report it
   * instead of it being swallowed silently.
   */
  ensureLoaded(dimension, location) {
    const x = Math.floor(location.x);
    const y = Math.floor(location.y);
    const z = Math.floor(location.z);
    const key = keyFor(dimension.id, x, y, z);

    const existing = this.loaders.get(key);
    if (existing && isEntityValid(existing.entity)) {
      return { active: true };
    }

    try {
      const entity = dimension.spawnEntity(LOADER_ENTITY_ID, {
        x: x + 0.5,
        y: y + 0.5,
        z: z + 0.5,
      });
      entity.triggerEvent(ACTIVATE_EVENT);
      this.loaders.set(key, { entity });
      return { active: true };
    } catch (spawnError) {
      // Destination not reachable yet (unloaded/ungenerated chunk, or
      // dimension not currently loaded). No entity was created, so there
      // is nothing to clean up — just retry on the next call.
      return { active: false, spawnError };
    }
  }

  /**
   * Remove every active loader whose destination key is NOT in
   * `activeKeys` - i.e. no hopper anywhere still has a route pointing at
   * it. The caller (main.js, which already enumerates every hopper's
   * routes on its own periodic schedule) is responsible for building that
   * set; this class has no notion of hoppers or routes itself.
   */
  pruneUnreferenced(activeKeys) {
    if (this.loaders.size === 0) return;
    for (const [key, loader] of this.loaders) {
      if (activeKeys.has(key)) continue;
      try {
        if (isEntityValid(loader.entity)) loader.entity.remove();
      } catch {}
      this.loaders.delete(key);
    }
  }
}

export const chunkLoaderManager = new ChunkLoaderManager();

/**
 * Remove every wr:chunk_loader entity found in a dimension, regardless of
 * whether this session's manager knows about it. Call once at startup to
 * reconcile state after a server restart or world reload: the manager's
 * in-memory map always starts empty, so any surviving loader entity from a
 * previous session is guaranteed to be an orphan.
 */
export function purgeOrphanLoaders(dimension) {
  try {
    const entities = dimension.getEntities({ type: LOADER_ENTITY_ID });
    for (const entity of entities) {
      try {
        entity.remove();
      } catch {}
    }
  } catch {}
}
