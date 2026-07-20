/**
 * Chunk Loader UI
 *
 * Handles the interaction form when a player right-clicks their chunk loader,
 * including the farm mode selection screen and setup validation.
 */

import { world, system } from '@minecraft/server';
import { ActionFormData } from '@minecraft/server-ui';
import { FARM_TYPES, FARM_TYPE_LIST } from './FarmDefinitions.js';

/**
 * Open the main chunk loader interaction form.
 * @param {import('@minecraft/server').Player} player
 * @param {{ id: string, location: object, dimension: string, placedBy: string, active: boolean, farmMode?: string }} loader
 * @param {object} manager - ChunkLoaderManager instance
 * @param {(player: object, loader: object) => void} toggleFn - Callback to toggle the loader on/off
 */
export function openChunkLoaderUI(player, loader, manager, toggleFn) {
    const isActive = loader.active !== false;
    const isPowered = loader.redstonePowered || false;
    const farmMode = loader.farmMode || 'none';
    const farmDef = FARM_TYPES[farmMode];
    const coords = `${loader.location.x}, ${loader.location.y}, ${loader.location.z}`;

    let statusText;
    if (!isActive) {
        statusText = '§c[INACTIVE]';
    } else if (isPowered) {
        statusText = '§6[REDSTONE OFF]';
    } else {
        statusText = '§a[ACTIVE]';
    }

    let bodyText =
        `§fStatus: ${statusText}\n` +
        `§fFarm Type: ${farmDef ? farmDef.displayName : '§7None'}\n` +
        `§fOwner: §e${loader.placedBy}\n` +
        `§fPosition: §7${coords}\n`;

    if (isActive && isPowered) {
        bodyText += `\n§6Receiving redstone signal - chunk loading paused.\n§7Remove the signal to resume.\n`;
    }

    const form = new ActionFormData()
        .title('§5§lChunk Loader')
        .body(bodyText);

    const toggleLabel = isActive
        ? '§6Deactivate Chunk Loader\n§8Turn off chunk loading'
        : '§aActivate Chunk Loader\n§8Turn on chunk loading';
    form.button(toggleLabel);

    const config = manager.getConfig();
    const farmModeAllowed = config.farmModeEnabled !== false;
    if (farmModeAllowed) {
        form.button('§dSet Farm Type\n§8Select farm configuration');
    }

    form.show(player).then(response => {
        if (response.canceled) return;

        if (response.selection === 0) {
            toggleFn(player, loader);
        } else if (response.selection === 1 && farmModeAllowed) {
            openFarmModeUI(player, loader, manager, toggleFn);
        }
    });
}

/**
 * Open the farm type selection form.
 */
function openFarmModeUI(player, loader, manager, toggleFn) {
    const currentMode = loader.farmMode || 'none';

    const form = new ActionFormData()
        .title('§5§lSelect Farm Type')
        .body(
            '§fSelect the type of farm connected to this chunk loader.\n' +
            '§7The chunk loader must be placed above the farm\'s collection system.\n'
        );

    for (const typeId of FARM_TYPE_LIST) {
        const def = FARM_TYPES[typeId];
        const isSelected = (typeId === currentMode);
        const marker = isSelected ? ' §a✓' : '';
        form.button(`${def.displayName}${marker}`, def.icon);
    }

    form.show(player).then(response => {
        if (response.canceled) {
            system.runTimeout(() => {
                const updatedLoader = manager.getChunkLoader(loader.id);
                if (updatedLoader) {
                    openChunkLoaderUI(player, { id: loader.id, ...updatedLoader }, manager, toggleFn);
                }
            }, 5);
            return;
        }

        const selectedTypeId = FARM_TYPE_LIST[response.selection];

        // "None" can always be set (disables farm mode)
        if (selectedTypeId === 'none') {
            applyFarmMode(player, loader, manager, selectedTypeId, toggleFn);
            return;
        }

        // Validate setup before allowing a farm mode
        if (!validateFarmSetup(player, loader)) {
            system.runTimeout(() => {
                const updatedLoader = manager.getChunkLoader(loader.id);
                if (updatedLoader) {
                    openFarmModeUI(player, { id: loader.id, ...updatedLoader }, manager, toggleFn);
                }
            }, 40);
            return;
        }

        applyFarmMode(player, loader, manager, selectedTypeId, toggleFn);
    });
}

/**
 * Apply the selected farm mode to the loader and update the entity nameTag.
 */
function applyFarmMode(player, loader, manager, farmTypeId, toggleFn) {
    const storedLoader = manager.getChunkLoader(loader.id);
    if (!storedLoader) {
        player.sendMessage('§c[Chunk Loader] §fChunk loader data not found.');
        return;
    }

    storedLoader.farmMode = farmTypeId;
    manager.saveChunkLoaders();

    const farmDef = FARM_TYPES[farmTypeId];
    if (farmTypeId === 'none') {
        player.sendMessage('§a[Chunk Loader] §fFarm type cleared.');
    } else {
        player.sendMessage(`§a[Chunk Loader] §fFarm type set to: ${farmDef.displayName}`);
    }

    // Update entity nameTag
    updateEntityNameTag(loader, storedLoader, manager);

    // Re-open the main UI
    system.runTimeout(() => {
        const updatedLoader = manager.getChunkLoader(loader.id);
        if (updatedLoader) {
            openChunkLoaderUI(player, { id: loader.id, ...updatedLoader }, manager, toggleFn);
        }
    }, 40);
}

/**
 * Update the floating text entity nameTag to reflect the current farm mode.
 */
function updateEntityNameTag(loader, loaderData, manager) {
    try {
        const dimension = world.getDimension(loader.dimension);
        const entities = dimension.getEntities({
            type: 'chunkloader:chunk_loader',
            location: {
                x: loader.location.x + 0.5,
                y: loader.location.y + 0.5,
                z: loader.location.z + 0.5
            },
            maxDistance: 2
        });

        const entity = entities.find(e => e.hasTag(`loader_${loader.id}`));
        if (entity) {
            const isActive = loaderData.active !== false;

            // Check if redstone is currently overriding
            let redstonePowered = false;
            try {
                const block = dimension.getBlock(loader.location);
                if (block) {
                    const power = block.getRedstonePower();
                    redstonePowered = power !== undefined && power > 0;
                }
            } catch {}

            let statusText;
            if (!isActive) {
                statusText = '§c[INACTIVE]';
            } else if (redstonePowered) {
                statusText = '§6[REDSTONE OFF]';
            } else {
                statusText = '§a[ACTIVE]';
            }

            const farmLabel = loaderData.farmMode && loaderData.farmMode !== 'none'
                ? `\n§7Farm: ${FARM_TYPES[loaderData.farmMode].displayName}`
                : '';
            entity.nameTag = `§5§lChunk Loader\n${statusText}\n§7Owner: ${loaderData.placedBy}${farmLabel}`;
        }
    } catch (error) {
        console.warn('[Chunk Loader] Error updating entity nameTag:', error);
    }
}

/**
 * Validate that the chunk loader has a valid collection system beneath it.
 * Returns true if a hopper or water is detected, false otherwise.
 */
function validateFarmSetup(player, loader) {
    try {
        const dimension = world.getDimension(loader.dimension);

        // Check for hopper directly below
        const hopperLoc = {
            x: loader.location.x,
            y: loader.location.y - 1,
            z: loader.location.z
        };
        const blockBelow = dimension.getBlock(hopperLoc);
        if (blockBelow && blockBelow.typeId === 'minecraft:hopper') {
            player.sendMessage('§a[Chunk Loader] §fCollection system detected: §eHopper');
            return true;
        }

        // Check for water within 2 blocks below
        for (let dy = -1; dy >= -2; dy--) {
            const checkLoc = {
                x: loader.location.x,
                y: loader.location.y + dy,
                z: loader.location.z
            };
            const block = dimension.getBlock(checkLoc);
            if (block && (block.typeId === 'minecraft:water' || block.typeId === 'minecraft:flowing_water')) {
                player.sendMessage('§a[Chunk Loader] §fCollection system detected: §eWater Stream');
                return true;
            }
        }

        // No valid setup found
        player.sendMessage('§c[Chunk Loader] §fFarm type could not be set!');
        player.sendMessage('§7The chunk loader must be placed above the farm\'s collection system.');
        player.sendMessage('§7Place a §ehopper directly below§7 the chunk loader, or ensure');
        player.sendMessage('§7a §ewater source§7 is within 2 blocks beneath it.');
        return false;
    } catch (error) {
        console.warn('[Chunk Loader] Error validating farm setup:', error);
        player.sendMessage('§c[Chunk Loader] §fCould not validate setup. Try again.');
        return false;
    }
}
