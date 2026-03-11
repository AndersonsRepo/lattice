/**
 * Lattice — Cellular Automata Engine
 *
 * Implements 1D and 2D cellular automata with mutable rule sets.
 * The core of the generative art system.
 */

// Unicode blocks for rendering (light → dense)
const PALETTE = [" ", "░", "▒", "▓", "█", "╱", "╲", "╳", "◊", "◆", "●", "○", "◐", "◑", "◒", "◓"];
const MINIMAL_PALETTE = [" ", "·", "•", "○", "●", "◆"];
const BLOCK_PALETTE = [" ", "░", "▒", "▓", "█"];

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
  complexity: number;   // entropy of cell distribution
  symmetry: number;     // horizontal + vertical symmetry score
  density: number;      // % of non-empty cells
  novelty: number;      // distance from previous pieces
  edgeActivity: number; // activity at boundaries
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

// --- 2D Cellular Automaton (Life-like) ---
export function evolve2D(genome: Genome): number[][] {
  const rule = genome.rule as Rule2D;
  const rng = mulberry32(genome.seed);
  const { width, height } = genome;
  const generations = Math.min(height, 100);

  // Initialize grid randomly
  let grid: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row = new Array(width).fill(0);
    for (let x = 0; x < width; x++) {
      row[x] = rng() > 0.6 ? 1 : 0;
    }
    grid.push(row);
  }

  // Run generations
  for (let gen = 0; gen < generations; gen++) {
    const next: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row = new Array(width).fill(0);
      for (let x = 0; x < width; x++) {
        const neighbors = countNeighbors(grid, x, y, width, height);
        const alive = grid[y][x] > 0;
        if (alive) {
          row[x] = rule.survive.includes(neighbors) ? Math.min(grid[y][x], rule.states - 1) : 0;
        } else {
          row[x] = rule.birth.includes(neighbors) ? 1 : 0;
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

  return { complexity, symmetry, density, novelty: 0, edgeActivity };
}

export function computeScore(metrics: PieceMetrics): number {
  // Prefer: moderate density, high complexity, some symmetry, high edge activity
  const densityScore = 1 - Math.abs(metrics.density - 0.4) * 2; // peak at 40%
  const complexityScore = Math.min(metrics.complexity / 2, 1);
  const symmetryBonus = metrics.symmetry * 0.3;
  const edgeScore = metrics.edgeActivity;

  return (
    densityScore * 0.25 +
    complexityScore * 0.35 +
    symmetryBonus * 0.15 +
    edgeScore * 0.25
  );
}

// --- Mutation ---
export function mutateGenome(genome: Genome, rng: () => number): Genome {
  const mutated = JSON.parse(JSON.stringify(genome)) as Genome;
  mutated.seed = Math.floor(rng() * 2 ** 32);
  mutated.mutations++;
  mutated.lineage = [...genome.lineage, genome.seed.toString(16)];

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
  }

  // Occasionally swap palette
  if (rng() > 0.8) {
    const palettes = [PALETTE, MINIMAL_PALETTE, BLOCK_PALETTE];
    mutated.palette = palettes[Math.floor(rng() * palettes.length)];
  }

  return mutated;
}

// --- Seed Genomes ---
export const SEED_GENOMES: Genome[] = [
  {
    type: "1d",
    rule: { number: 30, states: 2 },
    width: 64,
    height: 32,
    palette: BLOCK_PALETTE,
    seed: 42,
    mutations: 0,
    lineage: [],
  },
  {
    type: "1d",
    rule: { number: 110, states: 2 },
    width: 64,
    height: 32,
    palette: MINIMAL_PALETTE,
    seed: 7,
    mutations: 0,
    lineage: [],
  },
  {
    type: "2d",
    rule: { birth: [3], survive: [2, 3], states: 2 }, // Conway's Life
    width: 40,
    height: 24,
    palette: BLOCK_PALETTE,
    seed: 1337,
    mutations: 0,
    lineage: [],
  },
  {
    type: "2d",
    rule: { birth: [3, 6, 8], survive: [2, 4, 5], states: 2 },
    width: 40,
    height: 24,
    palette: PALETTE,
    seed: 2024,
    mutations: 0,
    lineage: [],
  },
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
    palette: MINIMAL_PALETTE,
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
    palette: BLOCK_PALETTE,
    seed: 555,
    mutations: 0,
    lineage: [],
  },
];
