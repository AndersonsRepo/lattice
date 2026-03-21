import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = 'https://fwwjtlafcrzeqfuqmexs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3d2p0bGFmY3J6ZXFmdXFtZXhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODE2MDM1MCwiZXhwIjoyMDgzNzM2MzUwfQ.pUu1ABMkwXGnQqz-x3D8uccaID4whh_Q6OyXEZUve3c';

// Color themes per genome type — mirrors docs/index.html TYPE_COLORS
const TYPE_COLORS: Record<string, { bg: string; colors: string[] }> = {
  '1d':                 { bg: '#0a0a0f', colors: ['#0a0a0f', '#1a1a3e', '#3b2d8b', '#6b4edb', '#9d7af5', '#c8abff', '#e8d8ff', '#ffffff'] },
  '2d':                 { bg: '#0a0a0f', colors: ['#0a0a0f', '#0d2818', '#166b3a', '#22a95c', '#4ade80', '#7af5a8', '#b8ffd4', '#e8fff0'] },
  'lsystem':            { bg: '#0a0a0f', colors: ['#0a0a0f', '#2d1a0a', '#6b3a0d', '#a85c16', '#db8b22', '#f5b84a', '#ffe088', '#fff4cc'] },
  'reaction-diffusion': { bg: '#0a0a0f', colors: ['#0a0a0f', '#1a0a2d', '#3b0d6b', '#6b16a8', '#a822db', '#d44af5', '#f088ff', '#ffccff'] },
  'voronoi':            { bg: '#0a0a0f', colors: ['#0a0a0f', '#0a1a2d', '#0d3b6b', '#166ba8', '#22a8db', '#4ad4f5', '#88eeff', '#ccf8ff'] },
  'wfc':                { bg: '#0a0a0f', colors: ['#0a0a0f', '#2d0a0a', '#6b0d1a', '#a8163b', '#db226b', '#f54a9d', '#ff88c8', '#ffccee'] },
  'spirograph':         { bg: '#0a0a0f', colors: ['#0a0a0f', '#1a2d0a', '#3b6b0d', '#6ba816', '#a8db22', '#d4f54a', '#eeff88', '#ffffcc'] },
  'attractor':          { bg: '#0a0a0f', colors: ['#0a0a0f', '#2d1a1a', '#6b2d2d', '#a84a3b', '#db6b4a', '#f59d6b', '#ffc8a0', '#ffe8d8'] },
  'julia':              { bg: '#0a0a0f', colors: ['#0a0a0f', '#0a2d2d', '#0d6b5b', '#16a88a', '#22dbb5', '#4af5d4', '#88ffe8', '#ccfff4'] },
  'noise':              { bg: '#0a0a0f', colors: ['#0a0a0f', '#1a1a0a', '#3b3b0d', '#6b6b16', '#a8a822', '#d4d44a', '#eeff88', '#ffffcc'] },
  'flowfield':          { bg: '#0a0a0f', colors: ['#0a0a0f', '#0a1a1a', '#0d3b3b', '#166b6b', '#22a8a8', '#4ad4d4', '#88eeff', '#ccffff'] },
};

// Mirrors charIntensity from index.html
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

function renderSvg(rendered: string, genomeType: string, size: number): string {
  const theme = TYPE_COLORS[genomeType] || TYPE_COLORS['2d'];
  const lines = rendered.split('\n').filter(l => l.length > 0);
  if (lines.length === 0) return '';

  const rows = lines.length;
  const cols = Math.max(...lines.map(l => [...l].length));
  const cellW = size / cols;
  const cellH = size / rows;

  let rects = '';
  for (let y = 0; y < rows; y++) {
    const chars = [...lines[y]];
    for (let x = 0; x < chars.length; x++) {
      const ch = chars[x];
      const intensity = charIntensity(ch);
      if (intensity === 0) continue; // background — skip
      const color = theme.colors[Math.min(intensity, theme.colors.length - 1)];
      rects += `<rect x="${(x * cellW).toFixed(2)}" y="${(y * cellH).toFixed(2)}" width="${(cellW + 0.5).toFixed(2)}" height="${(cellH + 0.5).toFixed(2)}" fill="${color}"/>`;
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="${theme.bg}"/>
${rects}
</svg>`;
}

async function fetchPiece(id: string): Promise<{ rendered: string; genome: { type: string }; score: number; generation: number } | null> {
  const headers: Record<string, string> = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Accept-Profile': 'lattice',
    'Accept': 'application/json',
  };
  const base = `${SUPABASE_URL}/rest/v1`;

  // Try archive first (largest table), then hall_of_fame, then population
  for (const table of ['archive', 'hall_of_fame', 'population']) {
    const res = await fetch(`${base}/${table}?id=eq.${id}&select=id,rendered,genome,score,generation`, { headers });
    if (res.ok) {
      const rows = await res.json();
      if (rows.length > 0) return rows[0];
    }
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id as string;
  if (!id) {
    return res.status(400).json({ error: 'Missing id parameter' });
  }

  const sizeParam = parseInt(req.query.size as string, 10);
  const size = Math.min(Math.max(sizeParam || 2048, 256), 4096);

  const piece = await fetchPiece(id);
  if (!piece || !piece.rendered) {
    return res.status(404).json({ error: 'Piece not found' });
  }

  const svg = renderSvg(piece.rendered, piece.genome?.type || '2d', size);

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.setHeader('Content-Disposition', `inline; filename="lattice-${id.slice(0, 8)}.svg"`);
  return res.status(200).send(svg);
}
