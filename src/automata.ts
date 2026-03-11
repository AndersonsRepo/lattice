/**
 * Lattice — Cellular Automata Engine
 *
 * Implements 1D and 2D cellular automata with mutable rule sets.
 * The core of the generative art system.
 */

// Unicode palettes for rendering (light → dense)
const PALETTE = [" ", "░", "▒", "▓", "█", "╱", "╲", "╳", "◊", "◆", "●", "○", "◐", "◑", "◒", "◓"];
const MINIMAL_PALETTE = [" ", "·", "•", "○", "●", "◆"];
const BLOCK_PALETTE = [" ", "░", "▒", "▓", "█"];

// New visually rich palettes
const WAVE_PALETTE = [" ", "~", "≈", "∿", "≋", "⌇", "⌁"];
const STAR_PALETTE = [" ", "·", "✦", "✧", "★", "✶", "✹", "✺"];
const BOTANICAL_PALETTE = [" ", ".", ":", "❦", "✿", "❀", "❁"];
const GEOMETRIC_PALETTE = [" ", "△", "▽", "◇", "◈", "⬡", "⬢"];
const BRAILLE_PALETTE = [" ", "⠁", "⠃", "⠇", "⠏", "⠟", "⠿", "⣿"];
const SHADE_PALETTE = [" ", "·", ":", "░", "▒", "▓", "█"];

export const ALL_PALETTES = [
  PALETTE, MINIMAL_PALETTE, BLOCK_PALETTE,
  WAVE_PALETTE, STAR_PALETTE, BOTANICAL_PALETTE,
  GEOMETRIC_PALETTE, BRAILLE_PALETTE, SHADE_PALETTE,
];

export interface Rule1D {
  number: number; // Wolfram rule number (0-255)
  states: number;
}

export interface Rule2D {
  birth: number[];    // neighbor counts that cause birth
  survive: number[];  // neighbor counts that allow survival
  states: number;     // number of cell states (2+ for generations)
}

export interface Genome {
  type: "1d" | "2d" | "lsystem";
  rule: Rule1D | Rule2D | LSystemRule;
  width: number;
  height: number;
  palette: string[];
  seed: number;
  mutations: number; // how many times this genome has been mutated
  lineage: string[]; // parent genome IDs
}

export interface LSystemRule {
  axiom: string;
  rules: Record<string, string>;
  angle: number;
  iterations: number;
}

export interface Piece {
  id: string;
  genome: Genome;
  grid: number[][];
  rendered: string;
  score: number;
  metrics: PieceMetrics;
  generation: number;
  createdAt: string;
}

export interface PieceMetrics {
  complexity: number;          // entropy of cell distribution
  symmetry: number;            // horizontal + vertical symmetry score
  density: number;             // % of non-empty cells
  novelty: number;             // distance from population (rewards uniqueness)
  edgeActivity: number;        // activity at boundaries
  structuralInterest: number;  // clustered regions vs uniform noise
}

// --- Pseudorandom number generator (deterministic from seed) ---
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 1D Cellular Automaton ---
export function evolve1D(genome: Genome): number[][] {
  const rule = genome.rule as Rule1D;
  const rng = mulberry32(genome.seed);
  const { width, height } = genome;

  const grid: number[][] = [];

  // Initialize first row
  const firstRow = new Array(width).fill(0);
  // Single center cell or random seed
  if (rng() > 0.5) {
    firstRow[Math.floor(width / 2)] = 1;
  } else {
    for (let i = 0; i < width; i++) {
      firstRow[i] = rng() > 0.7 ? 1 : 0;
    }
  }
  grid.push(firstRow);

  // Evolve
  for (let y = 1; y < height; y++) {
    const prev = grid[y - 1];
    const row = new Array(width).fill(0);
    for (let x = 0; x < width; x++) {
      const left = prev[(x - 1 + width) % width];
      const center = prev[x];
      const right = prev[(x + 1) % width];
      const neighborhood = (left << 2) | (center << 1) | right;
      row[x] = (rule.number >> neighborhood) & 1;
    }
    grid.push(row);
  }

  return grid;
}

// --- 2D Cellular Automaton (Life-like, multi-state) ---
export function evolve2D(genome: Genome): number[][] {
  const rule = genome.rule as Rule2D;
  const rng = mulberry32(genome.seed);
  const { width, height } = genome;
  const generations = Math.min(height, 100);
  const maxState = Math.max(rule.states - 1, 1);

  // Initialize grid randomly
  let grid: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array(width).fill(0);
    for (let x = 0; x < width; x++) {
      row[x] = rng() > 0.6 ? 1 : 0;
    }
    grid.push(row);
  }

  // Run generations — multi-state: dying cells decay through intermediate states
  for (let gen = 0; gen < generations; gen++) {
    const next: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row = new Array(width).fill(0);
      for (let x = 0; x < width; x++) {
        const neighbors = countNeighbors(grid, x, y, width, height);
        const cellState = grid[y][x];
        if (cellState === maxState) {
          // Fully alive cell — check survive rules
          row[x] = rule.survive.includes(neighbors) ? maxState : Math.max(maxState - 1, 0);
        } else if (cellState === 0) {
          // Dead cell — check birth rules
          row[x] = rule.birth.includes(neighbors) ? maxState : 0;
        } else {
          // Decaying cell — continue decay toward 0
          row[x] = cellState - 1;
        }
      }
      next.push(row);
    }
    grid = next;
  }

  return grid;
}

function countNeighbors(grid: number[][], x: number, y: number, w: number, h: number): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = (x + dx + w) % w;
      const ny = (y + dy + h) % h;
      if (grid[ny][nx] > 0) count++;
    }
  }
  return count;
}

// --- L-System ---
export function evolveLSystem(genome: Genome): number[][] {
  const rule = genome.rule as LSystemRule;
  const { width, height } = genome;

  // Generate L-system string
  let current = rule.axiom;
  for (let i = 0; i < rule.iterations; i++) {
    let next = "";
    for (const ch of current) {
      next += rule.rules[ch] ?? ch;
    }
    current = next;
    if (current.length > 10000) break; // safety limit
  }

  // Turtle graphics onto grid
  const grid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));
  let x = width / 2, y = height / 2;
  let angle = 0;
  const step = 1;
  const stack: { x: number; y: number; angle: number }[] = [];

  for (const ch of current) {
    switch (ch) {
      case "F":
      case "G":
        const nx = x + step * Math.cos((angle * Math.PI) / 180);
        const ny = y + step * Math.sin((angle * Math.PI) / 180);
        const gx = Math.round(nx) % width;
        const gy = Math.round(ny) % height;
        if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
          grid[gy][gx] = 1;
        }
        x = nx;
        y = ny;
        break;
      case "+":
        angle += rule.angle;
        break;
      case "-":
        angle -= rule.angle;
        break;
      case "[":
        stack.push({ x, y, angle });
        break;
      case "]":
        const state = stack.pop();
        if (state) ({ x, y, angle } = state);
        break;
    }
  }

  return grid;
}

// --- Rendering ---
export function render(grid: number[][], palette: string[]): string {
  return grid
    .map((row) =>
      row.map((cell) => palette[cell % palette.length]).join("")
    )
    .join("\n");
}

// --- Scoring ---
export function score(grid: number[][]): PieceMetrics {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const total = width * height;
  if (total === 0) return { complexity: 0, symmetry: 0, density: 0, novelty: 0, edgeActivity: 0 };

  // Density
  let filled = 0;
  const counts: Record<number, number> = {};
  for (const row of grid) {
    for (const cell of row) {
      if (cell > 0) filled++;
      counts[cell] = (counts[cell] ?? 0) + 1;
    }
  }
  const density = filled / total;

  // Complexity (Shannon entropy)
  let entropy = 0;
  for (const count of Object.values(counts)) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const complexity = entropy;

  // Symmetry (horizontal)
  let symMatches = 0;
  let symTotal = 0;
  for (const row of grid) {
    for (let x = 0; x < Math.floor(width / 2); x++) {
      symTotal++;
      if (row[x] === row[width - 1 - x]) symMatches++;
    }
  }
  // Vertical symmetry
  for (let y = 0; y < Math.floor(height / 2); y++) {
    for (let x = 0; x < width; x++) {
      symTotal++;
      if (grid[y][x] === grid[height - 1 - y][x]) symMatches++;
    }
  }
  const symmetry = symTotal > 0 ? symMatches / symTotal : 0;

  // Edge activity
  let edgeChanges = 0;
  let edgePairs = 0;
  for (const row of grid) {
    for (let x = 0; x < width - 1; x++) {
      edgePairs++;
      if (row[x] !== row[x + 1]) edgeChanges++;
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height - 1; y++) {
      edgePairs++;
      if (grid[y][x] !== grid[y + 1][x]) edgeChanges++;
    }
  }
  const edgeActivity = edgePairs > 0 ? edgeChanges / edgePairs : 0;

  // Structural interest — reward clustered regions over uniform noise
  // Uses a simple flood-fill-like count of distinct regions
  let regionCount = 0;
  const visited = Array.from({ length: height }, () => new Array(width).fill(false));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!visited[y][x] && grid[y][x] > 0) {
        regionCount++;
        // BFS flood fill
        const queue: [number, number][] = [[y, x]];
        visited[y][x] = true;
        while (queue.length > 0) {
          const [cy, cx] = queue.shift()!;
          for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const ny = cy + dy, nx = cx + dx;
            if (ny >= 0 && ny < height && nx >= 0 && nx < width && !visited[ny][nx] && grid[ny][nx] > 0) {
              visited[ny][nx] = true;
              queue.push([ny, nx]);
            }
          }
        }
      }
    }
  }
  // Normalize: sweet spot is ~5-30 regions for interesting structure
  const regionNorm = total > 0 ? Math.min(regionCount / (total * 0.02), 1) : 0;
  const structuralInterest = 1 - Math.abs(regionNorm - 0.5) * 2; // peak at moderate region count

  return { complexity, symmetry, density, novelty: 0, edgeActivity, structuralInterest };
}

// Compute novelty: how different is this piece's fingerprint from a set of others?
export function computeNovelty(metrics: PieceMetrics, population: PieceMetrics[]): number {
  if (population.length === 0) return 1;
  const keys: (keyof PieceMetrics)[] = ["complexity", "symmetry", "density", "edgeActivity", "structuralInterest"];
  let totalDist = 0;
  for (const other of population) {
    let dist = 0;
    for (const k of keys) {
      dist += (metrics[k] - other[k]) ** 2;
    }
    totalDist += Math.sqrt(dist);
  }
  // Average distance, normalized to [0, 1] range (sqrt(5) ≈ 2.24 is max possible)
  return Math.min((totalDist / population.length) / 1.5, 1);
}

export function computeScore(metrics: PieceMetrics): number {
  // Prefer: moderate density, high complexity, some symmetry, high edge activity, structural interest
  const densityScore = 1 - Math.abs(metrics.density - 0.4) * 2; // peak at 40%
  const complexityScore = Math.min(metrics.complexity / 2, 1);
  const symmetryBonus = metrics.symmetry * 0.3;
  const edgeScore = metrics.edgeActivity;
  const structureScore = metrics.structuralInterest ?? 0;

  return (
    densityScore * 0.2 +
    complexityScore * 0.25 +
    symmetryBonus * 0.1 +
    edgeScore * 0.2 +
    structureScore * 0.1 +
    metrics.novelty * 0.15 // novelty pressure — reward uniqueness
  );
}

// --- Mutation ---
export function mutateGenome(genome: Genome, rng: () => number): Genome {
  const mutated = JSON.parse(JSON.stringify(genome)) as Genome;
  mutated.seed = Math.floor(rng() * 2 ** 32);
  mutated.mutations++;
  mutated.lineage = [...genome.lineage, genome.seed.toString(16)];

  // Rare type-swap mutation (5%) — introduces fresh genome types into the population
  if (rng() < 0.05) {
    return randomGenomeOfType(
      ["1d", "2d", "lsystem"][Math.floor(rng() * 3)] as Genome["type"],
      rng,
      mutated.lineage
    );
  }

  if (mutated.type === "1d") {
    const rule = mutated.rule as Rule1D;
    // Flip 1-3 bits in the rule number
    const flips = Math.ceil(rng() * 3);
    for (let i = 0; i < flips; i++) {
      rule.number ^= 1 << Math.floor(rng() * 8);
    }
    rule.number = rule.number & 0xff;
  } else if (mutated.type === "2d") {
    const rule = mutated.rule as Rule2D;
    // Add or remove a birth/survive condition
    if (rng() > 0.5) {
      const n = Math.floor(rng() * 9);
      if (rule.birth.includes(n)) {
        rule.birth = rule.birth.filter((x) => x !== n);
      } else {
        rule.birth.push(n);
      }
    } else {
      const n = Math.floor(rng() * 9);
      if (rule.survive.includes(n)) {
        rule.survive = rule.survive.filter((x) => x !== n);
      } else {
        rule.survive.push(n);
      }
    }
    // Occasionally mutate state count (more states = gradient effects)
    if (rng() < 0.15) {
      rule.states = Math.floor(rng() * 5) + 2; // 2-6 states
    }
  } else if (mutated.type === "lsystem") {
    const rule = mutated.rule as LSystemRule;
    // Mutate angle or add/modify a rule
    if (rng() > 0.6) {
      rule.angle += (rng() > 0.5 ? 1 : -1) * Math.floor(rng() * 15 + 1);
      rule.angle = ((rule.angle % 360) + 360) % 360;
    } else {
      const keys = Object.keys(rule.rules);
      const key = keys[Math.floor(rng() * keys.length)];
      const chars = "F+-[]G";
      const pos = Math.floor(rng() * (rule.rules[key].length + 1));
      const ch = chars[Math.floor(rng() * chars.length)];
      rule.rules[key] =
        rule.rules[key].slice(0, pos) + ch + rule.rules[key].slice(pos);
    }
    // Occasionally bump iterations
    if (rng() < 0.1) {
      rule.iterations = Math.min(rule.iterations + 1, 6);
    }
  }

  // Canvas size mutation (10%) — slight variation for organic feel
  if (rng() < 0.1) {
    const delta = Math.floor(rng() * 8) - 4; // -4 to +3
    mutated.width = Math.max(24, Math.min(72, mutated.width + delta));
    mutated.height = Math.max(16, Math.min(40, mutated.height + Math.floor(delta * 0.6)));
  }

  // Palette swap (30% chance — higher than before to push visual variety)
  if (rng() < 0.3) {
    mutated.palette = ALL_PALETTES[Math.floor(rng() * ALL_PALETTES.length)];
  }

  return mutated;
}

// Crossover: combine traits from two parent genomes
export function crossoverGenomes(a: Genome, b: Genome, rng: () => number): Genome {
  // If different types, randomly pick one parent's type and rules
  if (a.type !== b.type) {
    const base = rng() > 0.5 ? a : b;
    const other = base === a ? b : a;
    const child = JSON.parse(JSON.stringify(base)) as Genome;
    child.seed = Math.floor(rng() * 2 ** 32);
    child.mutations = Math.max(a.mutations, b.mutations) + 1;
    child.lineage = [...a.lineage.slice(-2), ...b.lineage.slice(-2), "×"];
    child.palette = rng() > 0.5 ? a.palette : b.palette;
    child.width = rng() > 0.5 ? a.width : b.width;
    child.height = rng() > 0.5 ? a.height : b.height;
    return child;
  }

  // Same type — blend rules
  const child = JSON.parse(JSON.stringify(a)) as Genome;
  child.seed = Math.floor(rng() * 2 ** 32);
  child.mutations = Math.max(a.mutations, b.mutations) + 1;
  child.lineage = [...a.lineage.slice(-2), ...b.lineage.slice(-2), "×"];
  child.palette = rng() > 0.5 ? a.palette : b.palette;
  child.width = Math.round((a.width + b.width) / 2);
  child.height = Math.round((a.height + b.height) / 2);

  if (child.type === "2d") {
    const ra = a.rule as Rule2D, rb = b.rule as Rule2D;
    const rule = child.rule as Rule2D;
    // Union of birth/survive with random drops
    const birthSet = new Set([...ra.birth, ...rb.birth]);
    const surviveSet = new Set([...ra.survive, ...rb.survive]);
    rule.birth = [...birthSet].filter(() => rng() > 0.3);
    rule.survive = [...surviveSet].filter(() => rng() > 0.3);
    if (rule.birth.length === 0) rule.birth = [3]; // safety
    if (rule.survive.length === 0) rule.survive = [2]; // safety
    rule.states = rng() > 0.5 ? ra.states : rb.states;
  } else if (child.type === "1d") {
    const ra = a.rule as Rule1D, rb = b.rule as Rule1D;
    // Bitwise crossover: take random bits from each parent
    let result = 0;
    for (let i = 0; i < 8; i++) {
      result |= ((rng() > 0.5 ? ra.number : rb.number) >> i & 1) << i;
    }
    (child.rule as Rule1D).number = result;
  }

  return child;
}

// Generate a random genome of a given type (for type-swap mutations and re-seeding)
function randomGenomeOfType(type: Genome["type"], rng: () => number, lineage: string[]): Genome {
  const palette = ALL_PALETTES[Math.floor(rng() * ALL_PALETTES.length)];
  const seed = Math.floor(rng() * 2 ** 32);

  if (type === "1d") {
    return {
      type: "1d",
      rule: { number: Math.floor(rng() * 256), states: 2 },
      width: 48 + Math.floor(rng() * 24),
      height: 24 + Math.floor(rng() * 12),
      palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
    };
  } else if (type === "lsystem") {
    const axioms = ["F", "F+F", "F-F+F"];
    const ruleTemplates = [
      { F: "F+F-F-F+F" },
      { F: "FF+[+F-F-F]-[-F+F+F]" },
      { F: "F[+F]F[-F]F" },
      { F: "F[+F][-F]F[+F]" },
    ];
    return {
      type: "lsystem",
      rule: {
        axiom: axioms[Math.floor(rng() * axioms.length)],
        rules: ruleTemplates[Math.floor(rng() * ruleTemplates.length)],
        angle: [15, 22.5, 25, 30, 45, 60, 72, 90, 120][Math.floor(rng() * 9)],
        iterations: 3 + Math.floor(rng() * 2),
      },
      width: 48 + Math.floor(rng() * 16),
      height: 32 + Math.floor(rng() * 8),
      palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
    };
  }
  // Default: 2d
  const birthCount = 1 + Math.floor(rng() * 3);
  const surviveCount = 1 + Math.floor(rng() * 3);
  const birth = Array.from({ length: birthCount }, () => Math.floor(rng() * 9));
  const survive = Array.from({ length: surviveCount }, () => Math.floor(rng() * 9));
  return {
    type: "2d",
    rule: { birth: [...new Set(birth)], survive: [...new Set(survive)], states: 2 + Math.floor(rng() * 4) },
    width: 36 + Math.floor(rng() * 16),
    height: 20 + Math.floor(rng() * 12),
    palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
  };
}

// --- Seed Genomes ---
export const SEED_GENOMES: Genome[] = [
  // 1D Wolfram automata
  {
    type: "1d",
    rule: { number: 30, states: 2 },
    width: 64,
    height: 32,
    palette: BRAILLE_PALETTE,
    seed: 42,
    mutations: 0,
    lineage: [],
  },
  {
    type: "1d",
    rule: { number: 110, states: 2 },
    width: 64,
    height: 32,
    palette: SHADE_PALETTE,
    seed: 7,
    mutations: 0,
    lineage: [],
  },
  {
    type: "1d",
    rule: { number: 90, states: 2 }, // Sierpinski triangle
    width: 64,
    height: 32,
    palette: GEOMETRIC_PALETTE,
    seed: 314,
    mutations: 0,
    lineage: [],
  },
  // 2D Life-like (multi-state for gradient rendering)
  {
    type: "2d",
    rule: { birth: [3], survive: [2, 3], states: 4 }, // Conway's Life with decay trails
    width: 40,
    height: 24,
    palette: SHADE_PALETTE,
    seed: 1337,
    mutations: 0,
    lineage: [],
  },
  {
    type: "2d",
    rule: { birth: [3, 6, 8], survive: [2, 4, 5], states: 5 },
    width: 40,
    height: 24,
    palette: STAR_PALETTE,
    seed: 2024,
    mutations: 0,
    lineage: [],
  },
  {
    type: "2d",
    rule: { birth: [1, 3, 5], survive: [1, 2, 4], states: 6 }, // Coral-like growth
    width: 44,
    height: 28,
    palette: BOTANICAL_PALETTE,
    seed: 8888,
    mutations: 0,
    lineage: [],
  },
  {
    type: "2d",
    rule: { birth: [2], survive: [0], states: 3 }, // Seeds variant
    width: 36,
    height: 22,
    palette: WAVE_PALETTE,
    seed: 4242,
    mutations: 0,
    lineage: [],
  },
  // L-Systems
  {
    type: "lsystem",
    rule: {
      axiom: "F",
      rules: { F: "F+F-F-F+F" },
      angle: 90,
      iterations: 4,
    },
    width: 48,
    height: 32,
    palette: GEOMETRIC_PALETTE,
    seed: 99,
    mutations: 0,
    lineage: [],
  },
  {
    type: "lsystem",
    rule: {
      axiom: "F",
      rules: { F: "FF+[+F-F-F]-[-F+F+F]" },
      angle: 25,
      iterations: 3,
    },
    width: 48,
    height: 32,
    palette: BOTANICAL_PALETTE,
    seed: 555,
    mutations: 0,
    lineage: [],
  },
  {
    type: "lsystem",
    rule: {
      axiom: "F-F-F-F",
      rules: { F: "F[+F]F[-F]F" },
      angle: 72,
      iterations: 3,
    },
    width: 52,
    height: 36,
    palette: STAR_PALETTE,
    seed: 777,
    mutations: 0,
    lineage: [],
  },
  {
    type: "lsystem",
    rule: {
      axiom: "F",
      rules: { F: "F[+F][-F]F[+F]" },
      angle: 30,
      iterations: 4,
    },
    width: 56,
    height: 36,
    palette: BRAILLE_PALETTE,
    seed: 1001,
    mutations: 0,
    lineage: [],
  },
  // One more 1D with the rich palette
  {
    type: "1d",
    rule: { number: 150, states: 2 },
    width: 60,
    height: 30,
    palette: WAVE_PALETTE,
    seed: 2025,
    mutations: 0,
    lineage: [],
  },
];
