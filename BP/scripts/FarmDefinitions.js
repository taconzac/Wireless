/**
 * Farm Definitions
 *
 * Defines all supported farm types with their drop tables and production rates.
 * Each farm type specifies weighted drop entries that are randomly selected
 * during production cycles.
 */

export const FARM_TYPES = {
    none: {
        id: 'none',
        displayName: '§8None',
        icon: 'textures/ui/cancel',
        itemsPerHour: 0,
        dropTable: []
    },

    iron: {
        id: 'iron',
        displayName: '§fIron Farm',
        icon: 'textures/items/iron_ingot',
        itemsPerHour: 370,
        dropTable: [
            { itemId: 'minecraft:iron_ingot', weight: 85, minCount: 3, maxCount: 5 },
            { itemId: 'minecraft:poppy',      weight: 15, minCount: 1, maxCount: 2 }
        ]
    },

    gold: {
        id: 'gold',
        displayName: '§6Gold Farm',
        icon: 'textures/items/gold_nugget',
        itemsPerHour: 420,
        dropTable: [
            { itemId: 'minecraft:rotten_flesh', weight: 20, minCount: 0, maxCount: 1 },
            { itemId: 'minecraft:gold_nugget',  weight: 20, minCount: 0, maxCount: 1 },
            { itemId: 'minecraft:gold_ingot',   weight: 1,  minCount: 0, maxCount: 1 }
        ]
    },

    mob: {
        id: 'mob',
        displayName: '§2General Mob Farm',
        icon: 'textures/items/bone',
        itemsPerHour: 320,
        dropTable: [
            { itemId: 'minecraft:gunpowder',    weight: 20, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:bone',          weight: 20, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:arrow',         weight: 15, minCount: 1, maxCount: 3 },
            { itemId: 'minecraft:string',        weight: 15, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:spider_eye',    weight: 10, minCount: 1, maxCount: 1 },
            { itemId: 'minecraft:rotten_flesh',  weight: 20, minCount: 1, maxCount: 2 }
        ]
    },

    creeper: {
        id: 'creeper',
        displayName: '§aCreeper Farm',
        icon: 'textures/items/gunpowder',
        itemsPerHour: 300,
        dropTable: [
            { itemId: 'minecraft:gunpowder', weight: 100, minCount: 1, maxCount: 2 }
        ]
    },

    witch: {
        id: 'witch',
        displayName: '§5Witch Farm',
        icon: 'textures/items/glowstone_dust',
        itemsPerHour: 210,
        dropTable: [
            { itemId: 'minecraft:glowstone_dust', weight: 18, minCount: 1, maxCount: 3 },
            { itemId: 'minecraft:redstone',        weight: 18, minCount: 1, maxCount: 3 },
            { itemId: 'minecraft:sugar',           weight: 14, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:stick',           weight: 14, minCount: 1, maxCount: 3 },
            { itemId: 'minecraft:glass_bottle',    weight: 14, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:gunpowder',       weight: 12, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:spider_eye',      weight: 10, minCount: 1, maxCount: 1 }
        ]
    },

    enderman: {
        id: 'enderman',
        displayName: '§dEnderman Farm',
        icon: 'textures/items/ender_pearl',
        itemsPerHour: 500,
        dropTable: [
            { itemId: 'minecraft:ender_pearl', weight: 100, minCount: 1, maxCount: 1 }
        ]
    },

    blaze: {
        id: 'blaze',
        displayName: '§eBlaze Farm',
        icon: 'textures/items/blaze_rod',
        itemsPerHour: 260,
        dropTable: [
            { itemId: 'minecraft:blaze_rod', weight: 100, minCount: 1, maxCount: 1 }
        ]
    },

    guardian: {
        id: 'guardian',
        displayName: '§bGuardian Farm',
        icon: 'textures/items/prismarine_shard',
        itemsPerHour: 360,
        dropTable: [
            { itemId: 'minecraft:prismarine_shard',    weight: 40, minCount: 1, maxCount: 3 },
            { itemId: 'minecraft:prismarine_crystals', weight: 25, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:cod',                 weight: 35, minCount: 1, maxCount: 1 }
        ]
    },

    drowned: {
        id: 'drowned',
        displayName: '§3Drowned Farm',
        icon: 'textures/items/copper_ingot',
        itemsPerHour: 280,
        dropTable: [
            { itemId: 'minecraft:rotten_flesh',   weight: 66,  minCount: 0, maxCount: 2 },
            { itemId: 'minecraft:copper_ingot',    weight: 11,  minCount: 0, maxCount: 1 },
            { itemId: 'minecraft:nautilus_shell',  weight: 8,   minCount: 1, maxCount: 1 },
            { itemId: 'minecraft:trident',         weight: 1.5, minCount: 1, maxCount: 1 }
        ]
    },

    slime: {
        id: 'slime',
        displayName: '§aSlime Farm',
        icon: 'textures/items/slimeball',
        itemsPerHour: 200,
        dropTable: [
            { itemId: 'minecraft:slime_ball', weight: 100, minCount: 1, maxCount: 3 }
        ]
    },

    fish_ink: {
        id: 'fish_ink',
        displayName: '§9Fish & Ink Farm',
        icon: 'textures/items/dye_powder_black',
        itemsPerHour: 250,
        dropTable: [
            { itemId: 'minecraft:ink_sac',      weight: 25, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:glow_ink_sac', weight: 25, minCount: 1, maxCount: 2 },
            { itemId: 'minecraft:cod',           weight: 25, minCount: 1, maxCount: 1 },
            { itemId: 'minecraft:salmon',        weight: 25, minCount: 1, maxCount: 1 }
        ]
    },

    magma_cube: {
        id: 'magma_cube',
        displayName: '§cMagma Cube Farm',
        icon: 'textures/items/magma_cream',
        itemsPerHour: 350,
        dropTable: [
            { itemId: 'minecraft:magma_cream', weight: 100, minCount: 1, maxCount: 2 }
        ]
    }
};

/** Ordered list of farm type IDs for UI display */
export const FARM_TYPE_LIST = [
    'none', 'iron', 'gold', 'mob', 'creeper', 'witch',
    'enderman', 'blaze', 'guardian', 'drowned', 'slime',
    'fish_ink', 'magma_cube'
];

/**
 * Select a random drop from the farm's drop table using weighted randomness.
 * @param {string} farmTypeId
 * @returns {{ itemId: string, count: number } | null}
 */
export function rollDrop(farmTypeId) {
    const farm = FARM_TYPES[farmTypeId];
    if (!farm || farm.dropTable.length === 0) return null;

    const totalWeight = farm.dropTable.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const entry of farm.dropTable) {
        roll -= entry.weight;
        if (roll <= 0) {
            const count = entry.minCount + Math.floor(Math.random() * (entry.maxCount - entry.minCount + 1));
            return { itemId: entry.itemId, count };
        }
    }

    // Fallback (should not reach here)
    const fallback = farm.dropTable[0];
    return { itemId: fallback.itemId, count: fallback.minCount };
}

/**
 * Calculate the expected number of drop rolls per emulation cycle.
 * Uses the average items per roll to convert items/hour into rolls/cycle.
 * Returns a float — the caller should use a fractional accumulator.
 * @param {string} farmTypeId
 * @param {number} cycleSeconds
 * @returns {number}
 */
export function getDropsPerCycle(farmTypeId, cycleSeconds) {
    const farm = FARM_TYPES[farmTypeId];
    if (!farm || farm.itemsPerHour === 0) return 0;

    const totalWeight = farm.dropTable.reduce((sum, e) => sum + e.weight, 0);
    let avgItemsPerRoll = 0;
    for (const entry of farm.dropTable) {
        const probability = entry.weight / totalWeight;
        const avgCount = (entry.minCount + entry.maxCount) / 2;
        avgItemsPerRoll += probability * avgCount;
    }

    if (avgItemsPerRoll === 0) return 0;

    const itemsPerSecond = farm.itemsPerHour / 3600;
    const itemsPerCycle = itemsPerSecond * cycleSeconds;
    return itemsPerCycle / avgItemsPerRoll;
}
