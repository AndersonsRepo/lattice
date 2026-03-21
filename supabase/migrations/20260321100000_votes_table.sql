-- Votes table for community curation
CREATE TABLE IF NOT EXISTS lattice.votes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  piece_id uuid NOT NULL,
  voter_fingerprint text NOT NULL,
  vote smallint NOT NULL CHECK (vote IN (1, -1)),
  created_at timestamptz DEFAULT now(),
  UNIQUE(piece_id, voter_fingerprint)
);

-- Index for fast aggregation
CREATE INDEX idx_votes_piece_id ON lattice.votes(piece_id);

-- RLS: anyone can read vote counts, anyone can insert/update their own vote
ALTER TABLE lattice.votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read votes" ON lattice.votes FOR SELECT USING (true);
CREATE POLICY "Anyone can vote" ON lattice.votes FOR INSERT WITH CHECK (true);
CREATE POLICY "Voters can change their vote" ON lattice.votes FOR UPDATE USING (true);

-- Aggregated vote counts view
CREATE OR REPLACE VIEW lattice.vote_counts AS
SELECT piece_id,
       SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END)::int as upvotes,
       SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END)::int as downvotes,
       SUM(vote)::int as net_score
FROM lattice.votes
GROUP BY piece_id;

-- Expose vote_counts view via REST API
GRANT SELECT ON lattice.vote_counts TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON lattice.votes TO anon, authenticated;
