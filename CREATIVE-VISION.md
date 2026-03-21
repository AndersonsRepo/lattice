# Lattice Creative Vision

This file guides the autonomous creative expansion of the Lattice website.
Each cycle, Claude reads this file and the creative log, picks something
compelling, implements it, and pushes to GitHub. Vercel auto-deploys from main.

## Principles

- **The art comes first.** Every addition should serve the beauty of the work.
- **Build what's interesting.** Follow genuine curiosity, not a checklist.
- **Cohesion matters.** New pages/features should feel like they belong in the same universe — dark theme, monospace, the accent purple/green palette.
- **Progressive enhancement.** Each addition should stand alone but also enrich the whole.
- **Don't break what works.** Test that existing pages still load after changes.

## Infrastructure

Lattice runs on a real stack now — not just static files.

- **Vercel** — auto-deploys from GitHub `main` branch. Serves `docs/` as static. Supports Vercel Serverless Functions (`api/` directory) and Edge Functions for dynamic features. Live at https://lattice-self.vercel.app
- **Supabase** — PostgreSQL backend on `lattice` schema. Tables: `population`, `hall_of_fame`, `generations`, `archive`. RLS policies allow anonymous reads, service-role writes. REST API via PostgREST with `Accept-Profile: lattice` header.
- **GitHub** — source of truth. Push to `main` triggers Vercel deploy. Evolution engine (`src/evolve.ts`) writes to both Supabase and local JSON (fallback).

This unlocks capabilities that were impossible when Lattice was static-only.

## Creative Directions

These are seeds, not assignments. Combine them, mutate them, ignore them
in favor of something better. The point is to surprise and delight.

### Unlocked by Supabase (Live Data)
- **Real-time gallery** — pieces appear on the site the moment evolution creates them, no redeploy needed. The archive table is the source of truth.
- **Evolution pulse** — a live-updating dashboard showing the current generation, population health, epoch, and score trends. WebSocket or polling against Supabase.
- **Historical deep-dive** — every generation's data is in the DB. Build rich interactive timelines, filterable by epoch, species, score range, date. SQL-powered, not limited to what fits in a JSON file.
- **Piece permalink** — `/piece/<id>` pages that fetch a single piece from Supabase by ID. Shareable links to individual artworks.
- **Search & filter** — server-side filtering by type, score range, generation range, epoch. Supabase handles the query; the frontend stays fast.
- **Statistics API** — aggregate queries (avg score by epoch, species survival rates, mutation effectiveness) computed in SQL, served as JSON endpoints.

### Unlocked by Vercel (Dynamic Backend)
- **Serverless API routes** (`api/`) — thin endpoints that query Supabase and return shaped data. Keeps anon keys out of client-side code for sensitive operations.
- **OG image generation** — dynamic Open Graph images using `@vercel/og`. Share a piece link on Discord/Twitter and see the actual artwork as the preview card, rendered on-the-fly from genome data.
- **Voting API** — visitors upvote/downvote pieces via API route → Supabase `votes` table. No localStorage limitations, works across devices. Could feed back into fitness scoring.
- **Visitor creations** — pieces made in Create mode can be submitted to a `community_pieces` table via API. Curated community gallery.
- **Webhook receiver** — Vercel endpoint that the harness hits after each evolution cycle, triggering cache invalidation or Discord notifications.
- **Edge caching** — Vercel Edge Network caches API responses with short TTLs (30-60s) so the site stays fast globally while still showing near-live data.

### Visual & Interactive
- **Piece detail lightbox** — click a card in the gallery to see full-size render, lineage tree, mutation history, metric breakdown
- **Lineage graph** — force-directed or phylogenetic tree showing how pieces descend from each other (the lineage data is in each genome)
- **3D extrusion** — use Three.js to interpret grid values as height maps, turn flat pieces into navigable 3D landscapes
- **Comparison view** — side-by-side pieces to see how different genomes produce different aesthetics
- **Zoom into cells** — click a region of a piece to zoom in and see the micro-structure

### Data & Storytelling
- **Genome DNA viewer** — visualize the raw genome as a stylized double-helix or barcode
- **Epoch deep-dive** — dedicated sections explaining what each epoch (emergence, order, chaos, harmony) favors and showing exemplars
- **Statistics dashboard** — rich charts powered by SQL aggregates: score distributions, type survival rates, mutation effectiveness, diversity over time

### Technical & Meta
- **About page** — explain how the system works: evolution, scoring, epochs. Make the process itself part of the art
- **Algorithm visualizer** — show how each engine works step by step (e.g., how reaction-diffusion chemicals interact)
- **RSS/Atom feed** — Vercel API route that generates Atom XML from recent archive entries
- **OG social cards** — dynamic preview images via `@vercel/og` when sharing piece links
- **PWA manifest** — make it installable as an app, especially the live mode
- **Performance polish** — lazy loading, image placeholders, smoother scroll animations
- **Accessibility** — screen reader descriptions of pieces, keyboard navigation

### Experimental
- **Collaborative evolution** — visitors vote on pieces (stored in Supabase), votes influence the next generation's fitness function
- **Community gallery** — visitor-created pieces from Create mode, submitted via API, stored in Supabase, curated separately from evolved pieces
- **Generative poetry** — pair each piece with a haiku or short poem generated from its metrics
- **Seasonal themes** — the site's color palette subtly shifts with the time of year
- **Evolution-as-a-service** — API endpoint that lets visitors trigger a single micro-evolution step and watch the result in real time

## Constraints

- Frontend lives in `docs/` — Vercel serves this as the static root
- API routes live in `api/` — Vercel Serverless Functions (Node.js runtime)
- Supabase queries should use the anon key for reads, service role key only server-side (API routes, evolution engine)
- Never expose the service role key in client-side code
- Keep Supabase usage credit-conscious — avoid expensive queries in hot paths, use Vercel edge caching where possible
- Don't modify `gallery.json` structure — it's the offline fallback, generated by `evolve.ts`
- Keep total page sizes reasonable (< 500KB per HTML file)
- Preserve the existing dark aesthetic
