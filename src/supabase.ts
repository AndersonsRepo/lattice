/**
 * Lattice — Supabase REST client (zero dependencies, raw fetch)
 *
 * Uses the PostgREST API with `Accept-Profile: lattice` to target the lattice schema.
 * Service role key for writes, anon key for reads.
 * Falls back gracefully if Supabase is unreachable.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Piece, PieceMetrics, Genome } from "./automata.js";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

function loadEnv(): Record<string, string> {
  const envPath = join(import.meta.dirname, "..", ".env");
  const vars: Record<string, string> = {};
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        vars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
      }
    }
  }
  return vars;
}

const env = loadEnv();

const SUPABASE_URL = process.env.SUPABASE_URL || env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_KEY || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "";

const REST_URL = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";

export function isSupabaseConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_KEY);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function headers(write: boolean = false): Record<string, string> {
  const key = write ? SUPABASE_SERVICE_KEY : SUPABASE_ANON_KEY;
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Accept-Profile": "lattice",
    "Content-Profile": "lattice",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
  };
}

async function supaFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  if (!REST_URL) throw new Error("Supabase not configured");
  const url = `${REST_URL}${path}`;
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Supabase ${opts.method || "GET"} ${path} → ${res.status}: ${body}`);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

export interface PopulationRow {
  id: string;
  generation: number;
  genome: Genome;
  score: number;
  metrics: PieceMetrics;
  rendered: string | null;
  created_at: string;
}

/** Load current population from lattice.population */
export async function loadPopulation(): Promise<Piece[]> {
  const res = await supaFetch("/population?order=score.desc", {
    method: "GET",
    headers: { ...headers(false), "Accept": "application/json" },
  });
  const rows: PopulationRow[] = await res.json();
  return rows.map(rowToPiece);
}

/** Replace the entire population (delete all, then upsert) */
export async function savePopulation(pieces: Piece[]): Promise<void> {
  // Delete all existing rows
  await supaFetch("/population?id=not.is.null", {
    method: "DELETE",
    headers: headers(true),
  });

  if (pieces.length === 0) return;

  // Insert new population
  const rows = pieces.map(pieceToRow);
  await supaFetch("/population", {
    method: "POST",
    headers: { ...headers(true), "Prefer": "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
}

// ---------------------------------------------------------------------------
// Generations (history)
// ---------------------------------------------------------------------------

export interface GenerationRow {
  generation: number;
  epoch: string;
  best_score: number;
  avg_score: number;
  species_counts: Record<string, number>;
  hall_of_fame_size: number;
  best_piece_id: string | null;
  best_piece_genome: Genome | null;
  population_size: number;
  created_at: string;
}

/** Load full generation history */
export async function loadHistory(): Promise<GenerationRow[]> {
  const res = await supaFetch("/generations?order=generation.asc", {
    method: "GET",
    headers: { ...headers(false), "Accept": "application/json" },
  });
  return res.json();
}

/** Insert a single generation record */
export async function saveGeneration(gen: {
  generation: number;
  epoch: string;
  bestScore: number;
  avgScore: number;
  speciesCounts: Record<string, number>;
  hallOfFameSize: number;
  bestPieceId?: string;
  bestPieceGenome?: Genome;
  populationSize?: number;
}): Promise<void> {
  const row = {
    generation: gen.generation,
    epoch: gen.epoch,
    best_score: gen.bestScore,
    avg_score: gen.avgScore,
    species_counts: gen.speciesCounts,
    hall_of_fame_size: gen.hallOfFameSize,
    best_piece_id: gen.bestPieceId || null,
    best_piece_genome: gen.bestPieceGenome || null,
    population_size: gen.populationSize ?? 14,
  };
  await supaFetch("/generations", {
    method: "POST",
    headers: { ...headers(true), "Prefer": "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
}

// ---------------------------------------------------------------------------
// Hall of Fame
// ---------------------------------------------------------------------------

/** Add a piece to the hall of fame */
export async function addToHallOfFame(piece: Piece, epoch: string): Promise<void> {
  const row = {
    id: piece.id,
    generation: piece.generation,
    epoch,
    genome: piece.genome,
    score: piece.score,
    metrics: piece.metrics,
    rendered: piece.rendered || null,
  };
  await supaFetch("/hall_of_fame", {
    method: "POST",
    headers: { ...headers(true), "Prefer": "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
}

/** Get hall of fame pieces ordered by score descending */
export async function getHallOfFame(): Promise<Piece[]> {
  const res = await supaFetch("/hall_of_fame?order=score.desc&limit=20", {
    method: "GET",
    headers: { ...headers(false), "Accept": "application/json" },
  });
  const rows = await res.json();
  return rows.map((r: any) => ({
    id: r.id,
    genome: r.genome,
    grid: [],
    rendered: r.rendered || "",
    score: r.score,
    metrics: r.metrics,
    generation: r.generation,
    createdAt: r.inducted_at || r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Archive
// ---------------------------------------------------------------------------

/** Bulk insert pieces to the archive */
export async function archivePieces(pieces: Piece[], epoch: string): Promise<void> {
  if (pieces.length === 0) return;

  // Deduplicate by ID within the batch (PostgREST upsert fails on intra-batch dupes)
  const seen = new Set<string>();
  const uniquePieces = pieces.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  const rows = uniquePieces.map((p) => ({
    id: p.id,
    generation: p.generation,
    epoch,
    genome: p.genome,
    score: p.score,
    metrics: p.metrics,
    rendered: p.rendered || null,
    is_hall_of_fame: false,
  }));

  // Use upsert to avoid conflicts with existing archive entries
  await supaFetch("/archive", {
    method: "POST",
    headers: { ...headers(true), "Prefer": "return=minimal,resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowToPiece(row: PopulationRow): Piece {
  return {
    id: row.id,
    genome: row.genome,
    grid: [], // grids are not stored in Supabase (too large)
    rendered: row.rendered || "",
    score: row.score,
    metrics: row.metrics,
    generation: row.generation,
    createdAt: row.created_at,
  };
}

function pieceToRow(p: Piece): Omit<PopulationRow, "created_at"> {
  return {
    id: p.id,
    generation: p.generation,
    genome: p.genome,
    score: p.score,
    metrics: p.metrics,
    rendered: p.rendered || null,
  };
}
