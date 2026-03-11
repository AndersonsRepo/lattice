#!/usr/bin/env npx tsx
/**
 * Preview a specific genome type from the current population
 * Usage: npx tsx src/preview.ts [1d|2d|lsystem]
 */
import { readFileSync } from "fs";
import { join } from "path";
import { evolveLSystem, evolve1D, evolve2D, render } from "./automata.js";

const popFile = join(import.meta.dirname, "..", "gallery", "population.json");
const pop = JSON.parse(readFileSync(popFile, "utf-8"));
const targetType = process.argv[2] || "lsystem";

const piece = pop.pieces.find((p: any) => p.genome.type === targetType);
if (!piece) {
  console.log(`No ${targetType} pieces in population`);
  process.exit(1);
}

console.log(`=== ${targetType.toUpperCase()} — Score: ${(piece.score * 100).toFixed(1)}% ===`);
console.log(`Rule: ${JSON.stringify(piece.genome.rule)}`);
console.log(`Palette: ${piece.genome.palette.join("")}`);
console.log(`Canvas: ${piece.genome.width}×${piece.genome.height}`);
console.log();

let grid: number[][];
if (piece.genome.type === "lsystem") grid = evolveLSystem(piece.genome);
else if (piece.genome.type === "1d") grid = evolve1D(piece.genome);
else grid = evolve2D(piece.genome);

console.log(render(grid, piece.genome.palette));
