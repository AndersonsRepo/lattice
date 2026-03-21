import { ImageResponse } from '@vercel/og';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = 'https://fwwjtlafcrzeqfuqmexs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3d2p0bGFmY3J6ZXFmdXFtZXhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODE2MDM1MCwiZXhwIjoyMDgzNzM2MzUwfQ.pUu1ABMkwXGnQqz-x3D8uccaID4whh_Q6OyXEZUve3c';

const TYPE_COLORS: Record<string, { colors: string[] }> = {
  '1d':                  { colors: ['#0a0a0f', '#1a1a3e', '#3b2d8b', '#6b4edb', '#9d7af5', '#c8abff', '#e8d8ff', '#ffffff'] },
  '2d':                  { colors: ['#0a0a0f', '#0d2818', '#166b3a', '#22a95c', '#4ade80', '#7af5a8', '#b8ffd4', '#e8fff0'] },
  'lsystem':             { colors: ['#0a0a0f', '#2d1a0a', '#6b3a0d', '#a85c16', '#db8b22', '#f5b84a', '#ffe088', '#fff4cc'] },
  'reaction-diffusion':  { colors: ['#0a0a0f', '#1a0a2d', '#3b0d6b', '#6b16a8', '#a822db', '#d44af5', '#f088ff', '#ffccff'] },
  'voronoi':             { colors: ['#0a0a0f', '#0a1a2d', '#0d3b6b', '#166ba8', '#22a8db', '#4ad4f5', '#88eeff', '#ccf8ff'] },
  'wfc':                 { colors: ['#0a0a0f', '#2d0a0a', '#6b0d1a', '#a8163b', '#db226b', '#f54a9d', '#ff88c8', '#ffccee'] },
  'spirograph':          { colors: ['#0a0a0f', '#1a2d0a', '#3b6b0d', '#6ba816', '#a8db22', '#d4f54a', '#eeff88', '#ffffcc'] },
  'attractor':           { colors: ['#0a0a0f', '#2d1a1a', '#6b2d2d', '#a84a3b', '#db6b4a', '#f59d6b', '#ffc8a0', '#ffe8d8'] },
  'julia':               { colors: ['#0a0a0f', '#0a2d2d', '#0d6b5b', '#16a88a', '#22dbb5', '#4af5d4', '#88ffe8', '#ccfff4'] },
  'noise':               { colors: ['#0a0a0f', '#1a1a0a', '#3b3b0d', '#6b6b16', '#a8a822', '#d4d44a', '#eeff88', '#ffffcc'] },
  'flowfield':           { colors: ['#0a0a0f', '#0a1a1a', '#0d3b3b', '#166b6b', '#22a8a8', '#4ad4d4', '#88eeff', '#ccffff'] },
};

const TYPE_LABELS: Record<string, string> = {
  '1d': '1D Automaton', '2d': '2D Life-like', 'lsystem': 'L-System',
  'reaction-diffusion': 'Reaction-Diffusion', 'voronoi': 'Voronoi',
  'wfc': 'Wave Function Collapse', 'spirograph': 'Spirograph',
  'attractor': 'Strange Attractor', 'julia': 'Julia Set',
  'noise': 'Fractal Noise', 'flowfield': 'Flow Field',
};

function charIntensity(ch: string): number {
  if (ch === ' ') return 0;
  const light = '\u00B7.:~\u2801';
  const med1  = '\u2591\u2022\u2248\u2803\u25B3\u25BD\u2726';
  const med2  = '\u2592\u25CB\u223F\u2807\u25C7\u2727\u2766';
  const med3  = '\u2593\u25CF\u224B\u280F\u25C8\u2605\u273F';
  const heavy = '\u2588\u25C6\u2307\u281F\u2B21\u2736\u2740\u2741';
  const max   = '\u2573\u25D0\u25D1\u25D2\u25D3\u2301\u283F\u28FF\u2B22\u2739\u273A';
  if (light.includes(ch)) return 1;
  if (med1.includes(ch))  return 2;
  if (med2.includes(ch))  return 3;
  if (med3.includes(ch))  return 4;
  if (heavy.includes(ch)) return 5;
  if (max.includes(ch))   return 6;
  return 3;
}

async function fetchPiece(id: string) {
  const headers: Record<string, string> = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Accept-Profile': 'lattice',
    'Accept': 'application/json',
  };
  const base = `${SUPABASE_URL}/rest/v1`;
  const tables = ['archive', 'hall_of_fame', 'population'];

  for (const table of tables) {
    const res = await fetch(`${base}/${table}?id=eq.${id}&limit=1`, { headers });
    if (res.ok) {
      const rows = await res.json();
      if (rows.length > 0) return rows[0];
    }
  }
  return null;
}

export default async function handler(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return new Response('Missing id parameter', { status: 400 });
  }

  const piece = await fetchPiece(id);

  if (!piece) {
    // Return a fallback OG image with just the Lattice branding
    return new ImageResponse(
      (
        <div style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: '#0a0a0f', color: '#7c6fe0',
          fontFamily: 'monospace', fontSize: 48, letterSpacing: '0.3em',
        }}>
          LATTICE
        </div>
      ),
      { width: 1200, height: 630 },
    );
  }

  const genome = piece.genome || {};
  const genomeType: string = genome.type || '2d';
  const theme = TYPE_COLORS[genomeType] || TYPE_COLORS['2d'];
  const score = piece.score || 0;
  const gen = piece.generation || 0;
  const label = TYPE_LABELS[genomeType] || genomeType;
  const rendered: string = piece.rendered || '';

  // Parse the rendered grid into rows of characters
  const lines = rendered.split('\n').filter((l: string) => l.length > 0);
  const gridHeight = lines.length;
  const gridWidth = Math.max(...lines.map((l: string) => [...l].length), 1);

  // Calculate cell size to fit within the art area (right side of the image)
  // Art area: roughly 700x500 (leaving space for text on the left)
  const artW = 680;
  const artH = 500;
  const cellSize = Math.max(1, Math.min(
    Math.floor(artW / gridWidth),
    Math.floor(artH / gridHeight),
    12
  ));

  // Build grid cells as colored divs
  const gridCells: any[] = [];
  for (let y = 0; y < Math.min(gridHeight, Math.floor(artH / cellSize)); y++) {
    const chars = [...(lines[y] || '')];
    for (let x = 0; x < Math.min(chars.length, Math.floor(artW / cellSize)); x++) {
      const ch = chars[x];
      const intensity = charIntensity(ch);
      if (intensity === 0) continue; // skip background
      const color = theme.colors[Math.min(intensity, theme.colors.length - 1)];
      gridCells.push(
        <div
          key={`${y}-${x}`}
          style={{
            position: 'absolute',
            left: x * cellSize,
            top: y * cellSize,
            width: cellSize,
            height: cellSize,
            background: color,
          }}
        />
      );
    }
  }

  // Compute the actual rendered grid dimensions for centering
  const renderedW = Math.min(gridWidth, Math.floor(artW / cellSize)) * cellSize;
  const renderedH = Math.min(gridHeight, Math.floor(artH / cellSize)) * cellSize;

  return new ImageResponse(
    (
      <div style={{
        width: '100%', height: '100%', display: 'flex',
        background: '#0a0a0f', padding: '40px',
        fontFamily: 'monospace',
      }}>
        {/* Left side: text info */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between',
          width: '420px', paddingRight: '30px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Brand */}
            <div style={{
              fontSize: 16, letterSpacing: '0.3em', textTransform: 'uppercase' as const,
              color: '#6e6e82', marginBottom: 16,
            }}>
              LATTICE
            </div>

            {/* Type label */}
            <div style={{
              fontSize: 36, fontWeight: 300, letterSpacing: '0.08em',
              color: '#7c6fe0', marginBottom: 8,
              textShadow: '0 0 30px rgba(124,111,224,0.25)',
            }}>
              {label}
            </div>

            {/* Score */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '12px',
              marginBottom: 24,
            }}>
              <div style={{
                fontSize: 48, fontWeight: 300,
                color: '#4ade80',
              }}>
                {(score * 100).toFixed(1)}%
              </div>
            </div>

            {/* Details */}
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '8px',
              fontSize: 16, color: '#6e6e82',
            }}>
              <div style={{ display: 'flex' }}>
                <span style={{ color: '#c8c8d4' }}>Generation {gen}</span>
              </div>
              <div style={{ display: 'flex' }}>
                <span style={{ color: theme.colors[4] || '#7c6fe0' }}>
                  {piece.epoch || ''}
                </span>
              </div>
              {genome.mutations != null && (
                <div style={{ display: 'flex' }}>
                  <span>{genome.mutations} mutations</span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom brand */}
          <div style={{
            fontSize: 13, color: '#3a3a4a', letterSpacing: '0.1em',
          }}>
            lattice-self.vercel.app
          </div>
        </div>

        {/* Right side: art grid */}
        <div style={{
          flex: 1, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          borderLeft: '1px solid #1e1e2e',
          paddingLeft: '30px',
        }}>
          <div style={{
            position: 'relative',
            width: renderedW,
            height: renderedH,
          }}>
            {gridCells}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
