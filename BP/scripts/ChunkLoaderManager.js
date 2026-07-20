import { system } from "@minecraft/server";

// Ported from the myGen Chunk Loader's core trick: an invisible entity
// carrying the `minecraft:tick_world` component keeps a small radius of
// chunks simulating around it, with no tickingarea commands, no cheats,
// and no player-placed block required.
//
// Unlike myGen (one persistent, player-managed loader per placed block),
// Wireless Hopper never keeps anything loaded permanently. A loader is
// spawned only when a hopper is about to deliver items to a destination,
// and it despawns itself automatically ~15s after the last delivery
// attempt to that destination. One loader is shared by every hopper that
// routes to the same destination, so duplicate loaders are never created.

const LOADER_ENTITY_ID = "wr:chunk_loader";
const ACTIVATE_EVENT = "wr_loader:activate";
const KEEP_LOADED_TICKS = 300; // ~15 seconds at 20 ticks/sec
const SWEEP_INTERVAL_TICKS = 20; // check for expired loaders once per second

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
    /** @type {Map<string, { entity: import("@minecraft/server").Entity, expireAtTick: number }>} */
    this.loaders = new Map();
    system.runInterval(() => this.sweepExpired(), SWEEP_INTERVAL_TICKS);
  }

  /**
   * Ensure a temporary chunk loader is active at the given block location,
   * (re)starting its ~15s keep-alive timer so it survives long enough for
   * the in-flight transfer to land. Safe to call every tick — reuses the
   * existing loader for this destination if one is already active.
   *
   * If the destination chunk isn't currently simulated at all, Bedrock's
   * script API cannot force it to load (there is no non-cheat way to load
   * a chunk no player has ever been near); this silently no-ops and the
   * caller's own per-tick retry loop tries again next tick until the
   * destination becomes reachable.
   */
  ensureLoaded(dimension, location) {
    const x = Math.floor(location.x);
    const y = Math.floor(location.y);
    const z = Math.floor(location.z);
    const key = keyFor(dimension.id, x, y, z);
    const expireAtTick = system.currentTick + KEEP_LOADED_TICKS;

    const existing = this.loaders.get(key);
    if (existing && isEntityValid(existing.entity)) {
      existing.expireAtTick = expireAtTick;
      return;
    }

    try {
      const entity = dimension.spawnEntity(LOADER_ENTITY_ID, {
        x: x + 0.5,
        y: y + 0.5,
        z: z + 0.5,
      });
      entity.triggerEvent(ACTIVATE_EVENT);
      this.loaders.set(key, { entity, expireAtTick });
    } catch {
      // Destination not reachable yet (unloaded/ungenerated chunk, or
      // dimension not currently loaded). No entity was created, so there
      // is nothing to clean up — just retry on the next call.
    }
  }

  /** Remove every loader whose keep-alive timer has expired. */
  sweepExpired() {
    if (this.loaders.size === 0) return;
    const now = system.currentTick;
    for (const [key, loader] of this.loaders) {
      if (now < loader.expireAtTick) continue;
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
