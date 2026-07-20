import { world, system, ItemStack, CommandPermissionLevel } from '@minecraft/server';
import { ActionFormData, ModalFormData } from '@minecraft/server-ui';
import { FloatingTextVisibility } from './FloatingTextVisibility.js';
import { FarmEmulator } from './FarmEmulator.js';
import { openChunkLoaderUI } from './ChunkLoaderUI.js';
import { FARM_TYPES } from './FarmDefinitions.js';

class ChunkLoaderManager {
    constructor() {
        this.chunkLoaders = new Map();
        this.config = {
            maxLoadersPerPlayer: 5,
            defaultRadius: 4,
            globalDisabled: false,
            farmProximityDistance: 128,
            farmModeEnabled: true,
            redstoneEnabled: true
        };
        this.initialize();
    }

    initialize() {
        // Load existing chunk loaders from world properties
        system.runTimeout(() => {
            this.loadConfig();
            this.loadChunkLoaders();
        }, 20);
    }

    loadConfig() {
        try {
            const data = world.getDynamicProperty('chunkloader:config');
            if (data) {
                this.config = JSON.parse(data);
            }
        } catch (error) {
            console.warn('[Chunk Loader] Error loading config:', error);
        }
    }

    saveConfig() {
        try {
            world.setDynamicProperty('chunkloader:config', JSON.stringify(this.config));
        } catch (error) {
            console.warn('[Chunk Loader] Error saving config:', error);
        }
    }

    getConfig() {
        return { ...this.config };
    }

    updateConfig(key, value) {
        if (key in this.config) {
            this.config[key] = value;
            this.saveConfig();
            return true;
        }
        return false;
    }

    loadChunkLoaders() {
        try {
            const data = world.getDynamicProperty('chunkloader:loaders');
            if (data) {
                const loaders = JSON.parse(data);
                this.chunkLoaders = new Map(Object.entries(loaders));
            }
        } catch (error) {
            console.warn('[Chunk Loader] Error loading chunk loader data:', error);
        }
    }

    saveChunkLoaders() {
        try {
            const data = Object.fromEntries(this.chunkLoaders);
            world.setDynamicProperty('chunkloader:loaders', JSON.stringify(data));
        } catch (error) {
            console.warn('[Chunk Loader] Error saving chunk loader data:', error);
        }
    }

    generateLoaderId(location) {
        return `${Math.floor(location.x)}_${Math.floor(location.y)}_${Math.floor(location.z)}`;
    }

    registerChunkLoader(location, dimension, placedBy) {
        const loaderId = this.generateLoaderId(location);

        this.chunkLoaders.set(loaderId, {
            location: {
                x: Math.floor(location.x),
                y: Math.floor(location.y),
                z: Math.floor(location.z)
            },
            dimension: dimension,
            placedBy: placedBy,
            placedAt: Date.now(),
            active: true,
            farmMode: 'none'
        });

        this.saveChunkLoaders();
        return loaderId;
    }

    toggleChunkLoader(loaderId) {
        const loader = this.chunkLoaders.get(loaderId);
        if (loader) {
            loader.active = !loader.active;
            this.saveChunkLoaders();
            return loader.active;
        }
        return null;
    }

    removeChunkLoader(loaderId) {
        this.chunkLoaders.delete(loaderId);
        this.saveChunkLoaders();
    }

    getChunkLoader(loaderId) {
        return this.chunkLoaders.get(loaderId);
    }

    getAllChunkLoaders() {
        return Array.from(this.chunkLoaders.entries()).map(([id, data]) => ({
            id,
            ...data
        }));
    }

    getPlayerChunkLoaderCount(playerName) {
        return this.getAllChunkLoaders().filter(loader => loader.placedBy === playerName).length;
    }

    removeChunkLoaderEntity(location, dimension, loaderId) {
        try {
            const dim = world.getDimension(dimension);
            const entityLoc = {
                x: location.x + 0.5,
                y: location.y + 0.5,
                z: location.z + 0.5
            };

            const entities = dim.getEntities({
                type: 'chunkloader:chunk_loader',
                location: entityLoc,
                maxDistance: 2
            });

            // Try to find by tag first, otherwise remove all entities at this location
            const entity = loaderId
                ? entities.find(e => e.hasTag(`loader_${loaderId}`))
                : entities[0];

            if (entity) {
                entity.remove();
            } else if (entities.length > 0) {
                // Fallback: remove all chunk loader entities at this location
                entities.forEach(e => e.remove());
            }
        } catch (error) {
            console.warn('[Chunk Loader] Error removing entity:', error);
        }
    }
}

// Initialize manager
const manager = new ChunkLoaderManager();

// [Modified for Warehouse Utilities] Exported so main.js can read the
// current default radius for the wrench's loader-border visualization,
// without duplicating this class's config storage.
export { manager };

// Initialize floating text visibility (raycasting to hide text behind walls)
const visibility = new FloatingTextVisibility();

// Redstone detection system
// Tracks current redstone power state per loader (populated by onRedstoneUpdate custom component)
const redstoneStates = new Map();
// Tracks pending deactivation timeouts so they can be cancelled if redstone is removed quickly
const pendingRedstoneTimeouts = new Map();

// Initialize farm system (handles item production for connected farms)
const farmEmulator = new FarmEmulator(manager, redstoneStates);

/**
 * Check if a loader is currently being overridden by redstone.
 * Returns false if the redstone feature is disabled by admin.
 */
function isRedstoneOverriding(loaderId) {
    if (manager.config.redstoneEnabled === false) return false;
    return redstoneStates.get(loaderId) || false;
}

/**
 * Get the status text for a loader considering manual state and redstone.
 */
function getLoaderStatusText(manualActive, redstonePowered) {
    if (!manualActive) return '§c[INACTIVE]';
    if (redstonePowered) return '§6[REDSTONE OFF]';
    return '§a[ACTIVE]';
}

/**
 * Get the status message for a loader considering manual state and redstone.
 */
function getLoaderStatusMsg(manualActive, redstonePowered) {
    if (!manualActive) return '§6deactivated';
    if (redstonePowered) return '§6paused by redstone';
    return '§aactivated';
}

/**
 * Handle a redstone power change on a chunk loader block.
 * Called by the chunkloader:redstone_handler custom component.
 *
 * Visuals (block permutation, nameTag, sound) update immediately.
 * When deactivating, the actual chunk unload (entity event) is delayed by 2 seconds
 * so nearby redstone circuits have time to respond before the chunk freezes.
 * If the signal is removed during that window, the pending deactivation is cancelled.
 */
function handleRedstoneUpdate(block, powerLevel) {
    const location = block.location;
    const loaderId = manager.generateLoaderId(location);
    const loaderData = manager.getChunkLoader(loaderId);

    if (!loaderData) return; // Not registered yet (e.g. during initial placement)

    if (manager.config.globalDisabled) return;
    if (manager.config.redstoneEnabled === false) return;

    const isPowered = powerLevel > 0;
    const wasPowered = redstoneStates.get(loaderId) || false;

    if (isPowered === wasPowered) return; // No change
    redstoneStates.set(loaderId, isPowered);

    // Only act if the user wants the loader active
    if (!loaderData.active) return;

    const effectiveActive = !isPowered;

    // Update block visual immediately
    try {
        block.setPermutation(block.permutation.withState('chunkloader:active', effectiveActive));
    } catch (error) {
        console.warn('[Chunk Loader] Error setting block state from redstone:', error);
    }

    const dimension = block.dimension;
    const dimensionId = loaderData.dimension;
    const entityLoc = { x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 };

    const entities = dimension.getEntities({
        type: 'chunkloader:chunk_loader',
        location: entityLoc,
        maxDistance: 2
    });

    const entity = entities.find(e => e.hasTag(`loader_${loaderId}`));
    if (entity) {
        const config = manager.getConfig();
        const radius = Math.max(0, Math.min(6, config.defaultRadius));

        // Update nameTag immediately
        const farmLabel = loaderData.farmMode && loaderData.farmMode !== 'none' && FARM_TYPES[loaderData.farmMode]
            ? `\n§7Farm: ${FARM_TYPES[loaderData.farmMode].displayName}`
            : '';
        const statusText = getLoaderStatusText(loaderData.active, isPowered);
        entity.nameTag = `§5§lChunk Loader\n${statusText}\n§7Owner: ${loaderData.placedBy}${farmLabel}`;

        // Play sound immediately
        try {
            dimension.runCommand(`playsound random.click @a[r=16] ${entityLoc.x} ${entityLoc.y} ${entityLoc.z} 0.5 ${isPowered ? 0.8 : 1.2}`);
        } catch {}

        // Cancel any pending redstone timeout for this loader
        const pendingTimeout = pendingRedstoneTimeouts.get(loaderId);
        if (pendingTimeout !== undefined) {
            system.clearRun(pendingTimeout);
            pendingRedstoneTimeouts.delete(loaderId);
        }

        if (effectiveActive) {
            // Reactivating - restore chunk loading immediately
            entity.triggerEvent(`chunkloader:activate_r${radius}`);
        } else {
            // Deactivating - delay the actual chunk unload so nearby circuits can respond
            const timeoutId = system.runTimeout(() => {
                pendingRedstoneTimeouts.delete(loaderId);
                try {
                    // Re-verify state hasn't changed during the delay
                    const currentData = manager.getChunkLoader(loaderId);
                    if (!currentData || !currentData.active) return;
                    if (!redstoneStates.get(loaderId)) return; // Signal removed during delay

                    // Re-find the entity (original reference may be stale)
                    const dim = world.getDimension(dimensionId);
                    const ents = dim.getEntities({
                        type: 'chunkloader:chunk_loader',
                        location: entityLoc,
                        maxDistance: 2
                    });
                    const ent = ents.find(e => e.hasTag(`loader_${loaderId}`));
                    if (ent) {
                        ent.triggerEvent('chunkloader:deactivate');
                    }
                } catch {}
            }, 40); // 2 second grace period
            pendingRedstoneTimeouts.set(loaderId, timeoutId);
        }
    }
}

// Handle block placement
world.afterEvents.playerPlaceBlock.subscribe((event) => {
    const { block, player } = event;

    if (block.typeId === 'chunkloader:chunk_loader') {
        const location = block.location;
        const dimension = block.dimension.id;

        // Check if globally disabled
        const config = manager.getConfig();
        if (config.globalDisabled) {
            player.sendMessage('§c[Chunk Loader] Chunk loaders are currently disabled by an administrator!');
            player.sendMessage('§7Contact an admin for more information.');

            // Remove the block and give it back
            system.runTimeout(() => {
                try {
                    block.setType('minecraft:air');
                    player.getComponent('minecraft:inventory').container.addItem(
                        new ItemStack('chunkloader:chunk_loader', 1)
                    );
                } catch (error) {
                    console.warn('[Chunk Loader] Error refunding block:', error);
                }
            }, 1);
            return;
        }

        // Check player limit
        const playerCount = manager.getPlayerChunkLoaderCount(player.name);
        if (playerCount >= config.maxLoadersPerPlayer) {
            player.sendMessage(`§c[Chunk Loader] You have reached the maximum limit of ${config.maxLoadersPerPlayer} chunk loaders!`);
            player.sendMessage('§7Contact an admin if you need more loaders.');

            // Remove the block and give it back
            system.runTimeout(() => {
                try {
                    block.setType('minecraft:air');
                    player.getComponent('minecraft:inventory').container.addItem(
                        new ItemStack('chunkloader:chunk_loader', 1)
                    );
                } catch (error) {
                    console.warn('[Chunk Loader] Error refunding block:', error);
                }
            }, 1);
            return;
        }

        // Set block state to active
        try {
            block.setPermutation(block.permutation.withState('chunkloader:active', true));
        } catch (error) {
            console.warn('[Chunk Loader] Error setting block state:', error);
        }

        // Spawn chunk loader entity at block location
        try {
            const entityLoc = {
                x: location.x + 0.5,
                y: location.y + 0.5,
                z: location.z + 0.5
            };

            const entity = block.dimension.spawnEntity('chunkloader:chunk_loader', entityLoc);

            if (entity) {
                const loaderId = manager.registerChunkLoader(location, dimension, player.name);
                const config = manager.getConfig();
                const radius = Math.max(0, Math.min(6, config.defaultRadius)); // Clamp between 2-6
                entity.triggerEvent(`chunkloader:activate_r${radius}`);
                entity.nameTag = `§5§lChunk Loader\n§a[ACTIVE]\n§7Owner: ${player.name}`;
                entity.addTag('chunkloader:active');
                entity.addTag(`loader_${loaderId}`);

                // Spawn particles and play sound
                try {
                    const particleLoc = {
                        x: location.x + 0.5,
                        y: location.y + 0.5,
                        z: location.z + 0.5
                    };

                    // Multiple particle effects for a nice visual
                    block.dimension.spawnParticle('minecraft:totem_particle', particleLoc);

                    // Play activation sound at the block location
                    player.runCommand(`playsound random.orb @a[r=16] ${particleLoc.x} ${particleLoc.y} ${particleLoc.z} 1.0 1.0`);
                } catch (particleError) {
                    console.warn('[Chunk Loader] Error spawning particles/sound:', particleError);
                }

                player.sendMessage('§a[Chunk Loader] §fChunk loader activated!');
                player.sendMessage(`§7Keeping chunks loaded in a ${radius} chunk radius`);
                player.sendMessage(`§7Loaders: §e${playerCount + 1}§7/§e${config.maxLoadersPerPlayer}`);
            }
        } catch (error) {
            console.warn('[Chunk Loader] Error spawning entity:', error);
        }
    }
});

// Prevent non-owners from breaking chunk loaders
world.beforeEvents.playerBreakBlock.subscribe((event) => {
    const { block, player } = event;

    if (block.typeId === 'chunkloader:chunk_loader') {
        const loaderId = manager.generateLoaderId(block.location);
        const loaderData = manager.getChunkLoader(loaderId);

        if (loaderData) {
            const isOwner = loaderData.placedBy === player.name;
            const isAdmin = player.hasTag('chunk_admin');

            if (!isOwner && !isAdmin) {
                event.cancel = true;
                player.sendMessage('§c[Chunk Loader] §fYou do not own this chunk loader!');
                player.sendMessage(`§7Owner: §e${loaderData.placedBy}`);
            }
        }
    }
});

// Handle block destruction - clean up chunk loader data
world.afterEvents.playerBreakBlock.subscribe((event) => {
    const { block, player, brokenBlockPermutation } = event;

    if (brokenBlockPermutation.type.id === 'chunkloader:chunk_loader') {
        const loaderId = manager.generateLoaderId(block.location);
        const loaderData = manager.getChunkLoader(loaderId);

        if (loaderData) {
            manager.removeChunkLoader(loaderId);
            manager.removeChunkLoaderEntity(block.location, block.dimension.id, loaderId);
            redstoneStates.delete(loaderId);
            const pendingTimeout = pendingRedstoneTimeouts.get(loaderId);
            if (pendingTimeout !== undefined) {
                system.clearRun(pendingTimeout);
                pendingRedstoneTimeouts.delete(loaderId);
            }

            player.sendMessage('§c[Chunk Loader] §fChunk loader deactivated!');

            const remaining = manager.getPlayerChunkLoaderCount(player.name);
            const config = manager.getConfig();
            player.sendMessage(`§7Remaining loaders: §e${remaining}§7/§e${config.maxLoadersPerPlayer}`);
        }
    }
});

// Player interaction - open chunk loader UI by right-clicking
const lastInteraction = new Map();

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    const { block, player } = event;

    if (block.typeId === 'chunkloader:chunk_loader') {
        // Cancel the interaction to prevent block placement
        event.cancel = true;

        // Cooldown check to prevent duplicate events
        const interactionKey = `${player.name}|${block.location.x}|${block.location.y}|${block.location.z}`;
        const now = Date.now();
        const lastTime = lastInteraction.get(interactionKey) || 0;

        if (now - lastTime < 500) {
            return;
        }
        lastInteraction.set(interactionKey, now);

        system.run(() => {
            const loaderId = manager.generateLoaderId(block.location);
            const loaderData = manager.getChunkLoader(loaderId);

            if (!loaderData) {
                player.sendMessage('§c[Chunk Loader] §fChunk loader data not found.');
                return;
            }

            // Check if player is the owner or admin
            if (loaderData.placedBy !== player.name && !player.hasTag('chunk_admin')) {
                player.sendMessage('§c[Chunk Loader] §fYou do not own this chunk loader!');
                return;
            }

            // Open the UI form instead of directly toggling
            const redstonePowered = isRedstoneOverriding(loaderId);
            openChunkLoaderUI(
                player,
                { id: loaderId, ...loaderData, redstonePowered },
                manager,
                (p, l) => toggleChunkLoaderFromUI(p, l, block)
            );
        });
    }
});

/**
 * Toggle a chunk loader on/off from the interaction UI.
 * Wraps the existing toggle logic with block state and entity updates.
 */
function toggleChunkLoaderFromUI(player, loader, block) {
    try {
        // Re-fetch the block to avoid stale references from beforeEvents
        const dimension = player.dimension;
        const freshBlock = dimension.getBlock(block.location);
        if (!freshBlock || freshBlock.typeId !== 'chunkloader:chunk_loader') {
            player.sendMessage('§c[Chunk Loader] §fChunk loader block not found.');
            return;
        }

        // Use manual state from loader data, not block permutation (which may be affected by redstone)
        const currentManualState = loader.active !== false;
        const newState = !currentManualState;

        // Check if globally disabled and trying to activate
        const config = manager.getConfig();
        if (config.globalDisabled && newState) {
            player.sendMessage('§c[Chunk Loader] Chunk loaders are currently disabled by an administrator!');
            player.sendMessage('§7Cannot activate chunk loaders at this time.');
            return;
        }

        const loaderId = loader.id;

        // Update the manager state
        manager.toggleChunkLoader(loaderId);

        // Calculate effective state (considering redstone override)
        const isPowered = isRedstoneOverriding(loaderId);
        const effectiveActive = newState && !isPowered;

        // Update block state
        try {
            freshBlock.setPermutation(freshBlock.permutation.withState('chunkloader:active', effectiveActive));
        } catch (error) {
            console.warn('[Chunk Loader] Error setting block state:', error);
        }

        // Find and update entity
        try {
            const dimension = player.dimension;
            const entities = dimension.getEntities({
                type: 'chunkloader:chunk_loader',
                location: {
                    x: block.location.x + 0.5,
                    y: block.location.y + 0.5,
                    z: block.location.z + 0.5
                },
                maxDistance: 2
            });

            const entity = entities.find(e => e.hasTag(`loader_${loaderId}`));

            if (entity) {
                const radius = Math.max(0, Math.min(6, config.defaultRadius));
                const eventName = effectiveActive ? `chunkloader:activate_r${radius}` : 'chunkloader:deactivate';
                entity.triggerEvent(eventName);

                const loaderData = manager.getChunkLoader(loaderId);
                const statusText = getLoaderStatusText(newState, isPowered);
                const statusMsg = getLoaderStatusMsg(newState, isPowered);
                const farmLabel = loaderData && loaderData.farmMode && loaderData.farmMode !== 'none'
                    ? `\n§7Farm: ${FARM_TYPES[loaderData.farmMode].displayName}`
                    : '';
                entity.nameTag = `§5§lChunk Loader\n${statusText}\n§7Owner: ${loader.placedBy}${farmLabel}`;

                // Spawn particles and play sound based on effective state
                const particleLoc = {
                    x: block.location.x + 0.5,
                    y: block.location.y + 0.5,
                    z: block.location.z + 0.5
                };

                if (effectiveActive) {
                    dimension.spawnParticle('minecraft:totem_particle', particleLoc);
                    player.runCommand(`playsound random.orb @a[r=16] ${particleLoc.x} ${particleLoc.y} ${particleLoc.z} 1.0 1.0`);
                } else {
                    dimension.spawnParticle('minecraft:villager_angry', particleLoc);
                    player.runCommand(`playsound random.break @a[r=16] ${particleLoc.x} ${particleLoc.y} ${particleLoc.z} 1.0 0.8`);
                }

                player.sendMessage(`§a[Chunk Loader] §fChunk loader ${statusMsg}!`);
                if (newState && isPowered) {
                    player.sendMessage('§7Remove the redstone signal to enable chunk loading.');
                }
            } else {
                player.sendMessage('§c[Chunk Loader] §fEntity not found. The chunk loader may need to be reloaded.');
            }
        } catch (error) {
            console.warn('[Chunk Loader] Error toggling entity:', error);
            player.sendMessage('§c[Chunk Loader] §fError toggling chunk loader.');
        }
    } catch (error) {
        player.sendMessage('§c[Chunk Loader] §fError toggling chunk loader.');
        console.warn('[Chunk Loader] Error toggling from UI:', error);
    }
}

// Register custom component for redstone detection and /chunkloaders command
system.beforeEvents.startup.subscribe(({ customCommandRegistry, blockComponentRegistry }) => {
    // Redstone consumer handler - fires when block receives/loses redstone power
    blockComponentRegistry.registerCustomComponent('chunkloader:redstone_handler', {
        onRedstoneUpdate({ block, powerLevel }) {
            handleRedstoneUpdate(block, powerLevel);
        }
    });

    customCommandRegistry.registerCommand(
        {
            name: "mygen:chunkloaders",
            description: "Admin: Manage all chunk loaders",
            permissionLevel: CommandPermissionLevel.GameDirectors,
            cheatsRequired: false,
            mandatoryParameters: []
        },
        (origin) => {
            if (!origin.sourceEntity) {
                return;
            }

            system.run(() => {
                try {
                    const player = origin.sourceEntity;
                    openAdminChunkLoaderUI(player);
                } catch (error) {
                    console.warn('[Chunk Loader] Error opening UI:', error);
                }
            });
        }
    );
});

// Admin UI - shows ALL chunk loaders in the world
function openAdminChunkLoaderUI(player) {
    // Grant admin tag since they have GameDirectors permission to open this
    if (!player.hasTag('chunk_admin')) {
        player.addTag('chunk_admin');
    }

    const loaders = manager.getAllChunkLoaders();
    const config = manager.getConfig();

    const form = new ActionFormData()
        .title('§c§lAdmin: Chunk Loader Management')
        .body(
            `§fTotal Active Loaders: §e${loaders.length}\n` +
            `§fMax Per Player: §e${config.maxLoadersPerPlayer}\n` +
            `§fDefault Radius: §e${config.defaultRadius} chunks\n` +
            `§fGlobal Status: ${config.globalDisabled ? '§c[DISABLED]' : '§a[ENABLED]'}\n\n` +
            `§7Select an option:`
        );

    form.button('§6⚙ Settings\n§8Configure limits & radius');

    // Global enable/disable button
    if (config.globalDisabled) {
        form.button('§a✓ Enable All Chunk Loaders\n§8Allow players to use loaders');
    } else {
        form.button('§c✕ Disable All Chunk Loaders\n§8Prevent all chunk loading');
    }

    if (loaders.length === 0) {
        form.button('§7No Chunk Loaders\n§8None placed in world');
    } else {
        loaders.forEach((loader) => {
            const coords = `${loader.location.x}, ${loader.location.y}, ${loader.location.z}`;
            const dimension = loader.dimension.replace('minecraft:', '');
            const statusIcon = loader.active !== false ? '§a●' : '§c●';

            form.button(`${statusIcon} §f${coords}\n§8${dimension} §7| §8${loader.placedBy}`);
        });
    }

    form.show(player).then(response => {
        if (response.canceled) return;

        if (response.selection === 0) {
            // Settings
            openAdminSettingsUI(player);
        } else if (response.selection === 1) {
            // Toggle global enable/disable
            toggleGlobalDisable(player);
        } else if (loaders.length > 0) {
            // Loader selected (offset by 2 due to settings and global toggle buttons)
            const selectedLoader = loaders[response.selection - 2];
            openAdminLoaderDetailsUI(player, selectedLoader);
        }
    });
}

function toggleGlobalDisable(player) {
    const config = manager.getConfig();
    const newState = !config.globalDisabled;

    manager.updateConfig('globalDisabled', newState);

    if (newState) {
        // When disabling, deactivate all currently loaded chunk loaders
        const loaders = manager.getAllChunkLoaders();
        let deactivatedCount = 0;
        loaders.forEach(loader => {
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

                // Update block state
                const block = dimension.getBlock(loader.location);
                if (block && block.typeId === 'chunkloader:chunk_loader') {
                    block.setPermutation(block.permutation.withState('chunkloader:active', false));
                }

                // Update the stored data directly in the Map
                const storedLoader = manager.getChunkLoader(loader.id);
                if (storedLoader) {
                    storedLoader.active = false;
                }

                // Update entity
                const entity = entities.find(e => e.hasTag(`loader_${loader.id}`));
                if (entity) {
                    entity.triggerEvent('chunkloader:deactivate');
                    const farmLabel = loader.farmMode && loader.farmMode !== 'none'
                        ? `\n§7Farm: ${FARM_TYPES[loader.farmMode].displayName}`
                        : '';
                    entity.nameTag = `§5§lChunk Loader\n§c[INACTIVE]\n§7Owner: ${loader.placedBy}${farmLabel}`;
                    deactivatedCount++;
                }
            } catch (error) {
                console.warn('[Chunk Loader] Error updating entity:', error);
            }
        });

        // Save the updated data
        manager.saveChunkLoaders();
        player.sendMessage(`§c[Chunk Loader] §fAll chunk loaders disabled!`);
        player.sendMessage(`§7Deactivated §e${deactivatedCount}§7 loaded chunk loaders.`);
    } else {
        // When re-enabling, just remove the restriction
        player.sendMessage('§a[Chunk Loader] §fChunk loaders enabled!');
        player.sendMessage('§7Players can now reactivate their loaders.');
    }

    system.runTimeout(() => {
        openAdminChunkLoaderUI(player);
    }, 40);
}

function openAdminSettingsUI(player) {
    const config = manager.getConfig();

    const form = new ModalFormData()
        .title('§c§lAdmin: Settings')
        .slider('Max Loaders Per Player', 1, 20, {
            valueStep: 1,
            defaultValue: config.maxLoadersPerPlayer,
            tooltip: 'The maximum number of chunk loaders each player is allowed to place in the world.'
        })
        .slider('Default Chunk Radius', 0, 6, {
            valueStep: 1,
            defaultValue: config.defaultRadius,
            tooltip: 'Extra chunks kept loaded around the loader, in every direction. 0 = just the loader\'s own chunk, no border.'
        })
        .toggle('Hide Text Behind Walls', {
            defaultValue: FloatingTextVisibility.getEnabled(),
            tooltip: 'Uses raycasting to hide floating text when no player has direct line-of-sight, preventing text from showing through walls.'
        })
        .toggle('Allow Players to Set Farm Mode', {
            defaultValue: config.farmModeEnabled !== false,
            tooltip: 'When enabled, players can assign a farm type to their chunk loader. Disabling this hides the option from the chunk loader menu.'
        })
        .slider('Farm Proximity Distance (blocks)', 32, 256, {
            valueStep: 16,
            defaultValue: config.farmProximityDistance || 128,
            tooltip: 'How far away (in blocks) a player must be from a chunk loader before its farm begins producing items. Lower values start production sooner.'
        })
        .toggle('Redstone Control', {
            defaultValue: config.redstoneEnabled !== false,
            tooltip: 'When enabled, chunk loaders can be deactivated by powering them with a redstone signal. Useful for automated setups.'
        });

    form.show(player).then(response => {
        if (response.canceled) {
            openAdminChunkLoaderUI(player);
            return;
        }

        const [maxLoaders, radius, hideTextBehindWalls, farmModeEnabled, farmProximity, redstoneEnabled] = response.formValues;

        // Update config
        manager.updateConfig('maxLoadersPerPlayer', maxLoaders);
        manager.updateConfig('defaultRadius', radius);
        manager.updateConfig('farmProximityDistance', farmProximity);
        manager.updateConfig('farmModeEnabled', farmModeEnabled);
        manager.updateConfig('redstoneEnabled', redstoneEnabled);
        FloatingTextVisibility.setEnabled(hideTextBehindWalls);

        // When redstone control is disabled, reactivate any loaders that were being overridden
        if (!redstoneEnabled && redstoneStates.size > 0) {
            const loaders = manager.getAllChunkLoaders();
            for (const loader of loaders) {
                const wasPowered = redstoneStates.get(loader.id);
                if (!wasPowered) continue;

                // Cancel any pending deactivation timeout
                const pendingTimeout = pendingRedstoneTimeouts.get(loader.id);
                if (pendingTimeout !== undefined) {
                    system.clearRun(pendingTimeout);
                    pendingRedstoneTimeouts.delete(loader.id);
                }

                // If the loader was manually active, restore it
                if (loader.active !== false) {
                    try {
                        const dimension = world.getDimension(loader.dimension);
                        const block = dimension.getBlock(loader.location);
                        if (block && block.typeId === 'chunkloader:chunk_loader') {
                            block.setPermutation(block.permutation.withState('chunkloader:active', true));
                        }

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
                            const radius = config.defaultRadius ?? 4;
                            entity.triggerEvent(`chunkloader:activate_r${radius}`);
                            const farmLabel = loader.farmMode && loader.farmMode !== 'none'
                                ? `\n§7Farm: ${FARM_TYPES[loader.farmMode].displayName}`
                                : '';
                            entity.nameTag = `§5§lChunk Loader\n§a[ACTIVE]\n§7Owner: ${loader.placedBy}${farmLabel}`;
                        }
                    } catch (error) {
                        console.warn('[Chunk Loader] Error reactivating loader after redstone disable:', error);
                    }
                }
            }
            // Clear all redstone states since the feature is now disabled
            redstoneStates.clear();
            pendingRedstoneTimeouts.clear();
        }

        player.sendMessage('§a[Chunk Loader] §fSettings updated!');
        player.sendMessage(`§7Max Loaders: §e${maxLoaders}`);
        player.sendMessage(`§7Default Radius: §e${radius} chunks`);
        player.sendMessage(`§7Farm Proximity: §e${farmProximity} blocks`);
        player.sendMessage(`§7Hide Text Behind Walls: ${hideTextBehindWalls ? '§aEnabled' : '§cDisabled'}`);
        player.sendMessage(`§7Farm Mode: ${farmModeEnabled ? '§aEnabled' : '§cDisabled'}`);
        player.sendMessage(`§7Redstone Control: ${redstoneEnabled ? '§aEnabled' : '§cDisabled'}`);

        system.runTimeout(() => {
            openAdminChunkLoaderUI(player);
        }, 40);
    });
}

function openAdminLoaderDetailsUI(player, loader) {
    const isActive = loader.active !== false;
    const isPowered = isRedstoneOverriding(loader.id);

    const timePlaced = new Date(loader.placedAt).toLocaleString();
    const coords = `${loader.location.x}, ${loader.location.y}, ${loader.location.z}`;
    const dimension = loader.dimension.replace('minecraft:', '');
    const statusText = getLoaderStatusText(isActive, isPowered);
    const effectiveActive = isActive && !isPowered;
    const statusInfo = effectiveActive ? '§aChunks are being loaded' : (isActive && isPowered ? '§6Paused by redstone signal' : '§cChunks are not being loaded');
    const farmMode = loader.farmMode || 'none';
    const farmDef = FARM_TYPES[farmMode];
    const farmInfo = farmMode !== 'none' && farmDef
        ? farmDef.displayName
        : '§7None';

    const config = manager.getConfig();
    const radius = config.defaultRadius ?? 4;

    const form = new ActionFormData()
        .title(`§c§lAdmin: Chunk Loader Details ${statusText}`)
        .body(
            `§fLocation: §e${coords}\n` +
            `§fDimension: §e${dimension}\n` +
            `§fOwner: §e${loader.placedBy}\n` +
            `§fPlaced: §7${timePlaced}\n` +
            `§fRadius: §e${radius} chunks\n` +
            `§fFarm Mode: ${farmInfo}\n` +
            `§fStatus: ${statusInfo}\n\n` +
            '§7Select an action:'
        );

    const toggleText = isActive ? '§6Deactivate Chunk Loader' : '§aActivate Chunk Loader';
    form.button(toggleText);
    form.button('§eTeleport to Location');
    form.button('§c✕ Delete Loader Data\n§8Remove orphaned loader entry');
    form.button('§8Back to List');

    form.show(player).then(response => {
        if (response.canceled) return;

        switch (response.selection) {
            case 0: // Toggle
                toggleChunkLoader(player, loader, true);
                break;
            case 1: // Teleport
                teleportToLoader(player, loader);
                break;
            case 2: // Delete loader data
                confirmDeleteLoaderData(player, loader);
                break;
            case 3: // Back
                openAdminChunkLoaderUI(player);
                break;
        }
    });
}

function confirmDeleteLoaderData(player, loader) {
    const coords = `${loader.location.x}, ${loader.location.y}, ${loader.location.z}`;
    const dimension = loader.dimension.replace('minecraft:', '');

    const form = new ActionFormData()
        .title('§c§lConfirm Delete')
        .body(
            `§fAre you sure you want to delete this chunk loader's data?\n\n` +
            `§fLocation: §e${coords}\n` +
            `§fDimension: §e${dimension}\n` +
            `§fOwner: §e${loader.placedBy}\n\n` +
            `§cThis will remove the loader entry from the database.\n` +
            `§7Use this when the physical block has been lost\n` +
            `§7(e.g. chunk corruption, addon was temporarily removed).\n` +
            `§7Any associated entity will also be removed if found.`
        );

    form.button('§c✕ Delete Loader Data');
    form.button('§8Cancel');

    form.show(player).then(response => {
        if (response.canceled || response.selection === 1) {
            system.runTimeout(() => {
                openAdminLoaderDetailsUI(player, loader);
            }, 5);
            return;
        }

        // Remove the entity if it still exists
        manager.removeChunkLoaderEntity(loader.location, loader.dimension, loader.id);

        // Remove the data entry
        manager.removeChunkLoader(loader.id);

        // Clean up redstone state
        redstoneStates.delete(loader.id);
        const pendingTimeout = pendingRedstoneTimeouts.get(loader.id);
        if (pendingTimeout !== undefined) {
            system.clearRun(pendingTimeout);
            pendingRedstoneTimeouts.delete(loader.id);
        }

        player.sendMessage(`§a[Chunk Loader] §fLoader data deleted for §e${coords} §f(${dimension}).`);
        player.sendMessage(`§7Owner §e${loader.placedBy}§7's loader count has been freed up.`);

        system.runTimeout(() => {
            openAdminChunkLoaderUI(player);
        }, 40);
    });
}

function toggleChunkLoader(player, loader, isAdmin = false) {
    try {
        // Check if globally disabled (only affects non-admins)
        const config = manager.getConfig();
        if (!isAdmin && config.globalDisabled && loader.active === false) {
            player.sendMessage('§c[Chunk Loader] Chunk loaders are currently disabled by an administrator!');
            player.sendMessage('§7Cannot activate chunk loaders at this time.');
            return;
        }

        const dimension = world.getDimension(loader.dimension);
        const entities = dimension.getEntities({
            type: 'chunkloader:chunk_loader',
            location: loader.location,
            maxDistance: 2
        });

        const entity = entities.find(e => e.hasTag(`loader_${loader.id}`));

        if (entity) {
            const newState = manager.toggleChunkLoader(loader.id);

            if (newState !== null) {
                // Calculate effective state (considering redstone override)
                const isPowered = isRedstoneOverriding(loader.id);
                const effectiveActive = newState && !isPowered;

                // Update block state
                try {
                    const block = dimension.getBlock(loader.location);
                    if (block && block.typeId === 'chunkloader:chunk_loader') {
                        block.setPermutation(block.permutation.withState('chunkloader:active', effectiveActive));
                    }
                } catch (error) {
                    console.warn('[Chunk Loader] Error setting block state:', error);
                }

                // Update entity state
                const config = manager.getConfig();
                const radius = Math.max(0, Math.min(6, config.defaultRadius));
                const event = effectiveActive ? `chunkloader:activate_r${radius}` : 'chunkloader:deactivate';
                entity.triggerEvent(event);

                const statusText = getLoaderStatusText(newState, isPowered);
                const statusMsg = getLoaderStatusMsg(newState, isPowered);
                const loaderData = manager.getChunkLoader(loader.id);
                const farmLabel = loaderData && loaderData.farmMode && loaderData.farmMode !== 'none'
                    ? `\n§7Farm: ${FARM_TYPES[loaderData.farmMode].displayName}`
                    : '';
                entity.nameTag = `§5§lChunk Loader\n${statusText}\n§7Owner: ${loader.placedBy}${farmLabel}`;

                // Spawn particles and play sound based on state
                try {
                    const particleLoc = {
                        x: loader.location.x + 0.5,
                        y: loader.location.y + 0.5,
                        z: loader.location.z + 0.5
                    };

                    if (effectiveActive) {
                        // Activating - totem particle and activation sound
                        dimension.spawnParticle('minecraft:totem_particle', particleLoc);
                        player.runCommand(`playsound random.orb @a[r=16] ${particleLoc.x} ${particleLoc.y} ${particleLoc.z} 1.0 1.0`);
                    } else {
                        // Deactivating - different particle and sound
                        dimension.spawnParticle('minecraft:villager_angry', particleLoc);
                        player.runCommand(`playsound random.break @a[r=16] ${particleLoc.x} ${particleLoc.y} ${particleLoc.z} 1.0 0.8`);
                    }
                } catch (particleError) {
                    console.warn('[Chunk Loader] Error spawning toggle particles/sound:', particleError);
                }

                player.sendMessage(`§a[Chunk Loader] §fChunk loader ${statusMsg}!`);
                if (newState && isPowered) {
                    player.sendMessage('§7Remove the redstone signal to enable chunk loading.');
                }

                // Refresh the UI only for admin
                if (isAdmin) {
                    system.runTimeout(() => {
                        const updatedData = manager.getChunkLoader(loader.id);
                        if (updatedData) {
                            openAdminLoaderDetailsUI(player, { id: loader.id, ...updatedData });
                        }
                    }, 5);
                }
            } else {
                player.sendMessage('§c[Chunk Loader] Error toggling chunk loader.');
            }
        } else {
            // Entity not found - likely because it's inactive and out of simulation distance
            const isActive = loader.active !== false;

            if (!isActive) {
                // Trying to activate an inactive, unloaded chunk loader
                const coords = `${loader.location.x}, ${loader.location.y}, ${loader.location.z}`;
                player.sendMessage('§c[Chunk Loader] §fChunk loader is out of range!');
                player.sendMessage('§7The chunk loader is inactive and not loaded.');
                player.sendMessage(`§7Travel to §e${coords} §7to activate it.`);
                player.sendMessage('§7Or use the §eTeleport §7button to get there quickly.');
            } else {
                // Active chunk loader should always be findable - something is wrong
                player.sendMessage('§c[Chunk Loader] Could not find chunk loader entity.');
                player.sendMessage('§7It may have been removed or is in an unloaded dimension.');
            }
        }
    } catch (error) {
        player.sendMessage('§c[Chunk Loader] Error toggling chunk loader.');
        console.warn('[Chunk Loader] Error toggling:', error);
    }
}

function teleportToLoader(player, loader) {
    try {
        const dimension = world.getDimension(loader.dimension);
        const teleportLoc = {
            x: loader.location.x + 0.5,
            y: loader.location.y + 1,
            z: loader.location.z + 0.5
        };

        player.teleport(teleportLoc, { dimension: dimension });
        player.sendMessage('§a[Chunk Loader] §fTeleported to chunk loader!');
    } catch (error) {
        player.sendMessage('§c[Chunk Loader] Error teleporting. The dimension may not be loaded.');
        console.warn('[Chunk Loader] Error teleporting:', error);
    }
}

console.log('§7[§5Chunk Loader §fThe Ultimate Chunk Loading Solution§7] - [§5v1.3.0§7] - [§5Rob \'§emyGen§5\' Hall§7] - [§ewww.myGen.co.uk§7] - [§5Loaded successfully!§7]');
