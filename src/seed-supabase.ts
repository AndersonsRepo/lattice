#!/usr/bin/env npx tsx
/**
 * Lattice — One-time Supabase migration
 *
 * Reads existing gallery/population.json and gallery/history.json,
 * then uploads all data to Supabase tables.
 *
 * Run: npx tsx src/seed-supabase.ts
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  isSupabaseConfigured,
  savePopulation,
  saveGeneration,
  addToHallOfFame,
  archivePieces,
} from "./supabase.js";
import {
  Genome,
  Piece,
  PieceMetrics,
  getEpoch,
} from "./automata.js";

const PROJECT_DIR = join(import.meta.dirname, "..");
const GALLERY_DIR = join(PROJECT_DIR, "gallery");
const POPULATION_FILE = join(GALLERY_DIR, "population.json");
const HISTORY_FILE = join(GALLERY_DIR, "history.json");

interface GenerationRecord {
  generation: number;
  bestScore: number;
  avgScore: number;
  epoch: string;
  speciesCounts: Record<string, number>;
  hallOfFameSize: number;
  timestamp: string;
  bestPiece?: {
    id: string;
    genome: Genome;
    score: number;
    metrics: PieceMetrics;
  };
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

async function seed() {
  if (!isSupabaseConfigured()) {
    console.error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env");
    process.exit(1);
  }

  console.log("=== Lattice Supabase Seed ===\n");

  // 1. Load population
  let pop: Population | null = null;
  if (existsSync(POPULATION_FILE)) {
    pop = JSON.parse(readFileSync(POPULATION_FILE, "utf-8"));
    console.log(`Population: ${pop!.pieces.length} pieces, generation ${pop!.generation}`);
    console.log(`Hall of Fame: ${pop!.hallOfFame.length} pieces`);
  } else {
    console.log("No population.json found — skipping population seed");
  }

  // 2. Load history
  let history: GenerationRecord[] = [];
  if (existsSync(HISTORY_FILE)) {
    history = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
    console.log(`History: ${history.length} generation records`);
  } else {
    console.log("No history.json found — skipping history seed");
  }

  // 3. Upload population
  if (pop && pop.pieces.length > 0) {
    console.log("\nUploading population...");
    try {
      await savePopulation(pop.pieces);
      console.log(`  Done — ${pop.pieces.length} pieces uploaded`);
    } catch (err) {
      console.error(`  Failed: ${err}`);
    }
  }

  // 4. Upload hall of fame
  if (pop && pop.hallOfFame.length > 0) {
    console.log("\nUploading hall of fame...");
    let uploaded = 0;
    for (const piece of pop.hallOfFame) {
      const histEntry = history.find((h) => h.generation === piece.generation);
      const epoch = histEntry?.epoch ?? getEpoch(piece.generation);
      try {
        await addToHallOfFame(piece, epoch);
        uploaded++;
      } catch (err) {
        console.error(`  Failed to upload ${piece.id}: ${err}`);
      }
    }
    console.log(`  Done — ${uploaded}/${pop.hallOfFame.length} pieces uploaded`);
  }

  // 5. Upload generation history
  if (history.length > 0) {
    console.log("\nUploading generation history...");
    // Batch in chunks to avoid overwhelming the API
    const BATCH_SIZE = 20;
    let uploaded = 0;
    for (let i = 0; i < history.length; i += BATCH_SIZE) {
      const batch = history.slice(i, i + BATCH_SIZE);
      const promises = batch.map((record) =>
        saveGeneration({
          generation: record.generation,
          epoch: record.epoch,
          bestScore: record.bestScore,
          avgScore: record.avgScore,
          speciesCounts: record.speciesCounts,
          hallOfFameSize: record.hallOfFameSize,
          bestPieceId: record.bestPiece?.id,
          bestPieceGenome: record.bestPiece?.genome,
        }).then(() => { uploaded++; })
        .catch((err: any) => {
          console.error(`  Failed gen ${record.generation}: ${err}`);
        })
      );
      await Promise.all(promises);
      console.log(`  Progress: ${Math.min(i + BATCH_SIZE, history.length)}/${history.length}`);
    }
    console.log(`  Done — ${uploaded}/${history.length} generation records uploaded`);
  }

  // 6. Archive best pieces from history (deduplicated — same piece can be best across multiple gens)
  const seenIds = new Set<string>();
  const archivePieceList: Piece[] = [];
  for (const record of history) {
    if (record.bestPiece && !seenIds.has(record.bestPiece.id)) {
      seenIds.add(record.bestPiece.id);
      archivePieceList.push({
        id: record.bestPiece.id,
        genome: record.bestPiece.genome,
        grid: [],
        rendered: "",
        score: record.bestPiece.score,
        metrics: record.bestPiece.metrics,
        generation: record.generation,
        createdAt: record.timestamp,
      });
    }
  }

  if (archivePieceList.length > 0) {
    console.log(`\nArchiving ${archivePieceList.length} best pieces from history...`);
    // Batch archive in chunks
    // archivePieces expects a uniform epoch but pieces span multiple epochs,
    // so group by epoch and upload each group
    const byEpoch = new Map<string, Piece[]>();
    for (const piece of archivePieceList) {
      const epoch = history.find((h) => h.generation === piece.generation)?.epoch ?? "emergence";
      if (!byEpoch.has(epoch)) byEpoch.set(epoch, []);
      byEpoch.get(epoch)!.push(piece);
    }
    let uploaded = 0;
    for (const [epoch, batch] of byEpoch) {
      try {
        await archivePieces(batch, epoch);
        uploaded += batch.length;
        console.log(`  Epoch "${epoch}": ${batch.length} pieces archived`);
      } catch (err) {
        console.error(`  Failed epoch "${epoch}": ${err}`);
      }
    }
    console.log(`  Done — ${uploaded} pieces archived`);
  }

  console.log("\n=== Seed complete ===");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
