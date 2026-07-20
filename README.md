# Wireless Hopper 3.0

A personal-use Minecraft Bedrock add-on. Wireless Hopper v2.5's item-routing
feature set, with its `/tickingarea`-based chunk loader replaced by the
entity-based `minecraft:tick_world` technique from the myGen Chunk Loader.

## What's in this repo

```
BP/    Wireless Hopper 3.0 Behaviour Pack
RP/    Wireless Hopper 3.0 Resource Pack
CHANGELOG.md
README.md   (this file)
```

Everything under `BP/` and `RP/` except `BP/scripts/` is byte-for-byte
identical to Wireless Hopper v2.5 (blocks, items, entities, recipes, models,
textures) — the wrench, the hopper block/entity, filters, channels, range
upgrades, redstone modes, crafting, and UI text are all unchanged. Two
things were rewritten in `scripts/`: the chunk-loading implementation
(v3.0), and, as of v3.1, the fuel system was removed entirely — hoppers
now run unconditionally from the moment they're placed. See CHANGELOG.md
for the full list of what changed in each version.

## Architecture

### The old way (v2.5, removed)

Every hopper had a "Chunk Loader (Keep Loaded)" toggle. Turning it on ran
`dim.runCommand("tickingarea add circle ...")`; turning it off ran
`tickingarea remove`. This required cheats to be enabled in some contexts,
kept the *hopper itself* permanently loaded regardless of whether anything
was actually being transferred, and needed a menu the player had to
remember to use.

### The new way (3.0)

Ported from myGen: `wr:chunk_loader` is an invisible entity
(`BP/entities/chunk_loader.json`) that does nothing except carry the
`minecraft:tick_world` component:

```json
"wr_loader:active": {
  "minecraft:tick_world": { "never_despawn": true, "radius": 1 }
}
```

`tick_world` keeps a small radius of chunks simulating around whatever
entity carries it — no `/tickingarea` command, no cheats, no player-placed
block. `ChunkLoaderManager.js` (`BP/scripts/ChunkLoaderManager.js`) is the
only thing that ever spawns or removes one:

- `ensureLoaded(dimension, location)` — called every tick a hopper has an
  item ready to send to that location. If a loader already exists there
  (keyed by `dimension:x:y:z`, shared across every hopper routing to the
  same spot), its 15-second keep-alive timer is just extended. Otherwise a
  new loader entity is spawned and immediately triggers
  `wr_loader:activate`.
- A 1-second sweep (`system.runInterval`) removes any loader whose timer has
  expired.
- `purgeOrphanLoaders(dimension)` runs once at world startup and removes
  every `wr:chunk_loader` entity found — a fresh session's loader map always
  starts empty, so any survivor is guaranteed to be left over from before a
  restart/reload.

**The source hopper is never chunk-loaded by this system** — it's already
loaded, because a player just caused an item to enter it. Only destinations
get a temporary loader, and only while a delivery is actually in flight.

### How linking and sending changed

Linking (wrench + sneak + interact on a container) is functionally
identical to v2.5: it stores `container_N` = `"x,y,z"` on the source hopper
entity. That string *is* the registration the new system needs — there is
nothing extra to place or configure, matching the "no separate chunk loader
to manage" goal. All the temporary-loading logic is deferred to delivery
time:

```
item enters hopper's source inventory
        |
processDistribution() runs (every tick, as it always did)
        |
for each destination this item could go to:
        chunkLoaderManager.ensureLoaded(dim, destination)   <- activate/extend
        attempt the transfer (unchanged addItemsToInventory logic)
        |
   still has leftover? -> stays in source inventory, retried next tick
   transfer succeeded?  -> item leaves source; destination's 15s timer
                            was already extended by ensureLoaded() above
        |
no activity for ~15s at a destination -> its loader entity is removed
```

Because the retry already happens every tick (this loop existed in v2.5
unchanged), "wait until the destination inventory becomes valid" isn't a
separate state machine — it's just what already happens when a target
chunk isn't ready yet: `dim.getBlock()`/`getComponent("inventory")` comes
back empty, the item stays put, and the next tick tries again after
`ensureLoaded` has had another chance to bring the chunk up.

### Cross-dimension routing (not supported — inherited, unchanged)

A hopper cannot route items from the Nether to the Overworld (or any other
dimension pair). This isn't a gap introduced by this rewrite: `container_N`
has always been stored as a bare `"x,y,z"` string with no dimension field,
and the linking wizard (`world.beforeEvents.playerInteractWithBlock`) only
ever lists the player's own hoppers in `player.dimension` against a
destination `block` that is necessarily in that same dimension — you
physically cannot right-click a block in a dimension you're not standing
in. `processDistribution()` looks up every destination in the same `dim`
object the source hopper's own loop iteration passed in. Changing this
would mean storing a dimension id per route and reworking the linking UI
to pair across dimensions (e.g. by coordinates instead of "stand in front
of it") — a real feature addition, not a chunk-loading change, so I left it
alone per "do not redesign the add-on." The chunk-loading mechanism itself
has no such restriction: `ensureLoaded()` just uses whatever `dimension`
object it's handed, so Nether-to-Nether or End-to-End destinations load
exactly the same way Overworld ones do.

### Known Bedrock platform limitation

Bedrock's Script API has no non-cheat way to force-load a chunk that no
player has ever been near. This isn't a shortcut we took — it's a hard
platform boundary, and myGen's own admin tooling hits the identical wall
(`toggleChunkLoader()` in myGen's `main.js` explicitly tells the player
"Travel to X to activate it" when a loader's chunk isn't currently
simulated). `ensureLoaded()` reflects that honestly: it's wrapped in a
try/catch, and if spawning the loader entity fails because the destination
chunk isn't reachable, it silently does nothing and lets the existing
per-tick retry try again later. **No item is ever lost or duplicated by
this** — it just waits, which is exactly what the spec asked for.

What this system *does* reliably guarantee, with zero commands and zero
cheats: a destination that's currently reachable stays loaded through the
transfer and for ~15s afterward, so it can't flicker out mid-delivery, and
rapid repeated transfers to the same destination share one loader instead
of creating duplicates.

### Backwards compatibility

The manifest header UUIDs and module UUIDs are unchanged from v2.5, so this
is an in-place update, not a new add-on — a world with Wireless Hopper v2.5
applied will pick up 3.x the moment the pack files are replaced, no
relinking needed. All routing-relevant dynamic properties (`ownerName`,
`containerCount`, `container_0..9`, `filterList`, `isWhitelist`,
`CollectRange`, `distMode`, `rsMode`, `xpMode`, `trashMode`, `customName`,
`rrIndex`) are read and written exactly as before. The startup migration
strips legacy state that no longer means anything: the `ChunkLoaded` tag
(drove the old tickingarea toggle) and, as of 3.1, the `fuel`/`fuelTime`
properties and `FuelNotification` tag (the fuel system is gone — hoppers
placed under v2.5 simply start working unconditionally the next time the
world loads, with no fuel to refill).

## Testing

### Automated

`BP/scripts/selfTest.js` runs once at world startup and checks the real
inventory-stacking logic (`InventoryUtils.js`) and chunk-loader key
generation (`ChunkLoaderManager.js`) against plain-object stand-ins for
Bedrock's `Container`/`ItemStack`, logging a pass/fail summary to the
content log. This deliberately avoids the GameTest framework, which
requires an experimental toggle — incompatible with the "no experiments"
requirement. I also ran this exact test suite standalone under Node.js
(with `@minecraft/server` stubbed out) during development; all checks
passed. I additionally validated every JSON file for syntax and ran
`node --check` over every script — both clean.

I also built a one-off executable integration harness (stubbed
`@minecraft/server`/`@minecraft/server-ui`, not shipped in the pack) that
drives the real, exported `processDistribution()` and `chunkLoaderManager`
through a full destination lifecycle: destination unreachable for several
ticks (no crash, item stays put, no loader spawned) → destination becomes
reachable (item transfers on the very next tick, exactly one loader entity
spawned) → a second hopper routing to the same destination (no duplicate
loader) → 300+ ticks of inactivity (loader entity removed). I confirmed
this is a meaningful test by first running it against the pre-fix code:
`dim.getBlock()` throwing `LocationInUnloadedChunkError` on an unloaded
destination crashed `processDistribution()` uncaught, which is the actual
bug the fix above addresses.

### What I could not verify myself

This is a coding environment without a Minecraft Bedrock client, so I
cannot personally click through in-world scenarios. Please verify the
following before relying on this in a real world:

- [ ] 2 hoppers — link, send an item, confirm it arrives and the loader
      entity despawns ~15s after the last item.
- [ ] 20 hoppers, 100 hoppers — confirm no perceptible tick lag; loader
      count should never exceed the number of *distinct* destinations
      currently mid-transfer.
- [ ] Multiple simultaneous transfers to the same destination — confirm
      only one loader entity exists there (`/testfor` or spectate).
- [ ] Rapid repeated transfers — confirm the timer keeps resetting and the
      loader doesn't flicker on/off.
- [ ] Nether and End destinations.
- [ ] A destination right at a chunk border.
- [ ] A long-distance destination (many chunks from any player) while
      unloaded — confirm the item safely waits in the source hopper rather
      than vanishing, per the platform limitation above.
- [ ] Server restart / world reload — confirm no orphaned `wr:chunk_loader`
      entities remain (check `purgeOrphanLoaders` ran via the content log).
- [ ] Realm compatibility.
- [ ] Achievements stay enabled (no cheats/experiments are toggled by this
      pack — it never calls `/tickingarea` or any other command tied to
      chunk loading).
- [ ] Confirm the world loads and functions with no experimental toggles
      enabled at all.
