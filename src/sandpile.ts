/**
 * Lattice — Abelian Sandpile Engine
 *
 * The Abelian sandpile model: drop grains of sand onto a grid. When any cell
 * accumulates ≥ threshold grains, it "topples" — distributing one grain to each
 * cardinal neighbor. This creates cascading avalanches that produce stunning
 * fractal patterns with perfect 4-fold symmetry.
 *
 * The identity element of the sandpile group is one of the most beautiful
 * mathematical objects ever discovered — pure fractal geometry emerging from
 * the simplest possible rules.
 */

export interface SandpileRule {
  initialHeight: number;       // grains dropped at center (1000-100000)
  threshold: number;           // topple threshold (4 = classic, 3-8 for variants)
  dropPattern: "center" | "cross" | "ring" | "random" | "line";
  dropCount: number;           // number of drop points for non-center patterns (2-8)
  boundary: "open" | "closed"; // open = grains fall off edge, closed = wrap
  quantize: number;            // output states (3-8)
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

interface SandpileGenome {
  type: "sandpile";
  rule: SandpileRule;
  width: number;
  height: number;
  palette: string[];
  seed: number;
  mutations: number;
  lineage: string[];
}

/**
 * Run an Abelian sandpile simulation and return a quantized grid.
 *
 * The simulation uses a flat Int32Array for performance. Toppling is done
 * iteratively until the pile stabilizes (no cell ≥ threshold).
 */
export function evolveSandpile(genome: SandpileGenome): number[][] {
  const { width, height } = genome;
  const rule = genome.rule as SandpileRule;
  const rng = mulberry32(genome.seed);

  // Use higher internal resolution for detail
  const iw = width * 2;
  const ih = height * 2;
  const pile = new Int32Array(iw * ih);

  // Drop grains according to pattern
  dropGrains(pile, iw, ih, rule, rng);

  // Topple until stable
  stabilize(pile, iw, ih, rule.threshold, rule.boundary);

  // Downsample to output resolution and quantize
  const grid: number[][] = [];
  const q = Math.max(2, rule.quantize);

  // Find max value for normalization
  let maxVal = 0;
  for (let i = 0; i < pile.length; i++) {
    if (pile[i] > maxVal) maxVal = pile[i];
  }
  if (maxVal === 0) maxVal = 1;

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      // Average 2x2 block
      const sx = x * 2, sy = y * 2;
      const avg = (
        pile[sy * iw + sx] +
        pile[sy * iw + sx + 1] +
        pile[(sy + 1) * iw + sx] +
        pile[(sy + 1) * iw + sx + 1]
      ) / 4;

      // For classic threshold=4, the final state has values 0-3
      // Map directly to quantized output
      if (rule.threshold === 4 && rule.boundary === "open") {
        // Direct state mapping preserves the fractal structure
        const state = Math.round(avg);
        row.push(Math.min(state, q - 1));
      } else {
        // Normalized mapping for non-classic configurations
        const norm = avg / Math.max(maxVal, 1);
        row.push(Math.min(Math.floor(norm * q), q - 1));
      }
    }
    grid.push(row);
  }

  return grid;
}

function dropGrains(
  pile: Int32Array, w: number, h: number,
  rule: SandpileRule, rng: () => number
): void {
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const grains = rule.initialHeight;

  switch (rule.dropPattern) {
    case "center":
      pile[cy * w + cx] = grains;
      break;

    case "cross": {
      const arm = Math.floor(Math.min(w, h) / 6);
      const perPoint = Math.floor(grains / (1 + 4 * arm));
      pile[cy * w + cx] = perPoint;
      for (let i = 1; i <= arm; i++) {
        pile[cy * w + (cx + i)] = perPoint;
        pile[cy * w + (cx - i)] = perPoint;
        pile[(cy + i) * w + cx] = perPoint;
        pile[(cy - i) * w + cx] = perPoint;
      }
      break;
    }

    case "ring": {
      const radius = Math.floor(Math.min(w, h) / 5);
      const points = Math.max(8, rule.dropCount * 4);
      const perPoint = Math.floor(grains / points);
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const px = cx + Math.round(radius * Math.cos(angle));
        const py = cy + Math.round(radius * Math.sin(angle));
        if (px >= 0 && px < w && py >= 0 && py < h) {
          pile[py * w + px] += perPoint;
        }
      }
      break;
    }

    case "random": {
      const count = Math.max(2, rule.dropCount);
      const perPoint = Math.floor(grains / count);
      for (let i = 0; i < count; i++) {
        const px = Math.floor(rng() * w);
        const py = Math.floor(rng() * h);
        pile[py * w + px] += perPoint;
      }
      break;
    }

    case "line": {
      const len = Math.floor(w / 3);
      const perPoint = Math.floor(grains / len);
      const startX = cx - Math.floor(len / 2);
      for (let i = 0; i < len; i++) {
        const px = startX + i;
        if (px >= 0 && px < w) {
          pile[cy * w + px] += perPoint;
        }
      }
      break;
    }
  }
}

/**
 * Topple the sandpile until stable. Uses an iterative approach with a
 * worklist for efficiency — only re-checks cells that might have changed.
 */
function stabilize(
  pile: Int32Array, w: number, h: number,
  threshold: number, boundary: "open" | "closed"
): void {
  const maxIter = 10_000_000; // safety cap
  let iterations = 0;

  // Initial pass: find all unstable cells
  const queue: number[] = [];
  for (let i = 0; i < pile.length; i++) {
    if (pile[i] >= threshold) queue.push(i);
  }

  while (queue.length > 0 && iterations < maxIter) {
    const idx = queue.pop()!;
    if (pile[idx] < threshold) continue;

    const x = idx % w;
    const y = Math.floor(idx / w);

    // Topple: remove threshold grains, add 1 to each neighbor
    pile[idx] -= threshold;
    iterations++;

    // Cardinal neighbors
    const neighbors: number[] = [];

    if (boundary === "closed") {
      // Wrap around edges
      neighbors.push(y * w + ((x + 1) % w));
      neighbors.push(y * w + ((x - 1 + w) % w));
      neighbors.push(((y + 1) % h) * w + x);
      neighbors.push(((y - 1 + h) % h) * w + x);
    } else {
      // Open: grains at edge fall off (disappear)
      if (x + 1 < w) neighbors.push(y * w + x + 1);
      if (x - 1 >= 0) neighbors.push(y * w + x - 1);
      if (y + 1 < h) neighbors.push((y + 1) * w + x);
      if (y - 1 >= 0) neighbors.push((y - 1) * w + x);
    }

    for (const ni of neighbors) {
      pile[ni]++;
      if (pile[ni] >= threshold) {
        queue.push(ni);
      }
    }

    // Re-check current cell
    if (pile[idx] >= threshold) {
      queue.push(idx);
    }
  }
}

// --- Mutation ---
export function mutateSandpile(rule: SandpileRule, rng: () => number): SandpileRule {
  const mutated = { ...rule };

  const field = rng();
  if (field < 0.25) {
    // Mutate initial height ±20%
    const factor = 0.8 + rng() * 0.4;
    mutated.initialHeight = Math.max(500, Math.round(mutated.initialHeight * factor));
  } else if (field < 0.4) {
    // Mutate threshold (rare, dramatic effect)
    const thresholds = [3, 4, 5, 6, 8];
    mutated.threshold = thresholds[Math.floor(rng() * thresholds.length)];
  } else if (field < 0.6) {
    // Mutate drop pattern
    const patterns: SandpileRule["dropPattern"][] = ["center", "cross", "ring", "random", "line"];
    mutated.dropPattern = patterns[Math.floor(rng() * patterns.length)];
  } else if (field < 0.75) {
    // Mutate boundary condition
    mutated.boundary = mutated.boundary === "open" ? "closed" : "open";
  } else if (field < 0.85) {
    // Mutate drop count
    mutated.dropCount = Math.max(2, Math.min(8, mutated.dropCount + Math.floor(rng() * 3) - 1));
  } else {
    // Mutate quantize
    mutated.quantize = 3 + Math.floor(rng() * 6);
  }

  return mutated;
}

// --- Crossover ---
export function crossoverSandpile(a: SandpileRule, b: SandpileRule, rng: () => number): SandpileRule {
  const t = rng();
  return {
    initialHeight: Math.round(a.initialHeight * t + b.initialHeight * (1 - t)),
    threshold: rng() > 0.5 ? a.threshold : b.threshold,
    dropPattern: rng() > 0.5 ? a.dropPattern : b.dropPattern,
    dropCount: rng() > 0.5 ? a.dropCount : b.dropCount,
    boundary: rng() > 0.5 ? a.boundary : b.boundary,
    quantize: rng() > 0.5 ? a.quantize : b.quantize,
  };
}

// --- Random genome generation ---
export function randomSandpileRule(rng: () => number): SandpileRule {
  const patterns: SandpileRule["dropPattern"][] = ["center", "cross", "ring", "random", "line"];
  const presets = [
    { initialHeight: 10000, threshold: 4, dropPattern: "center" as const },
    { initialHeight: 50000, threshold: 4, dropPattern: "center" as const },
    { initialHeight: 20000, threshold: 4, dropPattern: "cross" as const },
    { initialHeight: 15000, threshold: 3, dropPattern: "center" as const },
    { initialHeight: 30000, threshold: 6, dropPattern: "ring" as const },
    { initialHeight: 25000, threshold: 4, dropPattern: "random" as const },
  ];
  const preset = presets[Math.floor(rng() * presets.length)];
  return {
    initialHeight: preset.initialHeight + Math.floor((rng() - 0.5) * preset.initialHeight * 0.3),
    threshold: preset.threshold,
    dropPattern: preset.dropPattern,
    dropCount: 2 + Math.floor(rng() * 5),
    boundary: rng() > 0.7 ? "closed" : "open",
    quantize: 4 + Math.floor(rng() * 4),
  };
}

// --- Seed genomes ---
export const SANDPILE_SEED_GENOMES_PARTIAL = [
  {
    rule: { initialHeight: 10000, threshold: 4, dropPattern: "center" as const, dropCount: 1, boundary: "open" as const, quantize: 4 },
    width: 52, height: 32, palette: "SHADE_PALETTE",
  },
  {
    rule: { initialHeight: 50000, threshold: 4, dropPattern: "center" as const, dropCount: 1, boundary: "open" as const, quantize: 5 },
    width: 56, height: 34, palette: "GEOMETRIC_PALETTE",
  },
  {
    rule: { initialHeight: 20000, threshold: 4, dropPattern: "cross" as const, dropCount: 4, boundary: "open" as const, quantize: 6 },
    width: 48, height: 30, palette: "BRAILLE_PALETTE",
  },
];
