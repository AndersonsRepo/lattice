#!/usr/bin/env npx tsx
/**
 * Lattice — Evolution Runner
 *
 * Each run:
 * 1. Loads the current population (Supabase primary, JSON fallback)
 * 2. Generates new pieces by mutating the best performers
 * 3. Scores and ranks all pieces
 * 4. Keeps the top N, culls the rest
 * 5. Saves standout pieces to gallery/
 * 6. Archives ALL generated pieces to Supabase
 * 7. Writes a summary for Discord notification
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, appendFileSync } from "fs";
import { join } from "path";
import {
  Genome,
  Piece,
  PieceMetrics,
  SEED_GENOMES,
  evolve1D,
  evolve2D,
  evolveLSystem,
  evolveReactionDiffusion,
  evolveVoronoi,
  evolveWFC,
  evolveSpirograph,
  evolveAttractor,
  evolveJulia,
  evolveNoise,
  evolveFlowField,
  evolveFractalFlame,
  evolveSandpile,
  evolveMagneticPendulum,
  render,
  score,
  computeScore,
  computeNovelty,
  mutateGenome,
  crossoverGenomes,
  getEpoch,
  getEpochDescription,
} from "./automata.js";
import {
  isSupabaseConfigured,
  loadPopulation as sbLoadPopulation,
  savePopulation as sbSavePopulation,
  loadHistory as sbLoadHistory,
  saveGeneration as sbSaveGeneration,
  addToHallOfFame as sbAddToHallOfFame,
  archivePieces as sbArchivePieces,
  getHallOfFame as sbGetHallOfFame,
} from "./supabase.js";

const PROJECT_DIR = join(import.meta.dirname, "..");
const GALLERY_DIR = join(PROJECT_DIR, "gallery");
const POPULATION_FILE = join(GALLERY_DIR, "population.json");
const HISTORY_FILE = join(GALLERY_DIR, "history.json");
const NOTIFY_FILE = join(
  process.env.HARNESS_ROOT || "/Users/andersonedmond/.local/ai-harness",
  "heartbeat-tasks",
  "pending-notifications.jsonl"
);

const POPULATION_SIZE = 14;
const OFFSPRING_PER_RUN = 8; // more offspring = more exploration
const HALL_OF_FAME_THRESHOLD = 0.55;
const ELITE_COUNT = 2; // top N pieces survive unmutated (elitism)
const EXTINCTION_INTERVAL = 50; // every N generations, trigger extinction event
const EXTINCTION_SURVIVAL_RATE = 0.4; // fraction that survive extinction
const STAGNATION_EXTINCTION_GENS = 25; // trigger extinction after N generations of stagnation
const NICHE_BONUS_WEIGHT = 0.08; // scoring bonus for species underrepresented in hall of fame

// Speciation: minimum slots per genome type (1 per type with 9 types)
const MIN_SLOTS_PER_TYPE = 1;
const GENOME_TYPES: Genome["type"][] = ["1d", "2d", "lsystem", "reaction-diffusion", "voronoi", "wfc", "spirograph", "attractor", "julia", "noise", "flowfield"];

// Hall of Fame seeding: probability of injecting mutated HoF genetics into offspring
const HOF_SEEDING_RATE = 0.15;
// Age penalty: pieces lose this fraction of score per generation they survive (prevents stagnation)
const AGE_PENALTY_PER_GEN = 0.003; // 0.3% per gen, caps at ~10% after 33 gens
const AGE_PENALTY_CAP = 0.10;

interface GenerationRecord {
  generation: number;
  bestScore: number;
  avgScore: number;
  epoch: string;
  speciesCounts: Record<string, number>;
  hallOfFameSize: number;
  timestamp: string;
  // Best piece archive — genome stored so it can be re-rendered on the site
  bestPiece?: {
    id: string;
    genome: Genome;
    score: number;
    metrics: PieceMetrics;
  };
  // Evolution telemetry
  extinctionEvent?: boolean;
  extinctionTrigger?: "periodic" | "stagnation"; // what caused the extinction
  eliteSurvivors?: number;
  crossoverRate?: number;
  diversityIndex?: number; // Simpson's diversity index
  speciesMomentum?: Record<string, number>; // score delta per species vs previous gen
  nicheBonus?: Record<string, number>; // niche pressure bonus per species
  maxLineageDepth?: number; // deepest mutation chain in population
  stagnationStreak?: number; // consecutive generations without improvement
  hofSeedCount?: number; // offspring generated from HoF genetics this gen
  avgCrowdingDistance?: number; // mean crowding distance in selection pool
  agePenaltyApplied?: number; // how many pieces received age penalties
  paretoFrontSize?: number; // pieces on the non-dominated front
}

interface Population {
  generation: number;
  pieces: Piece[];
  hallOfFame: Piece[];
  stats: {
    totalPiecesEver: number;
    bestScoreEver: number;
    avgScore: number;
  };
}

// ---------------------------------------------------------------------------
// Data layer — Supabase primary, JSON fallback
// ---------------------------------------------------------------------------

let useSupabase = isSupabaseConfigured();

function loadPopulationFromJSON(): Population {
  if (existsSync(POPULATION_FILE)) {
    return JSON.parse(readFileSync(POPULATION_FILE, "utf-8"));
  }
  return {
    generation: 0,
    pieces: [],
    hallOfFame: [],
    stats: { totalPiecesEver: 0, bestScoreEver: 0, avgScore: 0 },
  };
}

function savePopulationToJSON(pop: Population): void {
  const tmp = POPULATION_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(pop, null, 2));
  renameSync(tmp, POPULATION_FILE);
}

async function loadPop(): Promise<Population> {
  if (useSupabase) {
    try {
      const [pieces, hallOfFame] = await Promise.all([
        sbLoadPopulation(),
        sbGetHallOfFame(),
      ]);
      // Determine generation from the highest generation in population
      const generation = pieces.reduce((max, p) => Math.max(max, p.generation), 0);
      // Stats are derived — totalPiecesEver comes from JSON fallback since Supabase
      // doesn't track cumulative stats in the population table
      const jsonPop = loadPopulationFromJSON();
      return {
        generation,
        pieces,
        hallOfFame,
        stats: jsonPop.stats, // keep cumulative stats from JSON
      };
    } catch (err) {
      console.warn(`  [supabase] Failed to load population, falling back to JSON: ${err}`);
      useSupabase = false;
    }
  }
  return loadPopulationFromJSON();
}

async function savePop(pop: Population): Promise<void> {
  // Always save to JSON (guaranteed fallback)
  savePopulationToJSON(pop);

  if (useSupabase) {
    try {
      await sbSavePopulation(pop.pieces);
      console.log("  [supabase] Population saved");
    } catch (err) {
      console.warn(`  [supabase] Failed to save population: ${err}`);
    }
  }
}

async function saveGen(record: GenerationRecord, epoch: string): Promise<void> {
  if (useSupabase) {
    try {
      await sbSaveGeneration({
        generation: record.generation,
        epoch,
        bestScore: record.bestScore,
        avgScore: record.avgScore,
        speciesCounts: record.speciesCounts,
        hallOfFameSize: record.hallOfFameSize,
        bestPieceId: record.bestPiece?.id,
        bestPieceGenome: record.bestPiece?.genome,
        populationSize: POPULATION_SIZE,
      });
      console.log("  [supabase] Generation record saved");
    } catch (err) {
      console.warn(`  [supabase] Failed to save generation: ${err}`);
    }
  }
}

async function saveHallOfFameEntries(entries: Piece[], epoch: string): Promise<void> {
  if (!useSupabase || entries.length === 0) return;
  try {
    await Promise.all(entries.map((p) => sbAddToHallOfFame(p, epoch)));
    console.log(`  [supabase] ${entries.length} hall of fame entries saved`);
  } catch (err) {
    console.warn(`  [supabase] Failed to save hall of fame: ${err}`);
  }
}

async function archiveAllPieces(pieces: Piece[], epoch: string): Promise<void> {
  if (!useSupabase || pieces.length === 0) return;
  try {
    await sbArchivePieces(pieces, epoch);
    console.log(`  [supabase] ${pieces.length} pieces archived`);
  } catch (err) {
    console.warn(`  [supabase] Failed to archive pieces: ${err}`);
  }
}

// ---------------------------------------------------------------------------
// Piece generation
// ---------------------------------------------------------------------------

function generatePiece(genome: Genome, generation: number, populationMetrics?: PieceMetrics[]): Piece {
  let grid: number[][];
  switch (genome.type) {
    case "1d":
      grid = evolve1D(genome);
      break;
    case "2d":
      grid = evolve2D(genome);
      break;
    case "lsystem":
      grid = evolveLSystem(genome);
      break;
    case "reaction-diffusion":
      grid = evolveReactionDiffusion(genome);
      break;
    case "voronoi":
      grid = evolveVoronoi(genome);
      break;
    case "wfc":
      grid = evolveWFC(genome);
      break;
    case "spirograph":
      grid = evolveSpirograph(genome);
      break;
    case "attractor":
      grid = evolveAttractor(genome);
      break;
    case "julia":
      grid = evolveJulia(genome);
      break;
    case "noise":
      grid = evolveNoise(genome);
      break;
    case "flowfield":
      grid = evolveFlowField(genome);
      break;
    case "fractal-flame":
      grid = evolveFractalFlame(genome);
      break;
    default:
      grid = evolve1D(genome);
  }

  const metrics = score(grid);
  // Compute novelty relative to existing population
  if (populationMetrics && populationMetrics.length > 0) {
    metrics.novelty = computeNovelty(metrics, populationMetrics);
  }
  const totalScore = computeScore(metrics, generation, genome.type);
  const rendered = render(grid, genome.palette);

  return {
    id: `gen${generation}-${Date.now().toString(36)}`,
    genome,
    grid,
    rendered,
    score: totalScore,
    metrics,
    generation,
    createdAt: new Date().toISOString(),
  };
}

function notify(summary: string): void {
  const notification = {
    task: "lattice-evolve",
    channel: "lattice",
    summary,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(NOTIFY_FILE, JSON.stringify(notification) + "\n");
}

function formatPieceForDiscord(piece: Piece): string {
  const typeLabel = piece.genome.type === "1d" ? "1D Automaton"
    : piece.genome.type === "2d" ? "2D Life-like"
    : piece.genome.type === "reaction-diffusion" ? "Reaction-Diffusion"
    : piece.genome.type === "voronoi" ? "Voronoi"
    : piece.genome.type === "wfc" ? "Wave Function Collapse"
    : piece.genome.type === "spirograph" ? "Spirograph"
    : piece.genome.type === "attractor" ? "Strange Attractor"
    : piece.genome.type === "julia" ? "Julia Set"
    : piece.genome.type === "noise" ? "Fractal Noise"
    : piece.genome.type === "flowfield" ? "Flow Field"
    : piece.genome.type === "magnetic-pendulum" ? "Magnetic Pendulum"
    : "L-System";

  const ruleStr = piece.genome.type === "1d"
    ? `Rule ${(piece.genome.rule as any).number}`
    : piece.genome.type === "2d"
    ? `B${(piece.genome.rule as any).birth.join("")}/S${(piece.genome.rule as any).survive.join("")} (${(piece.genome.rule as any).states}st)`
    : piece.genome.type === "reaction-diffusion"
    ? `f=${(piece.genome.rule as any).feed.toFixed(3)} k=${(piece.genome.rule as any).kill.toFixed(3)}`
    : piece.genome.type === "voronoi"
    ? `${(piece.genome.rule as any).seeds}pts ${(piece.genome.rule as any).mode} ${(piece.genome.rule as any).metric}`
    : piece.genome.type === "wfc"
    ? `${(piece.genome.rule as any).tileCount}tiles ${(piece.genome.rule as any).symmetry}`
    : piece.genome.type === "spirograph"
    ? `${(piece.genome.rule as any).layers.length}layers ${(piece.genome.rule as any).layers[0]?.mode}`
    : piece.genome.type === "attractor"
    ? `${(piece.genome.rule as any).variant} a=${(piece.genome.rule as any).a.toFixed(1)} b=${(piece.genome.rule as any).b.toFixed(1)}`
    : piece.genome.type === "julia"
    ? `c=${(piece.genome.rule as any).cReal.toFixed(3)}+${(piece.genome.rule as any).cImag.toFixed(3)}i z=${(piece.genome.rule as any).zoom.toFixed(1)}x`
    : piece.genome.type === "noise"
    ? `${(piece.genome.rule as any).octaves}oct s=${(piece.genome.rule as any).scale.toFixed(3)} w=${(piece.genome.rule as any).warp.toFixed(1)}`
    : piece.genome.type === "flowfield"
    ? `${(piece.genome.rule as any).particles}p curl=${(piece.genome.rule as any).curl.toFixed(1)} s=${(piece.genome.rule as any).fieldScale.toFixed(3)}`
    : `angle=${(piece.genome.rule as any).angle}° iter=${(piece.genome.rule as any).iterations}`;

  const hasCrossover = piece.genome.lineage.includes("×");

  return [
    `**Lattice Gen ${piece.generation}** — ${typeLabel} (${ruleStr})`,
    `Score: **${(piece.score * 100).toFixed(1)}%** | ` +
      `Novelty: ${(piece.metrics.novelty * 100).toFixed(0)}% | ` +
      `Fractal: ${(piece.metrics.fractalDimension ?? 0).toFixed(2)} | ` +
      `Info: ${((piece.metrics.informationDensity ?? 0) * 100).toFixed(0)}% | ` +
      `Density: ${(piece.metrics.density * 100).toFixed(0)}%`,
    "```",
    piece.rendered,
    "```",
    `Mutations: ${piece.genome.mutations}${hasCrossover ? " (crossover)" : ""} | ` +
      `Canvas: ${piece.genome.width}×${piece.genome.height} | ` +
      `Palette: ${piece.genome.palette.slice(1, 4).join("")}...`,
  ].join("\n");
}

function metricDistance(a: PieceMetrics, b: PieceMetrics): number {
  const keys: (keyof PieceMetrics)[] = ["complexity", "symmetry", "density", "edgeActivity", "structuralInterest", "fractalDimension", "informationDensity", "compositionBalance"];
  let sum = 0;
  for (const k of keys) { sum += ((a[k] ?? 0) - (b[k] ?? 0)) ** 2; }
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// Crowding distance (NSGA-II inspired)
// Assigns each piece a measure of how isolated it is in metric space.
// Pieces at the extremes get infinite distance (always selected).
// This preserves diversity along the fitness landscape.
// ---------------------------------------------------------------------------
const CROWDING_METRICS: (keyof PieceMetrics)[] = [
  "complexity", "symmetry", "density", "edgeActivity", "structuralInterest",
  "fractalDimension", "informationDensity", "compositionBalance", "spatialCoherence"
];

function computeCrowdingDistances(pieces: Piece[]): Map<string, number> {
  const distances = new Map<string, number>();
  for (const p of pieces) distances.set(p.id, 0);
  if (pieces.length <= 2) {
    for (const p of pieces) distances.set(p.id, Infinity);
    return distances;
  }

  for (const metric of CROWDING_METRICS) {
    // Sort by this metric
    const sorted = [...pieces].sort((a, b) => (a.metrics[metric] ?? 0) - (b.metrics[metric] ?? 0));
    const minVal = sorted[0].metrics[metric] ?? 0;
    const maxVal = sorted[sorted.length - 1].metrics[metric] ?? 0;
    const range = maxVal - minVal;

    // Boundary pieces get infinite distance
    distances.set(sorted[0].id, Infinity);
    distances.set(sorted[sorted.length - 1].id, Infinity);

    if (range > 0) {
      for (let i = 1; i < sorted.length - 1; i++) {
        const prev = distances.get(sorted[i].id) ?? 0;
        const gap = ((sorted[i + 1].metrics[metric] ?? 0) - (sorted[i - 1].metrics[metric] ?? 0)) / range;
        if (prev !== Infinity) distances.set(sorted[i].id, prev + gap);
      }
    }
  }
  return distances;
}

// ---------------------------------------------------------------------------
// Pareto dominance check — piece A dominates B if A is >= B in all metrics
// and strictly > in at least one. Used to identify the non-dominated front.
// ---------------------------------------------------------------------------
function dominates(a: PieceMetrics, b: PieceMetrics): boolean {
  let strictlyBetter = false;
  for (const k of CROWDING_METRICS) {
    const va = a[k] ?? 0, vb = b[k] ?? 0;
    if (va < vb) return false;
    if (va > vb) strictlyBetter = true;
  }
  return strictlyBetter;
}

function countParetoFront(pieces: Piece[]): number {
  let count = 0;
  for (let i = 0; i < pieces.length; i++) {
    let dominated = false;
    for (let j = 0; j < pieces.length; j++) {
      if (i !== j && dominates(pieces[j].metrics, pieces[i].metrics)) {
        dominated = true;
        break;
      }
    }
    if (!dominated) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Age penalty — reduce score for long-incumbent pieces to encourage turnover
// ---------------------------------------------------------------------------
function applyAgePenalty(pieces: Piece[], currentGen: number): number {
  let penalizedCount = 0;
  for (const p of pieces) {
    const age = currentGen - p.generation;
    if (age > 0) {
      const penalty = Math.min(age * AGE_PENALTY_PER_GEN, AGE_PENALTY_CAP);
      p.score = p.score * (1 - penalty);
      penalizedCount++;
    }
  }
  return penalizedCount;
}

async function run(): Promise<void> {
  mkdirSync(GALLERY_DIR, { recursive: true });

  if (useSupabase) {
    console.log("  [supabase] Connected — using Supabase as primary data store");
  } else {
    console.log("  [supabase] Not configured — using JSON files only");
  }

  const pop = await loadPop();
  const gen = pop.generation + 1;
  const rng = () => Math.random(); // use true random for evolution

  const epoch = getEpoch(gen);
  console.log(`\n=== Lattice Generation ${gen} ===`);
  console.log(`  Epoch: ${epoch} — ${getEpochDescription(epoch)}`);

  // If no population, seed it
  if (pop.pieces.length === 0) {
    console.log("Seeding initial population...");
    for (const genome of SEED_GENOMES) {
      const piece = generatePiece(genome, gen);
      pop.pieces.push(piece);
      console.log(`  ${piece.id}: ${piece.genome.type} → score ${(piece.score * 100).toFixed(1)}%`);
    }
  }

  // Diversity injection: if a genome type has zero representatives, inject a seed
  const existingTypes = new Set(pop.pieces.map((p) => p.genome.type));
  for (const type of GENOME_TYPES) {
    if (!existingTypes.has(type)) {
      const seeds = SEED_GENOMES.filter((g) => g.type === type);
      if (seeds.length > 0) {
        const seed = seeds[Math.floor(rng() * seeds.length)];
        const piece = generatePiece({ ...seed, seed: Math.floor(rng() * 2 ** 32) }, gen);
        pop.pieces.push(piece);
        console.log(`  Injected missing type ${type}: ${piece.id} → score ${(piece.score * 100).toFixed(1)}%`);
      }
    }
  }

  // Collect existing population metrics for novelty scoring
  const popMetrics = pop.pieces.map((p) => p.metrics);

  // Tournament selection: pick k random candidates, return the best
  // Gives lower-ranked pieces a chance while strongly favoring high scorers
  const TOURNAMENT_SIZE = 3;
  function tournamentSelect(pool: Piece[]): Piece {
    let best = pool[Math.floor(rng() * pool.length)];
    for (let i = 1; i < TOURNAMENT_SIZE; i++) {
      const candidate = pool[Math.floor(rng() * pool.length)];
      if (candidate.score > best.score) best = candidate;
    }
    return best;
  }

  // Stagnation + adaptive mutation
  let history: GenerationRecord[] = [];
  if (existsSync(HISTORY_FILE)) { try { history = JSON.parse(readFileSync(HISTORY_FILE, "utf-8")); } catch {} }
  const recentBest = history.slice(-15).map(h => h.bestScore);
  const isStagnant = recentBest.length >= 15 && (Math.max(...recentBest) - Math.min(...recentBest)) < 0.005;
  if (isStagnant) {
    console.log("  Stagnation detected — injecting immigrants");
    // Immigration: add 2 fresh random genomes to break local optima
    const immigrantTypes = GENOME_TYPES.filter(() => rng() < 0.3).slice(0, 2);
    if (immigrantTypes.length === 0) immigrantTypes.push(GENOME_TYPES[Math.floor(rng() * GENOME_TYPES.length)]);
    for (const type of immigrantTypes) {
      const seeds = SEED_GENOMES.filter(g => g.type === type);
      if (seeds.length > 0) {
        const seed = seeds[Math.floor(rng() * seeds.length)];
        const immigrant = generatePiece({ ...seed, seed: Math.floor(rng() * 2 ** 32) }, gen, popMetrics);
        pop.pieces.push(immigrant);
        console.log(`  ✈ Immigrant ${immigrant.id}: ${type} → ${(immigrant.score*100).toFixed(1)}%`);
      }
    }
  }

  // Count consecutive stagnant generations for adaptive extinction
  let stagnationStreak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].stagnationStreak !== undefined) {
      stagnationStreak = isStagnant ? (history[i].stagnationStreak ?? 0) + 1 : 0;
      break;
    }
    // Fallback: check if this gen was stagnant too
    if (i > 14) {
      const slice = history.slice(i - 14, i + 1).map(h => h.bestScore);
      if ((Math.max(...slice) - Math.min(...slice)) < 0.005) {
        stagnationStreak++;
      } else break;
    } else break;
  }
  if (isStagnant && stagnationStreak === 0) stagnationStreak = 1;

  // Niche pressure — bonus for species underrepresented in hall of fame
  const hofTypeCounts: Record<string, number> = {};
  for (const p of pop.hallOfFame) {
    hofTypeCounts[p.genome.type] = (hofTypeCounts[p.genome.type] || 0) + 1;
  }
  const hofTotal = Math.max(pop.hallOfFame.length, 1);
  const nicheBonus: Record<string, number> = {};
  for (const type of GENOME_TYPES) {
    const hofFraction = (hofTypeCounts[type] || 0) / hofTotal;
    // Species with 0 HoF entries get full bonus, well-represented ones get none
    nicheBonus[type] = NICHE_BONUS_WEIGHT * Math.max(0, 1 - hofFraction * GENOME_TYPES.length);
  }
  const hasNicheBonus = Object.values(nicheBonus).some(v => v > 0.01);
  if (hasNicheBonus) {
    console.log(`  Niche pressure: ${Object.entries(nicheBonus).filter(([,v]) => v > 0.01).map(([t,v]) => `${t}=+${(v*100).toFixed(1)}%`).join(", ")}`);
  }

  // Extinction event — periodic OR triggered by prolonged stagnation
  const periodicExtinction = gen > 1 && gen % EXTINCTION_INTERVAL === 0;
  const stagnationExtinction = stagnationStreak >= STAGNATION_EXTINCTION_GENS;
  const isExtinction = periodicExtinction || stagnationExtinction;
  const extinctionTrigger: "periodic" | "stagnation" | undefined = periodicExtinction ? "periodic" : stagnationExtinction ? "stagnation" : undefined;
  if (isExtinction) {
    const surviveCount = Math.max(3, Math.ceil(pop.pieces.length * EXTINCTION_SURVIVAL_RATE));
    // Keep best piece per species + random survivors
    const extinctionSurvivors: Piece[] = [];
    const seenTypes = new Set<string>();
    for (const p of pop.pieces) {
      if (!seenTypes.has(p.genome.type)) {
        extinctionSurvivors.push(p);
        seenTypes.add(p.genome.type);
      }
    }
    // Fill remaining with random picks
    const remaining = pop.pieces.filter(p => !extinctionSurvivors.includes(p));
    while (extinctionSurvivors.length < surviveCount && remaining.length > 0) {
      const idx = Math.floor(rng() * remaining.length);
      extinctionSurvivors.push(remaining.splice(idx, 1)[0]);
    }
    const culledCount = pop.pieces.length - extinctionSurvivors.length;
    pop.pieces = extinctionSurvivors;
    console.log(`  ☄ EXTINCTION EVENT (${extinctionTrigger}) — culled ${culledCount} pieces, ${extinctionSurvivors.length} survive`);
  }

  // Diversity measurement — Simpson's diversity index
  const speciesForDiversity: Record<string, number> = {};
  for (const p of pop.pieces) {
    speciesForDiversity[p.genome.type] = (speciesForDiversity[p.genome.type] || 0) + 1;
  }
  const totalForDiversity = pop.pieces.length;
  let simpsonSum = 0;
  for (const count of Object.values(speciesForDiversity)) {
    simpsonSum += (count / totalForDiversity) ** 2;
  }
  const diversityIndex = 1 - simpsonSum; // 0 = monoculture, 1 = max diversity

  // Adaptive crossover rate — increase when diversity is low
  const baseCrossoverRate = 0.3;
  const crossoverRate = diversityIndex < 0.5
    ? baseCrossoverRate + (0.5 - diversityIndex) * 0.4 // up to 0.5 when monoculture
    : baseCrossoverRate;
  console.log(`  Diversity: ${(diversityIndex * 100).toFixed(1)}% | Crossover rate: ${(crossoverRate * 100).toFixed(0)}%`);

  function adaptiveMutate(genome: Genome, parentScore: number): Genome {
    const best = pop.pieces[0]?.score ?? 0.5, worst = pop.pieces[pop.pieces.length-1]?.score ?? 0;
    const f01 = (parentScore - worst) / Math.max(best - worst, 0.01);
    const passes = (f01 > 0.7 ? 1 : f01 > 0.4 ? 2 : 3) + (isStagnant ? 1 : 0);
    let m = genome;
    for (let p = 0; p < passes; p++) m = mutateGenome(m, rng);
    return m;
  }

  const offspring: Piece[] = [];
  let hofSeedCount = 0;
  const effOff = isStagnant ? OFFSPRING_PER_RUN + 4 : (isExtinction ? OFFSPRING_PER_RUN + 6 : OFFSPRING_PER_RUN);
  for (let i = 0; i < effOff; i++) {
    let childGenome: Genome;

    // Hall of Fame seeding: occasionally revive proven genetics from the hall of fame
    // This injects high-quality genomes back into the gene pool, mutated to explore nearby space
    if (rng() < HOF_SEEDING_RATE && pop.hallOfFame.length > 0) {
      const hofParent = pop.hallOfFame[Math.floor(rng() * pop.hallOfFame.length)];
      childGenome = adaptiveMutate(hofParent.genome, hofParent.score);
      childGenome.lineage = [...hofParent.genome.lineage.slice(-2), "HoF"];
      hofSeedCount++;
      console.log(`  HoF seed: ${hofParent.genome.type}@${(hofParent.score*100).toFixed(1)}% → mutated offspring`);
    } else if (rng() < crossoverRate && pop.pieces.length >= 2) {
      const parent = tournamentSelect(pop.pieces);
      // Prefer inter-species crossover when diversity is low
      let other = tournamentSelect(pop.pieces);
      let att = 0;
      const preferInterSpecies = diversityIndex < 0.5;
      while (att < 8 && (other.id === parent.id || (preferInterSpecies && other.genome.type === parent.genome.type && att < 5))) {
        other = tournamentSelect(pop.pieces);
        att++;
      }
      childGenome = crossoverGenomes(parent.genome, other.genome, rng);
      if (rng() < 0.5) childGenome = mutateGenome(childGenome, rng);
      console.log(`  Crossover ${parent.genome.type}\u00d7${other.genome.type} \u2192 ${childGenome.type}`);
    } else {
      const parent = tournamentSelect(pop.pieces);
      childGenome = adaptiveMutate(parent.genome, parent.score);
    }
    const child = generatePiece(childGenome, gen, popMetrics);
    offspring.push(child);
    console.log(`  Offspring ${child.id}: ${child.genome.type} \u2192 ${(child.score*100).toFixed(1)}% (novelty: ${(child.metrics.novelty*100).toFixed(0)}%)`);
  }
  if (hofSeedCount > 0) console.log(`  Hall of Fame seeding: ${hofSeedCount} offspring from proven genetics`);

  // Age penalty on incumbent population (not offspring — they're generation 0)
  const agePenaltyApplied = applyAgePenalty(pop.pieces, gen);
  if (agePenaltyApplied > 0) console.log(`  Age penalty applied to ${agePenaltyApplied} incumbent pieces`);

  // Fitness sharing + niche pressure
  const allPieces = [...pop.pieces, ...offspring];
  const SHARING_RADIUS = 0.15;
  const sharedScores = new Map<string, number>();
  for (const piece of allPieces) {
    const sameType = allPieces.filter(p => p.genome.type === piece.genome.type);
    let nc = 0;
    for (const o of sameType) { const d = metricDistance(piece.metrics, o.metrics); if (d < SHARING_RADIUS) nc += 1 - d/SHARING_RADIUS; }
    // Apply niche bonus: underrepresented species get a scoring uplift
    const bonus = nicheBonus[piece.genome.type] ?? 0;
    sharedScores.set(piece.id, (piece.score + bonus) / Math.max(nc, 1));
  }

  // Crowding distance — NSGA-II style diversity preservation
  const crowdingDistances = computeCrowdingDistances(allPieces);
  const avgCrowding = [...crowdingDistances.values()].filter(v => v !== Infinity).reduce((s, v) => s + v, 0) /
    Math.max([...crowdingDistances.values()].filter(v => v !== Infinity).length, 1);

  // Combined ranking: shared score as primary, crowding distance as tiebreaker
  // When two pieces have similar shared scores (within 2%), prefer the more isolated one
  allPieces.sort((a, b) => {
    const sa = sharedScores.get(a.id) ?? a.score;
    const sb = sharedScores.get(b.id) ?? b.score;
    if (Math.abs(sa - sb) > 0.02) return sb - sa; // clear winner by score
    // Tiebreak: prefer higher crowding distance (more isolated in metric space)
    const ca = crowdingDistances.get(a.id) ?? 0;
    const cb = crowdingDistances.get(b.id) ?? 0;
    return cb - ca;
  });

  // Pareto front size for telemetry
  const paretoFrontSize = countParetoFront(allPieces);

  // Elitism: top N pieces survive unchanged (prevents regression)
  const elites = allPieces.slice(0, ELITE_COUNT);
  console.log(`  Elites preserved: ${elites.map(e => `${e.genome.type}@${(e.score*100).toFixed(1)}%`).join(", ")}`);
  console.log(`  Pareto front: ${paretoFrontSize} pieces | Avg crowding: ${avgCrowding.toFixed(3)}`);

  // Speciation-aware selection
  const survivors: Piece[] = [];
  const reserved = new Set<string>();

  // Elite pieces are always included
  for (const p of elites) {
    survivors.push(p);
    reserved.add(p.id);
  }

  // Second pass: reserve top pieces per type (that aren't already elite)
  for (const type of GENOME_TYPES) {
    const ofType = allPieces.filter((p) => p.genome.type === type && !reserved.has(p.id));
    const toReserve = ofType.slice(0, MIN_SLOTS_PER_TYPE);
    for (const p of toReserve) {
      survivors.push(p);
      reserved.add(p.id);
    }
  }

  // Fill remaining slots with best overall (not already reserved)
  for (const p of allPieces) {
    if (survivors.length >= POPULATION_SIZE) break;
    if (!reserved.has(p.id)) {
      survivors.push(p);
    }
  }

  survivors.sort((a, b) => b.score - a.score);
  const culled = allPieces.length - survivors.length;

  // Log species diversity
  const typeCounts: Record<string, number> = {};
  for (const p of survivors) {
    typeCounts[p.genome.type] = (typeCounts[p.genome.type] || 0) + 1;
  }
  console.log(`  Species: ${Object.entries(typeCounts).map(([t, n]) => `${t}=${n}`).join(", ")}`);

  // Check for hall of fame entries (check all survivors, not just offspring)
  const newHallEntries: Piece[] = [];
  for (const piece of survivors) {
    if (
      piece.score >= HALL_OF_FAME_THRESHOLD &&
      !pop.hallOfFame.some((h) => h.id === piece.id)
    ) {
      newHallEntries.push(piece);
      pop.hallOfFame.push(piece);
    }
  }

  // Keep hall of fame bounded
  pop.hallOfFame = pop.hallOfFame
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  // Update stats
  const avgScore = survivors.reduce((s, p) => s + p.score, 0) / survivors.length;
  const bestScore = survivors[0]?.score ?? 0;

  pop.generation = gen;
  pop.pieces = survivors.map((p) => ({ ...p, grid: [] })); // don't store full grids in population
  pop.stats.totalPiecesEver += offspring.length;
  pop.stats.bestScoreEver = Math.max(pop.stats.bestScoreEver, bestScore);
  pop.stats.avgScore = avgScore;

  // Save population to both Supabase and JSON
  await savePop(pop);

  // Compute species momentum (avg score change vs previous generation)
  const speciesMomentum: Record<string, number> = {};
  const prevGen = history[history.length - 1];
  if (prevGen) {
    for (const type of Object.keys(typeCounts)) {
      const currentAvg = survivors.filter(s => s.genome.type === type)
        .reduce((s, p) => s + p.score, 0) / (typeCounts[type] || 1);
      // Compare against previous generation's best score as a proxy
      const prevSpeciesCount = prevGen.speciesCounts?.[type] ?? 0;
      if (prevSpeciesCount > 0) {
        speciesMomentum[type] = +(currentAvg - prevGen.avgScore).toFixed(4);
      } else {
        speciesMomentum[type] = 0; // new species, no delta
      }
    }
  }

  // Compute max lineage depth (longest mutation chain in population)
  const maxLineageDepth = Math.max(...survivors.map(s => s.genome.mutations), 0);

  const genRecord: GenerationRecord = {
    generation: gen,
    bestScore: bestScore,
    avgScore: avgScore,
    epoch,
    speciesCounts: typeCounts,
    hallOfFameSize: pop.hallOfFame.length,
    timestamp: new Date().toISOString(),
    bestPiece: survivors[0] ? {
      id: survivors[0].id,
      genome: survivors[0].genome,
      score: survivors[0].score,
      metrics: survivors[0].metrics,
    } : undefined,
    extinctionEvent: isExtinction,
    extinctionTrigger: isExtinction ? extinctionTrigger : undefined,
    eliteSurvivors: ELITE_COUNT,
    crossoverRate,
    diversityIndex,
    speciesMomentum,
    nicheBonus: hasNicheBonus ? nicheBonus : undefined,
    maxLineageDepth,
    stagnationStreak: isStagnant ? stagnationStreak : 0,
    hofSeedCount: hofSeedCount > 0 ? hofSeedCount : undefined,
    avgCrowdingDistance: +avgCrowding.toFixed(4),
    agePenaltyApplied: agePenaltyApplied > 0 ? agePenaltyApplied : undefined,
    paretoFrontSize,
  };
  history.push(genRecord);
  writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));

  // Save generation record and archive ALL pieces (survivors + culled) to Supabase
  await saveGen(genRecord, epoch);
  await archiveAllPieces(allPieces.map((p) => ({ ...p, grid: [] })), epoch);
  await saveHallOfFameEntries(
    newHallEntries.map((p) => {
      const full = generatePiece(p.genome, gen);
      return { ...full, id: p.id };
    }),
    epoch
  );

  // Export gallery.json for GitHub Pages site
  const DOCS_DIR = join(PROJECT_DIR, "docs");
  mkdirSync(DOCS_DIR, { recursive: true });
  // Build archive from history — re-render each generation's best piece
  const archive = history
    .filter((h) => h.bestPiece)
    .map((h) => {
      const bp = h.bestPiece!;
      const full = generatePiece(bp.genome, h.generation);
      return {
        generation: h.generation,
        epoch: h.epoch,
        timestamp: h.timestamp,
        id: bp.id,
        genome: bp.genome,
        score: bp.score,
        metrics: bp.metrics,
        rendered: full.rendered,
      };
    });

  // Supplement archive with hall of fame pieces from generations not covered
  const archiveGens = new Set(archive.map((a) => a.generation));
  for (const hofPiece of pop.hallOfFame) {
    if (!archiveGens.has(hofPiece.generation)) {
      const full = generatePiece(hofPiece.genome, hofPiece.generation);
      const histEntry = history.find((h) => h.generation === hofPiece.generation);
      archive.push({
        generation: hofPiece.generation,
        epoch: histEntry?.epoch ?? getEpoch(hofPiece.generation),
        timestamp: hofPiece.createdAt,
        id: hofPiece.id,
        genome: hofPiece.genome,
        score: hofPiece.score,
        metrics: hofPiece.metrics,
        rendered: full.rendered,
      });
      archiveGens.add(hofPiece.generation);
    }
  }
  archive.sort((a, b) => b.generation - a.generation);

  const galleryExport = {
    generation: gen,
    stats: pop.stats,
    history,
    archive,
    hallOfFame: pop.hallOfFame.map((p) => {
      const full = generatePiece(p.genome, p.generation);
      return { ...p, rendered: full.rendered };
    }),
    pieces: survivors.slice(0, 8).map((p) => {
      const full = generatePiece(p.genome, gen);
      return { ...p, rendered: full.rendered };
    }),
  };
  writeFileSync(join(DOCS_DIR, "gallery.json"), JSON.stringify(galleryExport, null, 2));

  // Save best piece rendering
  const best = allPieces[0];
  if (best) {
    const bestFile = join(GALLERY_DIR, `gen${gen}-best.txt`);
    writeFileSync(bestFile, formatPieceForDiscord(best));
  }

  // Summary
  console.log(`\nGeneration ${gen} complete:`);
  console.log(`  Population: ${survivors.length} (culled ${culled})`);
  console.log(`  Best score: ${(bestScore * 100).toFixed(1)}% (all-time: ${(pop.stats.bestScoreEver * 100).toFixed(1)}%)`);
  console.log(`  Avg score: ${(avgScore * 100).toFixed(1)}%`);
  console.log(`  Hall of Fame: ${pop.hallOfFame.length} pieces`);
  console.log(`  Total pieces ever: ${pop.stats.totalPiecesEver}`);
  if (useSupabase) {
    console.log(`  [supabase] All data synced to cloud`);
  }

  // Notify Discord with best piece or summary
  if (newHallEntries.length > 0) {
    const best = newHallEntries.sort((a, b) => b.score - a.score)[0];
    // Regenerate with grid for rendering
    const fullPiece = generatePiece(best.genome, gen);
    notify(formatPieceForDiscord(fullPiece));
    console.log(`\n  ★ New hall of fame entry posted to Discord!`);
  } else if (gen % 5 === 0) {
    // Every 5 generations, post a status update with the current best
    const fullBest = generatePiece(survivors[0].genome, gen);
    const status = [
      `**Lattice Status — Generation ${gen}** (Epoch: *${epoch}*)`,
      `${getEpochDescription(epoch)}`,
      `Population: ${survivors.length} | Best: ${(bestScore * 100).toFixed(1)}% | Avg: ${(avgScore * 100).toFixed(1)}%`,
      `Species: ${Object.entries(typeCounts).map(([t, n]) => `${t}=${n}`).join(", ")}`,
      `Hall of Fame: ${pop.hallOfFame.length} | Total pieces: ${pop.stats.totalPiecesEver}`,
      "",
      "Current best:",
      "```",
      fullBest.rendered,
      "```",
    ].join("\n");
    notify(status);
    console.log(`\n  Posted generation ${gen} status to Discord`);
  }
}

run();
