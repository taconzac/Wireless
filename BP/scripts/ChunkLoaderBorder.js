/**
 * Particle rendering system for chunk visualization.
 * @module ChunkLoaderBorder
 * @author Rob 'myGen' Hall
 * @license CC BY-NC-SA 4.0 - originally ParticleRenderer.js from
 * BedrockChunkVisualizer v1.1.1 (https://mygen.co.uk). See NOTICE.
 *
 * [Modified for Warehouse Utilities] The original rendered a fixed 3x3
 * grid (the player's current chunk plus its 8 immediate neighbors),
 * centered on wherever the player happened to be standing, triggered by
 * holding a compass renamed to "chunky"/"stillchunky". This version
 * renders an arbitrary (radius x2+1) grid centered on a given chunk
 * loader block instead of the player, with the radius passed in by the
 * caller rather than fixed at 1 - everything else (the edge-particle
 * approach, the inner/outer distinction, direction indicators) is
 * unchanged from the original.
 */

const CHUNK_SIZE = 16;
const PARTICLE_HEIGHT = 128; // 128 avoids culling in Vibrant Visuals

/**
 * Manages particle visualization for chunk borders.
 */
export class ChunkLoaderBorder {
    /**
     * Render the border of every chunk a loader at (centerChunkX,
     * centerChunkZ) with the given radius keeps loaded: its own chunk
     * (yellow/inner) and every chunk out to `radius` chunks away in each
     * direction (red/outer). radius=0 renders just the center chunk.
     * @param {Player} player - Player to render for (particles are
     * player-scoped, same as the original addon).
     * @param {number} centerChunkX - Center chunk X coordinate.
     * @param {number} centerChunkZ - Center chunk Z coordinate.
     * @param {number} radius - Chunks out from center, in every direction.
     * @param {boolean} useAnimation - Whether to use animated or static particles.
     * @param {boolean} showDirectionIndicators - Whether to show N/E/S/W indicators.
     */
    renderChunkBorders(player, centerChunkX, centerChunkZ, radius, useAnimation = true, showDirectionIndicators = true) {
        // Render current (center) chunk - all 4 edges, inner particles.
        this.renderSingleChunk(player, centerChunkX, centerChunkZ, true, { north: true, south: true, east: true, west: true }, useAnimation);

        if (showDirectionIndicators) {
            const eyeHeight = player.location.y + 5;
            this.renderDirectionIndicators(player, centerChunkX, centerChunkZ, eyeHeight);
        }

        if (radius <= 0) return;

        // Render every chunk out to `radius` chunks away (outer/red
        // particles), skipping the center chunk already rendered above.
        // Only render edges that don't touch another rendered chunk, so
        // shared internal edges between two loaded chunks aren't drawn
        // twice.
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (dx === 0 && dz === 0) continue;

                const chunkX = centerChunkX + dx;
                const chunkZ = centerChunkZ + dz;

                const edges = {
                    north: dz !== radius,
                    south: dz !== -radius,
                    east: dx !== -radius,
                    west: dx !== radius,
                };

                this.renderSingleChunk(player, chunkX, chunkZ, false, edges, useAnimation);
            }
        }
    }

    /**
     * Render edges for a single chunk
     * @param {Player} player - Player to render for
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {boolean} isCurrentChunk - True for current chunk (yellow), false for surrounding (red)
     * @param {Object} edges - Which edges to render: {north, south, east, west}
     * @param {boolean} useAnimation - Whether to use animated or static particles
     */
    renderSingleChunk(player, chunkX, chunkZ, isCurrentChunk, edges, useAnimation = true) {
        const chunkMinX = chunkX * CHUNK_SIZE;
        const chunkMaxX = chunkMinX + CHUNK_SIZE;
        const chunkMinZ = chunkZ * CHUNK_SIZE;
        const chunkMaxZ = chunkMinZ + CHUNK_SIZE;
        const chunkCenterX = chunkMinX + (CHUNK_SIZE / 2);
        const chunkCenterZ = chunkMinZ + (CHUNK_SIZE / 2);

        const suffix = useAnimation ? '' : '_static';

        const particleNS = isCurrentChunk ? `chunkvisualizer:inner${suffix}` : `chunkvisualizer:outer${suffix}`;
        const particleEW = isCurrentChunk ? `chunkvisualizer:inner_ew${suffix}` : `chunkvisualizer:outer_ew${suffix}`;

        if (edges.north) {
            this.spawnEdgeParticle(player, chunkCenterX, chunkMinZ, particleEW);
        }
        if (edges.south) {
            this.spawnEdgeParticle(player, chunkCenterX, chunkMaxZ, particleEW);
        }
        if (edges.west) {
            this.spawnEdgeParticle(player, chunkMinX, chunkCenterZ, particleNS);
        }
        if (edges.east) {
            this.spawnEdgeParticle(player, chunkMaxX, chunkCenterZ, particleNS);
        }
    }

    /**
     * Spawn a particle at a specific edge position
     * @param {Player} player - Player to spawn for
     * @param {number} x - X coordinate
     * @param {number} z - Z coordinate
     * @param {string} particleId - Particle identifier
     */
    spawnEdgeParticle(player, x, z, particleId) {
        const spawnPos = { x, y: PARTICLE_HEIGHT, z };
        try {
            player.spawnParticle(particleId, spawnPos);
        } catch (error) {
            // Chunk not loaded or particle not found, silently continue
        }
    }

    /**
     * Render direction indicators (N/E/S/W) for a chunk at specified height
     * @param {Player} player - Player to render for
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {number} height - Y coordinate to spawn indicators at
     */
    renderDirectionIndicators(player, chunkX, chunkZ, height) {
        const chunkMinX = chunkX * CHUNK_SIZE;
        const chunkMaxX = chunkMinX + CHUNK_SIZE;
        const chunkMinZ = chunkZ * CHUNK_SIZE;
        const chunkMaxZ = chunkMinZ + CHUNK_SIZE;
        const chunkCenterX = chunkMinX + (CHUNK_SIZE / 2);
        const chunkCenterZ = chunkMinZ + (CHUNK_SIZE / 2);

        const inset = 0.1;
        this.spawnDirectionParticle(player, chunkCenterX, height, chunkMinZ + inset, 'chunkvisualizer:north');
        this.spawnDirectionParticle(player, chunkCenterX, height, chunkMaxZ - inset, 'chunkvisualizer:south');
        this.spawnDirectionParticle(player, chunkMinX + inset, height, chunkCenterZ, 'chunkvisualizer:west');
        this.spawnDirectionParticle(player, chunkMaxX - inset, height, chunkCenterZ, 'chunkvisualizer:east');
    }

    /**
     * Spawn a direction indicator particle at a specific position
     * @param {Player} player - Player to spawn for
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} z - Z coordinate
     * @param {string} particleId - Particle identifier
     */
    spawnDirectionParticle(player, x, y, z, particleId) {
        try {
            player.spawnParticle(particleId, { x, y, z });
        } catch (error) {
            // Chunk not loaded or particle not found, silently continue
        }
    }
}
