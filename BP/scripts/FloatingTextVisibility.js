/**
 * Floating Text Visibility System
 *
 * Hides floating text nameTags when no player has clear line-of-sight,
 * preventing text from showing through walls.
 * Uses raycast (getBlockFromRay) to check for obstructions between
 * each player's eye position and each floating text entity.
 *
 * If a system updates an entity's nameTag while it's hidden (e.g. status toggle),
 * hideEntity detects the non-empty nameTag on the next cycle and
 * re-stores the updated text, so showEntity always restores the latest version.
 *
 * Note on transparent blocks: getBlockFromRay skips passable blocks (fences, signs,
 * flowers, etc.) by default, but solid transparent blocks like glass DO block the ray.
 * This means text behind glass walls will be hidden. This is intentional — glass
 * enclosures still occlude line-of-sight for text readability purposes.
 */

import { world, system } from '@minecraft/server';

const MAX_VISIBILITY_DISTANCE = 16;
const CHECK_INTERVAL_TICKS = 10; // 0.5 seconds
const PLAYER_EYE_HEIGHT = 1.62;
const PLAYER_EYE_HEIGHT_SNEAKING = 1.27;
const ALL_DIMENSIONS = ['minecraft:overworld', 'minecraft:nether', 'minecraft:the_end'];
const SETTING_KEY = 'chunkloader:setting_raycast';

export class FloatingTextVisibility {
    constructor() {
        /** @type {boolean} Whether entities may currently be hidden and need restoring */
        this._needsRestore = false;
        this.startVisibilityLoop();
    }

    startVisibilityLoop() {
        system.runInterval(() => {
            try {
                if (!FloatingTextVisibility.getEnabled()) {
                    if (this._needsRestore) {
                        this.restoreAllHiddenText();
                        this._needsRestore = false;
                    }
                    return;
                }
                this._needsRestore = true;
                this.updateVisibility();
            } catch (error) {
                console.warn(`[Chunk Loader] FloatingTextVisibility error: ${error.message}`);
            }
        }, CHECK_INTERVAL_TICKS);
    }

    /**
     * Set the enabled state of the raycast visibility feature
     * @param {boolean} enabled
     */
    static setEnabled(enabled) {
        world.setDynamicProperty(SETTING_KEY, enabled);
    }

    /**
     * Get the current enabled state
     * @returns {boolean}
     */
    static getEnabled() {
        try {
            const state = world.getDynamicProperty(SETTING_KEY);
            return state !== false; // Default to true if undefined
        } catch {
            return true;
        }
    }

    updateVisibility() {
        const players = world.getAllPlayers();
        if (players.length === 0) return;

        const dimensionMap = new Map();
        for (const player of players) {
            dimensionMap.set(player.dimension.id, player.dimension);
        }

        for (const [dimId, dimension] of dimensionMap) {
            let textEntities;
            try {
                textEntities = dimension.getEntities({ families: ['chunkloader'] });
            } catch {
                continue;
            }

            const dimensionPlayers = players.filter(p => p.dimension.id === dimId);

            for (const entity of textEntities) {
                try {
                    this.processEntity(entity, dimensionPlayers, dimension);
                } catch { /* skip invalid entities */ }
            }
        }
    }

    processEntity(entity, players, dimension) {
        const entityPos = entity.location;
        let anyPlayerHasLOS = false;

        for (const player of players) {
            const playerPos = player.location;
            const eyeHeight = player.isSneaking ? PLAYER_EYE_HEIGHT_SNEAKING : PLAYER_EYE_HEIGHT;

            const dx = entityPos.x - playerPos.x;
            const dy = entityPos.y - (playerPos.y + eyeHeight);
            const dz = entityPos.z - playerPos.z;
            const distanceSq = dx * dx + dy * dy + dz * dz;

            if (distanceSq > MAX_VISIBILITY_DISTANCE * MAX_VISIBILITY_DISTANCE) {
                continue;
            }

            const distance = Math.sqrt(distanceSq);
            if (distance < 0.5) {
                anyPlayerHasLOS = true;
                break;
            }

            const direction = {
                x: dx / distance,
                y: dy / distance,
                z: dz / distance
            };

            const playerEye = {
                x: playerPos.x,
                y: playerPos.y + eyeHeight,
                z: playerPos.z
            };

            try {
                const blockHit = dimension.getBlockFromRay(playerEye, direction, {
                    maxDistance: distance,
                    includePassableBlocks: false,
                    includeLiquidBlocks: false
                });

                if (!blockHit) {
                    anyPlayerHasLOS = true;
                    break;
                }
            } catch {
                anyPlayerHasLOS = true;
                break;
            }
        }

        if (anyPlayerHasLOS) {
            this.showEntity(entity);
        } else {
            this.hideEntity(entity);
        }
    }

    hideEntity(entity) {
        const isHidden = entity.getDynamicProperty('chunkloader:textHidden');
        const currentText = entity.nameTag;

        if (isHidden) {
            // If another system updated the nameTag while hidden, re-store the new text
            if (currentText) {
                entity.setDynamicProperty('chunkloader:storedNameTag', currentText);
                entity.nameTag = '';
            }
            return;
        }

        if (!currentText) return;

        entity.setDynamicProperty('chunkloader:storedNameTag', currentText);
        entity.setDynamicProperty('chunkloader:textHidden', true);
        entity.nameTag = '';
    }

    showEntity(entity) {
        const isHidden = entity.getDynamicProperty('chunkloader:textHidden');
        if (!isHidden) return;

        const storedText = entity.getDynamicProperty('chunkloader:storedNameTag');
        if (storedText) {
            entity.nameTag = storedText;
        }

        entity.setDynamicProperty('chunkloader:textHidden', undefined);
        entity.setDynamicProperty('chunkloader:storedNameTag', undefined);
    }

    restoreAllHiddenText() {
        for (const dimId of ALL_DIMENSIONS) {
            try {
                const dimension = world.getDimension(dimId);
                const textEntities = dimension.getEntities({ families: ['chunkloader'] });

                for (const entity of textEntities) {
                    try {
                        this.showEntity(entity);
                    } catch { /* skip invalid entities */ }
                }
            } catch { /* dimension may not be loaded */ }
        }
    }
}
