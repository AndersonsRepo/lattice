-- Enable Supabase Realtime on lattice tables
ALTER PUBLICATION supabase_realtime ADD TABLE lattice.archive;
ALTER PUBLICATION supabase_realtime ADD TABLE lattice.hall_of_fame;
ALTER PUBLICATION supabase_realtime ADD TABLE lattice.generations;
ALTER PUBLICATION supabase_realtime ADD TABLE lattice.population;
