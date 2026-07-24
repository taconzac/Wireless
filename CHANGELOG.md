# Changelog

## 3.3.6

Reported and reproduced: a plain chest, with no wireless hopper anywhere
near it, showed the hopper's purple vacuum particle and fed dropped items
into a chest below it. Minimal repro confirmed it: two plain chests
stacked, no hopper at all - break the top one and its contents go
straight into the bottom one.

### Fixed

- Found it: the main loop's own-block lookup only ever checked that *a*
  block existed at the wireless hopper entity's position
  (`if (!block) continue`) - it never checked that block was actually
  `BLOCK_ID` (the real wireless hopper block). The entity itself carries
  every dynamic property and runs all the tick logic, so if it ever
  survives without its real block still there (an explosion edge case, or
  anything else that removes the block without going through the normal
  break handler that kills this entity too), it would silently keep
  running - treating whatever block now occupies that position as if it
  *were* its own hopper, vacuuming nearby items and delivering them into
  whatever's directly below that unrelated block. That's exactly the
  reported symptom: an orphaned entity sitting where a plain chest now is
  will vacuum into whatever chest is below it, with nothing visibly
  wireless-hopper-shaped anywhere in sight.
- Added the missing `block.typeId !== BLOCK_ID` check, and self-heals:
  the moment a mismatch is detected, the orphaned entity is killed
  immediately rather than left to keep silently adopting whatever block
  happens to be there.
- Verified with an isolated test reproducing the exact reported scenario
  (an orphaned entity positioned where a plain chest sits, with another
  chest below and a dropped item nearby): confirms the entity is killed
  and neither the vacuum particle nor any item transfer happens. A
  negative control (temporarily removing just the new check) confirms
  the test actually catches the bug. A separate test confirms a
  legitimate, correctly-matched wireless hopper is unaffected and still
  delivers normally.

## 3.3.5

Close, per feedback: 3.3.4 showed a border around whatever chunk the
player happened to be standing in, regardless of whether an actual chunk
loader was anywhere nearby. It should only ever highlight a real
facility - the loader's own chunk first, then the chunks around it out to
the configured radius.

### Changed

- The passive wrench check now looks up every registered chunk loader
  (`mygenChunkLoaderManager.getAllChunkLoaders()`) in the player's current
  dimension, and only renders a border if the player is actually standing
  within one's coverage area (its own chunk, out to the configured radius
  in every direction). If no loader's facility covers where the player is
  standing, nothing is shown at all - it no longer draws a border around
  an arbitrary empty chunk.
- The border is now always centered on the matched loader's own chunk,
  not the player's - so standing anywhere inside a facility shows the
  same, correctly-anchored border, not one that shifts around based on
  exactly where in the facility the player happens to be. If a player is
  within range of more than one loader, the nearest one is used.
- Verified with an isolated test: a player far from any loader sees
  nothing; a player standing in a chunk *adjacent* to (not on top of) a
  registered loader, within its radius, sees the border correctly
  centered on the loader's own chunk rather than the player's.

## 3.3.4

Feedback on 3.3.3: semi-working, but the trigger shouldn't be "interact
with a chunk loader block while holding the wrench" - it should just be
holding the wrench, period, showing the border of whatever chunk(s) the
player is currently standing in/near.

### Changed

- Removed the interact-with-a-chunk-loader-block requirement entirely.
  The border is now shown passively: a per-tick check (throttled to once
  every ~3 seconds per player) looks at whether each online player is
  currently holding `wr:wrench` in their selected hotbar slot, and if so
  renders the border around their current position - no block interaction
  needed at all. This is much closer to BedrockChunkVisualizer's own
  original design (continuously checking every player for a specific held
  item), just with the wrench standing in for its "named compass"
  condition instead of a one-shot interact event.
- Fixed a throttle bug caught by this change's own test: the "last shown"
  tracking defaulted to `0`, which is indistinguishable from
  `system.currentTick` also being `0` right at world load - the very
  first check would always wrongly skip. Now defaults to `-Infinity`.
- Verified with an isolated test: border stays off for a player not
  holding the wrench, shows up for one who is (with no block interaction
  at all), respects the ~3s per-player throttle, and re-fires once that
  window elapses. Wireless Hopper's own transport logic is unaffected.

## 3.3.3

3.3.2's diagnostic didn't get a clear answer, but reported still not
working at all on iOS - so rather than keep guessing at the plain
vanilla-particle (`minecraft:endrod`) approach, replaced it outright with
the particle-rendering system from a separate, proven addon:
BedrockChunkVisualizer.

### Licensing (please read)

BedrockChunkVisualizer is licensed **CC BY-NC-SA 4.0** (also by Rob
'myGen' Hall, but a different license than the Chunk Loader's GPL-3.0 -
confirmed in its own `manifest.json`). This is more restrictive than GPL
in one specific way: **NonCommercial** - the add-on may not be used for
commercial purposes (sold, paywalled, ad-monetized, etc.) while it
contains this material, on top of the GPL source-availability requirement
already in place from 3.3.0. Added `LICENSE-CC-BY-NC-SA` (the CC BY-NC-SA
4.0 notice + canonical link) and `NOTICE` (exactly which files came from
which license) at the repo root, and both manifests now declare
`"license": "GPL-3.0-or-later AND CC-BY-NC-SA-4.0"`.

### Changed

- Removed `showChunkLoaderBorder()` (the `minecraft:endrod`-based border
  from 3.3.0/3.3.1/3.3.2) entirely.
- Added `ChunkLoaderBorder.js` (adapted from BedrockChunkVisualizer's
  `ParticleRenderer.js`): renders the border of every chunk a loader
  currently keeps loaded - its own chunk plus its configured radius out
  from there - using textured/animated particle walls instead of sparse
  vanilla particle dots. The original only ever rendered a fixed 3x3 grid
  centered on the player; this version takes an arbitrary radius and a
  center chunk (the loader block's, not the player's) as parameters.
- Trigger changed from the original addon's "hold a compass named
  'chunky'/'stillchunky'" to this add-on's own wrench (`wr:wrench`),
  consistent with every other wrench-triggered visualization already in
  this add-on. Does not check whether the loader is currently active.
- Radius shown is the current global "Default Chunk Radius" admin
  setting, same caveat as before: it reflects the *current* setting, not
  necessarily what a specific already-placed loader is actually running
  if the admin changed it since that loader was last activated.
- Verified with isolated tests: the border stays gated on holding the
  wrench (confirmed absent without it), and shows a radius-2 (5x5 chunk)
  area correctly sized and positioned when held; Wireless Hopper's own
  transport logic still works end-to-end on top of this change.

## 3.3.2

Reported: the chunk-loader border doesn't seem to work on iOS.

### Changed (temporary)

- Dropped the wrench requirement for the border - it now shows on *any*
  interaction with a myGen chunk loader block, regardless of what's held
  (or empty hand). This is a diagnostic step: if the border now shows up
  on iOS, the problem was specifically the held-item/wrench check; if it
  still doesn't show at all, the block-interaction handler itself isn't
  firing there, which is a different and bigger problem. Once we know
  which, this goes back to requiring the wrench.
- Verified in isolation that the border now fires with no itemStack at
  all (previously it required `itemStack?.typeId === WRENCH_ID`).

## 3.3.1

Simplified the wrench chunk-loader border from 3.3.0, per feedback: it was
drawing the loader's full *configured* radius, which turned out to be
misleading rather than useful, since radius is only ever tracked as one
global admin setting (not per-loader) - if the admin changes that setting
later, the border would show the new default, not what this specific
loader is actually keeping loaded.

### Changed

- `showChunkLoaderBorder()` now always draws just the single 16x16 chunk
  the block sits in, full stop - no radius, no reading the global config
  at all, and no dependency on whether the loader is currently active.
  `ChunkLoaderCore.js`'s `manager` export (added in 3.3.0 solely for this)
  was removed again, since nothing needs it anymore - keeps the
  modification footprint on the merged GPL file as small as possible.
- Verified with an isolated test: the border always bounds exactly the
  loader's own chunk, and `ChunkLoaderCore.js` no longer exposes `manager`
  to `main.js` at all, confirming the border can't read global radius
  even if something tried to.

## 3.3.0 - Renamed to Warehouse Utilities

A larger change than a normal patch: this add-on is renamed from "Wireless
Hopper 3.0" to **"Warehouse Utilities"**, and now bundles myGen's actual
Chunk Loader block/item directly, in addition to Wireless Hopper's own
automatic destination loaders.

### Licensing (please read)

myGen's Chunk Loader is licensed **GPL-3.0-or-later** (confirmed in its own
`manifest.json`, author Rob 'myGen' Hall, https://mygen.co.uk). Merging its
code in means the *entire add-on* - including all originally-authored
Wireless Hopper code - is now distributed under GPL-3.0-or-later. A copy of
the license is at the repo root (`LICENSE`). Both `BP/manifest.json` and
`RP/manifest.json` now declare `"license": "GPL-3.0-or-later"` and credit
both authors.

### Added

- **myGen's Chunk Loader**, bundled as its own craftable block/item
  (`chunkloader:chunk_loader`), separate from Wireless Hopper's own
  invisible, automatic `wr:chunk_loader` destination loaders. Same
  underlying technique (`minecraft:tick_world`), but this one is a
  visible, player-placed, manually-toggled tool with its own admin UI,
  farm-mode integration, and redstone control - all as originally written
  by Rob 'myGen' Hall, files kept intact except where noted below.
- **0-chunk radius option**: the loader's "extra chunks" radius previously
  couldn't go below 2. Added a `chunkloader:active_r0` component group
  (`minecraft:tick_world` radius 0) so "just this one chunk, no border" is
  now selectable, alongside the previously-unreachable radius 1. Fixed the
  four places that clamped to `Math.max(2, ...)` (now `Math.max(0, ...)`)
  and the two places that used `config.defaultRadius || 4` (now `?? 4` -
  the old form silently replaced a real `0` with `4`, since `0` is falsy
  in JS). The admin settings slider's minimum is now 0 instead of 2.
- **Recipe changed**: the loader's crafting recipe used a beacon at its
  center; changed to a netherite block (`recipes/chunk_loader.json`),
  with the unlock condition updated to match.
- **Wrench-visible loader radius**: holding `wr:wrench` and interacting
  with a placed chunk loader now draws its actual loaded-chunk boundary as
  a particle border (`showChunkLoaderBorder()` in `main.js`), using the
  same visualization style as the hopper's own collection-range border,
  so its real reach is visible at a glance instead of having to remember
  the current radius setting.

### Technical notes

- File layout: myGen's script files were copied in as-is
  (`ChunkLoaderUI.js`, `FarmDefinitions.js`, `FarmEmulator.js`,
  `FloatingTextVisibility.js`, and its `main.js` renamed to
  `ChunkLoaderCore.js` to avoid colliding with this add-on's own
  `main.js`), then side-effect-imported so its own event subscriptions
  register unchanged. Its `manager` instance is now also exported (marked
  inline as a modification) so `main.js` can read the current radius for
  the wrench visualization. Two asset filenames collided with existing
  Wireless Hopper files (`entities/chunk_loader.json`,
  `entity/chunk_loader.json`) and were kept under
  `*_chunk_loader.json` → `mygen_chunk_loader.json` instead; everything
  else (block, item, recipe, loot table, models, textures) had no naming
  conflict and was copied under its original name. Shared atlas files
  (`terrain_texture.json`) had myGen's entries merged in rather than
  overwritten.
- Verified with isolated tests: the full merged `main.js` imports and runs
  myGen's startup registration without throwing; a `defaultRadius` of `0`
  round-trips correctly through config storage; the wrench border
  visualization on a chunk loader block produces exactly the expected
  16x16 boundary at radius 0; and Wireless Hopper's own transport logic
  (source → destination delivery) still works end-to-end on top of the
  full merge.

## 3.2.12

3.2.11 fixed the wrong layer: it addressed the very-first-bootstrap race
at link time, but the *same* `LocationInUnloadedChunkError` then showed
up for an **Overworld** receiver too - proving this was never
Nether-specific. The actual issue was the destination loader's ~15
second idle timeout (`KEEP_LOADED_TICKS` in `ChunkLoaderManager.js`): once
a destination went quiet for 15s, its loader despawned and the chunk went
back to genuinely unloaded - and Bedrock's script API cannot force-load a
chunk that's gone fully cold without a player physically standing in it.
So every destination was only ever one idle period away from becoming
permanently unreachable again, in any dimension, which is exactly the
"receiver isn't loading the chunk like it should" behavior reported.

### Fixed

- Removed the 15-second idle expiry entirely. A destination's chunk
  loader now stays alive for as long as *any* hopper anywhere still has a
  route pointing at it, checked by a lightweight scan roughly every 5
  seconds (`pruneUnreferencedLoaders()` in `main.js`,
  `ChunkLoaderManager.pruneUnreferenced()`) instead of a per-destination
  countdown timer. A loader is only ever removed once nothing references
  its destination anymore (route deleted, or the owning hopper broken).
- This is what the addon's own description was always meant to do
  ("automatic destination chunk loading") - the fix is to stop the loader
  from being able to go cold in the first place while it's still needed,
  not to make failure less frequent.
- Verified with isolated tests: a loader whose destination is still
  referenced by a hopper's route survives a prune pass; one nothing
  references anymore is removed; the prune scan itself stays silent on
  ticks outside its ~5s interval; and a full source-to-destination
  delivery still works end-to-end against the new loader lifecycle.

## 3.2.11

The [TRACE-DELIVER] diagnostic from 3.2.10 found it: every configured
Nether destination reported the exact same failure -
`chunk loader spawnEntity THREW: LocationInUnloadedChunkError: ... not in
a chunk currently loaded and ticking` - every single delivery attempt,
for three separate destinations.

### Fixed

- The destination's chunk loader was only ever attempted from
  `processDistribution()`, which only runs once an item has actually
  reached the source hopper - in normal play, well after the player has
  moved on from the destination (walked back through a portal to go load
  the source side). By then nothing is keeping that Nether chunk loaded,
  so `spawnEntity()` throws every time and the loader can never get its
  first foothold. Overworld destinations happened to avoid this only by
  chance of timing (player still nearby, or the destination close enough
  to spawn/another loaded area) - it was never actually a different code
  path, just a race this addon was already going to lose eventually.
- Linking now calls `chunkLoaderManager.ensureLoaded()` immediately, at
  the moment the connection is created - the one point where the
  destination chunk is *guaranteed* loaded and ticking, since the player
  is standing on it interacting with the block. This gives the loader its
  required first foothold before the player ever has a chance to leave.
- Verified with an isolated test: simulates the full wrench-link flow
  (sneak + interact, pick source hopper from the wizard) and confirms the
  chunk loader's `spawnEntity` is now called during linking itself - at
  the correct destination coordinates - before any item is ever
  delivered, and that the route is still recorded correctly. A negative
  control (temporarily removing just the new call) confirms the test
  actually fails without the fix.

## 3.2.10

Reported: Overworld -> Nether transport still doesn't move items, even
after visiting the Nether destination in person to create the link (so
the "chunk was never loaded" explanation from 3.2.9 doesn't hold here -
Overworld -> Overworld and Nether -> Nether both work fine, only a Nether
*destination* fails). Nothing in `RouteEntry.js`/`ChunkLoaderManager.js`
turned up an obvious dimension-specific bug on inspection, so rather than
guess further, this build adds one small, targeted, throttled diagnostic
instead of guessing blind.

### Added (temporary)

- `ChunkLoaderManager.ensureLoaded()` now returns whether a loader is
  actually active at the destination, and the `spawnEntity` error if not,
  instead of swallowing that outcome entirely.
- A new `[TRACE-DELIVER]` message, throttled the same way past traces were
  (roughly once every 3 seconds, and only while an item is still stuck
  undelivered - stays silent on any successful delivery), reports exactly
  which step is failing for a given route: dimension resolution, the
  chunk loader's `spawnEntity`, or the destination's own `getBlock()`.
- Verified with isolated tests: one confirms the trace correctly surfaces
  a simulated "chunk loader can't spawn + getBlock throws" failure with
  the right dimension/coordinates; another confirms a fully successful
  delivery produces no trace message at all and still delivers the item.
- Temporary, like every other diagnostic added in this series - will be
  removed once the actual cause is found.

## 3.2.9

The periodic `[TRACE-GATE]`/`[TRACE]` chat messages (roughly every 3
seconds per hopper) had done their job - Nether-to-Nether transport and
the 3.2.8 height-limit crash are both confirmed fixed - and were now just
noise during normal play, as reported.

### Changed

- Removed the periodic diagnostic messages entirely: the `traceGating()`
  and `traceDelivery()` functions and their call sites in the main loop
  and `processDistribution()` are gone, along with the now-dead
  `shouldTrace` check. Hoppers no longer message their owner on a timer
  just for existing.
- Left the `[TRACE-CRASH]` messages from 3.2.7/3.2.8 in place - those only
  fire when something actually goes wrong (not on a fixed schedule during
  normal operation), and stay throttled so a genuine recurring failure
  still can't flood chat.
- Verified with an isolated test that real item delivery (source
  inventory -> hopper -> destination inventory) still works correctly with
  the trace calls removed - this was a chat-only cleanup, no functional
  logic changed.

## 3.2.8

Nether-to-Nether transport is now confirmed working in-game. This build
addresses the next issue surfaced by 3.2.7's new crash visibility: an
Overworld hopper repeatedly reporting
`[TRACE-CRASH] error processing a hopper in "minecraft:overworld":
LocationOutOfWorldBoundariesError: Trying to access location
(-13.0, 321.0, -4.0) which is outside of the world boundaries` -
Y=321 is one block above the Overworld's build limit.

### Fixed

- The hopper's own `dim.getBlock(blockLoc)` call - looking up its own
  block, right at the top of the per-entity loop - was still completely
  unguarded, unlike the container-below lookup a few lines later which
  already treats an out-of-bounds/unloaded location as "nothing here" and
  moves on. A hopper sitting at the world's height ceiling/floor throws
  here every single tick, forever. 3.2.7's outer per-entity `catch` still
  caught it (so it didn't cascade into other hoppers), which is exactly
  why it started showing up as `[TRACE-CRASH]` instead of failing
  silently - but it doesn't explain the message away, and the hopper still
  did nothing useful every tick it ran. Guarded with the same
  try/catch-and-skip pattern already used for the container-below lookup.
- Separately: both `[TRACE-CRASH]` messages added in 3.2.7 (the per-
  dimension `getEntities()` failure and the per-entity catch-all) had no
  throttle, unlike every other trace message in this file. For a hopper
  hitting the same error every tick, that means the identical message
  gets sent to chat 20 times a second, forever - which is exactly the
  "chat keeps saying this" spam reported. Both are now throttled on the
  same `TRACE_INTERVAL_TICKS` schedule as `traceGating`/`traceDelivery`.
- Verified with an isolated test: a hopper positioned so its own
  `getBlock()` throws `LocationOutOfWorldBoundariesError` no longer
  crashes to the outer catch, and a second, ordinary hopper processed
  right after it in the same tick still runs normally. A second test
  confirms the catch-all `[TRACE-CRASH]` message fires once on a
  throttle-eligible tick and then stays silent for the next 59 ticks
  instead of repeating every tick.
- Not yet tested in-game: Nether-to-Overworld transport.

## 3.2.7

The explosion theory from 3.2.6 doesn't hold up: this world is on Peaceful
(no hostile mobs, no Ghasts), and a *freshly placed* Nether hopper - which
can't possibly be an old "ghost" - still never appeared in any trace
message either. That means the entity genuinely exists and is loaded, but
the main loop still never reaches it. The only way that's true for every
single tick, permanently, is if something is throwing an uncaught
exception partway through that tick's work - and since Overworld
(processed first in `DIMENSION_NAMES`) always traces fine while Nether and
presumably End never do, that fits perfectly: whatever throws does so
while processing Nether, silently killing the rest of that tick for every
dimension after it, forever.

### Fixed

- Found several calls in the main loop that were unguarded, unlike almost
  everything else in this file: `dim.getEntities({typeId: ENTITY_ID})`
  itself (enumerating hoppers per dimension), the hopper's own
  `dim.getBlock(blockLoc)`, the item-vacuum's `dim.getEntities(...)` and
  `itemEntity.getComponent("item").itemStack`, the XP-vacuum's
  `dim.getEntities(...)`, and more. Any one of them throwing for a specific
  dimension would silently abort every dimension processed after it in
  `DIMENSION_NAMES` (`["overworld", "nether", "the_end"]`) for that tick -
  which, if it happens on every tick, is indistinguishable from "Nether and
  End hoppers are never processed at all."
- Rather than guess which single call was responsible, the whole per-
  dimension and per-hopper body of the main loop is now wrapped: a failure
  processing one dimension no longer prevents the next dimension in the
  list from running that same tick, and a failure processing one hopper no
  longer prevents the rest of that dimension's hoppers from running.
- Any such failure is now also reported directly to chat as
  `[TRACE-CRASH]` (not just the content log), with the real error name and
  message, for whichever players are in the affected dimension (or, for a
  single hopper's failure, the hopper's owner). If this - or anything like
  it - is what's actually been happening, this build will say so directly
  instead of requiring more guessing.
- Verified with a test that makes Nether's `getEntities()` throw
  internally: confirmed this reproduces the exact symptom against the
  pre-fix code (the callback throws uncaught, and `the_end` - processed
  after `nether` - never runs that tick), and that the fixed code handles
  it cleanly (no uncaught throw, and `the_end` still runs normally).

### If this build still shows nothing for the Nether hopper

That would mean the main loop genuinely isn't the problem, and whatever's
actually happening is upstream of it entirely (possibly something about
how or whether the Nether dimension's entities are being enumerated by the
game at all in this specific world) - at that point the next step is
almost certainly worth showing me the world/Realm setup directly rather
than continuing to add more chat-trace instrumentation.

## 3.2.6

Prompted by a sharp observation: even after the 3.2.5 fix, the Nether
hopper in question had *never once* appeared in any trace output at
all - not the wrong one, none at all. If its entity were genuinely being
processed by the main loop, it should trace on the same schedule as every
other hopper regardless of what's wrong with its routing. The only way
for that to be consistently, permanently true is if the entity simply
doesn't exist anymore.

### Fixed

- The explosion handler (`world.afterEvents.explosion`) killed any
  Wireless Hopper entity within 5 blocks of an explosion, but never
  touched the block underneath it. Every dynamic property - routing data,
  filters, everything - lives on that entity, so this left a "ghost"
  hopper: a block that looks completely normal, is entirely
  non-functional, never appears in any entity-based lookup or trace again
  (there's no entity to find), and previously gave zero feedback when
  interacted with. Ghast fireballs make this a routine occurrence in the
  Nether specifically, which is consistent with everything reported: the
  link was established successfully at some point (the entity existed
  then), and nothing has worked since (something - almost certainly a
  fireball - killed it afterward). The block is now removed along with the
  entity, matching how manually breaking the hopper already worked, so
  this exact scenario can't recur going forward.
- Interacting with a Wireless Hopper block that has no backing entity
  (whether from this or any other cause) now says so explicitly instead of
  silently doing nothing - both the config menu and the plain status
  display report "no entity found here" and suggest breaking and
  replacing the block.
- Verified the explosion handler now removes the block precisely when it
  kills the entity, and that this doesn't otherwise change delivery
  behavior.

### Note

This won't retroactively repair a hopper that's already in this state -
its stored routing data is gone with the entity. If your Nether hopper
still shows no `[TRACE-GATE]` message after this update, that's the
confirmation: break the block and relink it fresh.

## 3.2.5

Root cause confirmed directly from an in-game trace (not guessed): a
Nether-sourced hopper's own routing entries were found stored in two
different formats -
`container_0 = "minecraft:nether,13,40,9"`,
`container_1 = "nether,13,40,12"`,
`container_2 = "minecraft:nether,15,40,14"` -
on the exact same hopper. `Dimension.id` returns the `"minecraft:"`-
prefixed form at runtime (this settles the ambiguity earlier attempts
couldn't resolve from documentation alone), but different links had been
written at different times under different builds, some capturing the
prefixed form directly and some (briefly, under the build that added
normalization before it was reverted) capturing the short form. Whichever
form `world.getDimension()` doesn't accept fails to resolve, silently
(caught by the caller's own defensive try/catch) - so routes in the
"wrong" format simply never transported, forever, with no visible error.

### Fixed

- `RouteEntry.js` again normalizes every dimension id (`normalizeDimensionId()`,
  applied inside both `formatRouteEntry()` and `parseRouteEntry()`) down to
  the short `overworld`/`nether`/`the_end` form - the only form this addon
  has used successfully with `world.getDimension()` since v2.5. This is
  the same fix from the original (reverted) 3.2.1, re-added on its own -
  **not** the hopper registry/pending-link system from that version, which
  was solving a different, non-problem (a hopper not appearing in the
  wizard while its dimension is unloaded is expected Minecraft behavior).
  Because normalization happens on *read*, every previously-written route -
  regardless of which format it happened to get stored in - resolves
  correctly from now on with no migration step.
- Verified directly against the reported scenario: a hopper with three
  routes stored in the exact mixed formats from the trace above, each
  tested in isolation (no fallback route to mask a per-route failure).
  Confirmed this reproduces the bug precisely against the pre-fix code
  (the two `"minecraft:"`-prefixed routes fail to deliver, the short-form
  one works) and that all three deliver correctly with the fix.

The temporary `[TRACE-GATE]` / `[TRACE]` diagnostic messages from 3.2.3/
3.2.4 are left in for one more round in case anything else is still
wrong - they'll be removed once this is confirmed fixed in an actual
world.

## 3.2.4 (temporary diagnostic build)

3.2.3's trace never fired at all during actual testing - meaning the
problem is upstream of where it was placed (inside `processDistribution`,
which is only reached after several gating conditions already pass). This
version adds trace coverage for every step *before* that point too, plus
hardens the trace's own delivery so a failed lookup can't be the reason
nothing showed up.

### Added

- `traceGating()`: fires once per throttle window per hopper, before
  `processDistribution()` is ever reached, regardless of whether it has an
  item to send. Reports whether the hopper is redstone-locked, whether its
  "Teleportable" tag is set, whether its own underlying inventory was
  found, its `containerCount`, and the raw `container_N` string for each
  configured route. If this never appears either, the hopper isn't being
  reached by the main loop at all (or the trace delivery itself is
  failing - see below).
- `traceOwner()` now falls back to whichever player is standing within 32
  blocks of the hopper if looking up the owner by name fails for any
  reason (case sensitivity, timing, anything) - a silent failure there
  would by itself explain zero messages ever appearing, regardless of
  whether the rest of the addon is working correctly.
- Re-verified delivery behavior is unchanged (the trace only adds chat
  messages, never alters what actually happens) against the existing
  regression harness.

## 3.2.3 (temporary diagnostic build)

Y=40 in the Nether for both sender and receiver rules out the height-
boundary theory from 3.2.2 - that fix was real and worth keeping, but it
wasn't the (or the only) cause of the reported Nether→Nether / Nether→
Overworld delivery failure. Static analysis of `@minecraft/server`'s
actual type definitions couldn't conclusively settle whether the format
mismatch theory from the original 3.2.1 was real either. Rather than ship
another guess, this version adds an in-game trace so the next test run
produces direct evidence instead of more speculation.

### Added

- A temporary diagnostic trace in `processDistribution()`. Roughly once
  every 3 seconds per delivery attempt (throttled so it's readable, not
  spammy), the hopper's owner gets a chat message showing the *actual*
  runtime values at each step: the raw stored `container_N` string, the
  parsed dimension id and coordinates, whether `world.getDimension()`
  resolved successfully or threw (with the real error name/message), and
  whether `getBlock()` returned a real block with an inventory component,
  returned `undefined`, or threw.
- This is not a permanent feature — it'll be removed once the actual cause
  is confirmed from real trace output rather than continued guessing.

### How to use it

Stand near a Nether-to-Nether (or Nether-to-Overworld) hopper pair with an
item flowing through the source, and watch chat. A `§b[TRACE]` message
should appear roughly every 3 seconds while the item is stuck. Whatever
line it stops at (or the exact error text it shows) is the real answer.

## 3.2.2

3.2.1 is reverted as of this version — it's not part of this history. It
added a persistent hopper registry and a pending-link queue to solve a
hopper not appearing in the linking wizard while its dimension was
unloaded. On reflection that's expected Minecraft behavior (a dimension
nobody is in isn't simulated, so of course a live `getEntities()` scan
can't find anything there), not an add-on bug, and the registry was a much
bigger change than that observation warranted. 3.2.2 restores 3.2.0's
wizard exactly (live search, no registry, no pending-link queue) and
applies one small, targeted fix instead.

### Fixed

- The real remaining problem: Nether→Nether and Nether→Overworld transfers
  not delivering even with both hoppers loaded and adjacent. Found by
  re-auditing every `getBlock()` call in the file for the one that wasn't
  guarded like all the others: computing a hopper's own underlying
  container used
  `dim.getBlock({ x: blockLoc.x, y: blockLoc.y - 1, z: blockLoc.z })`
  with no try/catch. The Nether's usable height is roughly Y 0-127 with its
  floor sitting right around Y 0-4 — a hopper placed near that floor has
  its underlying-container position land just below Y 0, outside world
  bounds. Every other boundary-sensitive call in this file already guards
  against exactly this; this one didn't, so it could throw uncaught and
  abort the rest of that tick's processing for every hopper after it in
  iteration order (nothing upstream catches it) — the affected hopper never
  reaches the point where it would call `processDistribution()`, so it
  never delivers, regardless of destination. This is a pre-existing defect
  from v2.5, unrelated to cross-dimensional routing; it likely only
  surfaced now because testing cross-dimension links prompted building (and
  testing) Nether hoppers for the first time. Now wrapped in try/catch,
  consistent with the rest of the file: an out-of-bounds position is
  treated the same as "no inventory here" rather than crashing.
- Re-verified `processDistribution()` still delivers correctly afterward
  with no regressions.

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
