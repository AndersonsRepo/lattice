/**
 * Lattice — Turmite Engine
 *
 * Generalized Langton's Ant: a 2D Turing machine that walks on a grid,
 * reading cell colors and following state transitions. Simple rules produce
 * astonishing emergent behavior — chaotic scribbles that suddenly crystallize
 * into symmetric highways stretching to infinity.
 *
 * Each ant carries internal state. At each step:
 *   1. Read current cell color
 *   2. Look up (state, color) in transition table
 *   3. Write new color, turn, advance, change state
 *
 * Multiple ants create interference patterns where highways collide
 * and redirect each other into new structures.
 */

export interface TurmiteRule {
  colors: number;            // number of cell colors (2-8)
  states: number;            // number of ant internal states (1-4)
  transitions: number[][][]; // transitions[state][color] = [newColor, turn, newState]
                             // turn: 0=none, 1=right, 2=u-turn, 3=left
  ants: number;              // number of ants (1-6)
  antSpacing: "center" | "cross" | "corners" | "random";
  steps: number;             // simulation steps (1000-500000)
  wrapEdges: boolean;        // toroidal wrapping
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

interface TurmiteGenome {
  type: "turmite";
  rule: TurmiteRule;
  width: number;
  height: number;
  palette: string[];
  seed: number;
  mutations: number;
  lineage: string[];
}

interface Ant {
  x: number;
  y: number;
  dir: number; // 0=up, 1=right, 2=down, 3=left
  state: number;
}

// Direction deltas: up, right, down, left
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/**
 * Run a turmite simulation and return a quantized grid.
 */
export function evolveTurmite(genome: TurmiteGenome): number[][] {
  const { width, height } = genome;
  const rule = genome.rule as TurmiteRule;
  const rng = mulberry32(genome.seed);

  // Use higher internal resolution for detail
  const iw = width * 2;
  const ih = height * 2;
  const grid = new Uint8Array(iw * ih); // cell colors, initialized to 0

  // Place ants
  const ants: Ant[] = [];
  const cx = Math.floor(iw / 2);
  const cy = Math.floor(ih / 2);

  for (let i = 0; i < rule.ants; i++) {
    let x: number, y: number;
    switch (rule.antSpacing) {
      case "center":
        x = cx + (i % 3 - 1);
        y = cy + (Math.floor(i / 3) - 1);
        break;
      case "cross": {
        const dist = Math.floor(Math.min(iw, ih) / 6);
        const angle = (i / rule.ants) * Math.PI * 2;
        x = cx + Math.round(dist * Math.cos(angle));
        y = cy + Math.round(dist * Math.sin(angle));
        break;
      }
      case "corners": {
        const mx = Math.floor(iw / 4);
        const my = Math.floor(ih / 4);
        const positions = [
          [cx - mx, cy - my], [cx + mx, cy - my],
          [cx - mx, cy + my], [cx + mx, cy + my],
          [cx, cy - my], [cx, cy + my],
        ];
        const pos = positions[i % positions.length];
        x = pos[0];
        y = pos[1];
        break;
      }
      case "random":
        x = Math.floor(rng() * iw);
        y = Math.floor(rng() * ih);
        break;
      default:
        x = cx;
        y = cy;
    }
    ants.push({
      x: Math.max(0, Math.min(iw - 1, x)),
      y: Math.max(0, Math.min(ih - 1, y)),
      dir: Math.floor(rng() * 4),
      state: 0,
    });
  }

  // Simulate
  const numColors = Math.max(2, Math.min(8, rule.colors));
  const numStates = Math.max(1, Math.min(4, rule.states));

  for (let step = 0; step < rule.steps; step++) {
    for (const ant of ants) {
      const idx = ant.y * iw + ant.x;
      const cellColor = grid[idx] % numColors;
      const antState = ant.state % numStates;

      // Look up transition
      const trans = rule.transitions[antState]?.[cellColor];
      if (!trans) continue;

      const [newColor, turn, newState] = trans;

      // Write new color
      grid[idx] = newColor % numColors;

      // Turn: 0=none, 1=right, 2=u-turn, 3=left
      ant.dir = (ant.dir + turn) % 4;

      // Change state
      ant.state = newState % numStates;

      // Move forward
      let nx = ant.x + DX[ant.dir];
      let ny = ant.y + DY[ant.dir];

      if (rule.wrapEdges) {
        nx = ((nx % iw) + iw) % iw;
        ny = ((ny % ih) + ih) % ih;
      } else {
        // Bounce off edges
        if (nx < 0 || nx >= iw) {
          ant.dir = (ant.dir + 2) % 4;
          nx = Math.max(0, Math.min(iw - 1, nx));
        }
        if (ny < 0 || ny >= ih) {
          ant.dir = (ant.dir + 2) % 4;
          ny = Math.max(0, Math.min(ih - 1, ny));
        }
      }

      ant.x = nx;
      ant.y = ny;
    }
  }

  // Count visit density for richer output
  // Re-run with visit counting for the density layer
  const visits = new Uint32Array(iw * ih);
  const grid2 = new Uint8Array(iw * ih);
  const ants2: Ant[] = [];
  const rng2 = mulberry32(genome.seed);

  for (let i = 0; i < rule.ants; i++) {
    let x: number, y: number;
    switch (rule.antSpacing) {
      case "center":
        x = cx + (i % 3 - 1);
        y = cy + (Math.floor(i / 3) - 1);
        break;
      case "cross": {
        const dist = Math.floor(Math.min(iw, ih) / 6);
        const angle = (i / rule.ants) * Math.PI * 2;
        x = cx + Math.round(dist * Math.cos(angle));
        y = cy + Math.round(dist * Math.sin(angle));
        break;
      }
      case "corners": {
        const mx = Math.floor(iw / 4);
        const my = Math.floor(ih / 4);
        const positions = [
          [cx - mx, cy - my], [cx + mx, cy - my],
          [cx - mx, cy + my], [cx + mx, cy + my],
          [cx, cy - my], [cx, cy + my],
        ];
        const pos = positions[i % positions.length];
        x = pos[0];
        y = pos[1];
        break;
      }
      case "random":
        x = Math.floor(rng2() * iw);
        y = Math.floor(rng2() * ih);
        break;
      default:
        x = cx;
        y = cy;
    }
    ants2.push({
      x: Math.max(0, Math.min(iw - 1, x)),
      y: Math.max(0, Math.min(ih - 1, y)),
      dir: Math.floor(rng2() * 4),
      state: 0,
    });
  }

  for (let step = 0; step < rule.steps; step++) {
    for (const ant of ants2) {
      const idx = ant.y * iw + ant.x;
      visits[idx]++;
      const cellColor = grid2[idx] % numColors;
      const antState = ant.state % numStates;
      const trans = rule.transitions[antState]?.[cellColor];
      if (!trans) continue;
      const [newColor, turn, newState] = trans;
      grid2[idx] = newColor % numColors;
      ant.dir = (ant.dir + turn) % 4;
      ant.state = newState % numStates;
      let nx = ant.x + DX[ant.dir];
      let ny = ant.y + DY[ant.dir];
      if (rule.wrapEdges) {
        nx = ((nx % iw) + iw) % iw;
        ny = ((ny % ih) + ih) % ih;
      } else {
        if (nx < 0 || nx >= iw) { ant.dir = (ant.dir + 2) % 4; nx = Math.max(0, Math.min(iw - 1, nx)); }
        if (ny < 0 || ny >= ih) { ant.dir = (ant.dir + 2) % 4; ny = Math.max(0, Math.min(ih - 1, ny)); }
      }
      ant.x = nx;
      ant.y = ny;
    }
  }

  // Downsample to output resolution
  // Combine color state and visit density for rich output
  const q = Math.max(2, rule.quantize);
  const output: number[][] = [];

  // Find max visits for normalization
  let maxVisits = 1;
  for (let i = 0; i < visits.length; i++) {
    if (visits[i] > maxVisits) maxVisits = visits[i];
  }

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const sx = x * 2, sy = y * 2;
      // Average 2x2 block — combine color and density
      let colorSum = 0;
      let visitSum = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const idx = (sy + dy) * iw + (sx + dx);
          colorSum += grid[idx];
          visitSum += visits[idx];
        }
      }
      const avgColor = colorSum / 4;
      const avgVisit = visitSum / 4;

      // Blend color state with visit intensity
      const colorNorm = avgColor / Math.max(numColors - 1, 1);
      const visitNorm = Math.min(1, Math.log1p(avgVisit) / Math.log1p(maxVisits));
      const blended = colorNorm * 0.6 + visitNorm * 0.4;

      row.push(Math.min(Math.floor(blended * q), q - 1));
    }
    output.push(row);
  }

  return output;
}

// --- Mutation ---
export function mutateTurmite(rule: TurmiteRule, rng: () => number): TurmiteRule {
  const mutated: TurmiteRule = JSON.parse(JSON.stringify(rule));

  const field = rng();
  if (field < 0.35) {
    // Mutate a single transition entry
    const s = Math.floor(rng() * mutated.states);
    const c = Math.floor(rng() * mutated.colors);
    if (mutated.transitions[s] && mutated.transitions[s][c]) {
      const what = rng();
      if (what < 0.33) {
        // Change output color
        mutated.transitions[s][c][0] = Math.floor(rng() * mutated.colors);
      } else if (what < 0.66) {
        // Change turn direction
        mutated.transitions[s][c][1] = Math.floor(rng() * 4);
      } else {
        // Change next state
        mutated.transitions[s][c][2] = Math.floor(rng() * mutated.states);
      }
    }
  } else if (field < 0.5) {
    // Mutate number of ants
    mutated.ants = Math.max(1, Math.min(6, mutated.ants + (rng() > 0.5 ? 1 : -1)));
  } else if (field < 0.6) {
    // Mutate steps
    const factor = 0.7 + rng() * 0.6;
    mutated.steps = Math.max(1000, Math.min(500000, Math.round(mutated.steps * factor)));
  } else if (field < 0.7) {
    // Mutate ant spacing
    const spacings: TurmiteRule["antSpacing"][] = ["center", "cross", "corners", "random"];
    mutated.antSpacing = spacings[Math.floor(rng() * spacings.length)];
  } else if (field < 0.8) {
    // Toggle wrap
    mutated.wrapEdges = !mutated.wrapEdges;
  } else if (field < 0.9) {
    // Add/remove a color (dramatic mutation)
    if (rng() > 0.5 && mutated.colors < 8) {
      mutated.colors++;
      // Extend transitions for new color
      for (let s = 0; s < mutated.states; s++) {
        if (!mutated.transitions[s]) mutated.transitions[s] = [];
        mutated.transitions[s].push([
          Math.floor(rng() * mutated.colors),
          Math.floor(rng() * 4),
          Math.floor(rng() * mutated.states),
        ]);
      }
    } else if (mutated.colors > 2) {
      mutated.colors--;
      for (let s = 0; s < mutated.states; s++) {
        if (mutated.transitions[s]) {
          mutated.transitions[s] = mutated.transitions[s].slice(0, mutated.colors);
          // Clamp color references
          for (const t of mutated.transitions[s]) {
            t[0] = t[0] % mutated.colors;
          }
        }
      }
    }
  } else {
    // Mutate quantize
    mutated.quantize = 3 + Math.floor(rng() * 6);
  }

  return mutated;
}

// --- Crossover ---
export function crossoverTurmite(a: TurmiteRule, b: TurmiteRule, rng: () => number): TurmiteRule {
  // Use the parent with fewer colors as baseline to avoid index issues
  const base = a.colors <= b.colors ? a : b;
  const other = a.colors <= b.colors ? b : a;

  const child: TurmiteRule = JSON.parse(JSON.stringify(base));
  child.ants = rng() > 0.5 ? a.ants : b.ants;
  child.steps = Math.round(a.steps * rng() + b.steps * (1 - rng()));
  child.antSpacing = rng() > 0.5 ? a.antSpacing : b.antSpacing;
  child.wrapEdges = rng() > 0.5 ? a.wrapEdges : b.wrapEdges;
  child.quantize = rng() > 0.5 ? a.quantize : b.quantize;

  // Crossover transitions: mix entries from both parents
  for (let s = 0; s < child.states; s++) {
    for (let c = 0; c < child.colors; c++) {
      if (rng() > 0.5 && other.transitions[s]?.[c]) {
        const ot = other.transitions[s][c];
        child.transitions[s][c] = [
          ot[0] % child.colors,
          ot[1],
          ot[2] % child.states,
        ];
      }
    }
  }

  return child;
}

// --- Random rule generation ---
export function randomTurmiteRule(rng: () => number): TurmiteRule {
  const colors = 2 + Math.floor(rng() * 4); // 2-5
  const states = 1 + Math.floor(rng() * 3); // 1-3
  const transitions: number[][][] = [];

  for (let s = 0; s < states; s++) {
    transitions[s] = [];
    for (let c = 0; c < colors; c++) {
      transitions[s][c] = [
        Math.floor(rng() * colors),   // new color
        Math.floor(rng() * 4),        // turn
        Math.floor(rng() * states),   // new state
      ];
    }
  }

  return {
    colors,
    states,
    transitions,
    ants: 1 + Math.floor(rng() * 3),
    antSpacing: (["center", "cross", "corners", "random"] as const)[Math.floor(rng() * 4)],
    steps: 20000 + Math.floor(rng() * 80000),
    wrapEdges: rng() > 0.4,
    quantize: 4 + Math.floor(rng() * 4),
  };
}

// --- Seed genomes (partial — automata.ts wraps with full Genome fields) ---
export const TURMITE_SEED_GENOMES_PARTIAL = [
  {
    // Classic Langton's Ant — the original. Chaos for ~10k steps then a perfect highway.
    rule: {
      colors: 2, states: 1,
      transitions: [[[1, 1, 0], [0, 3, 0]]], // white→black+right, black→white+left
      ants: 1, antSpacing: "center" as const,
      steps: 15000, wrapEdges: true, quantize: 5,
    },
    width: 56, height: 34, palette: "SHADE_PALETTE",
  },
  {
    // Symmetric highway builder — 3 colors produce intricate filled regions
    rule: {
      colors: 3, states: 1,
      transitions: [[[1, 1, 0], [2, 1, 0], [0, 3, 0]]], // RRL
      ants: 1, antSpacing: "center" as const,
      steps: 40000, wrapEdges: true, quantize: 6,
    },
    width: 52, height: 32, palette: "BRAILLE_PALETTE",
  },
  {
    // Four-fold symmetric filler — LLRR produces dense filled patterns
    rule: {
      colors: 4, states: 1,
      transitions: [[[1, 3, 0], [2, 3, 0], [3, 1, 0], [0, 1, 0]]], // LLRR
      ants: 1, antSpacing: "center" as const,
      steps: 60000, wrapEdges: true, quantize: 7,
    },
    width: 48, height: 30, palette: "GEOMETRIC_PALETTE",
  },
  {
    // Multi-ant interference — two ants colliding and redirecting
    rule: {
      colors: 2, states: 1,
      transitions: [[[1, 1, 0], [0, 3, 0]]],
      ants: 3, antSpacing: "cross" as const,
      steps: 25000, wrapEdges: true, quantize: 5,
    },
    width: 56, height: 34, palette: "STAR_PALETTE",
  },
  {
    // Stateful turmite — 2 states × 3 colors, complex behavior
    rule: {
      colors: 3, states: 2,
      transitions: [
        [[1, 1, 1], [2, 3, 0], [0, 1, 0]], // state 0
        [[2, 3, 1], [0, 1, 1], [1, 1, 0]], // state 1
      ],
      ants: 1, antSpacing: "center" as const,
      steps: 50000, wrapEdges: true, quantize: 6,
    },
    width: 52, height: 32, palette: "WAVE_PALETTE",
  },
];
