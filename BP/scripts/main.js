import { world, system } from "@minecraft/server";
import { ModalFormData, ActionFormData } from "@minecraft/server-ui";
import { chunkLoaderManager, purgeOrphanLoaders } from "./ChunkLoaderManager.js";
import { addItemsToInventory } from "./InventoryUtils.js";
import { formatRouteEntry, parseRouteEntry, shortDimName } from "./RouteEntry.js";
import { runSelfTests } from "./selfTest.js";

const DIMENSION_NAMES = ["overworld", "nether", "the_end"];

// Constants
const DEFAULT_COLLECT_RANGE = 3;
const MAX_COLLECT_RANGE = 10;
const COOLDOWN_DURATION = 1000;

// Type IDs
const ENTITY_ID = "wr:wireless_hopper";
const BLOCK_ID = "wirless:wirless_hopper";
const WRENCH_ID = "wr:wrench";

// === MATH HELPERS ===
function getDistance(a, b) {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2) + Math.pow(a.z - b.z, 2),
  );
}

function getDirection(from, to) {
  const dir = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  return len === 0
    ? { x: 0, y: 0, z: 0 }
    : { x: dir.x / len, y: dir.y / len, z: dir.z / len };
}

// === ROBUST REDSTONE CHECKER ===
function getReceivedSignal(block) {
  try {
    // 1. Check if the block itself reports power
    if (block.getRedstonePower() > 0) return block.getRedstonePower();

    // 2. Scan neighbors safely (Handle World Boundaries)
    // We use a manual offset check with try-catch to prevent crashing at Y limits
    const offsets = [
      { x: 0, y: 1, z: 0 }, // Up
      { x: 0, y: -1, z: 0 }, // Down
      { x: 0, y: 0, z: -1 }, // North
      { x: 0, y: 0, z: 1 }, // South
      { x: 1, y: 0, z: 0 }, // East
      { x: -1, y: 0, z: 0 }, // West
    ];

    for (const offset of offsets) {
      try {
        const n = block.offset(offset.x, offset.y, offset.z);
        if (!n) continue;

        // Redstone Block is always power 15
        if (n.typeId === "minecraft:redstone_block") return 15;

        // Check if neighbor has power (Lever, Dust, Repeater, etc.)
        const power = n.getRedstonePower();
        if (power > 0) return power;
      } catch (err) {
        // Ignore LocationOutOfWorldBoundariesError or invalid block access
        continue;
      }
    }
  } catch (e) {
    // Fail safe
    return 0;
  }

  return 0;
}

// === STARTUP MIGRATION ===
// Runs once when the world loads. Two responsibilities:
//  1. Purge any wr:chunk_loader entities left over from a previous session.
//     A fresh session always starts with an empty ChunkLoaderManager map, so
//     any surviving loader entity is guaranteed to be an orphan (it kept
//     itself loaded via tick_world, which is exactly why it's still here).
//  2. Strip legacy state from existing hoppers that no longer means
//     anything: the "ChunkLoaded" tag (drove the old tickingarea-based
//     toggle), and the fuel system's "fuel"/"fuelTime" properties and
//     "FuelNotification" tag (hoppers now always run, unconditionally).
//     Routing data (container_0.. etc.) is untouched, so linked hoppers
//     keep working with no player action required.
system.run(() => {
  runSelfTests();

  for (const dimName of DIMENSION_NAMES) {
    try {
      const dim = world.getDimension(dimName);
      purgeOrphanLoaders(dim);

      for (const hopper of dim.getEntities({ typeId: ENTITY_ID })) {
        if (!hopper) continue;
        if (hopper.hasTag("ChunkLoaded")) hopper.removeTag("ChunkLoaded");
        if (hopper.hasTag("FuelNotification")) hopper.removeTag("FuelNotification");
        if (hopper.getDynamicProperty("fuel") !== undefined) {
          hopper.setDynamicProperty("fuel", undefined);
        }
        if (hopper.getDynamicProperty("fuelTime") !== undefined) {
          hopper.setDynamicProperty("fuelTime", undefined);
        }
      }
    } catch (e) {}
  }
});

// === GLOBAL EXPLOSION HANDLER ===
world.afterEvents.explosion.subscribe((explosionEvent) => {
  system.run(() => {
    try {
      const dimension = explosionEvent.dimension;
      const hoppers = dimension.getEntities({
        typeId: ENTITY_ID,
        location: explosionEvent.location,
        maxDistance: 5,
      });

      for (const hopper of hoppers) {
        if (!hopper) continue;
        hopper.kill();
      }
    } catch (error) {
      console.error(`Explosion Error: ${error.message}`);
    }
  });
});

// === INVENTORY LORE UPDATER ===
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    try {
      const inventoryComponent = player.getComponent("minecraft:inventory");
      if (!inventoryComponent) continue;
      const container = inventoryComponent.container;

      for (let i = 0; i < container.size; i++) {
        const item = container.getItem(i);
        if (!item) continue;

        if (item.typeId === WRENCH_ID) {
          const lore = item.getLore();
          if (!lore || lore.length === 0 || !lore[0].startsWith("§a- Wrench")) {
            const updatedItem = item.clone();
            updatedItem.setLore([
              `§a- Wrench`,
              ` -  §6@§oWirelessHopperAdd`,
              `§7Sneak+Use on air for Dashboard`,
            ]);
            container.setItem(i, updatedItem);
          }
        }
      }
    } catch (e) {}
  }
}, 20);

// === FEATURE: GLOBAL DASHBOARD ===
world.beforeEvents.itemUse.subscribe((ev) => {
  if (ev.itemStack.typeId !== WRENCH_ID) return;
  const player = ev.source;

  if (!player.isSneaking) return;

  system.run(() => {
    const blockHit = player.getBlockFromViewDirection({ maxDistance: 5 });
    if (blockHit) return;

    showGlobalDashboard(player);
  });
});

function showGlobalDashboard(player) {
  const hoppers = [];
  DIMENSION_NAMES.forEach((dimName) => {
    const dim = world.getDimension(dimName);
    const dimHoppers = dim.getEntities({ typeId: ENTITY_ID });
    dimHoppers.forEach((h) => {
      if (h && h.getDynamicProperty("ownerName") === player.name) {
        hoppers.push({ entity: h, dimension: dimName });
      }
    });
  });

  if (hoppers.length === 0) {
    player.playSound("note.bass");
    player.sendMessage(
      "§c[SYSTEM] No active Wireless Hopper units detected on network.",
    );
    return;
  }

  const form = new ActionFormData()
    .title("§l§9NETWORK OVERSIGHT")
    .body(
      `§7User: §e${player.name}§r\n` +
        `§7Status: §aONLINE §7| Connection: §aSECURE§r\n\n` +
        `§8--------------------------------§r\n` +
        `§fDETECTED UNITS: §b${hoppers.length}§r\n` +
        `§8--------------------------------§r\n` +
        `§7Select a unit below to retrieve GPS coordinates.`,
    );

  hoppers.forEach((h, i) => {
    const loc = h.entity.location;
    const customName = h.entity.getDynamicProperty("customName");
    const displayName = customName ? `§e${customName}§r` : `Unit ${i + 1}`;

    const dimShort =
      h.dimension === "overworld"
        ? "OW"
        : h.dimension === "nether"
          ? "NETHER"
          : "END";

    form.button(
      `§l${displayName} §8[§f${dimShort}§8]\n§r§aPos: ${Math.floor(
        loc.x,
      )}, ${Math.floor(loc.y)}, ${Math.floor(loc.z)}`,
      "textures/items/redstone_dust",
    );
  });

  form.show(player).then((r) => {
    if (r.canceled) return;
    const selected = hoppers[r.selection];
    if (selected && selected.entity) {
      player.playSound("random.orb");
      const customName = selected.entity.getDynamicProperty("customName");
      const name = customName ? `§e${customName}§r` : "Unit";

      player.sendMessage(
        `§e[GPS] ${name} located at §b${Math.floor(
          selected.entity.location.x,
        )}, ${Math.floor(selected.entity.location.y)}, ${Math.floor(
          selected.entity.location.z,
        )}§e in §d${selected.dimension}§e.`,
      );
    } else {
      player.playSound("note.bass");
      player.sendMessage(
        "§c[ERROR] Signal lost. Unit may be unloaded or destroyed.",
      );
    }
  });
}

// === INTERACTION HANDLER ===
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {
  const { block, player, itemStack } = ev;
  const isContainer = block.getComponent("inventory");

  if ((player["cool_down"] ?? 0) > Date.now()) return;

  // 1. LINKING
  if (
    itemStack?.typeId === WRENCH_ID &&
    isContainer &&
    block.typeId !== BLOCK_ID
  ) {
    player["cool_down"] = Date.now() + COOLDOWN_DURATION;

    if (!player.isSneaking) {
      system.run(() => {
        player.playSound("ui.button.click");
        player.onScreenDisplay.setActionBar("§e[!] Sneak + Interact to link");
      });
      return;
    }

    system.run(() => {
      // Search every dimension, not just the player's current one - this is
      // what actually makes cross-dimensional routing reachable through the
      // wizard. Without it, a player standing at an Overworld destination
      // could still only ever pick an Overworld source hopper, no matter
      // what the routing storage format supports. Same enumeration pattern
      // showGlobalDashboard() already uses.
      const myHoppers = [];
      for (const dimName of DIMENSION_NAMES) {
        const searchDim = world.getDimension(dimName);
        for (const h of searchDim.getEntities({ typeId: ENTITY_ID })) {
          if (h && h.getDynamicProperty("ownerName") === player.name) {
            myHoppers.push(h);
          }
        }
      }

      if (myHoppers.length === 0) {
        player.playSound("note.bass");
        player.sendMessage(
          `§c[SYSTEM] No owned units found. Ensure units are loaded.`,
        );
        return;
      }

      const names = myHoppers.map((h, i) => {
        const customName = h.getDynamicProperty("customName");
        const displayName = customName ? `§e${customName}§r` : `Unit ${i + 1}`;
        const dimTag = shortDimName(h.dimension.id);
        return `${displayName} [${dimTag}] @ ${Math.floor(
          h.location.x,
        )},${Math.floor(h.location.y)},${Math.floor(h.location.z)}`;
      });

      new ModalFormData()
        .title("§l§3CONNECTION WIZARD")
        .dropdown("§7Select Source Unit to Link:", names)
        .show(player)
        .then((res) => {
          if (res.canceled) return;
          const selected = myHoppers[res.formValues[0]];

          if (!selected) {
            player.playSound("note.bass");
            player.sendMessage("§c[ERROR] Target unit not found.");
            return;
          }

          const sourceDimId = selected.dimension.id;
          const destDimId = block.dimension.id;

          const hLoc = selected.location;
          const sourceX = Math.floor(hLoc.x);
          const sourceY = Math.floor(hLoc.y) - 1;
          const sourceZ = Math.floor(hLoc.z);

          if (
            destDimId === sourceDimId &&
            block.location.x === sourceX &&
            block.location.y === sourceY &&
            block.location.z === sourceZ
          ) {
            player.playSound("note.bass");
            player.sendMessage(
              "§c[ERROR] Recursion loop detected. Cannot link source input.",
            );
            return;
          }

          const containerCount =
            selected.getDynamicProperty("containerCount") || 0;
          const max = 10;

          if (containerCount >= max) {
            player.playSound("note.bass");
            player.sendMessage("§c[ERROR] Port limit reached (10/10).");
            return;
          }

          for (let i = 0; i < containerCount; i++) {
            const existing = parseRouteEntry(
              selected.getDynamicProperty(`container_${i}`),
              sourceDimId,
            );
            if (
              existing &&
              existing.dimensionId === destDimId &&
              existing.x === block.location.x &&
              existing.y === block.location.y &&
              existing.z === block.location.z
            ) {
              player.playSound("note.bass");
              player.sendMessage("§c[ERROR] Connection already established.");
              return;
            }
          }

          // Registration is intentionally just this location string (now
          // dimension-tagged): it's all the ChunkLoaderManager needs later
          // to spin up a temporary destination loader, in the correct
          // dimension, at delivery time. There is nothing to place and
          // nothing further to configure - loading is activated
          // automatically, per-transfer, and never kept on permanently.
          const locStr = formatRouteEntry(
            destDimId,
            block.location.x,
            block.location.y,
            block.location.z,
          );
          selected.setDynamicProperty(`container_${containerCount}`, locStr);
          selected.setDynamicProperty("containerCount", containerCount + 1);

          player.sendMessage("§a[SUCCESS] Data link established.");
          player.playSound("random.orb");
          player.playSound("respawn_anchor.charge");
          player.dimension.spawnParticle("minecraft:villager_happy", {
            x: block.location.x + 0.5,
            y: block.location.y + 1,
            z: block.location.z + 0.5,
          });
        });
    });
    return;
  }

  // 2. AMETHYST UPGRADE
  if (
    block.typeId === BLOCK_ID &&
    itemStack?.typeId === "minecraft:amethyst_shard"
  ) {
    player["cool_down"] = Date.now() + COOLDOWN_DURATION;
    ev.cancel = true;

    system.run(() => {
      const hopperEntity = player.dimension.getEntities({
        typeId: ENTITY_ID,
        location: block.location,
        maxDistance: 1.5,
      })[0];
      if (!hopperEntity) return;

      const currentRange =
        hopperEntity.getDynamicProperty("CollectRange") ||
        DEFAULT_COLLECT_RANGE;
      if (currentRange >= MAX_COLLECT_RANGE) {
        player.playSound("note.bass");
        player.sendMessage(`§c[SYSTEM] Maximum range capacity reached.`);
        return;
      }

      hopperEntity.setDynamicProperty("CollectRange", currentRange + 1);
      player.runCommand("clear @s amethyst_shard 0 1");

      const centerLoc = {
        x: hopperEntity.location.x,
        y: hopperEntity.location.y + 0.5,
        z: hopperEntity.location.z,
      };
      player.playSound("random.levelup");
      player.dimension.spawnParticle("minecraft:totem_particle", centerLoc);
      player.sendMessage(
        `§a[UPGRADE] Range increased to ${currentRange + 1} blocks.`,
      );
      showRangeBorder(hopperEntity, currentRange + 1);
    });
    return;
  }

  // 3. CONFIG MENU
  if (
    block.typeId === BLOCK_ID &&
    player.isSneaking &&
    itemStack?.typeId === WRENCH_ID
  ) {
    player["cool_down"] = Date.now() + COOLDOWN_DURATION;
    system.run(() => {
      const safeHopper = player.dimension.getEntities({
        typeId: ENTITY_ID,
        location: block.location,
        maxDistance: 1.5,
      })[0];
      if (!safeHopper) return;
      player.playSound("ui.button.click");
      showMainMenu(safeHopper, player);
    });
    return;
  }

  // 4. STATUS DISPLAY
  if (block.typeId === BLOCK_ID && itemStack?.typeId !== WRENCH_ID) {
    player["cool_down"] = Date.now() + COOLDOWN_DURATION;
    system.run(() => {
      const safeHopper = player.dimension.getEntities({
        typeId: ENTITY_ID,
        location: block.location,
        maxDistance: 1.5,
      })[0];
      if (!safeHopper) return;

      const range =
        safeHopper.getDynamicProperty("CollectRange") || DEFAULT_COLLECT_RANGE;
      const customName = safeHopper.getDynamicProperty("customName");
      const name = customName ? `§e${customName}§r` : "Wireless Hopper";

      const rsMode = safeHopper.getDynamicProperty("rsMode") || 0;
      const power = getReceivedSignal(block);
      let isLocked = false;
      if (rsMode === 1 && power > 0) isLocked = true;
      if (rsMode === 2 && power === 0) isLocked = true;

      const statusText = isLocked ? "§c[LOCKED]" : "§aACTIVE";

      player.onScreenDisplay.setActionBar(
        `${name} | ${statusText}§r | Range: §l${range}x${range}`,
      );
    });
    return;
  }

  // 5. SHOW BORDER
  if (itemStack?.typeId === WRENCH_ID) {
    system.run(() => {
      const hoppers = player.dimension.getEntities({
        typeId: ENTITY_ID,
        location: player.location,
        maxDistance: 5,
      });
      for (const h of hoppers) {
        if (h && h.hasTag("ShowBoarder")) {
          const range =
            h.getDynamicProperty("CollectRange") || DEFAULT_COLLECT_RANGE;
          showRangeBorder(h, range);
        }
      }
    });
  }
});

// === MENU SYSTEMS ===

function showMainMenu(entity, player) {
  const form = new ActionFormData()
    .title("§l§3WIRELESS HOPPER §8[§fv3.2§8]")
    .body(
      `§7§o"Advanced Item Transportation Solution"§r\n\n` +
        `§7Status: §aONLINE\n` +
        `§7Owner: §f${player.name}\n` +
        `§8--------------------\n` +
        `§7Select a module below to configure parameters.`,
    )
    .button(
      "§lStatus & Diagnostics\n§r§7View stats",
      "textures/ui/icon_map",
    )
    .button(
      "§lSystem Settings\n§r§7Configure functionality",
      "textures/ui/dev_glyph_color",
    )
    .button(
      "§lConnections\n§r§7Manage linked outputs",
      "textures/ui/refresh_light",
    )
    .button(
      "§lFilter Manager\n§r§7Whitelist/Blacklist",
      "textures/ui/magnifying_glass",
    )
    .button("§lRange Upgrades\n§r§7View coverage area", "textures/ui/hotbar_0")
    .button(
      "§lIdentity Config\n§r§7Rename this machine",
      "textures/ui/pencil_edit_icon",
    );

  form.show(player).then((r) => {
    if (r.canceled) return;
    switch (r.selection) {
      case 0:
        player.playSound("ui.button.click");
        showStatusInfo(entity, player);
        break;
      case 1:
        player.playSound("ui.button.click");
        showConfig(entity, player);
        break;
      case 2:
        player.playSound("ui.button.click");
        showLinkedContainers(entity, player);
        break;
      case 3:
        player.playSound("ui.button.click");
        showFilterMenu(entity, player);
        break;
      case 4:
        player.playSound("ui.button.click");
        showRangeUpgradeInfo(entity, player);
        break;
      case 5:
        player.playSound("ui.button.click");
        showRenameMenu(entity, player);
        break;
    }
  });
}

function showRenameMenu(entity, player) {
  const currentName = entity.getDynamicProperty("customName") || "";

  new ModalFormData()
    .title("§l§9IDENTITY CONFIG")
    .textField(
      "§7Assign a custom ID to this unit:\n§8Used in dashboards and linking menus.",
      "e.g. Mob Farm Output",
      { defaultvalue: currentName },
    )
    .show(player)
    .then((r) => {
      if (r.canceled) return;
      if (!entity) return;

      const newName = r.formValues[0];

      if (newName && newName.trim().length > 0) {
        const finalName = newName.trim();
        entity.setDynamicProperty("customName", finalName);
        entity.nameTag = `§e${finalName}§r`;
        player.playSound("random.anvil_use");
        player.sendMessage(
          `§a[SYSTEM] Unit identifier set to "§e${finalName}§a".`,
        );
      } else {
        entity.setDynamicProperty("customName", undefined);
        entity.nameTag = "";
        player.playSound("random.break");
        player.sendMessage("§e[SYSTEM] Unit identifier cleared.");
      }
    });
}

function showFilterMenu(entity, player) {
  const isWhitelist = entity.getDynamicProperty("isWhitelist") ?? false;
  const filterString = entity.getDynamicProperty("filterList") || "";
  const filters = filterString ? filterString.split(",") : [];

  const form = new ActionFormData()
    .title("§l§5FILTER PROTOCOLS")
    .body(
      `§7Active Filter Protocol:\n\n` +
        `§7Mode: §l${isWhitelist ? "§aWHITELIST" : "§cBLACKLIST"}§r\n` +
        `§7Count: §f${filters.length > 0 ? filters.length : "None"}\n` +
        `§8--------------------\n` +
        `§7Configure which items are processed.`,
    )
    .button(
      `§lToggle Mode\n§r§7Current: ${isWhitelist ? "White" : "Black"}`,
      "textures/ui/settings_glyph_color_2x",
    )
    .button("§lAdd Held Item\n§r§7Target: Hand", "textures/ui/color_plus")
    .button("§lClear Database\n§r§7Reset filters", "textures/ui/trash")
    .button("§lReturn\n§r§7Back to Main", "textures/ui/arrow_left");

  form.show(player).then((r) => {
    if (r.canceled) return;
    if (!entity) return;

    if (r.selection === 0) {
      entity.setDynamicProperty("isWhitelist", !isWhitelist);
      player.playSound("random.click");
      player.sendMessage(
        `§a[SYSTEM] Filter mode switched to ${
          !isWhitelist ? "Whitelist" : "Blacklist"
        }.`,
      );
      showFilterMenu(entity, player);
    } else if (r.selection === 1) {
      const hand = player
        .getComponent("inventory")
        .container.getItem(player.selectedSlotIndex);
      if (!hand) {
        player.playSound("note.bass");
        player.sendMessage("§c[ERROR] No item detected in hand.");
        return;
      }
      if (filters.includes(hand.typeId)) {
        player.playSound("note.bass");
        player.sendMessage(
          `§c[ERROR] Item '${hand.typeId}' is already registered.`,
        );
        return;
      }
      filters.push(hand.typeId);
      entity.setDynamicProperty("filterList", filters.join(","));
      player.playSound("random.pop");
      player.sendMessage(`§a[SYSTEM] Registered '${hand.typeId}' to filter.`);
      showFilterMenu(entity, player);
    } else if (r.selection === 2) {
      entity.setDynamicProperty("filterList", "");
      player.playSound("mob.armor_stand.break");
      player.sendMessage("§e[SYSTEM] Filter database flushed.");
      showFilterMenu(entity, player);
    } else {
      player.playSound("ui.button.click");
      showMainMenu(entity, player);
    }
  });
}

function showConfig(entity, player) {
  const distMode = entity.getDynamicProperty("distMode") || 0;
  const rsMode = entity.getDynamicProperty("rsMode") || 0;
  const xpState = entity.getDynamicProperty("xpMode") ?? false;

  const fullState = entity.hasTag("FullNotification");
  const teleState = entity.hasTag("Teleportable");
  const borderState = entity.hasTag("ShowBoarder");
  const antiState = entity.hasTag("AntiBreak");
  const trashState = !!entity.getDynamicProperty("trashMode");

  new ModalFormData()
    .title("§l§dSYSTEM KERNEL")
    .toggle("§7Full Notification", { defaultvalue: fullState })
    .toggle("§aDistribution Enabled", { defaultvalue: teleState })
    .toggle("§7Show Range Border", { defaultvalue: borderState })
    .toggle("§cAnti-Break Security", { defaultvalue: antiState })
    .toggle("§cVoid Overflow Items", { defaultvalue: trashState })
    .toggle("§eXP Vacuum Mode", { defaultvalue: xpState })
    .dropdown(
      "Distribution Mode",
      ["Round Robin (Even Split)", "Fill First (Sequential)"],
      { defaultvalue: distMode },
    )
    .dropdown(
      "Redstone Control",
      ["Always Active", "Pause on Signal (Standard)", "Activate on Signal"],
      { defaultvalue: rsMode },
    )
    .show(player)
    .then(({ canceled, formValues }) => {
      if (canceled) return;
      if (!entity) {
        player.playSound("note.bass");
        player.sendMessage(
          "§c[ERROR] Connection lost. Unit may have been destroyed.",
        );
        return;
      }

      const [full, tele, border, anti, trash, xpMode, dist, newRsMode] =
        formValues;

      full
        ? entity.addTag("FullNotification")
        : entity.removeTag("FullNotification");
      tele ? entity.addTag("Teleportable") : entity.removeTag("Teleportable");
      border ? entity.addTag("ShowBoarder") : entity.removeTag("ShowBoarder");
      anti ? entity.addTag("AntiBreak") : entity.removeTag("AntiBreak");

      entity.setDynamicProperty("trashMode", trash);
      entity.setDynamicProperty("distMode", dist);
      entity.setDynamicProperty("rsMode", newRsMode);
      entity.setDynamicProperty("xpMode", xpMode);

      if (border)
        showRangeBorder(
          entity,
          entity.getDynamicProperty("CollectRange") || DEFAULT_COLLECT_RANGE,
        );

      const centerLoc = {
        x: entity.location.x,
        y: entity.location.y + 0.5,
        z: entity.location.z,
      };
      entity.dimension.spawnParticle("minecraft:villager_happy", centerLoc);

      player.playSound("random.click");
      player.sendMessage("§a[SYSTEM] Kernel configuration updated.");
    });
}

function showStatusInfo(entity, player) {
  const tier = entity.getDynamicProperty("tier") || 1;
  const range =
    entity.getDynamicProperty("CollectRange") || DEFAULT_COLLECT_RANGE;
  const count = entity.getDynamicProperty("containerCount") || 0;
  const trash = entity.getDynamicProperty("trashMode") ? "§cON" : "§aOFF";
  const xpMode = entity.getDynamicProperty("xpMode") ? "§eACTIVE" : "§7OFF";
  const dist =
    (entity.getDynamicProperty("distMode") || 0) === 0
      ? "Round Robin"
      : "Fill First";
  const customName = entity.getDynamicProperty("customName");
  const name = customName ? `§e${customName}§r` : "Generic Unit";

  const rsMode = entity.getDynamicProperty("rsMode") || 0;
  const rsText =
    rsMode === 0
      ? "Always Active"
      : rsMode === 1
        ? "Pause on Signal"
        : "Active on Signal";

  new ActionFormData()
    .title("§l§bDIAGNOSTICS")
    .body(
      `§7================================\n` +
        `§7UNIT ID   : §f${name}\n` +
        `§7TIER      : §f${tier}\n` +
        `§7COVERAGE  : §f${range}x${range}\n` +
        `§7OUTPUTS   : §f${count}\n` +
        `§7TRASH     : §f${trash}\n` +
        `§7XP MODE   : ${xpMode}\n` +
        `§7MODE      : §f${dist}\n` +
        `§7REDSTONE  : §f${rsText}\n` +
        `§7================================`,
    )
    .button("Close")
    .show(player);
}

function showLinkedContainers(entity, player) {
  const count = entity.getDynamicProperty("containerCount") || 0;
  const form = new ActionFormData()
    .title("§l§6ROUTING TABLE")
    .body(
      `§7Total Active Routes: §e${count} / 10§r\n` +
        `§8--------------------\n` +
        `§7Select a connection to terminate signal.`,
    );

  for (let i = 0; i < count; i++) {
    const route = parseRouteEntry(
      entity.getDynamicProperty(`container_${i}`),
      entity.dimension.id,
    );
    if (route) {
      const dimTag = shortDimName(route.dimensionId);
      form.button(
        `§lTerminate Link\n§r§7Target: [${dimTag}] ${route.x}, ${route.y}, ${route.z}`,
        "textures/ui/cancel",
      );
    }
  }

  form
    .button("§lReturn\n§r§7Back to Main", "textures/ui/arrow_left")
    .show(player)
    .then((r) => {
      if (r.canceled || r.selection >= count) return;
      if (!entity) return;

      const lastLoc = entity.getDynamicProperty(`container_${count - 1}`);
      entity.setDynamicProperty(`container_${r.selection}`, lastLoc);
      entity.setDynamicProperty(`container_${count - 1}`, undefined);
      entity.setDynamicProperty("containerCount", count - 1);

      player.playSound("random.break");
      player.sendMessage("§e[SYSTEM] Link terminated successfully.");
    });
}

function showRangeUpgradeInfo(entity, player) {
  const range =
    entity.getDynamicProperty("CollectRange") || DEFAULT_COLLECT_RANGE;
  new ActionFormData()
    .title("§l§dRANGE UPGRADE")
    .body(
      `§7Current Radius: §b${range}x${range}\n` +
        `§7Maximum Limit : §c${MAX_COLLECT_RANGE}x${MAX_COLLECT_RANGE}\n\n` +
        `§fProtocol:\n` +
        `§7Interact with the hopper block using an §dAmethyst Shard§7 to expand coverage.`,
    )
    .button("OK")
    .show(player);
}

// === MAIN LOGIC LOOP ===
system.runInterval(() => {
  for (const dimName of DIMENSION_NAMES) {
    const dim = world.getDimension(dimName);
    const hoppers = dim.getEntities({ typeId: ENTITY_ID });

    for (const entity of hoppers) {
      if (!entity) continue;

      const blockLoc = {
        x: Math.floor(entity.location.x),
        y: Math.floor(entity.location.y),
        z: Math.floor(entity.location.z),
      };
      const block = dim.getBlock(blockLoc);
      if (!block) continue;

      // REDSTONE CONTROL LOGIC
      const rsMode = entity.getDynamicProperty("rsMode") || 0;
      const power = getReceivedSignal(block);
      let isLocked = false;

      if (rsMode === 1 && power > 0) isLocked = true;
      if (rsMode === 2 && power === 0) isLocked = true;

      if (isLocked) {
        if (system.currentTick % 20 === 0) {
          dim.spawnParticle("minecraft:basic_smoke_particle", {
            x: entity.location.x,
            y: entity.location.y + 0.5,
            z: entity.location.z,
          });
        }
        continue;
      }

      // === 1. COLLECT & VACUUM ===
      const range =
        entity.getDynamicProperty("CollectRange") || DEFAULT_COLLECT_RANGE;

      // === 1a. ITEM VACUUM ===
      const items = dim.getEntities({
        type: "minecraft:item",
        location: entity.location,
        maxDistance: range,
      });

      const filterString = entity.getDynamicProperty("filterList") || "";
      const filters = filterString ? filterString.split(",") : [];
      const isWhitelist = entity.getDynamicProperty("isWhitelist") ?? false;
      const xpMode = entity.getDynamicProperty("xpMode") ?? false;

      const inventoryComp = dim
        .getBlock({ x: blockLoc.x, y: blockLoc.y - 1, z: blockLoc.z })
        ?.getComponent("inventory");
      const inventory = inventoryComp?.container;

      const hopperCenter = {
        x: entity.location.x,
        y: entity.location.y + 0.5,
        z: entity.location.z,
      };

      // === 1b. XP VACUUM ===
      if (xpMode) {
        const orbs = dim.getEntities({
          typeId: "minecraft:xp_orb",
          location: entity.location,
          maxDistance: range,
        });

        for (const orb of orbs) {
          if (!orb) continue;
          const dist = getDistance(hopperCenter, orb.location);

          if (dist > 0.5) {
            const dir = getDirection(orb.location, hopperCenter);
            if (orb.location.y < hopperCenter.y) dir.y += 0.2; // Slight lift
            orb.applyImpulse({
              x: dir.x * 0.3,
              y: dir.y * 0.3,
              z: dir.z * 0.3,
            });
          } else {
            // Keep them neat at the center
            orb.teleport(hopperCenter);
          }
        }
      }

      if (inventory) {
        for (const itemEntity of items) {
          if (!itemEntity) continue;
          const itemStack = itemEntity.getComponent("item").itemStack;

          const inList = filters.includes(itemStack.typeId);
          if (isWhitelist && !inList) continue;
          if (!isWhitelist && inList) continue;

          const dist = getDistance(hopperCenter, itemEntity.location);

          if (dist > 1.5) {
            const dir = getDirection(itemEntity.location, hopperCenter);
            if (itemEntity.location.y < hopperCenter.y) {
              dir.y += 0.1;
            }
            const velocity = { x: dir.x * 0.8, y: dir.y * 0.8, z: dir.z * 0.8 };

            try {
              itemEntity.applyImpulse(velocity);
            } catch (e) {}
            continue;
          }

          try {
            dim.spawnParticle(
              "minecraft:eyeofender_death_explode_particle",
              itemEntity.location,
            );
            const left = addItemsToInventory(
              inventory,
              itemStack,
              itemStack.amount,
            );

            if (left === 0) itemEntity.remove();
          } catch (e) {}
        }
      }

      // === 2. DISTRIBUTE ===
      if (entity.hasTag("Teleportable") && inventory) {
        const count = entity.getDynamicProperty("containerCount") || 0;
        if (count > 0) {
          processDistribution(entity, inventory, dim);
        }
      }
    }
  }
}, 1);

export function processDistribution(entity, sourceInv, dim) {
  const count = entity.getDynamicProperty("containerCount") || 0;
  const distMode = entity.getDynamicProperty("distMode") || 0;
  const trashMode = entity.getDynamicProperty("trashMode") ?? false;
  let nextIndex = entity.getDynamicProperty("rrIndex") || 0;

  for (let i = 0; i < sourceInv.size; i++) {
    const item = sourceInv.getItem(i);
    if (!item) continue;

    let remaining = item.amount;
    let startIdx = distMode === 0 ? nextIndex : 0;
    let loops = 0;
    let currentIdx = startIdx;

    // An item is present and ready to move: this is the point the spec
    // calls "item enters hopper -> look up destination -> activate
    // destination loader". Everything below runs once per game tick until
    // the item is fully delivered, so a destination whose chunk isn't
    // loaded yet is retried automatically - "wait until destination
    // inventory becomes valid" falls out of that retry for free, and the
    // 15s keep-alive resets on every attempt, satisfied or not.
    while (remaining > 0 && loops < count) {
      const locStr = entity.getDynamicProperty(`container_${currentIdx}`);
      // dim.id is the fallback for legacy (dimension-less) entries created
      // before cross-dimensional routing existed - they always meant "same
      // dimension as the source hopper", so that's still exactly right.
      const route = parseRouteEntry(locStr, dim.id);

      if (route) {
        // world.getDimension() just resolves a handle - unlike getBlock, it
        // doesn't require the target chunk to be loaded, so this never
        // throws for a valid id. It's wrapped anyway in case stored data is
        // ever corrupted, matching the file's existing defensive style.
        try {
          const destDim = world.getDimension(route.dimensionId);
          chunkLoaderManager.ensureLoaded(destDim, route);

          // destDim.getBlock() throws LocationInUnloadedChunkError instead
          // of returning null when the destination chunk isn't loaded yet -
          // this is the normal state right after ensureLoaded() has just
          // kicked off loading (or when the chunk isn't reachable at all).
          // Treat it the same as "no inventory there yet": leave the item in
          // the source and let next tick's retry pick it up once the chunk
          // comes up.
          try {
            const targetBlock = destDim.getBlock(route);
            const targetInv = targetBlock?.getComponent("inventory")?.container;

            if (targetInv) {
              remaining = addItemsToInventory(targetInv, item, remaining);
            }
          } catch (e) {}
        } catch (e) {}
      }

      currentIdx = (currentIdx + 1) % count;
      loops++;

      if (distMode === 0 && remaining < item.amount) {
        break;
      }
    }

    if (distMode === 0) {
      entity.setDynamicProperty("rrIndex", currentIdx);
    }

    if (remaining === 0) {
      sourceInv.setItem(i, null);
    } else {
      if (trashMode && loops >= count) {
        sourceInv.setItem(i, null);
        dim.spawnParticle("minecraft:lava_particle", entity.location);
      } else {
        item.amount = remaining;
        sourceInv.setItem(i, item);
      }
    }
  }
}

// === BOILERPLATE BLOCK/ENTITY MANAGEMENT ===
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  system.run(() => {
    if (ev.block.typeId === BLOCK_ID) {
      const d = ev.block.dimension;
      const l = ev.block.location;
      const below = d.getBlock({ x: l.x, y: l.y - 1, z: l.z });
      if (!below.getComponent("inventory")) {
        ev.player.sendMessage("§c[!] Place on a container.");
        ev.player.playSound("note.bass");
        d.runCommand(`setblock ${l.x} ${l.y} ${l.z} air destroy`);
        return;
      }
      const e = d.spawnEntity(ENTITY_ID, {
        x: l.x + 0.5,
        y: l.y,
        z: l.z + 0.5,
      });
      e.addTag("ShowBoarder");
      e.addTag("Teleportable");
      e.setDynamicProperty("ownerName", ev.player.name);
      e.setDynamicProperty("CollectRange", DEFAULT_COLLECT_RANGE);
      e.setDynamicProperty("rsMode", 0);
      e.setDynamicProperty("xpMode", false); // Default OFF

      ev.player.playSound("random.orb");
      ev.player.sendMessage("§a[!] Hopper setup complete.");
      showRangeBorder(e, DEFAULT_COLLECT_RANGE);
    }
  });
});

world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  if (ev.block.typeId === BLOCK_ID) {
    const ent = ev.player.dimension.getEntities({
      typeId: ENTITY_ID,
      location: ev.block.location,
    })[0];
    if (ent) {
      if (
        ent.hasTag("AntiBreak") &&
        ent.getDynamicProperty("ownerName") !== ev.player.name
      ) {
        ev.cancel = true;
        ev.player.playSound("note.bass");
        ev.player.sendMessage("§c[!] Protected.");
        return;
      }
      system.run(() => {
        if (ent) {
          ent.kill();
        }
      });
    }
  }
});

function showRangeBorder(entity, range) {
  if (!entity) return;
  const center = entity.location;
  const dim = entity.dimension;
  const steps = range * 4;

  // Safely spawn particle with bounds check to prevent crash logs
  const safeSpawn = (id, loc) => {
    // Basic bounds check to avoid engine errors at world limits
    if (loc.y < -64 || loc.y > 320) return;
    try {
      dim.spawnParticle(id, loc);
    } catch (e) {}
  };

  try {
    for (let i = 0; i <= steps; i++) {
      const offset = (i / steps) * 2 * range - range;
      const y = center.y + 0.5;

      safeSpawn("minecraft:endrod", {
        x: center.x + range,
        y,
        z: center.z + offset,
      });
      safeSpawn("minecraft:endrod", {
        x: center.x - range,
        y,
        z: center.z + offset,
      });
      safeSpawn("minecraft:endrod", {
        x: center.x + offset,
        y,
        z: center.z + range,
      });
      safeSpawn("minecraft:endrod", {
        x: center.x + offset,
        y,
        z: center.z - range,
      });
    }

    // Also show connection lines if debug is on. Only drawn for
    // same-dimension destinations - a straight line between an Overworld
    // and a Nether/End coordinate would just be a meaningless particle
    // trail through unrelated coordinate spaces, so cross-dimension links
    // are silently skipped here (they still work; they just aren't drawn).
    const count = entity.getDynamicProperty("containerCount") || 0;
    const sourceDimId = dim.id;
    for (let j = 0; j < count; j++) {
      const locStr = entity.getDynamicProperty(`container_${j}`);
      const route = parseRouteEntry(locStr, sourceDimId);
      if (route && route.dimensionId === sourceDimId) {
        const { x: tx, y: ty, z: tz } = route;
        const steps = 15;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const px = center.x + (tx + 0.5 - center.x) * t;
          const py = center.y + 0.5 + (ty + 0.5 - (center.y + 0.5)) * t;
          const pz = center.z + (tz + 0.5 - center.z) * t;
          safeSpawn("minecraft:basic_flame_particle", {
            x: px,
            y: py,
            z: pz,
          });
        }
      }
    }
  } catch (e) {}
}
