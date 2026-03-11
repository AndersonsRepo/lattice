#!/usr/bin/env npx tsx
/**
 * Lattice — Evolution Runner
 *
 * Each run:
 * 1. Loads the current population from gallery/population.json
 * 2. Generates new pieces by mutating the best performers
 * 3. Scores and ranks all pieces
 * 4. Keeps the top N, culls the rest
 * 5. Saves standout pieces to gallery/
 * 6. Writes a summary for Discord notification
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
  render,
  score,
  computeScore,
  mutateGenome,
} from "./automata.js";

const PROJECT_DIR = join(import.meta.dirname, "..");
const GALLERY_DIR = join(PROJECT_DIR, "gallery");
const POPULATION_FILE = join(GALLERY_DIR, "population.json");
const HISTORY_FILE = join(GALLERY_DIR, "history.json");
const NOTIFY_FILE = join(
  process.env.HARNESS_ROOT || "/Users/andersonedmond/.local/ai-harness",
  "heartbeat-tasks",
  "pending-notifications.jsonl"
);

const POPULATION_SIZE = 12;
const OFFSPRING_PER_RUN = 6;
const HALL_OF_FAME_THRESHOLD = 0.7;

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

function loadPopulation(): Population {
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

function savePopulation(pop: Population): void {
  const tmp = POPULATION_FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(pop, null, 2));
  renameSync(tmp, POPULATION_FILE);
}

function generatePiece(genome: Genome, generation: number): Piece {
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
    default:
      grid = evolve1D(genome);
  }

  const metrics = score(grid);
  const totalScore = computeScore(metrics);
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
    : "L-System";

  const ruleStr = piece.genome.type === "1d"
    ? `Rule ${(piece.genome.rule as any).number}`
    : piece.genome.type === "2d"
    ? `B${(piece.genome.rule as any).birth.join("")}/S${(piece.genome.rule as any).survive.join("")}`
    : `angle=${(piece.genome.rule as any).angle}°`;

  return [
    `**Lattice Gen ${piece.generation}** — ${typeLabel} (${ruleStr})`,
    `Score: **${(piece.score * 100).toFixed(1)}%** | ` +
      `Complexity: ${piece.metrics.complexity.toFixed(2)} | ` +
      `Symmetry: ${(piece.metrics.symmetry * 100).toFixed(0)}% | ` +
      `Density: ${(piece.metrics.density * 100).toFixed(0)}%`,
    "```",
    piece.rendered,
    "```",
    `Mutations: ${piece.genome.mutations} | Lineage depth: ${piece.genome.lineage.length}`,
  ].join("\n");
}

function run(): void {
  mkdirSync(GALLERY_DIR, { recursive: true });

  const pop = loadPopulation();
  const gen = pop.generation + 1;
  const rng = () => Math.random(); // use true random for evolution

  console.log(`\n=== Lattice Generation ${gen} ===`);

  // If no population, seed it
  if (pop.pieces.length === 0) {
    console.log("Seeding initial population...");
    for (const genome of SEED_GENOMES) {
      const piece = generatePiece(genome, gen);
      pop.pieces.push(piece);
      console.log(`  ${piece.id}: ${piece.genome.type} → score ${(piece.score * 100).toFixed(1)}%`);
    }
  }

  // Generate offspring from top performers
  const sorted = [...pop.pieces].sort((a, b) => b.score - a.score);
  const parents = sorted.slice(0, Math.ceil(sorted.length / 2));

  const offspring: Piece[] = [];
  for (let i = 0; i < OFFSPRING_PER_RUN; i++) {
    const parent = parents[Math.floor(rng() * parents.length)];
    const childGenome = mutateGenome(parent.genome, rng);
    const child = generatePiece(childGenome, gen);
    offspring.push(child);
    console.log(
      `  Offspring ${child.id}: ${child.genome.type} → score ${(child.score * 100).toFixed(1)}% ` +
        `(parent: ${parent.id}, score ${(parent.score * 100).toFixed(1)}%)`
    );
  }

  // Combine and select
  const allPieces = [...pop.pieces, ...offspring].sort((a, b) => b.score - a.score);
  const survivors = allPieces.slice(0, POPULATION_SIZE);
  const culled = allPieces.length - survivors.length;

  // Check for hall of fame entries
  const newHallEntries: Piece[] = [];
  for (const piece of offspring) {
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

  savePopulation(pop);

  // Export gallery.json for GitHub Pages site
  const DOCS_DIR = join(PROJECT_DIR, "docs");
  mkdirSync(DOCS_DIR, { recursive: true });
  const galleryExport = {
    generation: gen,
    stats: pop.stats,
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
      `**Lattice Status — Generation ${gen}**`,
      `Population: ${survivors.length} | Best: ${(bestScore * 100).toFixed(1)}% | Avg: ${(avgScore * 100).toFixed(1)}%`,
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
