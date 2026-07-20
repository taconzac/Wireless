# Changelog

## 3.2.1

Two real bugs reported from in-game testing of 3.2.0's cross-dimensional
routing, both fixed.

### Fixed

- **Nether→Nether (and any route) established but never transported, even
  with both ends loaded.** `Dimension.id` doesn't necessarily come back in
  a format `world.getDimension()` accepts unmodified (e.g. a
  `"minecraft:"`-prefixed form) - a route stored with the raw value made
  `world.getDimension()` throw inside `processDistribution()`, which was
  silently swallowed by the surrounding try/catch, so the item just sat
  there forever with no visible error. `RouteEntry.js` now exports
  `normalizeDimensionId()`, applied inside `formatRouteEntry()` and
  `parseRouteEntry()`, that collapses any spelling down to the short
  `overworld`/`nether`/`the_end` form this codebase has used successfully
  with `world.getDimension()` since v2.5. Because normalization happens on
  *read*, this also self-heals any route already written under the buggy
  3.2.0 build - no migration needed, existing broken links start working
  the next time they're read.
- **A hopper in a different dimension never appeared in the linking
  wizard's dropdown** ("no option to connect chest to nether thing, doesn't
  show"). The wizard searched all three dimensions live
  (`dimension.getEntities()`), but that can only ever return entities in
  *currently simulated* chunks - a Nether hopper is essentially never
  loaded while the player links from the Overworld, so it could never be
  found this way regardless of how many dimensions were searched. Fixed
  with a new persistent registry (`HopperRegistry.js`, a world dynamic
  property keyed by dimension+coordinates) that's independent of load
  state:
  - Updated at placement, rename, and break time; self-healed (registered
    exactly once, tag-guarded) for pre-existing hoppers the first time the
    main tick loop sees them again after upgrading.
  - The wizard's dropdown is now built from this registry, so every owned
    hopper is visible regardless of which dimension is currently loaded.
  - Actually *writing* a route still needs a live entity (routing data
    stays on the source hopper's own dynamic properties, unchanged). If the
    selected hopper is live, the link applies immediately exactly as
    before. If not, a small pending-link queue records the intent, and the
    main tick loop applies it (running the identical recursion/port-limit/
    duplicate checks via a new shared `tryEstablishLink()` helper) the next
    time that specific hopper is loaded. No item or link is ever lost
    waiting for this.

### Changed

- Extracted the recursion-loop/port-limit/duplicate-connection checks that
  used to live only in the linking wizard's callback into
  `tryEstablishLink()`, shared by both the immediate-apply and deferred-
  apply paths, so both enforce identical rules instead of duplicating the
  logic.

Verified against real production code with a dedicated harness that
reproduces both original bugs against the pre-fix behavior (a strict
`world.getDimension()` stub that only accepts the short form, and
dimensions that go fully unloaded) and confirms the fixed code: Nether→
Nether actually transports, a Nether hopper is visible via the registry
while the Nether is completely unloaded, linking to it queues a pending
link instead of silently failing, and the deferred link is established and
delivers correctly once the source loads again. Also re-ran the full 3.2.0
cross-dimension regression suite (12 checks) with no regressions.

## 3.2.0

### Added

- Cross-dimensional routing. A Wireless Hopper can now route to a
  destination in a *different* dimension: Overworld↔Nether, Overworld↔End,
  and Nether↔End, in addition to same-dimension routing.
  - `scripts/RouteEntry.js` (new) — `formatRouteEntry()` /
    `parseRouteEntry()` extend the routing string stored in each
    `container_N` dynamic property from the old dimension-less `"x,y,z"` to
    `"dimensionId,x,y,z"`, using exactly the string Bedrock's own
    `Dimension.id` getter returns (so it round-trips through
    `world.getDimension()` without guessing a format). `shortDimName()`
    gives a short OW/NETHER/END tag for menus.
  - **Backward compatible by construction, not by migration**: legacy
    3-part entries (no dimension field) are never rewritten in storage —
    `parseRouteEntry()` just resolves them against the reading hopper's own
    current dimension every time, exactly matching what they always meant.
    Old saves are read, never touched.
  - The linking wizard's source-hopper dropdown now searches all three
    dimensions (same enumeration pattern the dashboard already used)
    instead of only the player's current one — without this, a player
    standing at a destination could still only ever pick a same-dimension
    source, no matter what the storage format supported. Each candidate's
    dimension is shown in its dropdown label.
  - The recursion-loop guard (a hopper can't route into its own input) and
    the duplicate-connection check now both compare dimension in addition
    to coordinates, since coordinates alone are ambiguous across
    dimensions.
  - `processDistribution()` resolves each destination's own dimension via
    `world.getDimension()` before touching it, instead of assuming the
    source hopper's dimension.
  - The Routing Table menu now shows a dimension tag next to each linked
    destination's coordinates. The range-border particle effect skips
    drawing connection lines to cross-dimension destinations (an Overworld↔Nether
    coordinate line would just be a meaningless trail through unrelated
    coordinate spaces) — the link still works, it's just not drawn.
  - **No changes were needed in `ChunkLoaderManager.js`.** Its dedupe key
    was already `dimension.id + coordinates`, so a destination loader was
    always scoped per-dimension; passing it the correct destination
    `Dimension` object (rather than the source's) was the only thing
    required, confirming loaders dedupe correctly even when different
    dimensions' hoppers route to the same destination.
- Verified with a dedicated integration harness covering: Overworld→Nether,
  Nether→Overworld, End→Overworld, a legacy dimension-less entry still
  resolving correctly, cross-dimension loader dedupe (two hoppers in two
  different dimensions routing to the same destination share one loader),
  and orphaned-loader purging across all three dimensions independently
  (restart compatibility) — 16/16 checks passing.

## 3.1.0

### Removed

- The entire fuel system. Wireless Hoppers now run unconditionally from the
  moment they're placed — no fuel meter, no refueling with redstone blocks,
  no dead tank.
  - Removed `FUEL_CAPACITY`, `FUEL_CONSUME_INTERVAL`, `FUEL_EFFICIENCY_PER_TIER`,
    `MAX_FUEL_EFFICIENCY_BONUS`, and the `getFuelEfficiencyBonus()` /
    `getFuelConsumeInterval()` helpers.
  - Removed the per-tick fuel drain and the `if (fuel <= 0) continue;` gate
    from the main loop — hoppers now always run their vacuum and
    distribution logic (subject only to the existing redstone lock).
  - Removed the redstone-block "REFUEL" interaction entirely; redstone
    blocks now just trigger the ordinary status display like any other
    item, instead of being consumed.
  - Removed fuel from every UI surface: the dashboard button, the
    wrench-tap status display (now shows "ACTIVE" instead of a fuel %),
    the Diagnostics menu (dropped "FUEL CELL" and "EFFICIENCY" lines), the
    Range Upgrade info screen (dropped the fuel-efficiency side-benefit
    text — amethyst upgrades now purely increase collection radius), and
    the System Settings "Fuel Notification" toggle (this toggle never
    actually did anything even in v2.5 — no code fired a notification off
    it — so it was dead weight either way).
  - New hoppers no longer start at 0 fuel; they work immediately on
    placement.
  - The startup migration now also strips the legacy `fuel`, `fuelTime`,
    and `FuelNotification` state from existing hoppers, alongside the
    `ChunkLoaded` cleanup already in place.
- Re-verified with the same integration harness used for the chunk-loader
  fix: full unloaded→reachable→transfer→dedupe→expire lifecycle still
  passes with fuel removed.

## 3.0.0

Rewrite of the chunk-loading layer only. Everything else — linking, channels,
filters, transfer logic, inventory behaviour, item/XP vacuuming, fuel,
range upgrades, redstone modes, models, textures, sounds, UI styling, and
crafting recipes — is unchanged from v2.5.

### Added

- Silent, automatic, per-transfer chunk loading for a hopper's *destination*
  containers, built on the same `minecraft:tick_world` entity technique used
  by the myGen Chunk Loader. No player action, no menu, no commands.
- `wr:chunk_loader` — an invisible, internal entity (scale 0, no name tag,
  never player-facing) that carries the `minecraft:tick_world` component
  while a delivery is in flight or was recently completed.
- `ChunkLoaderManager.js` — tracks at most one active loader per destination
  location, reuses it across every hopper that routes there, extends its
  ~15 second keep-alive on every delivery attempt, and sweeps expired
  loaders on a 1-second interval.
- Startup reconciliation: on world load, any `wr:chunk_loader` entities left
  over from a previous session are purged (a fresh session's loader map is
  always empty, so any survivor is by definition an orphan), and the legacy
  `ChunkLoaded` tag is stripped from existing hoppers.
- `scripts/selfTest.js` — pure-logic regression checks (inventory stacking,
  chunk-loader key uniqueness) that run once at startup and log to the
  content log. No GameTest framework and no experimental toggles required.

### Removed

- `/tickingarea` command usage and all `dimension.runCommand("tickingarea …")`
  calls.
- The "Chunk Loader (Keep Loaded)" toggle from the System Settings menu.
- The `ChunkLoaded` entity tag and every UI element that referenced it
  (dashboard `[⚓ LOADED]` markers, the diagnostics "ANCHOR" line, the
  linking wizard's anchor marker).
- `manageTickingArea()` and its two call sites (explosion cleanup, block
  break cleanup) — hopper destruction no longer needs to tear down a
  tickingarea, because none is ever created.

### Changed

- Destination containers are no longer assumed to already be loaded.
  `processDistribution()` now calls `chunkLoaderManager.ensureLoaded()` for
  a destination immediately before attempting a transfer to it; if the
  destination chunk isn't ready yet, the existing per-tick retry loop
  (unchanged) naturally waits and tries again on the next tick, so no item
  is ever lost, duplicated, or silently dropped.
- `min_engine_version` raised to `1.21.60` (the documented minimum for
  `minecraft:tick_world`), and the `@minecraft/server` dependency bumped to
  `2.4.0`.
- Manifest header and module UUIDs are unchanged from v2.5, so this ships
  as an in-place update rather than a new add-on — worlds that already have
  Wireless Hopper applied pick up 3.0 automatically, with no relinking
  required. Routing data (`container_0..9`, `containerCount`, filters, fuel,
  range, etc.) is untouched by this rewrite.
- Extracted the item-stacking helper into `scripts/InventoryUtils.js` (used
  by both the vacuum and distribution code paths) and deleted the unused,
  entirely dead `scripts/vector.js`, whose static-method duplicated the
  distance/direction math already inlined in `main.js`.

### Fixed

- `processDistribution()`'s destination lookup (`dim.getBlock({x, y, z})`)
  was unguarded. Bedrock's `Dimension.getBlock()` throws
  `LocationInUnloadedChunkError` rather than returning `null` when the
  target chunk isn't currently loaded — exactly the "destination not near
  any player" case this whole feature exists to handle. Left unguarded,
  that exception would abort the rest of that tick's hopper loop every
  single tick a delivery was pending to an unloaded destination. It's now
  wrapped in a try/catch, treated the same as "no inventory there yet."
  Verified with an executable integration harness (stubbed
  `@minecraft/server`) that reproduces the crash on the old code and
  confirms the fixed code correctly: leaves the item in the source while
  the destination is unreachable, transfers it the tick after the
  destination becomes reachable, spawns exactly one loader entity, dedupes
  a second hopper routing to the same destination, and expires the loader
  after its keep-alive window.

### Known limitation (inherited from v2.5, not introduced by this rewrite)

Wireless Hopper has never supported cross-dimension routing. A `container_N`
routing entry is stored as a bare `"x,y,z"` string with no dimension field,
and the linking wizard only ever lists the *player's currently owned
hoppers in their current dimension* against a destination block that is
necessarily in that same dimension (you can't right-click a block in a
different dimension). So a hopper in the Nether can only ever route to
Nether destinations, Overworld to Overworld, and so on — this rewrite
preserves that behavior unchanged rather than redesigning the routing
format, per the "do not redesign the add-on" instruction. The chunk-loader
mechanism itself has no such restriction — it works identically in every
dimension, since `ensureLoaded()` is just handed whichever `dimension`
object the caller is already operating in.

### Known platform limitation

Bedrock's Script API has no non-cheat way to force-load a chunk that no
player has ever been near (myGen's own admin UI hits this same wall and
tells the player to travel there manually). Wireless Hopper 3.0 keeps an
already-reachable destination loaded through a transfer and for ~15s after,
and it never uses commands to get around this — but it cannot conjure a
chunk into existence out of nowhere. See the README's Architecture section
for the full explanation.
