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
upgrades, redstone modes, crafting, and UI text are all unchanged. Three
things were changed in `scripts/`: the chunk-loading implementation (v3.0),
the fuel system was removed entirely as of v3.1 (hoppers run
unconditionally from the moment they're placed), and cross-dimensional
routing was added as of v3.2 (a hopper can now route to a destination in a
different dimension). See CHANGELOG.md for the full list of what changed
in each version.

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

### Cross-dimensional routing

As of 3.2, a hopper can route to a destination in a *different* dimension:
Overworld↔Nether, Overworld↔End, Nether↔End, alongside ordinary
same-dimension routing. Two things had to change to make this possible —
storage format and the linking UI — and neither touches transfer logic,
chunk loading, filters, or anything else:

- **Storage** (`scripts/RouteEntry.js`): `container_N` now stores
  `"dimensionId,x,y,z"` instead of the old dimension-less `"x,y,z"`. The
  dimension id is exactly the string Bedrock's own `Dimension.id` getter
  returned for the destination block at link time, so resolving it later
  is just `world.getDimension(thatSameString)` — no guessing at "overworld"
  vs "minecraft:overworld" formatting. Old 3-part entries are still read
  correctly (resolved against whichever dimension the source hopper is
  currently in, exactly what they always meant) and are never rewritten in
  place — this is backward compatibility by tolerant reading, not by a
  migration pass.
- **Linking wizard**: the source-hopper dropdown used to search only
  `player.dimension` — so even with dimension-aware storage, a player
  standing at an Overworld destination could never have picked a Nether
  hopper as the source, no matter what the storage format supported. It
  now searches all three dimensions (the same enumeration
  `showGlobalDashboard()` already used), with each candidate's dimension
  shown in its label. The destination's dimension is just whatever
  dimension the player is standing in when they link, same as before.

`ChunkLoaderManager.js` required **no changes at all** — its dedupe key was
already `dimension.id + coordinates`, so a loader was always scoped to its
destination's own dimension; `processDistribution()` just had to pass it
the destination's `Dimension` object instead of assuming the source's.

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

For cross-dimensional routing (3.2), a second harness stood up three
independent fake dimensions (Overworld/Nether/End, each with its own
loaded-state, inventory, and loader-entity list) and drove real production
code through: Overworld→Nether, Nether→Overworld, End→Overworld (with a
wrong-dimension-inventory guard — confirming an item sent to the Nether
does *not* also show up in the Overworld's own inventory), a legacy
dimension-less entry still resolving to the source's own dimension, two
hoppers in two different dimensions routing to the same destination
sharing exactly one loader, expiry across all three dimensions, and
orphaned-loader purging in each dimension independently (restart
compatibility). 16/16 checks passed.

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

### Manual tests for cross-dimensional routing (3.2)

- [ ] Overworld → Nether: place a source hopper in the Overworld, travel to
      the Nether, stand at a chest there and link (the Overworld hopper
      should appear in the dropdown, tagged `[OW]`). Send an item from the
      Overworld side; confirm it arrives in the Nether chest.
- [ ] Nether → Overworld, and End → Overworld: same shape, reversed and
      from the End.
- [ ] Nether → End direct (no Overworld hop).
- [ ] A single hopper with both a same-dimension route *and* a
      cross-dimension route configured at once — confirm both deliver
      independently.
- [ ] Two different hoppers, in two different dimensions, both routing to
      the same destination chest — confirm only one loader keeps that
      chest's chunk loaded (no duplicate loaders, no double-delivery races).
- [ ] Link a cross-dimension route, then check the Routing Table menu shows
      the correct `[OW]`/`[NETHER]`/`[END]` tag next to it.
- [ ] Try to link a hopper to its own input across dimensions (should be
      impossible by construction, since the destination dimension is always
      wherever you're standing when you link — just confirm the recursion
      guard still fires correctly for genuine same-dimension self-loops).
- [ ] A world that already has same-dimension-only links from v3.0/3.1 —
      confirm they still work unchanged after upgrading to 3.2, with no
      relinking.
- [ ] Cross-dimension destination that's currently unreachable (e.g. Nether
      destination while no one has been there this session) — confirm the
      item waits safely in the source rather than being lost, and delivers
      once someone visits that Nether region.
- [ ] Server restart with active cross-dimension routes — confirm no
      orphaned loaders survive in any of the three dimensions, and routes
      keep working after the restart.
