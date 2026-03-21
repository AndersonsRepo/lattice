-- Lattice evolution schema
CREATE SCHEMA IF NOT EXISTS lattice;

-- Population: current living pieces (replaces population.json)
CREATE TABLE lattice.population (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  genome JSONB NOT NULL,        -- {type, rule, width, height, palette, seed, mutations, lineage}
  score REAL NOT NULL,
  metrics JSONB NOT NULL,       -- {complexity, symmetry, density, novelty, edgeActivity, structuralInterest, fractalDimension, informationDensity}
  rendered TEXT,                -- ASCII art render
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Hall of Fame: archived high-scoring pieces (score >= 0.55)
CREATE TABLE lattice.hall_of_fame (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  epoch TEXT NOT NULL,           -- emergence, order, chaos, harmony
  genome JSONB NOT NULL,
  score REAL NOT NULL,
  metrics JSONB NOT NULL,
  rendered TEXT,
  inducted_at TIMESTAMPTZ DEFAULT NOW()
);

-- Evolution history: one row per generation (replaces history.json)
CREATE TABLE lattice.generations (
  generation INTEGER PRIMARY KEY,
  epoch TEXT NOT NULL,
  best_score REAL NOT NULL,
  avg_score REAL NOT NULL,
  species_counts JSONB NOT NULL,  -- {life2d: 3, wfc: 4, ...}
  hall_of_fame_size INTEGER NOT NULL,
  best_piece_id TEXT,
  best_piece_genome JSONB,
  population_size INTEGER DEFAULT 14,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Piece archive: every piece ever generated (for analytics)
CREATE TABLE lattice.archive (
  id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  epoch TEXT NOT NULL,
  genome JSONB NOT NULL,
  score REAL NOT NULL,
  metrics JSONB NOT NULL,
  rendered TEXT,
  is_hall_of_fame BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_population_score ON lattice.population(score DESC);
CREATE INDEX idx_population_type ON lattice.population((genome->>'type'));
CREATE INDEX idx_hall_of_fame_score ON lattice.hall_of_fame(score DESC);
CREATE INDEX idx_generations_epoch ON lattice.generations(epoch);
CREATE INDEX idx_archive_generation ON lattice.archive(generation);
CREATE INDEX idx_archive_type ON lattice.archive((genome->>'type'));
CREATE INDEX idx_archive_score ON lattice.archive(score DESC);

-- RLS policies (public read, service role write)
ALTER TABLE lattice.population ENABLE ROW LEVEL SECURITY;
ALTER TABLE lattice.hall_of_fame ENABLE ROW LEVEL SECURITY;
ALTER TABLE lattice.generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lattice.archive ENABLE ROW LEVEL SECURITY;

-- Public read access (for the website to fetch live data)
CREATE POLICY "Public read population" ON lattice.population FOR SELECT USING (true);
CREATE POLICY "Public read hall_of_fame" ON lattice.hall_of_fame FOR SELECT USING (true);
CREATE POLICY "Public read generations" ON lattice.generations FOR SELECT USING (true);
CREATE POLICY "Public read archive" ON lattice.archive FOR SELECT USING (true);

-- Service role write access (for the evolution engine)
CREATE POLICY "Service write population" ON lattice.population FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write hall_of_fame" ON lattice.hall_of_fame FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write generations" ON lattice.generations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write archive" ON lattice.archive FOR ALL USING (true) WITH CHECK (true);
