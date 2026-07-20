/**
 * Farm Emulator
 *
 * Periodically checks all active chunk loaders with a farm mode set.
 * When no player is within proximity, items are produced to emulate
 * the farm operating — delivered directly into a hopper inventory
 * or spawned onto water for collection.
 */

import { world, system, ItemStack, EquipmentSlot } from '@minecraft/server';
import { FARM_TYPES, rollDrop, getDropsPerCycle } from './FarmDefinitions.js';

const EMULATION_CYCLE_TICKS = 400;    // 20 seconds
const EMULATION_CYCLE_SECONDS = 20;
const DEFAULT_PROXIMITY_BLOCKS = 128; // ~8 chunks

export class FarmEmulator {
    constructor(chunkLoaderManager, redstoneStates) {
        this.manager = chunkLoaderManager;
        this.redstoneStates = redstoneStates;
        /** @type {Map<string, number>} Fractional roll accumulators per loader ID */
        this.fractionalAccumulators = new Map();
        this.startEmulationLoop();
    }

    startEmulationLoop() {
        system.runInterval(() => {
            try {
                this.runEmulationCycle();
            } catch (error) {
                console.warn('[Farm Emulator] Error in emulation cycle:', error);
            }
        }, EMULATION_CYCLE_TICKS);
    }

    runEmulationCycle() {
        const allLoaders = this.manager.getAllChunkLoaders();
        const players = world.getAllPlayers();

        for (const loader of allLoaders) {
            if (loader.active === false) continue;
            if (!loader.farmMode || loader.farmMode === 'none') continue;

            // Skip if redstone is overriding this loader
            const config = this.manager.getConfig();
            if (config.redstoneEnabled !== false && this.redstoneStates.get(loader.id)) continue;

            const farmDef = FARM_TYPES[loader.farmMode];
            if (!farmDef || farmDef.itemsPerHour === 0) continue;

            if (this.isPlayerNearby(loader, players)) continue;

            const lootingLevel = this.getOwnerLootingLevel(loader, players);
            this.emitDrops(loader, farmDef, lootingLevel);
        }

        this.cleanupAccumulators(allLoaders);
    }

    /**
     * Check if any player is within proximity distance of the loader.
     * Uses squared distance to avoid sqrt per check.
     */
    isPlayerNearby(loader, players) {
        const config = this.manager.getConfig();
        const proximityDistance = config.farmProximityDistance || DEFAULT_PROXIMITY_BLOCKS;
        const proximityDistanceSq = proximityDistance * proximityDistance;

        for (const player of players) {
            if (player.dimension.id !== loader.dimension) continue;

            const dx = player.location.x - (loader.location.x + 0.5);
            const dy = player.location.y - (loader.location.y + 0.5);
            const dz = player.location.z - (loader.location.z + 0.5);
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq <= proximityDistanceSq) {
                return true;
            }
        }
        return false;
    }

    /**
     * Get the looting enchantment level from the chunk loader owner's held sword.
     * Returns 0 if the owner is offline or not holding a looting weapon.
     */
    getOwnerLootingLevel(loader, players) {
        const owner = players.find(p => p.name === loader.placedBy);
        if (!owner) return 0;

        try {
            const equippable = owner.getComponent('minecraft:equippable');
            if (!equippable) return 0;

            const mainhand = equippable.getEquipment(EquipmentSlot.Mainhand);
            if (!mainhand) return 0;

            const enchantable = mainhand.getComponent('minecraft:enchantable');
            if (!enchantable) return 0;

            const looting = enchantable.getEnchantment('looting');
            return looting ? looting.level : 0;
        } catch {
            return 0;
        }
    }

    /**
     * Produce and deliver items for a single loader.
     * Uses a fractional accumulator to handle sub-integer rolls per cycle.
     */
    emitDrops(loader, farmDef, lootingLevel = 0) {
        const loaderId = loader.id;
        const rawRolls = getDropsPerCycle(farmDef.id, EMULATION_CYCLE_SECONDS);

        // Accumulate fractional rolls
        const accumulated = (this.fractionalAccumulators.get(loaderId) || 0) + rawRolls;
        const wholeRolls = Math.floor(accumulated);
        this.fractionalAccumulators.set(loaderId, accumulated - wholeRolls);

        if (wholeRolls <= 0) return;

        try {
            const dimension = world.getDimension(loader.dimension);

            // Batch drops by item type
            const dropBatch = new Map();
            for (let i = 0; i < wholeRolls; i++) {
                const drop = rollDrop(farmDef.id);
                if (!drop) continue;

                if (lootingLevel > 0) {
                    drop.count += Math.floor(Math.random() * (lootingLevel + 1));
                }

                const existing = dropBatch.get(drop.itemId) || 0;
                dropBatch.set(drop.itemId, existing + drop.count);
            }

            if (dropBatch.size === 0) return;

            // Determine delivery method: hopper inventory or water spawn
            this.deliverItems(dimension, loader, dropBatch);
        } catch (error) {
            console.warn(`[Farm Emulator] Error spawning items for loader ${loaderId}:`, error);
        }
    }

    /**
     * Deliver batched items either into a hopper inventory or onto water.
     */
    deliverItems(dimension, loader, dropBatch) {
        // Check for hopper directly below
        const hopperLoc = {
            x: loader.location.x,
            y: loader.location.y - 1,
            z: loader.location.z
        };

        try {
            const hopperBlock = dimension.getBlock(hopperLoc);
            if (hopperBlock && hopperBlock.typeId === 'minecraft:hopper') {
                this.deliverToHopper(hopperBlock, dropBatch);
                return;
            }
        } catch { /* block may not be loaded */ }

        // Check for water within 2 blocks below and spawn items there
        for (let dy = -1; dy >= -2; dy--) {
            const checkLoc = {
                x: loader.location.x,
                y: loader.location.y + dy,
                z: loader.location.z
            };

            try {
                const block = dimension.getBlock(checkLoc);
                if (block && (block.typeId === 'minecraft:water' || block.typeId === 'minecraft:flowing_water')) {
                    const spawnLoc = {
                        x: loader.location.x + 0.5,
                        y: loader.location.y + dy + 0.5,
                        z: loader.location.z + 0.5
                    };
                    this.spawnItemEntities(dimension, spawnLoc, dropBatch);
                    return;
                }
            } catch { /* block may not be loaded */ }
        }

        // Neither hopper nor water found — skip silently
        // (setup validation should have prevented this state)
    }

    /**
     * Insert items directly into a hopper's inventory container.
     */
    deliverToHopper(hopperBlock, dropBatch) {
        try {
            const inventory = hopperBlock.getComponent('minecraft:inventory');
            if (!inventory) return;

            const container = inventory.container;
            if (!container) return;

            for (const [itemId, totalCount] of dropBatch) {
                let remaining = totalCount;
                while (remaining > 0) {
                    const count = Math.min(remaining, 64);
                    const itemStack = new ItemStack(itemId, count);
                    container.addItem(itemStack);
                    remaining -= count;
                }
            }
        } catch (error) {
            console.warn('[Farm Emulator] Error inserting into hopper:', error);
        }
    }

    /**
     * Spawn item entities at a location (for water-based collection).
     */
    spawnItemEntities(dimension, location, dropBatch) {
        for (const [itemId, totalCount] of dropBatch) {
            let remaining = totalCount;
            while (remaining > 0) {
                const count = Math.min(remaining, 64);
                const itemStack = new ItemStack(itemId, count);
                dimension.spawnItem(itemStack, location);
                remaining -= count;
            }
        }
    }

    /**
     * Remove accumulators for loaders that no longer exist.
     */
    cleanupAccumulators(currentLoaders) {
        const activeIds = new Set(currentLoaders.map(l => l.id));
        for (const [id] of this.fractionalAccumulators) {
            if (!activeIds.has(id)) {
                this.fractionalAccumulators.delete(id);
            }
        }
    }
}
