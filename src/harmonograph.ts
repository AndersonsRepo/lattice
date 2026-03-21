/**
 * Harmonograph — Coupled Damped Pendulum Engine
 *
 * Simulates the motion of a pen attached to coupled pendulums swinging
 * with different frequencies, phases, and decay rates. The resulting
 * Lissajous-like curves decay organically over time, producing ethereal
 * interference patterns that reveal hidden rational relationships
 * between frequencies.
 *
 * Unlike spirographs (periodic, mechanical), harmonographs are physical
 * simulations with damping — they breathe, decay, and die beautifully.
 */

// --- Deterministic PRNG (same as other engines) ---
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HarmonographPendulum {
  frequency: number;    // oscillation frequency (0.5-8.0)
  phase: number;        // initial phase offset in radians (0-2π)
  amplitude: number;    // swing amplitude (0.2-1.0)
  damping: number;      // exponential decay rate (0.0001-0.01)
}

export interface HarmonographRule {
  pendulums: HarmonographPendulum[];  // 2-4 pendulums (even indices → X, odd → Y)
  steps: number;          // total simulation steps (5000-80000)
  dt: number;             // time step (0.01-0.05)
  quantize: number;       // output states (3-8)
  rotary: boolean;        // if true, one pendulum pair rotates (circular motion base)
  lineWidth: number;      // trace thickness (0-2, 0=single pixel)
}

interface HarmonographGenome {
  type: "harmonograph";
  rule: HarmonographRule;
  width: number;
  height: number;
  palette: string[];
  seed: number;
  mutations: number;
  lineage: string[];
}

/**
 * Evaluate harmonograph position at time t.
 * Even-indexed pendulums contribute to X, odd to Y.
 */
function sample(pendulums: HarmonographPendulum[], t: number, rotary: boolean): [number, number] {
  let x = 0, y = 0;
  for (let i = 0; i < pendulums.length; i++) {
    const p = pendulums[i];
    const decay = Math.exp(-p.damping * t);
    const val = p.amplitude * Math.sin(p.frequency * t + p.phase) * decay;
    if (i % 2 === 0) {
      if (rotary && i === 0) {
        // Rotary mode: first pendulum contributes to both axes (circular base)
        x += val;
        y += p.amplitude * Math.cos(p.frequency * t + p.phase) * decay;
      } else {
        x += val;
      }
    } else {
      y += val;
    }
  }
  return [x, y];
}

/**
 * Evolve a harmonograph genome into a grid of cell values.
 * Traces the pendulum path and accumulates density on the grid.
 */
export function evolveHarmonograph(genome: HarmonographGenome): number[][] {
  const { rule, width: w, height: h, seed } = genome;
  const { pendulums, steps, dt, quantize, rotary, lineWidth } = rule;

  // Accumulator grid (floating point density)
  const acc = new Float64Array(w * h);

  // Find bounding box by sampling first
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  const sampleCount = Math.min(steps, 2000);
  for (let i = 0; i < sampleCount; i++) {
    const t = (i / sampleCount) * steps * dt;
    const [x, y] = sample(pendulums, t, rotary);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  // Add padding
  const rangeX = (maxX - minX) || 1;
  const rangeY = (maxY - minY) || 1;
  const pad = 0.05;
  minX -= rangeX * pad;
  maxX += rangeX * pad;
  minY -= rangeY * pad;
  maxY += rangeY * pad;
  const finalRangeX = maxX - minX;
  const finalRangeY = maxY - minY;

  // Trace the full path
  let prevGx = -1, prevGy = -1;
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    const [x, y] = sample(pendulums, t, rotary);

    // Map to grid coordinates
    const gx = Math.floor(((x - minX) / finalRangeX) * (w - 1));
    const gy = Math.floor(((y - minY) / finalRangeY) * (h - 1));

    if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
      // Intensity decays with time (earlier strokes are brighter)
      const intensity = 1.0 + 0.5 * Math.exp(-rule.pendulums[0].damping * t * 0.5);
      acc[gy * w + gx] += intensity;

      // Thicker lines: fill neighboring cells
      if (lineWidth >= 1) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = gx + dx, ny = gy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              acc[ny * w + nx] += intensity * 0.3;
            }
          }
        }
      }
      if (lineWidth >= 2) {
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) continue;
            const nx = gx + dx, ny = gy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              acc[ny * w + nx] += intensity * 0.1;
            }
          }
        }
      }

      // Bresenham interpolation between consecutive points for smoother curves
      if (prevGx >= 0 && (Math.abs(gx - prevGx) > 1 || Math.abs(gy - prevGy) > 1)) {
        const dist = Math.max(Math.abs(gx - prevGx), Math.abs(gy - prevGy));
        for (let s = 1; s < dist; s++) {
          const fx = Math.round(prevGx + (gx - prevGx) * s / dist);
          const fy = Math.round(prevGy + (gy - prevGy) * s / dist);
          if (fx >= 0 && fx < w && fy >= 0 && fy < h) {
            acc[fy * w + fx] += intensity * 0.6;
          }
        }
      }

      prevGx = gx;
      prevGy = gy;
    }
  }

  // Quantize: log-scale density → discrete states
  let maxDensity = 0;
  for (let i = 0; i < acc.length; i++) {
    if (acc[i] > maxDensity) maxDensity = acc[i];
  }

  const grid: number[][] = [];
  const logMax = Math.log1p(maxDensity);
  for (let y = 0; y < h; y++) {
    const row: number[] = [];
    for (let x = 0; x < w; x++) {
      const v = acc[y * w + x];
      if (v === 0) {
        row.push(0);
      } else {
        const normalized = Math.log1p(v) / logMax;
        row.push(1 + Math.floor(normalized * (quantize - 1.001)));
      }
    }
    grid.push(row);
  }

  return grid;
}

/** Mutate a harmonograph rule in place */
export function mutateHarmonograph(rule: HarmonographRule, rng: () => number): HarmonographRule {
  const mutated = JSON.parse(JSON.stringify(rule)) as HarmonographRule;
  const param = rng();

  if (param < 0.35) {
    // Perturb a pendulum's frequency — small changes create dramatic shifts
    const idx = Math.floor(rng() * mutated.pendulums.length);
    const p = mutated.pendulums[idx];
    // Prefer near-rational frequency ratios (they make the best patterns)
    if (rng() < 0.3) {
      // Snap to a nearby rational ratio
      const ratios = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6];
      const target = ratios[Math.floor(rng() * ratios.length)];
      p.frequency = target + (rng() - 0.5) * 0.05; // slight detuning
    } else {
      p.frequency = Math.max(0.5, Math.min(8, p.frequency + (rng() - 0.5) * 0.8));
    }
  } else if (param < 0.55) {
    // Perturb phase
    const idx = Math.floor(rng() * mutated.pendulums.length);
    mutated.pendulums[idx].phase = (mutated.pendulums[idx].phase + (rng() - 0.5) * 1.0 + Math.PI * 2) % (Math.PI * 2);
  } else if (param < 0.7) {
    // Perturb damping
    const idx = Math.floor(rng() * mutated.pendulums.length);
    mutated.pendulums[idx].damping = Math.max(0.0001, Math.min(0.01, mutated.pendulums[idx].damping + (rng() - 0.5) * 0.002));
  } else if (param < 0.8) {
    // Perturb amplitude
    const idx = Math.floor(rng() * mutated.pendulums.length);
    mutated.pendulums[idx].amplitude = Math.max(0.2, Math.min(1.0, mutated.pendulums[idx].amplitude + (rng() - 0.5) * 0.2));
  } else if (param < 0.88) {
    // Add or remove a pendulum (2-4 range)
    if (rng() > 0.5 && mutated.pendulums.length < 4) {
      mutated.pendulums.push({
        frequency: 1 + rng() * 4,
        phase: rng() * Math.PI * 2,
        amplitude: 0.3 + rng() * 0.5,
        damping: 0.001 + rng() * 0.005,
      });
    } else if (mutated.pendulums.length > 2) {
      mutated.pendulums.splice(Math.floor(rng() * mutated.pendulums.length), 1);
    }
  } else if (param < 0.93) {
    // Toggle rotary mode
    mutated.rotary = !mutated.rotary;
  } else {
    // Adjust steps or quantize
    if (rng() > 0.5) {
      mutated.steps = Math.max(5000, Math.min(80000, mutated.steps + Math.floor((rng() - 0.5) * 20000)));
    } else {
      mutated.quantize = 3 + Math.floor(rng() * 6);
    }
  }

  return mutated;
}

/** Crossover two harmonograph rules */
export function crossoverHarmonograph(a: HarmonographRule, b: HarmonographRule, rng: () => number): HarmonographRule {
  const t = rng();
  // Take pendulums from both parents
  const minLen = Math.min(a.pendulums.length, b.pendulums.length);
  const maxLen = Math.max(a.pendulums.length, b.pendulums.length);
  const pendulums: HarmonographPendulum[] = [];

  for (let i = 0; i < maxLen && pendulums.length < 4; i++) {
    const pa = i < a.pendulums.length ? a.pendulums[i] : null;
    const pb = i < b.pendulums.length ? b.pendulums[i] : null;
    if (pa && pb) {
      // Interpolate between parents
      pendulums.push({
        frequency: pa.frequency * t + pb.frequency * (1 - t),
        phase: rng() > 0.5 ? pa.phase : pb.phase,
        amplitude: pa.amplitude * t + pb.amplitude * (1 - t),
        damping: pa.damping * t + pb.damping * (1 - t),
      });
    } else if (pa || pb) {
      // Extra pendulum from one parent — include with 60% chance
      if (rng() < 0.6) pendulums.push({ ...(pa || pb)! });
    }
  }

  // Ensure at least 2
  while (pendulums.length < 2) {
    pendulums.push({
      frequency: 1 + rng() * 3,
      phase: rng() * Math.PI * 2,
      amplitude: 0.4 + rng() * 0.4,
      damping: 0.001 + rng() * 0.004,
    });
  }

  return {
    pendulums,
    steps: rng() > 0.5 ? a.steps : b.steps,
    dt: rng() > 0.5 ? a.dt : b.dt,
    quantize: rng() > 0.5 ? a.quantize : b.quantize,
    rotary: rng() > 0.5 ? a.rotary : b.rotary,
    lineWidth: rng() > 0.5 ? a.lineWidth : b.lineWidth,
  };
}

/** Generate a random harmonograph rule */
export function randomHarmonographRule(rng: () => number): HarmonographRule {
  const numPendulums = 2 + Math.floor(rng() * 3); // 2-4
  const pendulums: HarmonographPendulum[] = [];

  // Use near-rational frequency ratios for aesthetically pleasing patterns
  const baseFreq = 1 + rng() * 2;
  const ratios = [1, 1.5, 2, 2.5, 3, 4, 5];

  for (let i = 0; i < numPendulums; i++) {
    const ratio = ratios[Math.floor(rng() * ratios.length)];
    pendulums.push({
      frequency: baseFreq * ratio + (rng() - 0.5) * 0.05, // slight detuning
      phase: rng() * Math.PI * 2,
      amplitude: 0.3 + rng() * 0.7,
      damping: 0.0005 + rng() * 0.005,
    });
  }

  return {
    pendulums,
    steps: 15000 + Math.floor(rng() * 45000),
    dt: 0.015 + rng() * 0.025,
    quantize: 4 + Math.floor(rng() * 4),
    rotary: rng() < 0.3,
    lineWidth: Math.floor(rng() * 2),
  };
}

/** Partial seed genomes (width/height/palette/seed added by automata.ts) */
export const HARMONOGRAPH_SEED_GENOMES_PARTIAL: Omit<HarmonographGenome, "palette" | "seed" | "width" | "height">[] = [
  {
    // Classic 2:3 Lissajous with slow decay — elegant figure-eight patterns
    type: "harmonograph",
    rule: {
      pendulums: [
        { frequency: 2, phase: 0, amplitude: 0.9, damping: 0.001 },
        { frequency: 3, phase: Math.PI / 4, amplitude: 0.8, damping: 0.0012 },
      ],
      steps: 40000,
      dt: 0.02,
      quantize: 6,
      rotary: false,
      lineWidth: 1,
    },
    mutations: 0,
    lineage: [],
  },
  {
    // Rotary harmonograph — spiraling orbital decay
    type: "harmonograph",
    rule: {
      pendulums: [
        { frequency: 1, phase: 0, amplitude: 0.8, damping: 0.0008 },
        { frequency: 1, phase: Math.PI / 2, amplitude: 0.8, damping: 0.0008 },
        { frequency: 3.01, phase: 0, amplitude: 0.4, damping: 0.002 },
      ],
      steps: 50000,
      dt: 0.02,
      quantize: 5,
      rotary: true,
      lineWidth: 1,
    },
    mutations: 0,
    lineage: [],
  },
  {
    // Dense 4-pendulum interference — rich moiré-like textures
    type: "harmonograph",
    rule: {
      pendulums: [
        { frequency: 2, phase: 0, amplitude: 0.7, damping: 0.0003 },
        { frequency: 3, phase: 1.2, amplitude: 0.6, damping: 0.0004 },
        { frequency: 5, phase: 0.8, amplitude: 0.4, damping: 0.0006 },
        { frequency: 7, phase: 2.1, amplitude: 0.3, damping: 0.0008 },
      ],
      steps: 60000,
      dt: 0.015,
      quantize: 7,
      rotary: false,
      lineWidth: 0,
    },
    mutations: 0,
    lineage: [],
  },
];
