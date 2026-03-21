/**
 * Magnetic Pendulum — Basin of Attraction Fractal Engine
 *
 * Simulates a damped pendulum suspended above a plane of magnets.
 * Each pixel is colored by which magnet the pendulum settles on when
 * released from that position. The boundaries between basins form
 * infinitely complex fractals — chaos at the edge of determinism.
 */

export interface MagneticPendulumRule {
  magnets: number;           // number of magnets (2-6)
  arrangement: "triangle" | "square" | "pentagon" | "hexagon" | "ring" | "random";
  friction: number;          // damping coefficient (0.01-0.3)
  gravity: number;           // restoring force toward center (0.05-0.8)
  magnetStrength: number;    // attraction strength (0.5-5.0)
  pendulumHeight: number;    // height above magnet plane (0.1-0.8)
  maxSteps: number;          // simulation steps per pixel (200-3000)
  dt: number;                // time step (0.005-0.03)
  quantize: number;          // output states (3-8)
  zoom: number;              // view zoom (0.5-4.0)
  centerX: number;           // view center X
  centerY: number;           // view center Y
}

interface Vec2 { x: number; y: number; }

function getMagnetPositions(rule: MagneticPendulumRule, rng: () => number): Vec2[] {
  const n = rule.magnets;
  const positions: Vec2[] = [];
  const radius = 1.0;

  switch (rule.arrangement) {
    case "triangle":
      for (let i = 0; i < Math.max(n, 3); i++) {
        const angle = (2 * Math.PI * i) / Math.max(n, 3) - Math.PI / 2;
        positions.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      }
      break;
    case "square":
      for (let i = 0; i < Math.max(n, 4); i++) {
        const angle = (2 * Math.PI * i) / Math.max(n, 4) + Math.PI / 4;
        positions.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      }
      break;
    case "pentagon":
      for (let i = 0; i < Math.max(n, 5); i++) {
        const angle = (2 * Math.PI * i) / Math.max(n, 5) - Math.PI / 2;
        positions.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      }
      break;
    case "hexagon":
      for (let i = 0; i < Math.max(n, 6); i++) {
        const angle = (2 * Math.PI * i) / Math.max(n, 6);
        positions.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      }
      break;
    case "ring":
      for (let i = 0; i < n; i++) {
        const angle = (2 * Math.PI * i) / n;
        positions.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      }
      break;
    case "random":
      for (let i = 0; i < n; i++) {
        const angle = rng() * 2 * Math.PI;
        const r = 0.3 + rng() * 0.7;
        positions.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
      }
      break;
  }

  return positions.slice(0, n);
}

/**
 * Simulate the pendulum from a starting position and return which magnet it settles on.
 * Returns the magnet index (0..n-1) or -1 if it doesn't converge.
 */
function simulatePendulum(
  startX: number, startY: number,
  magnets: Vec2[],
  rule: MagneticPendulumRule
): { magnetIndex: number; settleTime: number } {
  let px = startX, py = startY;
  let vx = 0, vy = 0;
  const { friction, gravity, magnetStrength, pendulumHeight, maxSteps, dt } = rule;
  const h2 = pendulumHeight * pendulumHeight;
  const settleThreshold = 0.001;

  for (let step = 0; step < maxSteps; step++) {
    // Compute forces
    let fx = 0, fy = 0;

    // Gravity (restoring force toward center)
    fx -= gravity * px;
    fy -= gravity * py;

    // Magnetic attraction (inverse-cube in 3D projected to 2D)
    for (let m = 0; m < magnets.length; m++) {
      const dx = magnets[m].x - px;
      const dy = magnets[m].y - py;
      const d2 = dx * dx + dy * dy + h2;
      const d3 = d2 * Math.sqrt(d2);
      const force = magnetStrength / d3;
      fx += force * dx;
      fy += force * dy;
    }

    // Friction (damping)
    fx -= friction * vx;
    fy -= friction * vy;

    // Velocity Verlet integration
    vx += fx * dt;
    vy += fy * dt;
    px += vx * dt;
    py += vy * dt;

    // Check convergence — has the pendulum settled near a magnet?
    const speed2 = vx * vx + vy * vy;
    if (speed2 < settleThreshold) {
      let bestMagnet = 0;
      let bestDist = Infinity;
      for (let m = 0; m < magnets.length; m++) {
        const dx = magnets[m].x - px;
        const dy = magnets[m].y - py;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          bestMagnet = m;
        }
      }
      return { magnetIndex: bestMagnet, settleTime: step / maxSteps };
    }

    // Escape check — pendulum flew too far
    if (px * px + py * py > 100) {
      return { magnetIndex: -1, settleTime: 1 };
    }
  }

  // Didn't converge — assign to nearest magnet
  let bestMagnet = 0;
  let bestDist = Infinity;
  for (let m = 0; m < magnets.length; m++) {
    const dx = magnets[m].x - px;
    const dy = magnets[m].y - py;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestMagnet = m;
    }
  }
  return { magnetIndex: bestMagnet, settleTime: 1 };
}

/**
 * Evolve a magnetic pendulum genome into a grid of cell states.
 * Each cell maps to a starting position; the value encodes which magnet basin it belongs to,
 * with settle time modulating the sub-state for visual richness.
 */
export function evolveMagneticPendulum(genome: { rule: MagneticPendulumRule; width: number; height: number; seed: number; palette?: string[] }): number[][] {
  const rule = genome.rule;
  const { width, height } = genome;
  const rng = mulberry32(genome.seed);
  const magnets = getMagnetPositions(rule, rng);
  const maxState = Math.max(rule.quantize - 1, 1);

  const grid: number[][] = [];

  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      // Map pixel to world coordinates
      const wx = (x / width - 0.5) * 2 * rule.zoom + rule.centerX;
      const wy = (y / height - 0.5) * 2 * rule.zoom + rule.centerY;

      const { magnetIndex, settleTime } = simulatePendulum(wx, wy, magnets, rule);

      if (magnetIndex < 0) {
        row.push(0);
      } else {
        // Encode magnet basin + settle time into quantized state
        // Each magnet gets a range of states; settle time picks within that range
        const statesPerMagnet = Math.max(1, Math.floor(maxState / magnets.length));
        const baseState = (magnetIndex % magnets.length) * statesPerMagnet;
        const timeState = Math.floor(settleTime * (statesPerMagnet - 1));
        row.push(Math.min(baseState + timeState, maxState));
      }
    }
    grid.push(row);
  }

  return grid;
}

export function mutateMagneticPendulum(rule: MagneticPendulumRule, rng: () => number): void {
  const param = rng();
  if (param < 0.2) {
    rule.friction = Math.max(0.01, Math.min(0.3, rule.friction + (rng() - 0.5) * 0.06));
  } else if (param < 0.35) {
    rule.gravity = Math.max(0.05, Math.min(0.8, rule.gravity + (rng() - 0.5) * 0.15));
  } else if (param < 0.5) {
    rule.magnetStrength = Math.max(0.5, Math.min(5.0, rule.magnetStrength + (rng() - 0.5) * 0.8));
  } else if (param < 0.6) {
    rule.pendulumHeight = Math.max(0.1, Math.min(0.8, rule.pendulumHeight + (rng() - 0.5) * 0.15));
  } else if (param < 0.7) {
    rule.magnets = Math.max(2, Math.min(6, rule.magnets + (rng() > 0.5 ? 1 : -1)));
    const arrangements: MagneticPendulumRule["arrangement"][] = ["triangle", "square", "pentagon", "hexagon", "ring", "random"];
    rule.arrangement = arrangements[Math.floor(rng() * arrangements.length)];
  } else if (param < 0.8) {
    rule.zoom = Math.max(0.5, Math.min(4.0, rule.zoom + (rng() - 0.5) * 0.5));
  } else if (param < 0.9) {
    rule.centerX += (rng() - 0.5) * 0.3;
    rule.centerY += (rng() - 0.5) * 0.3;
  } else {
    rule.quantize = 3 + Math.floor(rng() * 6);
  }
}

export function crossoverMagneticPendulum(a: MagneticPendulumRule, b: MagneticPendulumRule, rng: () => number): MagneticPendulumRule {
  return {
    magnets: rng() > 0.5 ? a.magnets : b.magnets,
    arrangement: rng() > 0.5 ? a.arrangement : b.arrangement,
    friction: a.friction * rng() + b.friction * (1 - rng()),
    gravity: a.gravity * rng() + b.gravity * (1 - rng()),
    magnetStrength: a.magnetStrength * rng() + b.magnetStrength * (1 - rng()),
    pendulumHeight: a.pendulumHeight * rng() + b.pendulumHeight * (1 - rng()),
    maxSteps: Math.round(a.maxSteps * rng() + b.maxSteps * (1 - rng())),
    dt: a.dt * rng() + b.dt * (1 - rng()),
    quantize: rng() > 0.5 ? a.quantize : b.quantize,
    zoom: a.zoom * rng() + b.zoom * (1 - rng()),
    centerX: a.centerX * rng() + b.centerX * (1 - rng()),
    centerY: a.centerY * rng() + b.centerY * (1 - rng()),
  };
}

export function randomMagneticPendulumRule(rng: () => number): MagneticPendulumRule {
  const presets: Omit<MagneticPendulumRule, "quantize" | "zoom" | "centerX" | "centerY">[] = [
    // Classic 3-magnet — the archetypal basin fractal
    { magnets: 3, arrangement: "triangle", friction: 0.1, gravity: 0.2, magnetStrength: 1.5, pendulumHeight: 0.3, maxSteps: 1500, dt: 0.01 },
    // 4-magnet square — more complex basin boundaries
    { magnets: 4, arrangement: "square", friction: 0.08, gravity: 0.15, magnetStrength: 2.0, pendulumHeight: 0.25, maxSteps: 2000, dt: 0.01 },
    // Low friction — chaotic trajectories, intricate fractals
    { magnets: 3, arrangement: "triangle", friction: 0.03, gravity: 0.1, magnetStrength: 1.0, pendulumHeight: 0.2, maxSteps: 2500, dt: 0.008 },
    // Strong magnets — sharp basin boundaries
    { magnets: 5, arrangement: "pentagon", friction: 0.12, gravity: 0.25, magnetStrength: 3.5, pendulumHeight: 0.35, maxSteps: 1000, dt: 0.012 },
    // 6-magnet hex — kaleidoscopic symmetry
    { magnets: 6, arrangement: "hexagon", friction: 0.06, gravity: 0.18, magnetStrength: 2.5, pendulumHeight: 0.28, maxSteps: 1800, dt: 0.01 },
  ];

  const preset = presets[Math.floor(rng() * presets.length)];
  return {
    ...preset,
    friction: preset.friction + (rng() - 0.5) * 0.02,
    gravity: preset.gravity + (rng() - 0.5) * 0.05,
    magnetStrength: preset.magnetStrength + (rng() - 0.5) * 0.3,
    pendulumHeight: preset.pendulumHeight + (rng() - 0.5) * 0.05,
    quantize: 4 + Math.floor(rng() * 4),
    zoom: 1.0 + (rng() - 0.5) * 0.6,
    centerX: (rng() - 0.5) * 0.2,
    centerY: (rng() - 0.5) * 0.2,
  };
}

export const MAGNETIC_PENDULUM_SEED_GENOMES_PARTIAL: Omit<any, "width" | "height" | "palette" | "seed" | "mutations" | "lineage">[] = [
  { type: "magnetic-pendulum", rule: { magnets: 3, arrangement: "triangle", friction: 0.08, gravity: 0.2, magnetStrength: 1.5, pendulumHeight: 0.3, maxSteps: 1500, dt: 0.01, quantize: 6, zoom: 1.2, centerX: 0, centerY: 0 } },
  { type: "magnetic-pendulum", rule: { magnets: 4, arrangement: "square", friction: 0.05, gravity: 0.15, magnetStrength: 2.0, pendulumHeight: 0.25, maxSteps: 2000, dt: 0.01, quantize: 5, zoom: 1.0, centerX: 0, centerY: 0 } },
];

// --- Deterministic PRNG (same as automata.ts) ---
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
