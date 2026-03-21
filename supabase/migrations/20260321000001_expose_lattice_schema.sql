-- Expose the lattice schema via PostgREST (Supabase REST API)
-- This allows querying lattice tables via the REST API using Accept-Profile: lattice header
ALTER ROLE authenticator SET pgrst.db_schemas TO 'public, lattice';
NOTIFY pgrst, 'reload config';

-- Grant usage on the lattice schema to the API roles
GRANT USAGE ON SCHEMA lattice TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA lattice TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA lattice TO anon, authenticated, service_role;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA lattice GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA lattice GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
