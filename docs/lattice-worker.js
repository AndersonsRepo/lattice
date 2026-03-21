// ============================================================
//  Lattice WebWorker v2 — ALL simulation engines off the main thread
//  Optimizations: flat typed arrays, buffer reuse, Transferable roundtrip,
//  single-pass normalization, inlined hot loops, zero main-thread sim cost
//  Protocol: init → step (with Transferable buffer) → destroy
// ============================================================

function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Perlin Noise (optimized: typed arrays for gradients + permutation) ---
class NoiseField {
  constructor(seed) {
    const rng = mulberry32(seed);
    const N = 256;
    const perm = new Uint8Array(N);
    for (let i = 0; i < N; i++) perm[i] = i;
    for (let i = N - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    this.p = new Uint16Array(512);
    for (let i = 0; i < 512; i++) this.p[i] = perm[i & 255];
    this.gx = new Float64Array(N);
    this.gy = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const a = rng() * 6.283185307179586;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }
  noise(x, y) {
    const { p, gx, gy } = this;
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = p[p[xi] + yi] & 255, ab = p[p[xi] + yi + 1] & 255;
    const ba = p[p[xi + 1] + yi] & 255, bb = p[p[xi + 1] + yi + 1] & 255;
    const x1 = (gx[aa] * xf + gy[aa] * yf) * (1 - u) + (gx[ba] * (xf - 1) + gy[ba] * yf) * u;
    const x2 = (gx[ab] * xf + gy[ab] * (yf - 1)) * (1 - u) + (gx[bb] * (xf - 1) + gy[bb] * (yf - 1)) * u;
    return x1 * (1 - v) + x2 * v;
  }
  fbm(x, y, octaves, persistence, lacunarity) {
    let value = 0, amplitude = 1, frequency = 1, maxAmp = 0;
    for (let o = 0; o < octaves; o++) {
      value += this.noise(x * frequency, y * frequency) * amplitude;
      maxAmp += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return value / maxAmp;
  }
}

// ============================================================
//  Engines (optimized: flat arrays, pre-computed constants)
// ============================================================

class Life2D {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    this.maxState = Math.max(this.rule.states - 1, 1);
    const rng = mulberry32(genome.seed);
    // Flat grid for cache coherence
    this.grid = new Float32Array(w * h);
    this.next = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) this.grid[i] = rng() > 0.6 ? this.maxState : 0;
    this._birthLUT = new Uint8Array(9);
    this._surviveLUT = new Uint8Array(9);
    for (const n of this.rule.birth) this._birthLUT[n] = 1;
    for (const n of this.rule.survive) this._surviveLUT[n] = 1;
  }
  step() {
    const { w, h, maxState, grid, next, _birthLUT, _surviveLUT } = this;
    for (let y = 0; y < h; y++) {
      const ym = ((y - 1 + h) % h) * w, yc = y * w, yp = ((y + 1) % h) * w;
      for (let x = 0; x < w; x++) {
        const xm = (x - 1 + w) % w, xp = (x + 1) % w;
        const neighbors = (grid[ym + xm] > 0) + (grid[ym + x] > 0) + (grid[ym + xp] > 0)
                        + (grid[yc + xm] > 0)                        + (grid[yc + xp] > 0)
                        + (grid[yp + xm] > 0) + (grid[yp + x] > 0) + (grid[yp + xp] > 0);
        const cell = grid[yc + x];
        if (cell === maxState) next[yc + x] = _surviveLUT[neighbors] ? maxState : Math.max(maxState - 1, 0);
        else if (cell === 0) next[yc + x] = _birthLUT[neighbors] ? maxState : 0;
        else next[yc + x] = cell - 1;
      }
    }
    const tmp = this.grid; this.grid = this.next; this.next = tmp;
  }
  getValues(buf) {
    const { w, h, maxState, grid } = this;
    const vals = buf || grid;
    if (maxState === 1) { if (buf) buf.set(grid); return vals; }
    const inv = 1 / maxState;
    const len = w * h;
    for (let i = 0; i < len; i++) vals[i] = grid[i] * inv;
    return vals;
  }
}

class ReactionDiffusion {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    const size = w * h;
    // Flat typed arrays — single contiguous allocation for cache coherence
    this.U = new Float64Array(size).fill(1.0);
    this.V = new Float64Array(size);
    this._nU = new Float64Array(size);
    this._nV = new Float64Array(size);
    const rng = mulberry32(genome.seed);
    const numSeeds = 3 + ((rng() * 5) | 0);
    for (let s = 0; s < numSeeds; s++) {
      const cx = (rng() * w) | 0, cy = (rng() * h) | 0;
      const r = 2 + ((rng() * 3) | 0);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (dx * dx + dy * dy <= r * r) {
            const x = ((cx + dx) % w + w) % w;
            const y = ((cy + dy) % h + h) % h;
            const idx = y * w + x;
            this.U[idx] = 0.5 + rng() * 0.1;
            this.V[idx] = 0.25 + rng() * 0.1;
          }
    }
    this.warmup = 0;
  }
  step() {
    const { w, h, rule } = this;
    const { feed, kill, Du, Dv } = rule;
    const fk = feed + kill; // Pre-compute feed+kill (used every pixel)
    const substeps = this.warmup < 200 ? 20 : 8;
    let U = this.U, V = this.V, nU = this._nU, nV = this._nV;
    // Pre-compute row offsets to avoid modulo in inner loop
    const rowUp = new Int32Array(h);
    const rowDown = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      rowUp[y] = ((y - 1 + h) % h) * w;
      rowDown[y] = ((y + 1) % h) * w;
    }
    for (let sub = 0; sub < substeps; sub++) {
      for (let y = 0; y < h; y++) {
        const ym = rowUp[y];
        const yc = y * w;
        const yp = rowDown[y];
        // Handle left edge (x=0) separately to avoid modulo in inner loop
        {
          const u = U[yc], v = V[yc];
          const lapU = U[ym] + U[yp] + U[yc + w - 1] + U[yc + 1] - 4 * u;
          const lapV = V[ym] + V[yp] + V[yc + w - 1] + V[yc + 1] - 4 * v;
          const uvv = u * v * v;
          let nu = u + Du * lapU - uvv + feed * (1 - u);
          let nv = v + Dv * lapV + uvv - fk * v;
          nU[yc] = nu < 0 ? 0 : nu > 1 ? 1 : nu;
          nV[yc] = nv < 0 ? 0 : nv > 1 ? 1 : nv;
        }
        // Inner columns: no modulo needed (1 to w-2)
        for (let x = 1; x < w - 1; x++) {
          const ci = yc + x;
          const u = U[ci], v = V[ci];
          const lapU = U[ym + x] + U[yp + x] + U[ci - 1] + U[ci + 1] - 4 * u;
          const lapV = V[ym + x] + V[yp + x] + V[ci - 1] + V[ci + 1] - 4 * v;
          const uvv = u * v * v;
          let nu = u + Du * lapU - uvv + feed * (1 - u);
          let nv = v + Dv * lapV + uvv - fk * v;
          nU[ci] = nu < 0 ? 0 : nu > 1 ? 1 : nu;
          nV[ci] = nv < 0 ? 0 : nv > 1 ? 1 : nv;
        }
        // Handle right edge (x=w-1) separately
        {
          const ci = yc + w - 1;
          const u = U[ci], v = V[ci];
          const lapU = U[ym + w - 1] + U[yp + w - 1] + U[ci - 1] + U[yc] - 4 * u;
          const lapV = V[ym + w - 1] + V[yp + w - 1] + V[ci - 1] + V[yc] - 4 * v;
          const uvv = u * v * v;
          let nu = u + Du * lapU - uvv + feed * (1 - u);
          let nv = v + Dv * lapV + uvv - fk * v;
          nU[ci] = nu < 0 ? 0 : nu > 1 ? 1 : nu;
          nV[ci] = nv < 0 ? 0 : nv > 1 ? 1 : nv;
        }
      }
      const tU = U, tV = V; U = nU; V = nV; nU = tU; nV = tV;
    }
    this.U = U; this.V = V; this._nU = nU; this._nV = nV;
    this.warmup += substeps;
  }
  getValues(buf) {
    const { V } = this;
    const len = V.length;
    const vals = buf || new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const v = V[i] * 2.5;
      vals[i] = v < 1 ? v : 1;
    }
    return vals;
  }
}

class JuliaLive {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    this.baseCReal = this.rule.cReal;
    this.baseCImag = this.rule.cImag;
    this.time = 0;
  }
  step() { this.time += 0.003; }
  getValues(buf) {
    const { w, h, rule, time, baseCReal, baseCImag } = this;
    const { maxIter, zoom, centerX, centerY, escape } = rule;
    const escSq = escape * escape;
    const cReal = baseCReal + Math.sin(time) * 0.015;
    const cImag = baseCImag + Math.cos(time * 0.7) * 0.015;
    const invW = 1 / w, invH = 1 / h;
    const scaleX = (4 / zoom) * (w / h), scaleY = 4 / zoom;
    const invMaxIter = 1 / maxIter;
    const log2 = 0.6931471805599453; // Math.log(2)
    const vals = buf || new Float32Array(w * h);
    for (let py = 0; py < h; py++) {
      const ziBase = centerY + (py * invH - 0.5) * scaleY;
      const rowOff = py * w;
      for (let px = 0; px < w; px++) {
        let zr = centerX + (px * invW - 0.5) * scaleX;
        let zi = ziBase;
        let iter = 0;
        let zr2 = zr * zr, zi2 = zi * zi;
        // Unrolled inner loop: test escape with cached squares
        while (iter < maxIter && zr2 + zi2 < escSq) {
          zi = 2 * zr * zi + cImag;
          zr = zr2 - zi2 + cReal;
          zr2 = zr * zr;
          zi2 = zi * zi;
          iter++;
        }
        if (iter === maxIter) {
          vals[rowOff + px] = 1;
        } else {
          // Smooth iteration count (avoid sqrt: log(modSq)/2 instead of log(sqrt(modSq)))
          const smooth = iter + 1 - Math.log(Math.log(zr2 + zi2) * 0.5) / log2;
          const v = smooth * invMaxIter;
          vals[rowOff + px] = v < 0 ? 0 : v > 1 ? 1 : v;
        }
      }
    }
    return vals;
  }
}

class NoiseLive {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    this.field = new NoiseField(genome.seed);
    this.time = 0;
  }
  step() { this.time += 0.02; }
  getValues(buf) {
    const { w, h, rule, field, time } = this;
    const { scale, octaves, persistence, lacunarity, offsetX, offsetY, warp } = rule;
    const vals = buf || new Float32Array(w * h);
    for (let py = 0; py < h; py++) {
      const rowOff = py * w;
      for (let px = 0; px < w; px++) {
        let nx = (px + offsetX) * scale + time * 0.3;
        let ny = (py + offsetY) * scale + time * 0.15;
        if (warp > 0) {
          // Use fewer octaves for displacement (warp doesn't need full detail)
          const warpOct = Math.min(octaves, 3);
          nx += field.fbm(nx + 5.2, ny + 1.3, warpOct, persistence, lacunarity) * warp * 10;
          ny += field.fbm(nx + 1.7, ny + 9.2, warpOct, persistence, lacunarity) * warp * 10;
        }
        const n = (field.fbm(nx, ny, octaves, persistence, lacunarity) + 1) * 0.5;
        vals[rowOff + px] = n < 0 ? 0 : n > 1 ? 1 : n;
      }
    }
    return vals;
  }
}

class FlowFieldLive {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    this.field = new NoiseField(genome.seed);
    const rng = mulberry32(genome.seed);
    const size = w * h;
    this.accum = new Float64Array(size);
    // Structure of Arrays (SoA) for particles — better cache coherence
    const count = this.count = Math.min(genome.rule.particles || 500, 800);
    this.px = new Float64Array(count);
    this.py = new Float64Array(count);
    this.pl = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      this.px[i] = rng() * w;
      this.py[i] = rng() * h;
      this.pl[i] = (rng() * genome.rule.steps) | 0;
    }
    this.rng = rng;
    this._maxAccum = 0; // Track max incrementally instead of scanning each frame
  }
  step() {
    const { w, h, rule, field, accum, px, py, pl, count, rng } = this;
    const { fieldScale, stepLength, steps, curl: curlAmt, offsetX, offsetY } = rule;
    const len = accum.length;
    // Decay + track max in same pass
    let maxA = 0;
    for (let i = 0; i < len; i++) {
      const v = accum[i] * 0.995;
      accum[i] = v;
      if (v > maxA) maxA = v;
    }
    // Cache the base fbm call when curl is enabled (3 fbm calls → 2 with shared base)
    const useCurl = curlAmt > 0;
    const eps = 0.01;
    const invEps = 1 / eps; // Pre-compute for forward difference gradient
    for (let i = 0; i < count; i++) {
      if (pl[i] <= 0 || px[i] < 0 || px[i] >= w || py[i] < 0 || py[i] >= h) {
        px[i] = rng() * w; py[i] = rng() * h; pl[i] = steps;
      }
      const ix = px[i] | 0, iy = py[i] | 0;
      if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
        const nv = accum[iy * w + ix] + 0.3;
        accum[iy * w + ix] = nv;
        if (nv > maxA) maxA = nv;
      }
      const nx = (px[i] + offsetX) * fieldScale;
      const ny = (py[i] + offsetY) * fieldScale;
      let angle;
      const base = field.fbm(nx, ny, 3, 0.5, 2);
      if (useCurl) {
        // Forward differences: 2 extra fbm calls instead of 4 (central differences)
        // dndx ≈ (f(x+eps) - f(x)) / eps, dndy ≈ (f(y+eps) - f(y)) / eps
        const dndx = (field.fbm(nx + eps, ny, 3, 0.5, 2) - base) * invEps;
        const dndy = (field.fbm(nx, ny + eps, 3, 0.5, 2) - base) * invEps;
        angle = base * 6.2832 * (1 - curlAmt) + Math.atan2(dndx, -dndy) * curlAmt;
      } else {
        angle = base * 6.2832;
      }
      px[i] += Math.cos(angle) * stepLength;
      py[i] += Math.sin(angle) * stepLength;
      pl[i]--;
    }
    this._maxAccum = maxA;
  }
  getValues(buf) {
    const { accum, _maxAccum } = this;
    const len = accum.length;
    const vals = buf || new Float32Array(len);
    // Single pass: normalize using tracked max (no separate max-find scan)
    const s = _maxAccum > 0 ? 1 / _maxAccum : 1;
    for (let i = 0; i < len; i++) { const v = accum[i] * s; vals[i] = v < 1 ? v : 1; }
    return vals;
  }
}

class Automaton1D {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    const rng = mulberry32(genome.seed);
    this.rows = [];
    const first = new Float32Array(w);
    if (rng() > 0.5) first[w >> 1] = 1;
    else for (let i = 0; i < w; i++) first[i] = rng() > 0.7 ? 1 : 0;
    this.rows.push(first);
  }
  step() {
    if (this.rows.length >= this.h) this.rows.shift();
    const prev = this.rows[this.rows.length - 1];
    const row = new Float32Array(this.w);
    const ruleNum = this.rule.number;
    const states = this.rule.states || 2;
    if (states <= 2) {
      for (let x = 0; x < this.w; x++) {
        const hood = (prev[(x - 1 + this.w) % this.w] << 2) | (prev[x] << 1) | prev[(x + 1) % this.w];
        row[x] = (ruleNum >> hood) & 1;
      }
    } else {
      for (let x = 0; x < this.w; x++) {
        const sum = prev[(x - 1 + this.w) % this.w] + prev[x] + prev[(x + 1) % this.w];
        row[x] = Math.min(Math.floor(ruleNum / (3 ** sum)) % 3, states - 1);
      }
    }
    this.rows.push(row);
  }
  getValues(buf) {
    const { w, h, rows } = this;
    const vals = buf || new Float32Array(w * h);
    vals.fill(0);
    const startY = Math.max(0, h - rows.length);
    for (let i = 0; i < rows.length && (startY + i) < h; i++) {
      const off = (startY + i) * w;
      const row = rows[i];
      for (let x = 0; x < w; x++) vals[off + x] = row[x];
    }
    return vals;
  }
}

class LSystemLive {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    const rule = genome.rule;
    let current = rule.axiom;
    for (let i = 0; i < rule.iterations; i++) {
      let next = '';
      for (const ch of current) next += rule.rules[ch] || ch;
      current = next;
      if (current.length > 15000) break;
    }
    const points = [];
    let tx = 0, ty = 0, tAngle = -90, tDepth = 0;
    const stack = [];
    const deg2rad = Math.PI / 180;
    for (const ch of current) {
      switch (ch) {
        case 'F': case 'G': {
          const a = tAngle * deg2rad;
          const nx = tx + Math.cos(a), ny = ty + Math.sin(a);
          points.push({ x: nx, y: ny, depth: tDepth });
          tx = nx; ty = ny; break;
        }
        case '+': tAngle += rule.angle; break;
        case '-': tAngle -= rule.angle; break;
        case '[': stack.push({ x: tx, y: ty, angle: tAngle, depth: tDepth }); tDepth++; break;
        case ']': { const s = stack.pop(); if (s) { tx = s.x; ty = s.y; tAngle = s.angle; tDepth = s.depth; } break; }
      }
    }
    if (points.length > 0) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of points) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
      const drawW = w - 4, drawH = h - 4;
      const bboxW = maxX - minX || 1, bboxH = maxY - minY || 1;
      const sc = Math.min(drawW / bboxW, drawH / bboxH);
      const offX = 2 + (drawW - bboxW * sc) / 2 - minX * sc;
      const offY = 2 + (drawH - bboxH * sc) / 2 - minY * sc;
      this.points = points.map(p => ({ gx: Math.round(p.x * sc + offX), gy: Math.round(p.y * sc + offY), depth: p.depth }));
    } else { this.points = []; }
    this.maxDepth = Math.max(1, ...this.points.map(p => p.depth));
    this.revealIdx = 0;
    this.grid = new Float32Array(w * h);
  }
  step() {
    const { w, h, points, grid } = this;
    const batch = Math.max(1, Math.ceil(points.length / 300));
    for (let i = 0; i < batch && this.revealIdx < points.length; i++, this.revealIdx++) {
      const p = points[this.revealIdx];
      if (p.gx >= 0 && p.gx < w && p.gy >= 0 && p.gy < h) {
        const intensity = 1 - (p.depth / (this.maxDepth + 1)) * 0.5;
        const idx = p.gy * w + p.gx;
        if (intensity > grid[idx]) grid[idx] = intensity;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = p.gx + dx, ny = p.gy + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny * w + nx, v = intensity * 0.3;
            if (v > grid[ni]) grid[ni] = v;
          }
        }
      }
    }
    if (this.revealIdx >= points.length) {
      for (let i = 0, len = grid.length; i < len; i++)
        if (grid[i] > 0.01) grid[i] = Math.min(1, grid[i] * 0.998 + 0.001);
    }
  }
  getValues(buf) { if (buf) { buf.set(this.grid); return buf; } return this.grid; }
}

class SpirographLive {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    this.grid = new Float32Array(w * h);
    this.t = 0;
    this.totalSteps = this.rule.steps || 2000;
  }
  step() {
    const { w, h, rule, grid } = this;
    const batch = Math.max(4, Math.ceil(this.totalSteps / 400));
    for (let i = 0; i < batch; i++) {
      this.t++;
      const theta = (this.t / this.totalSteps) * 62.83185307179586; // PI*2*10
      for (const layer of rule.layers) {
        const { R, r, d, mode } = layer;
        let x, y;
        if (mode === 'epi') {
          x = (R + r) * Math.cos(theta) - d * Math.cos((R + r) / r * theta);
          y = (R + r) * Math.sin(theta) - d * Math.sin((R + r) / r * theta);
        } else {
          x = (R - r) * Math.cos(theta) + d * Math.cos((R - r) / r * theta);
          y = (R - r) * Math.sin(theta) - d * Math.sin((R - r) / r * theta);
        }
        const gx = Math.round((x / 20 + 0.5) * (w - 1));
        const gy = Math.round((y / 20 + 0.5) * (h - 1));
        if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
          const idx = gy * w + gx;
          grid[idx] = Math.min(1, grid[idx] + 0.15);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = gx + dx, ny = gy + dy;
            if (nx >= 0 && nx < w && ny >= 0 && ny < h)
              grid[ny * w + nx] = Math.min(1, grid[ny * w + nx] + 0.04);
          }
        }
      }
    }
  }
  getValues(buf) { if (buf) { buf.set(this.grid); return buf; } return this.grid; }
}

class AttractorLive {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    this.accum = new Float64Array(w * h);
    this.px = 0.1; this.py = 0.1;
    this._maxAccum = 0;
    // Pre-compute attractor mapping constants
    this._invW = w / 6;
    this._invH = h / 6;
  }
  step() {
    const { w, h, rule, accum, _invW, _invH } = this;
    const { variant, a, b, c, d } = rule;
    let px = this.px, py = this.py;
    let maxA = this._maxAccum * 0.999; // decay will reduce max
    const isDejong = variant === 'dejong';
    // Hoist iteration into local vars for tighter loop
    for (let i = 0; i < 2000; i++) {
      let nx, ny;
      if (isDejong) {
        nx = Math.sin(a * py) - Math.cos(b * px);
        ny = Math.sin(c * px) - Math.cos(d * py);
      } else {
        nx = Math.sin(a * py) + c * Math.cos(a * px);
        ny = Math.sin(b * px) + d * Math.cos(b * py);
      }
      px = nx; py = ny;
      const gx = ((nx + 3) * _invW) | 0;
      const gy = ((ny + 3) * _invH) | 0;
      if (gx >= 0 && gx < w && gy >= 0 && gy < h) {
        const idx = gy * w + gx;
        const nv = accum[idx] + 1;
        accum[idx] = nv;
        if (nv > maxA) maxA = nv;
      }
    }
    this.px = px; this.py = py;
    // Decay pass
    const len = accum.length;
    for (let i = 0; i < len; i++) accum[i] *= 0.999;
    this._maxAccum = maxA;
  }
  getValues(buf) {
    const { accum, _maxAccum } = this;
    const len = accum.length;
    const vals = buf || new Float32Array(len);
    // Log-based tone mapping: avoids per-pixel sqrt, better dynamic range
    if (_maxAccum > 1) {
      const logMax = Math.log1p(_maxAccum);
      const invLogMax = 1 / logMax;
      for (let i = 0; i < len; i++) {
        const v = Math.log1p(accum[i]) * invLogMax;
        vals[i] = v < 1 ? v : 1;
      }
    } else {
      for (let i = 0; i < len; i++) vals[i] = accum[i] < 1 ? accum[i] : 1;
    }
    return vals;
  }
}

class VoronoiLive {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    this.reveal = 0;
    const rng = mulberry32(genome.seed);
    const pts = [];
    for (let i = 0; i < genome.rule.seeds; i++) pts.push({ x: rng() * w, y: rng() * h });
    this.fullGrid = new Float32Array(w * h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        let minD = Infinity, minD2 = Infinity;
        for (const p of pts) {
          const dx = Math.min(Math.abs(px - p.x), w - Math.abs(px - p.x));
          const dy = Math.min(Math.abs(py - p.y), h - Math.abs(py - p.y));
          const d = genome.rule.metric === 'manhattan' ? dx + dy : genome.rule.metric === 'chebyshev' ? Math.max(dx, dy) : Math.sqrt(dx * dx + dy * dy);
          if (d < minD) { minD2 = minD; minD = d; } else if (d < minD2) { minD2 = d; }
        }
        const edge = 1 - Math.min(1, (minD2 - minD) / 8);
        const region = minD / (Math.max(w, h) * 0.5);
        this.fullGrid[py * w + px] = genome.rule.mode === 'edges' ? edge : genome.rule.mode === 'gradient' ? Math.min(1, region) : edge * 0.5 + region * 0.5;
      }
    }
  }
  step() { this.reveal = Math.min(1, this.reveal + 0.008); }
  getValues(buf) {
    const { w, h, fullGrid, reveal } = this;
    if (reveal >= 1) { if (buf) { buf.set(fullGrid); return buf; } return fullGrid; }
    const vals = buf || new Float32Array(w * h);
    vals.fill(0);
    const cx = w * 0.5, cy = h * 0.5;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    const threshold = reveal * maxDist * 1.2;
    const thresholdSq = threshold * threshold;  // squared distance for fast rejection
    const fadeInv = 1 / (maxDist * 0.1);
    for (let py = 0; py < h; py++) {
      const rowOff = py * w;
      const dyc = py - cy;
      const dycSq = dyc * dyc;
      for (let px = 0; px < w; px++) {
        const dxc = px - cx;
        const dSq = dxc * dxc + dycSq;
        // Skip sqrt for pixels outside threshold (majority during early reveal)
        if (dSq < thresholdSq) {
          const d = Math.sqrt(dSq);
          vals[rowOff + px] = fullGrid[rowOff + px] * Math.min(1, (threshold - d) * fadeInv);
        }
      }
    }
    return vals;
  }
}

class WFCLive {
  constructor(genome) {
    const w = this.w = genome.width, h = this.h = genome.height;
    this.rule = genome.rule;
    const rng = mulberry32(genome.seed);
    this.fullGrid = new Float32Array(w * h);
    const tc = this.rule.tileCount || 4;
    const grid = new Int8Array(w * h).fill(-1);
    const weights = this.rule.weights || Array(tc).fill(1);
    const adj = this.rule.adjacency || Array.from({ length: tc }, () => Array.from({ length: tc }, (_, j) => j));
    this.collapseOrder = [];
    const visited = new Uint8Array(w * h);
    const cx = w >> 1, cy = h >> 1;
    const queue = [cx + cy * w];
    visited[cx + cy * w] = 1;
    const dirs = [-1, 1, -w, w], dxs = [-1, 1, 0, 0], dys = [0, 0, -1, 1];
    while (queue.length > 0) {
      const ci = queue.shift();
      const x = ci % w, y = (ci / w) | 0;
      let allowed = Array.from({ length: tc }, (_, i) => i);
      for (let d = 0; d < 4; d++) {
        const nx = x + dxs[d], ny = y + dys[d];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && grid[ny * w + nx] >= 0) {
          const na = adj[grid[ny * w + nx]] || [];
          allowed = allowed.filter(t => na.includes(t));
        }
      }
      if (allowed.length === 0) allowed = Array.from({ length: tc }, (_, i) => i);
      const totalW = allowed.reduce((s, t) => s + (weights[t] || 1), 0);
      let r = rng() * totalW, tile = allowed[0];
      for (const t of allowed) { r -= (weights[t] || 1); if (r <= 0) { tile = t; break; } }
      grid[ci] = tile;
      this.fullGrid[ci] = tile / Math.max(1, tc - 1);
      this.collapseOrder.push(ci);
      for (let d = 0; d < 4; d++) {
        const nx = x + dxs[d], ny = y + dys[d];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h && !visited[ny * w + nx]) {
          visited[ny * w + nx] = 1;
          queue.push(ny * w + nx);
        }
      }
    }
    if (this.rule.symmetry === 'horizontal' || this.rule.symmetry === 'quad')
      for (let y = 0; y < h; y++) for (let x = 0; x < (w >> 1); x++) this.fullGrid[y * w + (w - 1 - x)] = this.fullGrid[y * w + x];
    if (this.rule.symmetry === 'vertical' || this.rule.symmetry === 'quad')
      for (let y = 0; y < (h >> 1); y++) for (let x = 0; x < w; x++) this.fullGrid[(h - 1 - y) * w + x] = this.fullGrid[y * w + x];
    this.revealIdx = 0;
    this.grid = new Float32Array(w * h);
  }
  step() {
    const batch = Math.max(2, Math.ceil(this.collapseOrder.length / 200));
    for (let i = 0; i < batch && this.revealIdx < this.collapseOrder.length; i++, this.revealIdx++)
      this.grid[this.collapseOrder[this.revealIdx]] = this.fullGrid[this.collapseOrder[this.revealIdx]];
  }
  getValues(buf) { if (buf) { buf.set(this.grid); return buf; } return this.grid; }
}

// ============================================================
//  Engine Factory + Worker Protocol
// ============================================================
const ENGINES = { '2d': Life2D, 'reaction-diffusion': ReactionDiffusion, '1d': Automaton1D,
  'julia': JuliaLive, 'noise': NoiseLive, 'flowfield': FlowFieldLive, 'lsystem': LSystemLive,
  'spirograph': SpirographLive, 'attractor': AttractorLive, 'voronoi': VoronoiLive, 'wfc': WFCLive };

let engine = null;

self.onmessage = function(e) {
  const msg = e.data;

  if (msg.cmd === 'init') {
    const Ctor = ENGINES[msg.genome.type];
    engine = Ctor ? new Ctor(msg.genome) : null;
    self.postMessage({ cmd: 'ready', w: engine?.w || 0, h: engine?.h || 0 });
  }

  else if (msg.cmd === 'step') {
    if (!engine) return;
    const t0 = performance.now();
    engine.step();
    const simMs = performance.now() - t0;
    // Use provided Transferable buffer or allocate
    const buf = msg.buffer ? new Float32Array(msg.buffer) : new Float32Array(engine.w * engine.h);
    const t1 = performance.now();
    engine.getValues(buf);
    const getValMs = performance.now() - t1;
    self.postMessage({ cmd: 'values', buffer: buf.buffer, simMs, getValMs }, [buf.buffer]);
  }

  else if (msg.cmd === 'destroy') {
    engine = null;
  }
};
