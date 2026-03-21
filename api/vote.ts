import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fwwjtlafcrzeqfuqmexs.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Simple in-memory rate limit (resets when function cold-starts)
const ipHits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= RATE_LIMIT;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing service key' });
  }

  // Rate limit
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Rate limit exceeded. Max 100 votes per hour.' });
  }

  // Parse and validate
  const { pieceId, vote, fingerprint } = req.body || {};

  if (!pieceId || !UUID_RE.test(pieceId)) {
    return res.status(400).json({ error: 'Invalid pieceId: must be a UUID' });
  }
  if (vote !== 1 && vote !== -1) {
    return res.status(400).json({ error: 'Invalid vote: must be 1 or -1' });
  }
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 8 || fingerprint.length > 128) {
    return res.status(400).json({ error: 'Invalid fingerprint' });
  }

  const base = `${SUPABASE_URL}/rest/v1`;
  const headers = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    'Content-Profile': 'lattice',
    'Accept-Profile': 'lattice',
    'Content-Type': 'application/json',
    'Prefer': 'resolution=merge-duplicates,return=minimal',
  };

  try {
    // Upsert the vote (ON CONFLICT updates)
    const upsertRes = await fetch(`${base}/votes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        piece_id: pieceId,
        voter_fingerprint: fingerprint,
        vote,
      }),
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('Supabase upsert error:', upsertRes.status, errText);
      return res.status(500).json({ error: 'Failed to record vote' });
    }

    // Fetch updated vote count
    const countRes = await fetch(
      `${base}/vote_counts?piece_id=eq.${pieceId}`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Accept-Profile': 'lattice',
          'Accept': 'application/json',
        },
      }
    );

    let netScore = vote; // fallback if count query fails
    if (countRes.ok) {
      const counts = await countRes.json();
      if (counts.length > 0) {
        netScore = counts[0].net_score;
      }
    }

    return res.status(200).json({ success: true, netScore });
  } catch (err) {
    console.error('Vote handler error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
