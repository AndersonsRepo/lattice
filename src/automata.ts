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

export interface ReactionDiffusionRule {
  feed: number;      // feed rate for chemical U (0.01-0.1)
  kill: number;      // kill rate for chemical V (0.04-0.08)
  Du: number;        // diffusion rate of U (0.1-0.3)
  Dv: number;        // diffusion rate of V (0.03-0.1)
  steps: number;     // simulation steps (500-3000)
  quantize: number;  // number of output states (3-8)
}

export interface VoronoiRule {
  seeds: number;       // number of seed points (5-40)
  mode: "regions" | "edges" | "gradient" | "dual"; // rendering mode
  metric: "euclidean" | "manhattan" | "chebyshev"; // distance metric
  jitter: number;      // seed point randomness (0=grid, 1=fully random)
}

export interface WFCRule {
  tileCount: number;        // number of distinct tile types (3-8)
  adjacency: number[][];    // adjacency[tile] = list of tiles allowed as neighbors
  weights: number[];        // probability weight for each tile when collapsing
  symmetry: "none" | "horizontal" | "vertical" | "quad"; // post-collapse symmetry
}

export interface SpirographLayer {
  R: number;    // fixed circle radius (1-10)
  r: number;    // rolling circle radius (0.1-8)
  d: number;    // pen distance from rolling center (0.1-8)
  mode: "hypo" | "epi";  // hypotrochoid or epitrochoid
}

export interface SpirographRule {
  layers: SpirographLayer[];  // 1-4 overlaid curves
  steps: number;              // resolution per curve (500-3000)
  thickness: number;          // brush thickness (0-2)
  rotationOffset: number;     // degrees rotation between layers (0-360)
}

export interface AttractorRule {
  variant: "clifford" | "dejong";  // attractor formula
  a: number;   // parameter a (-3 to 3)
  b: number;   // parameter b (-3 to 3)
  c: number;   // parameter c (-3 to 3)
  d: number;   // parameter d (-3 to 3)
  iterations: number;  // number of points to plot (50000-500000)
  quantize: number;    // number of output states (3-8)
}

export interface JuliaRule {
  cReal: number;      // real part of c constant (-2 to 2)
  cImag: number;      // imaginary part of c constant (-2 to 2)
  maxIter: number;    // max iterations per pixel (50-500)
  zoom: number;       // zoom level (0.5-4)
  centerX: number;    // view center X (-2 to 2)
  centerY: number;    // view center Y (-2 to 2)
  quantize: number;   // output states (3-8)
  escape: number;     // escape radius (2-10)
}

export interface NoiseRule {
  scale: number;        // base frequency (0.02-0.2)
  octaves: number;      // detail layers (1-6)
  persistence: number;  // amplitude decay per octave (0.3-0.8)
  lacunarity: number;   // frequency multiplier per octave (1.5-3.0)
  quantize: number;     // output states (3-8)
  offsetX: number;      // horizontal offset (-100 to 100)
  offsetY: number;      // vertical offset (-100 to 100)
  warp: number;         // domain warping strength (0-2)
}

export interface Genome {
  type: "1d" | "2d" | "lsystem" | "reaction-diffusion" | "voronoi" | "wfc" | "spirograph" | "attractor" | "julia" | "noise";
  rule: Rule1D | Rule2D | LSystemRule | ReactionDiffusionRule | VoronoiRule | WFCRule | SpirographRule | AttractorRule | JuliaRule | NoiseRule;
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

// --- 1D Cellular Automaton (binary or totalistic 3-state) ---
export function evolve1D(genome: Genome): number[][] {
  const rule = genome.rule as Rule1D;
  const rng = mulberry32(genome.seed);
  const { width, height } = genome;

  const grid: number[][] = [];

  if (rule.states <= 2) {
    // Classic binary Wolfram rule
    const firstRow = new Array(width).fill(0);
    if (rng() > 0.5) {
      firstRow[Math.floor(width / 2)] = 1;
    } else {
      for (let i = 0; i < width; i++) {
        firstRow[i] = rng() > 0.7 ? 1 : 0;
      }
    }
    grid.push(firstRow);

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
  } else {
    // Totalistic 3-state rule: neighborhood sum (0-6) maps to output state (0-2)
    // rule.number encodes 7 trits (3^7 = 2187 possible rules)
    const firstRow = new Array(width).fill(0);
    if (rng() > 0.5) {
      firstRow[Math.floor(width / 2)] = rule.states - 1;
    } else {
      for (let i = 0; i < width; i++) {
        firstRow[i] = Math.floor(rng() * rule.states);
      }
    }
    grid.push(firstRow);

    for (let y = 1; y < height; y++) {
      const prev = grid[y - 1];
      const row = new Array(width).fill(0);
      for (let x = 0; x < width; x++) {
        const left = prev[(x - 1 + width) % width];
        const center = prev[x];
        const right = prev[(x + 1) % width];
        const sum = left + center + right; // 0 to 6 for 3-state
        // Extract trit from rule number for this sum
        const trit = Math.floor(rule.number / (3 ** sum)) % 3;
        row[x] = Math.min(trit, rule.states - 1);
      }
      grid.push(row);
    }
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

// --- L-System (thick brush, depth-aware, auto-centered) ---
export function evolveLSystem(genome: Genome): number[][] {
  const rule = genome.rule as LSystemRule;
  const { width, height } = genome;
  const maxState = Math.max((genome.palette?.length ?? 2) - 1, 1);

  // Generate L-system string
  let current = rule.axiom;
  for (let i = 0; i < rule.iterations; i++) {
    let next = "";
    for (const ch of current) {
      next += rule.rules[ch] ?? ch;
    }
    current = next;
    if (current.length > 15000) break; // safety limit
  }

  // Phase 1: Trace turtle path on unbounded canvas to find bounding box
  const points: { x: number; y: number; depth: number }[] = [];
  let tx = 0, ty = 0;
  let tAngle = -90;
  const tStep = 1;
  let tDepth = 0;
  const tStack: { x: number; y: number; angle: number; depth: number }[] = [];

  for (const ch of current) {
    switch (ch) {
      case "F":
      case "G": {
        const nx = tx + tStep * Math.cos((tAngle * Math.PI) / 180);
        const ny = ty + tStep * Math.sin((tAngle * Math.PI) / 180);
        points.push({ x: nx, y: ny, depth: tDepth });
        tx = nx;
        ty = ny;
        break;
      }
      case "+": tAngle += rule.angle; break;
      case "-": tAngle -= rule.angle; break;
      case "[":
        tStack.push({ x: tx, y: ty, angle: tAngle, depth: tDepth });
        tDepth++;
        break;
      case "]": {
        const state = tStack.pop();
        if (state) ({ x: tx, y: ty, angle: tAngle, depth: tDepth } = state);
        break;
      }
    }
  }

  if (points.length === 0) {
    return Array.from({ length: height }, () => new Array(width).fill(0));
  }

  // Find bounding box of all drawn points
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // Phase 2: Scale and center onto grid with margin
  const margin = 2;
  const drawW = width - margin * 2;
  const drawH = height - margin * 2;
  const bboxW = maxX - minX || 1;
  const bboxH = maxY - minY || 1;
  const scale = Math.min(drawW / bboxW, drawH / bboxH);
  const offsetX = margin + (drawW - bboxW * scale) / 2 - minX * scale;
  const offsetY = margin + (drawH - bboxH * scale) / 2 - minY * scale;

  const grid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));

  // Helper: paint a cell with thickness based on depth
  const paint = (gx: number, gy: number, intensity: number, radius: number) => {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius + 0.5) continue;
        const px = gx + dx;
        const py = gy + dy;
        if (px < 0 || px >= width || py < 0 || py >= height) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const falloff = Math.max(1, Math.round(intensity * (1 - dist / (radius + 1))));
        grid[py][px] = Math.max(grid[py][px], falloff);
      }
    }
  };

  // Phase 3: Paint scaled points onto grid
  for (const p of points) {
    const gx = Math.round(p.x * scale + offsetX);
    const gy = Math.round(p.y * scale + offsetY);
    const radius = Math.max(0, 2 - Math.floor(p.depth / 2));
    const intensity = Math.max(1, maxState - p.depth);
    if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
      paint(gx, gy, intensity, radius);
    }
  }

  // Post-process: bloom effect — add a soft glow around all drawn cells
  const bloomed: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));
  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      bloomed[gy][gx] = grid[gy][gx];
    }
  }
  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      if (grid[gy][gx] > 0) {
        // Soft glow: neighbors get +1 if they're empty or lower
        for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
          const ny = gy + dy, nx = gx + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            const glow = Math.max(1, grid[gy][gx] - 1);
            bloomed[ny][nx] = Math.max(bloomed[ny][nx], glow);
          }
        }
      }
    }
  }

  return bloomed;
}

// --- Reaction-Diffusion (Gray-Scott model) ---
export function evolveReactionDiffusion(genome: Genome): number[][] {
  const rule = genome.rule as ReactionDiffusionRule;
  const rng = mulberry32(genome.seed);
  const { width, height } = genome;
  const { feed, kill, Du, Dv, steps, quantize } = rule;

  // Two chemical grids: U (substrate) and V (catalyst)
  let U = Array.from({ length: height }, () => new Float64Array(width).fill(1.0));
  let V = Array.from({ length: height }, () => new Float64Array(width).fill(0.0));

  // Seed V with random patches
  const numSeeds = 3 + Math.floor(rng() * 5);
  for (let s = 0; s < numSeeds; s++) {
    const cx = Math.floor(rng() * width);
    const cy = Math.floor(rng() * height);
    const r = 2 + Math.floor(rng() * 3);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r) {
          const x = ((cx + dx) % width + width) % width;
          const y = ((cy + dy) % height + height) % height;
          U[y][x] = 0.5 + rng() * 0.1;
          V[y][x] = 0.25 + rng() * 0.1;
        }
      }
    }
  }

  // Laplacian with wrapping boundaries
  const laplacian = (grid: Float64Array[], x: number, y: number): number => {
    const xm = (x - 1 + width) % width;
    const xp = (x + 1) % width;
    const ym = (y - 1 + height) % height;
    const yp = (y + 1) % height;
    return (
      grid[ym][x] + grid[yp][x] + grid[y][xm] + grid[y][xp]
      - 4 * grid[y][x]
    );
  };

  // Simulate
  const dt = 1.0;
  for (let step = 0; step < steps; step++) {
    const newU = Array.from({ length: height }, () => new Float64Array(width));
    const newV = Array.from({ length: height }, () => new Float64Array(width));

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = U[y][x];
        const v = V[y][x];
        const uvv = u * v * v;
        const lapU = laplacian(U, x, y);
        const lapV = laplacian(V, x, y);

        newU[y][x] = Math.max(0, Math.min(1, u + dt * (Du * lapU - uvv + feed * (1 - u))));
        newV[y][x] = Math.max(0, Math.min(1, v + dt * (Dv * lapV + uvv - (feed + kill) * v)));
      }
    }

    U = newU;
    V = newV;
  }

  // Quantize V chemical into discrete states for rendering
  const maxState = quantize - 1;
  const result: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      result[y][x] = Math.min(maxState, Math.floor(V[y][x] * quantize * 2.5));
    }
  }

  return result;
}

// --- Voronoi Tessellation ---
export function evolveVoronoi(genome: Genome): number[][] {
  const rule = genome.rule as VoronoiRule;
  const rng = mulberry32(genome.seed);
  const { width, height } = genome;
  const maxState = Math.max((genome.palette?.length ?? 2) - 1, 1);

  // Generate seed points
  const points: { x: number; y: number }[] = [];
  if (rule.jitter < 0.3) {
    // Grid-based with jitter
    const cols = Math.ceil(Math.sqrt(rule.seeds * (width / height)));
    const rows = Math.ceil(rule.seeds / cols);
    const cellW = width / cols;
    const cellH = height / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (points.length >= rule.seeds) break;
        points.push({
          x: (c + 0.5 + (rng() - 0.5) * rule.jitter) * cellW,
          y: (r + 0.5 + (rng() - 0.5) * rule.jitter) * cellH,
        });
      }
    }
  } else {
    // Fully random placement
    for (let i = 0; i < rule.seeds; i++) {
      points.push({ x: rng() * width, y: rng() * height });
    }
  }

  // Distance function based on metric
  const dist = (ax: number, ay: number, bx: number, by: number): number => {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    // Wrap-aware distances
    const wx = Math.min(dx, width - dx);
    const wy = Math.min(dy, height - dy);
    switch (rule.metric) {
      case "manhattan": return wx + wy;
      case "chebyshev": return Math.max(wx, wy);
      default: return Math.sqrt(wx * wx + wy * wy);
    }
  };

  const grid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Find two nearest seed points
      let d1 = Infinity, d2 = Infinity;
      let nearest = 0;
      for (let i = 0; i < points.length; i++) {
        const d = dist(x, y, points[i].x, points[i].y);
        if (d < d1) {
          d2 = d1; d1 = d; nearest = i;
        } else if (d < d2) {
          d2 = d;
        }
      }

      switch (rule.mode) {
        case "regions":
          // Color by which seed is nearest
          grid[y][x] = (nearest % maxState) + 1;
          break;
        case "edges": {
          // Edge detection: thin lines where d2 ≈ d1
          const edgeWidth = Math.max(width, height) * 0.03;
          grid[y][x] = (d2 - d1) < edgeWidth ? maxState : 0;
          break;
        }
        case "gradient": {
          // Distance gradient from nearest seed
          const maxDist = Math.sqrt(width * width + height * height) / (Math.sqrt(rule.seeds) * 1.2);
          const normalized = Math.min(d1 / maxDist, 1);
          grid[y][x] = Math.round(normalized * maxState);
          break;
        }
        case "dual": {
          // Combines regions + edge highlighting
          const edge = Math.max(width, height) * 0.04;
          if ((d2 - d1) < edge) {
            grid[y][x] = maxState; // bright edges
          } else {
            grid[y][x] = Math.max(1, (nearest % (maxState - 1)) + 1);
          }
          break;
        }
      }
    }
  }

  return grid;
}

// --- Wave Function Collapse ---
export function evolveWFC(genome: Genome): number[][] {
  const rule = genome.rule as WFCRule;
  const rng = mulberry32(genome.seed);
  const { width, height } = genome;
  const { tileCount, adjacency, weights } = rule;

  // Each cell starts as a superposition of all possible tiles
  // We represent this as a Set of possible tile indices
  const possible: Set<number>[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => new Set(Array.from({ length: tileCount }, (_, i) => i)))
  );
  const collapsed: number[][] = Array.from({ length: height }, () => new Array(width).fill(-1));

  // Weighted random choice from a set of tiles
  const weightedPick = (tiles: Set<number>): number => {
    let total = 0;
    for (const t of tiles) total += weights[t] ?? 1;
    let r = rng() * total;
    for (const t of tiles) {
      r -= weights[t] ?? 1;
      if (r <= 0) return t;
    }
    return [...tiles][tiles.size - 1]; // fallback
  };

  // Shannon entropy of a cell's possibilities
  const entropy = (tiles: Set<number>): number => {
    if (tiles.size <= 1) return 0;
    let total = 0;
    for (const t of tiles) total += weights[t] ?? 1;
    let e = 0;
    for (const t of tiles) {
      const p = (weights[t] ?? 1) / total;
      if (p > 0) e -= p * Math.log2(p);
    }
    // Add small noise to break ties
    return e + rng() * 0.001;
  };

  // Propagate constraints from a collapsed cell
  const propagate = (startY: number, startX: number): void => {
    const stack: [number, number][] = [[startY, startX]];
    while (stack.length > 0) {
      const [cy, cx] = stack.pop()!;
      const allowed = possible[cy][cx];
      // Build set of tiles that can neighbor this cell
      const neighborAllowed = new Set<number>();
      for (const tile of allowed) {
        const adj = adjacency[tile];
        if (adj) for (const a of adj) neighborAllowed.add(a);
      }

      for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
        if (collapsed[ny][nx] >= 0) continue; // already collapsed

        const before = possible[ny][nx].size;
        // Remove tiles that aren't in neighborAllowed
        for (const t of [...possible[ny][nx]]) {
          if (!neighborAllowed.has(t)) possible[ny][nx].delete(t);
        }
        // If we reduced possibilities, propagate further
        if (possible[ny][nx].size < before && possible[ny][nx].size > 0) {
          stack.push([ny, nx]);
        }
      }
    }
  };

  // Main WFC loop
  let iterations = 0;
  const maxIterations = width * height;
  while (iterations < maxIterations) {
    // Find uncollapsed cell with minimum entropy
    let minEntropy = Infinity;
    let minY = -1, minX = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (collapsed[y][x] >= 0) continue;
        if (possible[y][x].size === 0) {
          // Contradiction — fill with random tile
          collapsed[y][x] = Math.floor(rng() * tileCount);
          continue;
        }
        const e = entropy(possible[y][x]);
        if (e < minEntropy) {
          minEntropy = e;
          minY = y;
          minX = x;
        }
      }
    }

    if (minY < 0) break; // all cells collapsed

    // Collapse the chosen cell
    const tile = weightedPick(possible[minY][minX]);
    collapsed[minY][minX] = tile;
    possible[minY][minX] = new Set([tile]);
    propagate(minY, minX);
    iterations++;
  }

  // Fill any remaining uncollapsed cells
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (collapsed[y][x] < 0) {
        collapsed[y][x] = possible[y][x].size > 0
          ? weightedPick(possible[y][x])
          : Math.floor(rng() * tileCount);
      }
    }
  }

  // Apply symmetry
  if (rule.symmetry === "horizontal" || rule.symmetry === "quad") {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < Math.floor(width / 2); x++) {
        collapsed[y][width - 1 - x] = collapsed[y][x];
      }
    }
  }
  if (rule.symmetry === "vertical" || rule.symmetry === "quad") {
    for (let y = 0; y < Math.floor(height / 2); y++) {
      for (let x = 0; x < width; x++) {
        collapsed[height - 1 - y][x] = collapsed[y][x];
      }
    }
  }

  return collapsed;
}

// --- Spirograph (Hypotrochoid / Epitrochoid curves) ---
export function evolveSpirograph(genome: Genome): number[][] {
  const rule = genome.rule as SpirographRule;
  const { width, height } = genome;
  const maxState = Math.max((genome.palette?.length ?? 2) - 1, 1);

  // Trace all layers on unbounded canvas first
  const allPoints: { x: number; y: number; layer: number }[] = [];

  for (let li = 0; li < rule.layers.length; li++) {
    const layer = rule.layers[li];
    const { R, r, d, mode } = layer;
    const rotRad = (rule.rotationOffset * li * Math.PI) / 180;

    // Number of full rotations needed for the pattern to close
    // LCM(R, r) / r rotations, capped for performance
    const gcd = (a: number, b: number): number => {
      a = Math.abs(Math.round(a * 100));
      b = Math.abs(Math.round(b * 100));
      while (b) { [a, b] = [b, a % b]; }
      return a / 100;
    };
    const g = gcd(R, r);
    const fullRotations = Math.min(R / g, 20); // cap rotations
    const totalAngle = fullRotations * 2 * Math.PI;

    for (let i = 0; i <= rule.steps; i++) {
      const t = (i / rule.steps) * totalAngle;
      let x: number, y: number;

      if (mode === "hypo") {
        // Hypotrochoid: rolling circle inside fixed circle
        x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
        y = (R - r) * Math.sin(t) + d * Math.sin(((R - r) / r) * t);
      } else {
        // Epitrochoid: rolling circle outside fixed circle
        x = (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t);
        y = (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t);
      }

      // Apply per-layer rotation
      if (rotRad !== 0) {
        const rx = x * Math.cos(rotRad) - y * Math.sin(rotRad);
        const ry = x * Math.sin(rotRad) + y * Math.cos(rotRad);
        x = rx;
        y = ry;
      }

      allPoints.push({ x, y, layer: li });
    }
  }

  if (allPoints.length === 0) {
    return Array.from({ length: height }, () => new Array(width).fill(0));
  }

  // Find bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of allPoints) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // Scale and center onto grid with margin
  const margin = 1;
  const drawW = width - margin * 2;
  const drawH = height - margin * 2;
  const bboxW = maxX - minX || 1;
  const bboxH = maxY - minY || 1;
  const scale = Math.min(drawW / bboxW, drawH / bboxH);
  const offsetX = margin + (drawW - bboxW * scale) / 2 - minX * scale;
  const offsetY = margin + (drawH - bboxH * scale) / 2 - minY * scale;

  const grid: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));

  for (const p of allPoints) {
    const gx = Math.round(p.x * scale + offsetX);
    const gy = Math.round(p.y * scale + offsetY);
    if (gx < 0 || gx >= width || gy < 0 || gy >= height) continue;

    // Layer-aware intensity: each layer gets a distinct state
    const intensity = Math.max(1, Math.min(maxState, maxState - p.layer));

    // Paint with thickness
    const radius = rule.thickness;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius + 0.5) continue;
        const px = gx + dx;
        const py = gy + dy;
        if (px >= 0 && px < width && py >= 0 && py < height) {
          grid[py][px] = Math.max(grid[py][px], intensity);
        }
      }
    }
  }

  return grid;
}

// --- Strange Attractor (Clifford / De Jong) ---
export function evolveAttractor(genome: Genome): number[][] {
  const rule = genome.rule as AttractorRule;
  const { width, height } = genome;
  const { a, b, c, d, iterations, quantize } = rule;

  // Accumulate hit counts in a density map
  const density: number[][] = Array.from({ length: height }, () => new Array(width).fill(0));

  let x = 0.1, y = 0.1;
  // First pass: find bounding box by sampling
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const samplePoints: { x: number; y: number }[] = [];

  for (let i = 0; i < iterations; i++) {
    let nx: number, ny: number;
    if (rule.variant === "clifford") {
      // Clifford attractor: x' = sin(a*y) + c*cos(a*x), y' = sin(b*x) + d*cos(b*y)
      nx = Math.sin(a * y) + c * Math.cos(a * x);
      ny = Math.sin(b * x) + d * Math.cos(b * y);
    } else {
      // De Jong attractor: x' = sin(a*y) - cos(b*x), y' = sin(c*x) - cos(d*y)
      nx = Math.sin(a * y) - Math.cos(b * x);
      ny = Math.sin(c * x) - Math.cos(d * y);
    }
    x = nx;
    y = ny;

    if (!isFinite(x) || !isFinite(y)) { x = 0.1; y = 0.1; continue; }

    samplePoints.push({ x, y });
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (maxX === minX || maxY === minY || samplePoints.length === 0) {
    return density; // degenerate attractor
  }

  // Map points to grid and accumulate density
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  const margin = 1;
  const drawW = width - margin * 2;
  const drawH = height - margin * 2;
  let maxDensity = 0;

  for (const p of samplePoints) {
    const gx = Math.floor(margin + ((p.x - minX) / bboxW) * drawW);
    const gy = Math.floor(margin + ((p.y - minY) / bboxH) * drawH);
    if (gx >= 0 && gx < width && gy >= 0 && gy < height) {
      density[gy][gx]++;
      if (density[gy][gx] > maxDensity) maxDensity = density[gy][gx];
    }
  }

  if (maxDensity === 0) return density;

  // Quantize density to output states using log scale (better dynamic range)
  const logMax = Math.log(maxDensity + 1);
  const maxState = Math.max(quantize - 1, 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (density[y][x] > 0) {
        const logVal = Math.log(density[y][x] + 1) / logMax;
        density[y][x] = Math.max(1, Math.round(logVal * maxState));
      }
    }
  }

  return density;
}

// --- Julia Set Fractal ---
export function evolveJulia(genome: Genome): number[][] {
  const rule = genome.rule as JuliaRule;
  const { width, height } = genome;
  const { cReal, cImag, maxIter, zoom, centerX, centerY, quantize, escape } = rule;
  const escSq = escape * escape;
  const maxState = Math.max(quantize - 1, 1);

  const grid: number[][] = [];
  const aspect = width / height / 2; // /2 because chars are ~2x tall as wide

  for (let py = 0; py < height; py++) {
    const row = new Array(width).fill(0);
    for (let px = 0; px < width; px++) {
      // Map pixel to complex plane
      let zr = centerX + (px / width - 0.5) * (4 / zoom) * aspect;
      let zi = centerY + (py / height - 0.5) * (4 / zoom);

      let iter = 0;
      while (iter < maxIter && zr * zr + zi * zi < escSq) {
        const tmp = zr * zr - zi * zi + cReal;
        zi = 2 * zr * zi + cImag;
        zr = tmp;
        iter++;
      }

      if (iter === maxIter) {
        // Inside the set
        row[px] = maxState;
      } else {
        // Smooth coloring using log escape
        const smooth = iter + 1 - Math.log(Math.log(Math.sqrt(zr * zr + zi * zi))) / Math.log(2);
        const t = Math.max(0, Math.min(1, smooth / maxIter));
        row[px] = Math.round(t * maxState);
      }
    }
    grid.push(row);
  }

  return grid;
}

// --- Fractal Noise (value noise with octave stacking + domain warping) ---
export function evolveNoise(genome: Genome): number[][] {
  const rule = genome.rule as NoiseRule;
  const { width, height } = genome;
  const rng = mulberry32(genome.seed);
  const { scale, octaves, persistence, lacunarity, quantize, offsetX, offsetY, warp } = rule;
  const maxState = Math.max(quantize - 1, 1);

  // Build a permutation table for value noise (seeded)
  const PERM_SIZE = 256;
  const perm = new Array(PERM_SIZE);
  for (let i = 0; i < PERM_SIZE; i++) perm[i] = i;
  for (let i = PERM_SIZE - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  // Double the table to avoid modular wrapping
  const p = [...perm, ...perm];

  // Random gradient vectors for each hash
  const gradX = new Array(PERM_SIZE);
  const gradY = new Array(PERM_SIZE);
  for (let i = 0; i < PERM_SIZE; i++) {
    const angle = rng() * Math.PI * 2;
    gradX[i] = Math.cos(angle);
    gradY[i] = Math.sin(angle);
  }

  function fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
  }

  function lerp(a: number, b: number, t: number): number {
    return a + t * (b - a);
  }

  function gradientNoise(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = fade(xf);
    const v = fade(yf);

    const aa = p[p[xi] + yi];
    const ab = p[p[xi] + yi + 1];
    const ba = p[p[xi + 1] + yi];
    const bb = p[p[xi + 1] + yi + 1];

    const dot = (hash: number, fx: number, fy: number) =>
      gradX[hash % PERM_SIZE] * fx + gradY[hash % PERM_SIZE] * fy;

    const x1 = lerp(dot(aa, xf, yf), dot(ba, xf - 1, yf), u);
    const x2 = lerp(dot(ab, xf, yf - 1), dot(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  // Fractal Brownian Motion: stack octaves of noise
  function fbm(x: number, y: number): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmp = 0;

    for (let o = 0; o < octaves; o++) {
      value += gradientNoise(x * frequency, y * frequency) * amplitude;
      maxAmp += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return value / maxAmp; // normalize to roughly [-1, 1]
  }

  const grid: number[][] = [];
  for (let py = 0; py < height; py++) {
    const row = new Array(width).fill(0);
    for (let px = 0; px < width; px++) {
      let nx = (px + offsetX) * scale;
      let ny = (py + offsetY) * scale;

      // Domain warping: distort coordinates using noise itself
      if (warp > 0) {
        const wx = fbm(nx + 5.2, ny + 1.3) * warp;
        const wy = fbm(nx + 1.7, ny + 9.2) * warp;
        nx += wx * 10;
        ny += wy * 10;
      }

      const n = fbm(nx, ny);
      // Map from [-1,1] to [0, maxState]
      const t = Math.max(0, Math.min(1, (n + 1) / 2));
      row[px] = Math.round(t * maxState);
    }
    grid.push(row);
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
  if (total === 0) return { complexity: 0, symmetry: 0, density: 0, novelty: 0, edgeActivity: 0, structuralInterest: 0 };

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

// Epoch system: aesthetic pressure shifts every 10 generations
// Each epoch emphasizes different qualities, preventing stagnation
export type Epoch = "emergence" | "order" | "chaos" | "harmony";

export function getEpoch(generation: number): Epoch {
  const epochs: Epoch[] = ["emergence", "order", "chaos", "harmony"];
  return epochs[Math.floor(generation / 10) % epochs.length];
}

export function getEpochDescription(epoch: Epoch): string {
  switch (epoch) {
    case "emergence": return "Favoring structural complexity and novel forms";
    case "order": return "Seeking symmetry, pattern, and balance";
    case "chaos": return "Rewarding edge activity and high entropy";
    case "harmony": return "Balancing density, structure, and uniqueness";
  }
}

export function computeScore(metrics: PieceMetrics, generation?: number, genomeType?: Genome["type"]): number {
  // Type-aware density scoring — each type has a different "ideal" density
  // Previously, the universal 40% peak heavily favored 2D Life-like automata
  const idealDensity = getIdealDensity(genomeType);
  const densityScore = idealDensity === null
    ? Math.min(metrics.complexity / 2, 1) // full-coverage types: reward state variety
    : 1 - Math.abs(metrics.density - idealDensity) * (2 / Math.max(idealDensity, 1 - idealDensity));
  const complexityScore = Math.min(metrics.complexity / 2, 1);
  // Symmetry scaled per type — naturally symmetric types get less bonus for it
  const symScale = getSymmetryScale(genomeType);
  const symmetryBonus = metrics.symmetry * symScale;
  const edgeScore = metrics.edgeActivity;
  const structureScore = metrics.structuralInterest ?? 0;
  const noveltyScore = metrics.novelty;

  // Base weights — type-aware adjustments blend with epoch modifiers
  let w = getTypeWeights(genomeType);

  // Epoch modifiers — shift emphasis over time
  if (generation !== undefined) {
    const epoch = getEpoch(generation);
    const ew = getEpochWeights(epoch);
    // Blend: 60% type-specific, 40% epoch pressure
    w = {
      density: w.density * 0.6 + ew.density * 0.4,
      complexity: w.complexity * 0.6 + ew.complexity * 0.4,
      symmetry: w.symmetry * 0.6 + ew.symmetry * 0.4,
      edge: w.edge * 0.6 + ew.edge * 0.4,
      structure: w.structure * 0.6 + ew.structure * 0.4,
      novelty: w.novelty * 0.6 + ew.novelty * 0.4,
    };
  }

  return (
    densityScore * w.density +
    complexityScore * w.complexity +
    symmetryBonus * w.symmetry +
    edgeScore * w.edge +
    structureScore * w.structure +
    noveltyScore * w.novelty
  );
}

type Weights = { density: number; complexity: number; symmetry: number; edge: number; structure: number; novelty: number };

// Ideal density per type — null means full-coverage (score by state diversity)
function getIdealDensity(genomeType?: Genome["type"]): number | null {
  switch (genomeType) {
    case "1d": return 0.45;              // rows fill from top, moderate fill is good
    case "2d": return 0.4;               // classic sweet spot for life-like
    case "lsystem": return 0.2;          // sparse fractal branching is beautiful
    case "reaction-diffusion": return 0.5; // organic blobs want medium coverage
    case "voronoi": return null;          // always full — score by variety
    case "wfc": return null;              // always full — score by variety
    case "spirograph": return 0.15;       // thin elegant curves
    case "attractor": return 0.25;        // organic density clusters
    case "julia": return null;             // full coverage — score by state variety
    case "noise": return null;              // full coverage — score by state variety
    default: return 0.4;
  }
}

// Symmetry scaling per type — types that are inherently symmetric shouldn't
// get as much bonus for it (the bonus is already "baked in")
function getSymmetryScale(genomeType?: Genome["type"]): number {
  switch (genomeType) {
    case "spirograph": return 0.15;       // parametric curves are naturally symmetric
    case "attractor": return 0.35;        // attractors can have emergent symmetry
    case "voronoi": return 0.4;           // structured but not inherently symmetric
    case "wfc": return 0.25;              // symmetry mode already baked into genome
    case "lsystem": return 0.35;          // partial symmetry from branching
    case "julia": return 0.2;             // Julia sets have inherent symmetry
    case "noise": return 0.4;              // noise can have emergent symmetry from warping
    default: return 0.3;                  // original scale
  }
}

// Type-specific weight profiles — reward what makes each type interesting
function getTypeWeights(genomeType?: Genome["type"]): Weights {
  switch (genomeType) {
    case "1d":
      // 1D automata: complexity classes (Class 3/4) are most interesting
      return { density: 0.15, complexity: 0.3, symmetry: 0.05, edge: 0.2, structure: 0.15, novelty: 0.15 };
    case "lsystem":
      // L-systems: structural beauty, fractal complexity, moderate density
      return { density: 0.1, complexity: 0.25, symmetry: 0.15, edge: 0.1, structure: 0.25, novelty: 0.15 };
    case "reaction-diffusion":
      // RD: organic textures, edge patterns, complexity of Turing patterns
      return { density: 0.15, complexity: 0.25, symmetry: 0.05, edge: 0.25, structure: 0.15, novelty: 0.15 };
    case "voronoi":
      // Voronoi: edge patterns and structural variety matter most
      return { density: 0.1, complexity: 0.2, symmetry: 0.1, edge: 0.25, structure: 0.2, novelty: 0.15 };
    case "wfc":
      // WFC: constraint-based structure, local patterns, complexity
      return { density: 0.1, complexity: 0.25, symmetry: 0.15, edge: 0.2, structure: 0.15, novelty: 0.15 };
    case "spirograph":
      // Spirographs: symmetry and complexity of overlapping curves
      return { density: 0.1, complexity: 0.25, symmetry: 0.2, edge: 0.15, structure: 0.15, novelty: 0.15 };
    case "attractor":
      // Attractors: complex organic structure, density variation, novelty
      return { density: 0.15, complexity: 0.25, symmetry: 0.1, edge: 0.15, structure: 0.2, novelty: 0.15 };
    case "julia":
      // Julia sets: complexity of boundary detail, edge activity, structural variety
      return { density: 0.1, complexity: 0.25, symmetry: 0.1, edge: 0.2, structure: 0.2, novelty: 0.15 };
    case "noise":
      // Noise: organic textures, structural interest from domain warping, complexity
      return { density: 0.1, complexity: 0.25, symmetry: 0.1, edge: 0.15, structure: 0.25, novelty: 0.15 };
    case "2d":
    default:
      return { density: 0.2, complexity: 0.2, symmetry: 0.1, edge: 0.15, structure: 0.15, novelty: 0.2 };
  }
}

function getEpochWeights(epoch: Epoch): Weights {
  switch (epoch) {
    case "emergence":
      return { density: 0.15, complexity: 0.25, symmetry: 0.05, edge: 0.15, structure: 0.2, novelty: 0.2 };
    case "order":
      return { density: 0.2, complexity: 0.15, symmetry: 0.25, edge: 0.1, structure: 0.1, novelty: 0.2 };
    case "chaos":
      return { density: 0.15, complexity: 0.25, symmetry: 0.05, edge: 0.25, structure: 0.1, novelty: 0.2 };
    case "harmony":
      return { density: 0.2, complexity: 0.2, symmetry: 0.1, edge: 0.15, structure: 0.15, novelty: 0.2 };
  }
}

// --- Mutation ---
export function mutateGenome(genome: Genome, rng: () => number): Genome {
  const mutated = JSON.parse(JSON.stringify(genome)) as Genome;
  mutated.seed = Math.floor(rng() * 2 ** 32);
  mutated.mutations++;
  mutated.lineage = [...genome.lineage, genome.seed.toString(16)];

  // Rare type-swap mutation (5%) — introduces fresh genome types into the population
  if (rng() < 0.05) {
    const types: Genome["type"][] = ["1d", "2d", "lsystem", "reaction-diffusion", "voronoi", "wfc", "spirograph", "attractor", "julia", "noise"];
    return randomGenomeOfType(
      types[Math.floor(rng() * types.length)],
      rng,
      mutated.lineage
    );
  }

  if (mutated.type === "1d") {
    const rule = mutated.rule as Rule1D;
    if (rule.states <= 2) {
      // Binary: flip 1-3 bits in the rule number
      const flips = Math.ceil(rng() * 3);
      for (let i = 0; i < flips; i++) {
        rule.number ^= 1 << Math.floor(rng() * 8);
      }
      rule.number = rule.number & 0xff;
      // 10% chance to upgrade to 3-state totalistic
      if (rng() < 0.1) {
        rule.states = 3;
        rule.number = Math.floor(rng() * 2187); // 3^7
      }
    } else {
      // Totalistic: tweak one trit position
      const pos = Math.floor(rng() * 7);
      const currentTrit = Math.floor(rule.number / (3 ** pos)) % 3;
      const newTrit = (currentTrit + 1 + Math.floor(rng() * 2)) % 3;
      rule.number = rule.number - currentTrit * (3 ** pos) + newTrit * (3 ** pos);
      rule.number = Math.max(0, Math.min(2186, rule.number));
    }
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
  } else if (mutated.type === "reaction-diffusion") {
    const rule = mutated.rule as ReactionDiffusionRule;
    // Perturb feed/kill rates slightly — these are very sensitive
    const param = rng();
    if (param < 0.3) {
      rule.feed = Math.max(0.01, Math.min(0.1, rule.feed + (rng() - 0.5) * 0.01));
    } else if (param < 0.6) {
      rule.kill = Math.max(0.04, Math.min(0.08, rule.kill + (rng() - 0.5) * 0.005));
    } else if (param < 0.8) {
      rule.Du = Math.max(0.1, Math.min(0.3, rule.Du + (rng() - 0.5) * 0.02));
      rule.Dv = Math.max(0.03, Math.min(0.1, rule.Dv + (rng() - 0.5) * 0.01));
    } else {
      rule.steps = Math.max(500, Math.min(3000, rule.steps + Math.floor((rng() - 0.5) * 400)));
    }
    // Occasionally change quantization
    if (rng() < 0.15) {
      rule.quantize = 3 + Math.floor(rng() * 6); // 3-8 states
    }
  } else if (mutated.type === "voronoi") {
    const rule = mutated.rule as VoronoiRule;
    const param = rng();
    if (param < 0.35) {
      // Adjust seed count
      rule.seeds = Math.max(5, Math.min(40, rule.seeds + Math.floor((rng() - 0.5) * 8)));
    } else if (param < 0.6) {
      // Change mode
      const modes: VoronoiRule["mode"][] = ["regions", "edges", "gradient", "dual"];
      rule.mode = modes[Math.floor(rng() * modes.length)];
    } else if (param < 0.8) {
      // Change metric
      const metrics: VoronoiRule["metric"][] = ["euclidean", "manhattan", "chebyshev"];
      rule.metric = metrics[Math.floor(rng() * metrics.length)];
    } else {
      // Adjust jitter
      rule.jitter = Math.max(0, Math.min(1, rule.jitter + (rng() - 0.5) * 0.3));
    }
  } else if (mutated.type === "wfc") {
    const rule = mutated.rule as WFCRule;
    const param = rng();
    if (param < 0.25) {
      // Flip one adjacency connection
      const tile = Math.floor(rng() * rule.tileCount);
      const neighbor = Math.floor(rng() * rule.tileCount);
      const idx = rule.adjacency[tile].indexOf(neighbor);
      if (idx >= 0) {
        rule.adjacency[tile].splice(idx, 1);
        if (rule.adjacency[tile].length === 0) rule.adjacency[tile] = [tile]; // self-connection fallback
      } else {
        rule.adjacency[tile].push(neighbor);
      }
    } else if (param < 0.5) {
      // Perturb weights
      const tile = Math.floor(rng() * rule.tileCount);
      rule.weights[tile] = Math.max(0.1, rule.weights[tile] + (rng() - 0.5) * 0.5);
    } else if (param < 0.7) {
      // Change symmetry
      const syms: WFCRule["symmetry"][] = ["none", "horizontal", "vertical", "quad"];
      rule.symmetry = syms[Math.floor(rng() * syms.length)];
    } else {
      // Add or remove a tile (within 3-8 range)
      if (rng() > 0.5 && rule.tileCount < 8) {
        rule.tileCount++;
        // New tile connects to 2-4 random existing tiles
        const connections = Array.from({ length: 2 + Math.floor(rng() * 3) }, () =>
          Math.floor(rng() * rule.tileCount)
        );
        rule.adjacency.push([...new Set(connections)]);
        rule.weights.push(0.5 + rng());
        // Let some existing tiles connect back
        for (let i = 0; i < rule.tileCount - 1; i++) {
          if (rng() < 0.4) rule.adjacency[i].push(rule.tileCount - 1);
        }
      } else if (rule.tileCount > 3) {
        const removed = rule.tileCount - 1;
        rule.tileCount--;
        rule.adjacency.pop();
        rule.weights.pop();
        // Clean up references to removed tile
        for (let i = 0; i < rule.tileCount; i++) {
          rule.adjacency[i] = rule.adjacency[i].filter(t => t < rule.tileCount);
          if (rule.adjacency[i].length === 0) rule.adjacency[i] = [i];
        }
      }
    }
  } else if (mutated.type === "spirograph") {
    const rule = mutated.rule as SpirographRule;
    const param = rng();
    if (param < 0.4) {
      // Perturb a layer's parameters
      const li = Math.floor(rng() * rule.layers.length);
      const layer = rule.layers[li];
      const which = rng();
      if (which < 0.3) {
        layer.R = Math.max(1, Math.min(10, layer.R + (rng() - 0.5) * 2));
      } else if (which < 0.6) {
        layer.r = Math.max(0.1, Math.min(8, layer.r + (rng() - 0.5) * 1.5));
      } else {
        layer.d = Math.max(0.1, Math.min(8, layer.d + (rng() - 0.5) * 1.5));
      }
    } else if (param < 0.55) {
      // Flip a layer's mode
      const li = Math.floor(rng() * rule.layers.length);
      rule.layers[li].mode = rule.layers[li].mode === "hypo" ? "epi" : "hypo";
    } else if (param < 0.7) {
      // Add or remove a layer (1-4 range)
      if (rng() > 0.5 && rule.layers.length < 4) {
        rule.layers.push({
          R: 2 + rng() * 6,
          r: 0.5 + rng() * 4,
          d: 0.5 + rng() * 4,
          mode: rng() > 0.5 ? "hypo" : "epi",
        });
      } else if (rule.layers.length > 1) {
        rule.layers.splice(Math.floor(rng() * rule.layers.length), 1);
      }
    } else if (param < 0.85) {
      // Adjust rotation offset
      rule.rotationOffset = (rule.rotationOffset + (rng() - 0.5) * 60 + 360) % 360;
    } else {
      // Adjust thickness
      rule.thickness = Math.max(0, Math.min(2, Math.round(rule.thickness + (rng() > 0.5 ? 1 : -1))));
    }
  } else if (mutated.type === "attractor") {
    const rule = mutated.rule as AttractorRule;
    const param = rng();
    if (param < 0.5) {
      // Perturb one of the 4 parameters
      const which = Math.floor(rng() * 4);
      const keys: (keyof Pick<AttractorRule, "a" | "b" | "c" | "d">)[] = ["a", "b", "c", "d"];
      rule[keys[which]] = Math.max(-3, Math.min(3, rule[keys[which]] + (rng() - 0.5) * 0.4));
    } else if (param < 0.7) {
      // Switch variant
      rule.variant = rule.variant === "clifford" ? "dejong" : "clifford";
    } else if (param < 0.85) {
      // Adjust iterations
      rule.iterations = Math.max(50000, Math.min(500000, rule.iterations + Math.floor((rng() - 0.5) * 100000)));
    } else {
      // Adjust quantization
      rule.quantize = 3 + Math.floor(rng() * 6); // 3-8
    }
  } else if (mutated.type === "julia") {
    const rule = mutated.rule as JuliaRule;
    const param = rng();
    if (param < 0.4) {
      // Perturb c constant — small changes produce dramatic visual shifts
      const which = rng() > 0.5 ? "cReal" : "cImag";
      rule[which] = Math.max(-2, Math.min(2, rule[which] + (rng() - 0.5) * 0.15));
    } else if (param < 0.6) {
      // Adjust zoom
      rule.zoom = Math.max(0.5, Math.min(4, rule.zoom * (0.7 + rng() * 0.6)));
    } else if (param < 0.75) {
      // Shift view center
      rule.centerX = Math.max(-2, Math.min(2, rule.centerX + (rng() - 0.5) * 0.3));
      rule.centerY = Math.max(-2, Math.min(2, rule.centerY + (rng() - 0.5) * 0.3));
    } else if (param < 0.85) {
      // Adjust max iterations
      rule.maxIter = Math.max(50, Math.min(500, rule.maxIter + Math.floor((rng() - 0.5) * 80)));
    } else if (param < 0.93) {
      // Change quantization
      rule.quantize = 3 + Math.floor(rng() * 6); // 3-8
    } else {
      // Adjust escape radius
      rule.escape = Math.max(2, Math.min(10, rule.escape + (rng() - 0.5) * 2));
    }
  } else if (mutated.type === "noise") {
    const rule = mutated.rule as NoiseRule;
    const param = rng();
    if (param < 0.3) {
      // Perturb scale
      rule.scale = Math.max(0.02, Math.min(0.2, rule.scale + (rng() - 0.5) * 0.03));
    } else if (param < 0.5) {
      // Adjust octaves
      rule.octaves = Math.max(1, Math.min(6, rule.octaves + (rng() > 0.5 ? 1 : -1)));
    } else if (param < 0.65) {
      // Perturb persistence
      rule.persistence = Math.max(0.3, Math.min(0.8, rule.persistence + (rng() - 0.5) * 0.1));
    } else if (param < 0.8) {
      // Perturb lacunarity
      rule.lacunarity = Math.max(1.5, Math.min(3.0, rule.lacunarity + (rng() - 0.5) * 0.3));
    } else if (param < 0.9) {
      // Shift offset (explore different regions of noise space)
      rule.offsetX += (rng() - 0.5) * 20;
      rule.offsetY += (rng() - 0.5) * 20;
    } else {
      // Adjust domain warping
      rule.warp = Math.max(0, Math.min(2, rule.warp + (rng() - 0.5) * 0.4));
    }
    if (rng() < 0.15) {
      rule.quantize = 3 + Math.floor(rng() * 6); // 3-8 states
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
  } else if (child.type === "reaction-diffusion") {
    const ra = a.rule as ReactionDiffusionRule, rb = b.rule as ReactionDiffusionRule;
    const rule = child.rule as ReactionDiffusionRule;
    // Interpolate parameters between parents
    const t = rng();
    rule.feed = ra.feed * t + rb.feed * (1 - t);
    rule.kill = ra.kill * t + rb.kill * (1 - t);
    rule.Du = rng() > 0.5 ? ra.Du : rb.Du;
    rule.Dv = rng() > 0.5 ? ra.Dv : rb.Dv;
    rule.steps = rng() > 0.5 ? ra.steps : rb.steps;
    rule.quantize = rng() > 0.5 ? ra.quantize : rb.quantize;
  } else if (child.type === "voronoi") {
    const ra = a.rule as VoronoiRule, rb = b.rule as VoronoiRule;
    const rule = child.rule as VoronoiRule;
    rule.seeds = rng() > 0.5 ? ra.seeds : rb.seeds;
    rule.mode = rng() > 0.5 ? ra.mode : rb.mode;
    rule.metric = rng() > 0.5 ? ra.metric : rb.metric;
    rule.jitter = ra.jitter * rng() + rb.jitter * (1 - rng());
  } else if (child.type === "wfc") {
    const ra = a.rule as WFCRule, rb = b.rule as WFCRule;
    const rule = child.rule as WFCRule;
    // Use the smaller tile count and merge adjacency
    rule.tileCount = Math.min(ra.tileCount, rb.tileCount);
    rule.adjacency = [];
    rule.weights = [];
    for (let i = 0; i < rule.tileCount; i++) {
      // Union adjacency from both parents, filtered to valid range
      const combined = new Set([
        ...(ra.adjacency[i] || []),
        ...(rb.adjacency[i] || []),
      ].filter(t => t < rule.tileCount));
      if (combined.size === 0) combined.add(i);
      rule.adjacency.push([...combined].filter(() => rng() > 0.2)); // random drop
      if (rule.adjacency[i].length === 0) rule.adjacency[i] = [i];
      rule.weights.push(rng() > 0.5 ? (ra.weights[i] ?? 1) : (rb.weights[i] ?? 1));
    }
    rule.symmetry = rng() > 0.5 ? ra.symmetry : rb.symmetry;
  } else if (child.type === "spirograph") {
    const ra = a.rule as SpirographRule, rb = b.rule as SpirographRule;
    const rule = child.rule as SpirographRule;
    // Mix layers from both parents
    const allLayers = [...ra.layers, ...rb.layers];
    rule.layers = [];
    for (const layer of allLayers) {
      if (rng() > 0.4 && rule.layers.length < 4) {
        rule.layers.push({ ...layer });
      }
    }
    if (rule.layers.length === 0) rule.layers.push({ ...ra.layers[0] });
    rule.thickness = rng() > 0.5 ? ra.thickness : rb.thickness;
    rule.rotationOffset = ra.rotationOffset * rng() + rb.rotationOffset * (1 - rng());
    rule.steps = rng() > 0.5 ? ra.steps : rb.steps;
  } else if (child.type === "attractor") {
    const ra = a.rule as AttractorRule, rb = b.rule as AttractorRule;
    const rule = child.rule as AttractorRule;
    const t = rng();
    rule.a = ra.a * t + rb.a * (1 - t);
    rule.b = ra.b * t + rb.b * (1 - t);
    rule.c = rng() > 0.5 ? ra.c : rb.c;
    rule.d = rng() > 0.5 ? ra.d : rb.d;
    rule.variant = rng() > 0.5 ? ra.variant : rb.variant;
    rule.iterations = rng() > 0.5 ? ra.iterations : rb.iterations;
    rule.quantize = rng() > 0.5 ? ra.quantize : rb.quantize;
  } else if (child.type === "julia") {
    const ra = a.rule as JuliaRule, rb = b.rule as JuliaRule;
    const rule = child.rule as JuliaRule;
    const t = rng();
    rule.cReal = ra.cReal * t + rb.cReal * (1 - t);
    rule.cImag = ra.cImag * t + rb.cImag * (1 - t);
    rule.zoom = rng() > 0.5 ? ra.zoom : rb.zoom;
    rule.centerX = (ra.centerX + rb.centerX) / 2;
    rule.centerY = (ra.centerY + rb.centerY) / 2;
    rule.maxIter = rng() > 0.5 ? ra.maxIter : rb.maxIter;
    rule.quantize = rng() > 0.5 ? ra.quantize : rb.quantize;
    rule.escape = rng() > 0.5 ? ra.escape : rb.escape;
  } else if (child.type === "noise") {
    const ra = a.rule as NoiseRule, rb = b.rule as NoiseRule;
    const rule = child.rule as NoiseRule;
    const t = rng();
    rule.scale = ra.scale * t + rb.scale * (1 - t);
    rule.octaves = rng() > 0.5 ? ra.octaves : rb.octaves;
    rule.persistence = ra.persistence * t + rb.persistence * (1 - t);
    rule.lacunarity = ra.lacunarity * t + rb.lacunarity * (1 - t);
    rule.warp = ra.warp * t + rb.warp * (1 - t);
    rule.offsetX = rng() > 0.5 ? ra.offsetX : rb.offsetX;
    rule.offsetY = rng() > 0.5 ? ra.offsetY : rb.offsetY;
    rule.quantize = rng() > 0.5 ? ra.quantize : rb.quantize;
  }

  return child;
}

// Generate a random WFC genome with interesting constraint patterns
function randomWFCGenome(rng: () => number, palette: string[], seed: number, lineage: string[]): Genome {
  const tileCount = 3 + Math.floor(rng() * 5); // 3-7 tiles
  const adjacency: number[][] = [];
  const weights: number[] = [];

  // Generate adjacency with interesting structure (not fully connected, not too sparse)
  for (let i = 0; i < tileCount; i++) {
    const numAdj = 1 + Math.floor(rng() * Math.min(tileCount, 4)); // 1-4 neighbors
    const adj = new Set<number>();
    adj.add(i); // self-connection ensures tile can appear next to itself
    for (let j = 0; j < numAdj; j++) {
      adj.add(Math.floor(rng() * tileCount));
    }
    adjacency.push([...adj]);
    weights.push(0.3 + rng() * 1.5);
  }

  const syms: WFCRule["symmetry"][] = ["none", "horizontal", "vertical", "quad"];
  return {
    type: "wfc",
    rule: {
      tileCount,
      adjacency,
      weights,
      symmetry: syms[Math.floor(rng() * syms.length)],
    },
    width: 40 + Math.floor(rng() * 20),
    height: 24 + Math.floor(rng() * 12),
    palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
  };
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
  if (type === "voronoi") {
    const modes: VoronoiRule["mode"][] = ["regions", "edges", "gradient", "dual"];
    const metrics: VoronoiRule["metric"][] = ["euclidean", "manhattan", "chebyshev"];
    return {
      type: "voronoi",
      rule: {
        seeds: 8 + Math.floor(rng() * 25),
        mode: modes[Math.floor(rng() * modes.length)],
        metric: metrics[Math.floor(rng() * metrics.length)],
        jitter: rng(),
      },
      width: 48 + Math.floor(rng() * 16),
      height: 28 + Math.floor(rng() * 10),
      palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
    };
  }
  if (type === "wfc") {
    return randomWFCGenome(rng, palette, seed, lineage);
  }
  if (type === "spirograph") {
    const numLayers = 1 + Math.floor(rng() * 3); // 1-3 layers
    const layers: SpirographLayer[] = [];
    for (let i = 0; i < numLayers; i++) {
      layers.push({
        R: 2 + rng() * 6,
        r: 0.5 + rng() * 4,
        d: 0.5 + rng() * 4,
        mode: rng() > 0.5 ? "hypo" : "epi",
      });
    }
    return {
      type: "spirograph",
      rule: {
        layers,
        steps: 1000 + Math.floor(rng() * 1500),
        thickness: Math.floor(rng() * 2),
        rotationOffset: rng() * 360,
      },
      width: 48 + Math.floor(rng() * 16),
      height: 32 + Math.floor(rng() * 10),
      palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
    };
  }
  if (type === "reaction-diffusion") {
    // Known interesting parameter regions in Gray-Scott space
    const presets = [
      { feed: 0.037, kill: 0.06 },   // spots
      { feed: 0.03, kill: 0.062 },    // stripes/worms
      { feed: 0.025, kill: 0.06 },    // labyrinth
      { feed: 0.04, kill: 0.065 },    // mitosis (splitting dots)
      { feed: 0.055, kill: 0.062 },   // coral
    ];
    const preset = presets[Math.floor(rng() * presets.length)];
    return {
      type: "reaction-diffusion",
      rule: {
        feed: preset.feed + (rng() - 0.5) * 0.005,
        kill: preset.kill + (rng() - 0.5) * 0.003,
        Du: 0.16 + (rng() - 0.5) * 0.06,
        Dv: 0.08 + (rng() - 0.5) * 0.03,
        steps: 1000 + Math.floor(rng() * 1500),
        quantize: 4 + Math.floor(rng() * 4),
      },
      width: 40 + Math.floor(rng() * 16),
      height: 24 + Math.floor(rng() * 12),
      palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
    };
  }
  if (type === "attractor") {
    // Known interesting parameter ranges for beautiful attractors
    const presets = [
      { variant: "clifford" as const, a: -1.4, b: 1.6, c: 1.0, d: 0.7 },    // classic swirls
      { variant: "clifford" as const, a: 1.7, b: 1.7, c: 0.6, d: 1.2 },     // butterfly
      { variant: "dejong" as const, a: -2.0, b: -2.0, c: -1.2, d: 2.0 },     // organic loops
      { variant: "dejong" as const, a: 1.4, b: -2.3, c: 2.4, d: -2.1 },      // dense filigree
      { variant: "clifford" as const, a: -1.7, b: 1.3, c: -0.1, d: -1.2 },   // vortex
    ];
    const preset = presets[Math.floor(rng() * presets.length)];
    return {
      type: "attractor",
      rule: {
        variant: preset.variant,
        a: preset.a + (rng() - 0.5) * 0.2,
        b: preset.b + (rng() - 0.5) * 0.2,
        c: preset.c + (rng() - 0.5) * 0.2,
        d: preset.d + (rng() - 0.5) * 0.2,
        iterations: 100000 + Math.floor(rng() * 200000),
        quantize: 4 + Math.floor(rng() * 4),
      },
      width: 48 + Math.floor(rng() * 16),
      height: 28 + Math.floor(rng() * 10),
      palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
    };
  }
  if (type === "julia") {
    // Known beautiful Julia set c values
    const presets = [
      { cReal: -0.7, cImag: 0.27015 },    // classic dendrite
      { cReal: -0.8, cImag: 0.156 },       // spiral galaxies
      { cReal: 0.285, cImag: 0.01 },       // filigree
      { cReal: -0.4, cImag: 0.6 },         // rabbit ears
      { cReal: 0.355, cImag: 0.355 },      // seahorse valley
      { cReal: -0.1, cImag: 0.651 },       // dendrite tendrils
      { cReal: -1.0, cImag: 0.0 },         // basilica
      { cReal: -0.75, cImag: 0.0 },        // double spiral
    ];
    const preset = presets[Math.floor(rng() * presets.length)];
    return {
      type: "julia",
      rule: {
        cReal: preset.cReal + (rng() - 0.5) * 0.05,
        cImag: preset.cImag + (rng() - 0.5) * 0.05,
        maxIter: 100 + Math.floor(rng() * 200),
        zoom: 1 + rng() * 1.5,
        centerX: (rng() - 0.5) * 0.3,
        centerY: (rng() - 0.5) * 0.3,
        quantize: 4 + Math.floor(rng() * 4),
        escape: 2 + rng() * 3,
      },
      width: 48 + Math.floor(rng() * 16),
      height: 28 + Math.floor(rng() * 10),
      palette, seed, mutations: 0, lineage: [...lineage, "typeswap"],
    };
  }
  if (type === "noise") {
    return {
      type: "noise",
      rule: {
        scale: 0.04 + rng() * 0.12,
        octaves: 2 + Math.floor(rng() * 4),
        persistence: 0.35 + rng() * 0.4,
        lacunarity: 1.6 + rng() * 1.2,
        quantize: 4 + Math.floor(rng() * 4),
        offsetX: rng() * 100,
        offsetY: rng() * 100,
        warp: rng() * 1.5,
      },
      width: 48 + Math.floor(rng() * 16),
      height: 28 + Math.floor(rng() * 10),
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
  {
    type: "1d",
    rule: { number: 600, states: 3 }, // Totalistic 3-state — produces gradients
    width: 60,
    height: 32,
    palette: SHADE_PALETTE,
    seed: 1234,
    mutations: 0,
    lineage: [],
  },
  {
    type: "1d",
    rule: { number: 1599, states: 3 }, // Another totalistic — known interesting
    width: 56,
    height: 28,
    palette: STAR_PALETTE,
    seed: 9876,
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
  // Reaction-Diffusion (Gray-Scott)
  {
    type: "reaction-diffusion",
    rule: { feed: 0.037, kill: 0.06, Du: 0.16, Dv: 0.08, steps: 2000, quantize: 5 },
    width: 48,
    height: 28,
    palette: SHADE_PALETTE,
    seed: 3141,
    mutations: 0,
    lineage: [],
  },
  {
    type: "reaction-diffusion",
    rule: { feed: 0.03, kill: 0.062, Du: 0.16, Dv: 0.08, steps: 2500, quantize: 6 },
    width: 44,
    height: 26,
    palette: WAVE_PALETTE,
    seed: 2718,
    mutations: 0,
    lineage: [],
  },
  {
    type: "reaction-diffusion",
    rule: { feed: 0.025, kill: 0.06, Du: 0.18, Dv: 0.06, steps: 1500, quantize: 4 },
    width: 50,
    height: 30,
    palette: BOTANICAL_PALETTE,
    seed: 1618,
    mutations: 0,
    lineage: [],
  },
  // Voronoi tessellation
  {
    type: "voronoi",
    rule: { seeds: 15, mode: "dual", metric: "euclidean", jitter: 0.8 },
    width: 52,
    height: 30,
    palette: GEOMETRIC_PALETTE,
    seed: 4444,
    mutations: 0,
    lineage: [],
  },
  {
    type: "voronoi",
    rule: { seeds: 25, mode: "edges", metric: "manhattan", jitter: 1.0 },
    width: 56,
    height: 32,
    palette: BRAILLE_PALETTE,
    seed: 5555,
    mutations: 0,
    lineage: [],
  },
  {
    type: "voronoi",
    rule: { seeds: 10, mode: "gradient", metric: "chebyshev", jitter: 0.5 },
    width: 48,
    height: 28,
    palette: SHADE_PALETTE,
    seed: 6666,
    mutations: 0,
    lineage: [],
  },
  // Wave Function Collapse
  {
    type: "wfc",
    rule: {
      tileCount: 5,
      adjacency: [[0,1],[0,1,2],[1,2,3],[2,3,4],[3,4]], // gradient chain
      weights: [1, 1.2, 1, 1.2, 1],
      symmetry: "horizontal",
    },
    width: 48,
    height: 28,
    palette: SHADE_PALETTE,
    seed: 7777,
    mutations: 0,
    lineage: [],
  },
  {
    type: "wfc",
    rule: {
      tileCount: 4,
      adjacency: [[0,1,3],[0,1,2],[1,2,3],[0,2,3]], // fully connected minus diagonals
      weights: [0.5, 1.5, 1.5, 0.5],
      symmetry: "quad",
    },
    width: 44,
    height: 28,
    palette: GEOMETRIC_PALETTE,
    seed: 8080,
    mutations: 0,
    lineage: [],
  },
  {
    type: "wfc",
    rule: {
      tileCount: 6,
      adjacency: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0]], // ring topology
      weights: [1, 0.8, 1.2, 0.8, 1.0, 1.1],
      symmetry: "none",
    },
    width: 52,
    height: 30,
    palette: STAR_PALETTE,
    seed: 9090,
    mutations: 0,
    lineage: [],
  },
  // Spirograph (parametric curves)
  {
    type: "spirograph",
    rule: {
      layers: [
        { R: 5, r: 3, d: 2.5, mode: "hypo" as const },
      ],
      steps: 2000,
      thickness: 1,
      rotationOffset: 0,
    },
    width: 52,
    height: 34,
    palette: GEOMETRIC_PALETTE,
    seed: 1111,
    mutations: 0,
    lineage: [],
  },
  {
    type: "spirograph",
    rule: {
      layers: [
        { R: 7, r: 2, d: 3, mode: "epi" as const },
        { R: 5, r: 3, d: 1.5, mode: "hypo" as const },
      ],
      steps: 1500,
      thickness: 0,
      rotationOffset: 45,
    },
    width: 56,
    height: 36,
    palette: STAR_PALETTE,
    seed: 2222,
    mutations: 0,
    lineage: [],
  },
  {
    type: "spirograph",
    rule: {
      layers: [
        { R: 8, r: 5, d: 4, mode: "hypo" as const },
        { R: 6, r: 1, d: 5, mode: "epi" as const },
        { R: 4, r: 3, d: 2, mode: "hypo" as const },
      ],
      steps: 2500,
      thickness: 1,
      rotationOffset: 30,
    },
    width: 60,
    height: 38,
    palette: WAVE_PALETTE,
    seed: 3333,
    mutations: 0,
    lineage: [],
  },
  // Strange Attractors (Clifford / De Jong)
  {
    type: "attractor",
    rule: { variant: "clifford", a: -1.4, b: 1.6, c: 1.0, d: 0.7, iterations: 200000, quantize: 6 },
    width: 52,
    height: 32,
    palette: SHADE_PALETTE,
    seed: 10101,
    mutations: 0,
    lineage: [],
  },
  {
    type: "attractor",
    rule: { variant: "dejong", a: -2.0, b: -2.0, c: -1.2, d: 2.0, iterations: 150000, quantize: 5 },
    width: 48,
    height: 30,
    palette: BRAILLE_PALETTE,
    seed: 20202,
    mutations: 0,
    lineage: [],
  },
  {
    type: "attractor",
    rule: { variant: "clifford", a: 1.7, b: 1.7, c: 0.6, d: 1.2, iterations: 250000, quantize: 7 },
    width: 56,
    height: 34,
    palette: STAR_PALETTE,
    seed: 30303,
    mutations: 0,
    lineage: [],
  },
  // Julia Set Fractals
  {
    type: "julia",
    rule: { cReal: -0.7, cImag: 0.27015, maxIter: 150, zoom: 1.2, centerX: 0, centerY: 0, quantize: 6, escape: 4 },
    width: 52,
    height: 30,
    palette: SHADE_PALETTE,
    seed: 40404,
    mutations: 0,
    lineage: [],
  },
  {
    type: "julia",
    rule: { cReal: -0.8, cImag: 0.156, maxIter: 200, zoom: 1.5, centerX: 0, centerY: 0, quantize: 7, escape: 3 },
    width: 56,
    height: 32,
    palette: STAR_PALETTE,
    seed: 50505,
    mutations: 0,
    lineage: [],
  },
  {
    type: "julia",
    rule: { cReal: 0.285, cImag: 0.01, maxIter: 250, zoom: 1.0, centerX: 0, centerY: 0, quantize: 5, escape: 4 },
    width: 48,
    height: 28,
    palette: WAVE_PALETTE,
    seed: 60606,
    mutations: 0,
    lineage: [],
  },
  // Fractal Noise (value noise + domain warping)
  {
    type: "noise",
    rule: { scale: 0.06, octaves: 4, persistence: 0.5, lacunarity: 2.0, quantize: 6, offsetX: 0, offsetY: 0, warp: 0.5 },
    width: 52,
    height: 30,
    palette: SHADE_PALETTE,
    seed: 70707,
    mutations: 0,
    lineage: [],
  },
  {
    type: "noise",
    rule: { scale: 0.1, octaves: 3, persistence: 0.65, lacunarity: 2.5, quantize: 5, offsetX: 42, offsetY: 17, warp: 1.2 },
    width: 56,
    height: 32,
    palette: WAVE_PALETTE,
    seed: 80808,
    mutations: 0,
    lineage: [],
  },
  {
    type: "noise",
    rule: { scale: 0.04, octaves: 5, persistence: 0.45, lacunarity: 1.8, quantize: 7, offsetX: -30, offsetY: 55, warp: 0 },
    width: 48,
    height: 28,
    palette: BRAILLE_PALETTE,
    seed: 90909,
    mutations: 0,
    lineage: [],
  },
];
