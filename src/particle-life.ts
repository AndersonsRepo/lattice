/**
 * Lattice — Particle Life Engine
 *
 * N species of particles interact via an attraction/repulsion matrix.
 * Each species pair has a force coefficient: positive = attraction, negative = repulsion.
 * Particles also have a friction coefficient and a force radius.
 *
 * Simple rules → emergent complexity: swarms, hunters, orbits, symbiosis, chains.
 *
 * Inspired by Jeffrey Ventrella's "Clusters" and Hunar Ahmad's "Particle Life."
 */

export interface ParticleLifeRule {
  species: number;           // number of particle species (3-8)
  particlesPerSpecies: number; // particles per species (50-300)
  attractionMatrix: number[][]; // species×species force matrix (-1 to 1)
  forceRadius: number;       // interaction radius (30-120)
  friction: number;          // velocity damping per step (0.1-0.9)
  forceFactor: number;       // global force multiplier (0.5-5)
  steps: number;             // simulation steps (200-1000)
  quantize: number;          // output states (3-8)
}

// Deterministic PRNG (same as automata.ts)
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ParticleLifeGenome {
  type: "particle-life";
  rule: ParticleLifeRule;
  width: number;
  height: number;
  palette: string[];
  seed: number;
  mutations: number;
  lineage: string[];
}

/**
 * Run a Particle Life simulation and return an integer grid.
 *
 * Particles are simulated at pixel resolution on a toroidal field,
 * then density is accumulated into the output grid cells.
 */
export function evolveParticleLife(genome: ParticleLifeGenome): number[][] {
  const rule = genome.rule as ParticleLifeRule;
  const rng = mulberry32(genome.seed);
  const { width, height } = genome;

  // Simulation space (4x output resolution)
  const W = width * 4;
  const H = height * 4;

  const numSpecies = Math.min(rule.species, 8);
  const perSpecies = Math.min(rule.particlesPerSpecies, 300);
  const total = numSpecies * perSpecies;

  // Particle arrays
  const px = new Float64Array(total);
  const py = new Float64Array(total);
  const vx = new Float64Array(total);
  const vy = new Float64Array(total);
  const ps = new Uint8Array(total); // species index

  // Initialize particles in species clusters
  for (let s = 0; s < numSpecies; s++) {
    const cx = rng() * W;
    const cy = rng() * H;
    for (let i = 0; i < perSpecies; i++) {
      const idx = s * perSpecies + i;
      px[idx] = (cx + (rng() - 0.5) * W * 0.4 + W) % W;
      py[idx] = (cy + (rng() - 0.5) * H * 0.4 + H) % H;
      vx[idx] = (rng() - 0.5) * 0.5;
      vy[idx] = (rng() - 0.5) * 0.5;
      ps[idx] = s;
    }
  }

  const radius = rule.forceRadius;
  const radiusSq = radius * radius;
  const friction = rule.friction;
  const factor = rule.forceFactor;
  const matrix = rule.attractionMatrix;

  // Simulation loop
  for (let step = 0; step < rule.steps; step++) {
    // Compute forces
    for (let i = 0; i < total; i++) {
      let fx = 0, fy = 0;
      const si = ps[i];

      for (let j = 0; j < total; j++) {
        if (i === j) continue;

        // Toroidal distance
        let dx = px[j] - px[i];
        let dy = py[j] - py[i];
        if (dx > W / 2) dx -= W;
        if (dx < -W / 2) dx += W;
        if (dy > H / 2) dy -= H;
        if (dy < -H / 2) dy += H;

        const distSq = dx * dx + dy * dy;
        if (distSq > radiusSq || distSq < 1) continue;

        const dist = Math.sqrt(distSq);
        const norm = 1 / dist;

        // Force profile: repel at very close range, then attraction/repulsion curve
        const t = dist / radius;
        let force: number;
        if (t < 0.3) {
          // Universal short-range repulsion (prevents collapse)
          force = (t / 0.3 - 1);
        } else {
          // Species-dependent force from matrix
          const attraction = matrix[si][ps[j]];
          force = attraction * (1 - Math.abs(2 * t - 1.3));
        }

        fx += dx * norm * force * factor;
        fy += dy * norm * force * factor;
      }

      vx[i] = (vx[i] + fx) * friction;
      vy[i] = (vy[i] + fy) * friction;
    }

    // Update positions (toroidal wrap)
    for (let i = 0; i < total; i++) {
      px[i] = ((px[i] + vx[i]) % W + W) % W;
      py[i] = ((py[i] + vy[i]) % H + H) % H;
    }
  }

  // Accumulate density into output grid
  const density = new Float64Array(width * height);
  for (let i = 0; i < total; i++) {
    const gx = Math.floor(px[i] / 4);
    const gy = Math.floor(py[i] / 4);
    const cx = Math.max(0, Math.min(width - 1, gx));
    const cy = Math.max(0, Math.min(height - 1, gy));
    density[cy * width + cx] += 1;
  }

  // Normalize and quantize
  let maxDen = 0;
  for (let i = 0; i < density.length; i++) {
    if (density[i] > maxDen) maxDen = density[i];
  }
  if (maxDen === 0) maxDen = 1;

  const maxState = rule.quantize - 1;
  const grid: number[][] = [];
  for (let gy = 0; gy < height; gy++) {
    const row = new Array(width).fill(0);
    for (let gx = 0; gx < width; gx++) {
      const normalized = density[gy * width + gx] / maxDen;
      row[gx] = Math.round(normalized * maxState);
    }
    grid.push(row);
  }

  return grid;
}

// --- Mutation ---
export function mutateParticleLife(rule: ParticleLifeRule, rng: () => number): ParticleLifeRule {
  const r: ParticleLifeRule = {
    ...rule,
    attractionMatrix: rule.attractionMatrix.map(row => [...row]),
  };
  const param = rng();

  if (param < 0.35) {
    // Perturb 1-3 matrix entries
    const flips = 1 + Math.floor(rng() * 3);
    for (let f = 0; f < flips; f++) {
      const i = Math.floor(rng() * r.species);
      const j = Math.floor(rng() * r.species);
      r.attractionMatrix[i][j] = Math.max(-1, Math.min(1,
        r.attractionMatrix[i][j] + (rng() - 0.5) * 0.5
      ));
    }
  } else if (param < 0.5) {
    r.forceRadius = Math.max(30, Math.min(120, r.forceRadius + (rng() - 0.5) * 20));
  } else if (param < 0.6) {
    r.friction = Math.max(0.1, Math.min(0.9, r.friction + (rng() - 0.5) * 0.15));
  } else if (param < 0.7) {
    r.forceFactor = Math.max(0.5, Math.min(5, r.forceFactor + (rng() - 0.5) * 1));
  } else if (param < 0.8) {
    r.particlesPerSpecies = Math.max(50, Math.min(300,
      r.particlesPerSpecies + Math.floor((rng() - 0.5) * 60)
    ));
  } else if (param < 0.9) {
    r.steps = Math.max(200, Math.min(1000, r.steps + Math.floor((rng() - 0.5) * 200)));
  } else {
    // Add or remove a species
    if (rng() > 0.5 && r.species < 8) {
      r.species++;
      r.attractionMatrix = r.attractionMatrix.map(row => [...row, (rng() - 0.5) * 2]);
      r.attractionMatrix.push(
        Array.from({ length: r.species }, () => (rng() - 0.5) * 2)
      );
    } else if (r.species > 3) {
      r.species--;
      r.attractionMatrix = r.attractionMatrix.slice(0, r.species).map(row => row.slice(0, r.species));
    }
  }

  if (rng() < 0.15) {
    r.quantize = 3 + Math.floor(rng() * 6);
  }

  return r;
}

// --- Crossover ---
export function crossoverParticleLife(a: ParticleLifeRule, b: ParticleLifeRule, rng: () => number): ParticleLifeRule {
  const t = rng();
  const species = rng() > 0.5 ? a.species : b.species;

  // Build matrix from the chosen species count, interpolating where both have entries
  const matrix: number[][] = [];
  for (let i = 0; i < species; i++) {
    const row: number[] = [];
    for (let j = 0; j < species; j++) {
      const av = (i < a.species && j < a.species) ? a.attractionMatrix[i][j] : (rng() - 0.5) * 2;
      const bv = (i < b.species && j < b.species) ? b.attractionMatrix[i][j] : (rng() - 0.5) * 2;
      row.push(av * t + bv * (1 - t));
    }
    matrix.push(row);
  }

  return {
    species,
    particlesPerSpecies: Math.round(a.particlesPerSpecies * t + b.particlesPerSpecies * (1 - t)),
    attractionMatrix: matrix,
    forceRadius: a.forceRadius * t + b.forceRadius * (1 - t),
    friction: a.friction * t + b.friction * (1 - t),
    forceFactor: a.forceFactor * t + b.forceFactor * (1 - t),
    steps: rng() > 0.5 ? a.steps : b.steps,
    quantize: rng() > 0.5 ? a.quantize : b.quantize,
  };
}

// --- Random rule generator ---
export function randomParticleLifeRule(rng: () => number): ParticleLifeRule {
  const species = 3 + Math.floor(rng() * 4); // 3-6

  // Generate attraction matrix with interesting asymmetric patterns
  const matrix: number[][] = [];
  for (let i = 0; i < species; i++) {
    const row: number[] = [];
    for (let j = 0; j < species; j++) {
      if (i === j) {
        // Self-interaction: mild attraction (flocking)
        row.push(0.1 + rng() * 0.4);
      } else {
        // Inter-species: full range, biased slightly negative for interesting dynamics
        row.push((rng() - 0.55) * 2);
      }
    }
    matrix.push(row);
  }

  return {
    species,
    particlesPerSpecies: 80 + Math.floor(rng() * 120),
    attractionMatrix: matrix,
    forceRadius: 50 + Math.floor(rng() * 50),
    friction: 0.3 + rng() * 0.4,
    forceFactor: 1 + rng() * 2,
    steps: 400 + Math.floor(rng() * 400),
    quantize: 4 + Math.floor(rng() * 4),
  };
}

// --- Seed genomes ---
export const PARTICLE_LIFE_SEED_GENOMES_PARTIAL = [
  {
    // "Hunters and Prey" — asymmetric chase dynamics
    species: 4, particlesPerSpecies: 120,
    attractionMatrix: [
      [ 0.3, -0.8,  0.5,  0.1],
      [ 0.7,  0.2, -0.6,  0.3],
      [-0.5,  0.8,  0.3, -0.4],
      [ 0.1, -0.3,  0.6,  0.2],
    ],
    forceRadius: 70, friction: 0.5, forceFactor: 2, steps: 600, quantize: 6,
  },
  {
    // "Symbiosis" — mutual attraction clusters
    species: 3, particlesPerSpecies: 150,
    attractionMatrix: [
      [ 0.4,  0.6, -0.3],
      [ 0.5,  0.3,  0.7],
      [-0.4,  0.6,  0.2],
    ],
    forceRadius: 80, friction: 0.4, forceFactor: 1.5, steps: 500, quantize: 5,
  },
  {
    // "Orbital Dance" — strong cross-species forces create orbits
    species: 5, particlesPerSpecies: 100,
    attractionMatrix: [
      [ 0.2,  0.9, -0.7,  0.1,  0.3],
      [-0.8,  0.3,  0.6, -0.2,  0.1],
      [ 0.5, -0.5,  0.2,  0.8, -0.6],
      [ 0.1,  0.3, -0.4,  0.3,  0.7],
      [-0.3,  0.2,  0.5, -0.6,  0.2],
    ],
    forceRadius: 60, friction: 0.6, forceFactor: 2.5, steps: 700, quantize: 7,
  },
];

export const PARTICLE_LIFE_SEED_GENOMES = PARTICLE_LIFE_SEED_GENOMES_PARTIAL.map(rule => ({
  type: "particle-life" as const,
  rule,
  width: 48,
  height: 28,
  palette: [" ", "·", ":", "░", "▒", "▓", "█"],
  seed: Math.floor(Math.random() * 2 ** 32),
  mutations: 0,
  lineage: [] as string[],
}));
