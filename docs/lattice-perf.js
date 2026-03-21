// ============================================================
//  Lattice Performance Module v3
//  Uint32 pixel writes, zero-alloc monitoring, WebWorker pipeline
// ============================================================

const LatticePerf = (() => {

  // === RGBA32 LUT ===
  // Pre-computes Uint32Array from RGB LUT for single-write-per-pixel rendering.
  // Little-endian layout: byte order R,G,B,A maps to 0xAABBGGRR in Uint32.
  const _lut32Cache = new WeakMap();

  function _getRGBA32(lut) {
    let lut32 = _lut32Cache.get(lut);
    if (lut32) return lut32;
    lut32 = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const ci = i * 3;
      lut32[i] = lut[ci] | (lut[ci + 1] << 8) | (lut[ci + 2] << 16) | 0xFF000000;
    }
    _lut32Cache.set(lut, lut32);
    return lut32;
  }

  // === FastRenderer ===
  // Bulk ImageData writes via Uint32Array — 1 write per pixel instead of 4.
  // For a 120x80 grid: 9,600 Uint32 writes + 1 putImageData + 1 drawImage.
  class FastRenderer {
    constructor() {
      this._simCanvas = null;
      this._simCtx = null;
      this._imageData = null;
      this._data32 = null;
      this._w = 0;
      this._h = 0;
      this._vigCache = null;
      this._vigW = 0;
      this._vigH = 0;
    }

    _ensureSim(w, h) {
      if (this._w === w && this._h === h) return;
      this._simCanvas = document.createElement('canvas');
      this._simCanvas.width = w;
      this._simCanvas.height = h;
      this._simCtx = this._simCanvas.getContext('2d', { willReadFrequently: false });
      this._imageData = this._simCtx.createImageData(w, h);
      this._data32 = new Uint32Array(this._imageData.data.buffer);
      this._w = w;
      this._h = h;
    }

    _fillPixels(values, lut, len) {
      const data32 = this._data32;
      const lut32 = _getRGBA32(lut);
      for (let i = 0; i < len; i++) {
        data32[i] = lut32[values[i] * 255 | 0];
      }
    }

    render(ctx, values, simW, simH, lut, alpha, targetW, targetH) {
      if (alpha <= 0) return;
      this._ensureSim(simW, simH);
      this._fillPixels(values, lut, simW * simH);
      this._simCtx.putImageData(this._imageData, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this._simCanvas, 0, 0, targetW, targetH);
      ctx.globalAlpha = 1;
    }

    renderCentered(ctx, values, simW, simH, lut, alpha, viewW, viewH) {
      if (alpha <= 0) return;
      this._ensureSim(simW, simH);
      this._fillPixels(values, lut, simW * simH);
      this._simCtx.putImageData(this._imageData, 0, 0);

      const cellW = viewW / simW;
      const cellH = viewH / simH;
      const cellSize = Math.max(cellW, cellH);
      const totalW = cellSize * simW;
      const totalH = cellSize * simH;
      const offsetX = (viewW - totalW) / 2;
      const offsetY = (viewH - totalH) / 2;

      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this._simCanvas, offsetX, offsetY, totalW, totalH);
      ctx.globalAlpha = 1;
    }

    drawVignette(ctx, w, h, innerR, outerR, opacity) {
      if (this._vigW !== w || this._vigH !== h) {
        this._vigCache = document.createElement('canvas');
        this._vigCache.width = w;
        this._vigCache.height = h;
        const vctx = this._vigCache.getContext('2d');
        const grad = vctx.createRadialGradient(
          w / 2, h / 2, Math.min(w, h) * (innerR || 0.3),
          w / 2, h / 2, Math.max(w, h) * (outerR || 0.7)
        );
        grad.addColorStop(0, 'rgba(10,10,15,0)');
        grad.addColorStop(1, `rgba(10,10,15,${opacity || 0.5})`);
        vctx.fillStyle = grad;
        vctx.fillRect(0, 0, w, h);
        this._vigW = w;
        this._vigH = h;
      }
      ctx.drawImage(this._vigCache, 0, 0);
    }
  }

  // === LegacyRenderer ===
  // The old per-pixel fillRect approach, kept for benchmarking comparison.
  class LegacyRenderer {
    render(ctx, values, simW, simH, lut, alpha, targetW, targetH) {
      if (alpha <= 0) return;
      const cellW = targetW / simW;
      const cellH = targetH / simH;
      ctx.globalAlpha = alpha;
      for (let y = 0; y < simH; y++) {
        for (let x = 0; x < simW; x++) {
          const val = values[y * simW + x];
          const ci = Math.floor(val * 255) * 3;
          const r = lut[ci], g = lut[ci + 1], b = lut[ci + 2];
          if (r === 10 && g === 10 && b === 15 && val < 0.01) continue;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(x * cellW, y * cellH, Math.ceil(cellW), Math.ceil(cellH));
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // === PerfMonitor ===
  // Ring buffer — O(1) insert, pre-allocated sort buffer for zero-alloc p95.
  class PerfMonitor {
    constructor(maxSamples) {
      this._max = maxSamples || 120;
      this._buffers = {};
      this._indices = {};
      this._counts = {};
      this._starts = {};
      this._sortBuf = new Float64Array(this._max);
    }

    _ensure(key) {
      if (!this._buffers[key]) {
        this._buffers[key] = new Float64Array(this._max);
        this._indices[key] = 0;
        this._counts[key] = 0;
      }
    }

    start(key) {
      this._starts[key] = performance.now();
    }

    end(key) {
      const elapsed = performance.now() - (this._starts[key] || 0);
      this.record(key, elapsed);
      return elapsed;
    }

    record(key, value) {
      this._ensure(key);
      this._buffers[key][this._indices[key]] = value;
      this._indices[key] = (this._indices[key] + 1) % this._max;
      if (this._counts[key] < this._max) this._counts[key]++;
    }

    avg(key) {
      const count = this._counts[key] || 0;
      if (count === 0) return 0;
      const buf = this._buffers[key];
      let sum = 0;
      for (let i = 0; i < count; i++) sum += buf[i];
      return sum / count;
    }

    p95(key) {
      const count = this._counts[key] || 0;
      if (count === 0) return 0;
      const buf = this._buffers[key];
      const tmp = this._sortBuf;
      for (let i = 0; i < count; i++) tmp[i] = buf[i];
      const view = tmp.subarray(0, count);
      view.sort();
      return view[Math.floor(count * 0.95)] || 0;
    }

    report() {
      return {
        simAvg:    this.avg('sim'),
        simP95:    this.p95('sim'),
        renderAvg: this.avg('render'),
        renderP95: this.p95('render'),
        frameAvg:  this.avg('frame'),
        fps:       this.avg('frame') > 0 ? 1000 / this.avg('frame') : 0,
        workerSimAvg: this.avg('workerSim'),
      };
    }

    formatReport() {
      const r = this.report();
      let s = `sim: ${r.simAvg.toFixed(1)}ms (p95: ${r.simP95.toFixed(1)}ms) | ` +
              `render: ${r.renderAvg.toFixed(1)}ms (p95: ${r.renderP95.toFixed(1)}ms) | ` +
              `frame: ${r.frameAvg.toFixed(1)}ms | ${r.fps.toFixed(0)} fps`;
      if (r.workerSimAvg > 0) s += ` | worker: ${r.workerSimAvg.toFixed(1)}ms`;
      return s;
    }
  }

  // === WorkerBridge ===
  // Off-main-thread simulation via lattice-worker.js.
  // Transferable ArrayBuffer round-trips for zero-copy data exchange.
  // Double-buffer mode: requests next step on value receipt, overlapping
  // worker computation with main-thread rendering.
  class WorkerBridge {
    constructor(workerUrl) {
      this._workerUrl = workerUrl;
      this._worker = null;
      this._buffer = null;
      this._values = null;
      this._pending = false;
      this._ready = false;
      this._simW = 0;
      this._simH = 0;
      this._simMs = 0;
      this._getValMs = 0;
      this._destroyed = false;
      this._onReady = null;
      this._autoStep = false;
    }

    get w() { return this._simW; }
    get h() { return this._simH; }
    get simMs() { return this._simMs; }
    get getValMs() { return this._getValMs; }

    init(genome, opts) {
      this._ready = false;
      this._pending = false;
      this._values = null;
      this._buffer = null;
      this._destroyed = false;
      this._onReady = (opts && opts.onReady) || null;
      this._autoStep = (opts && opts.autoStep) || false;

      try {
        if (this._worker) this._worker.terminate();
        this._worker = new Worker(this._workerUrl);
        this._worker.onmessage = (e) => this._onMessage(e);
        this._worker.onerror = () => { this._ready = false; };
        this._worker.postMessage({ cmd: 'init', genome });
      } catch (err) {
        this._worker = null;
        return false;
      }
      return true;
    }

    _onMessage(e) {
      if (this._destroyed) return;
      const msg = e.data;
      if (msg.cmd === 'ready') {
        this._simW = msg.w;
        this._simH = msg.h;
        this._ready = true;
        if (this._onReady) this._onReady();
      } else if (msg.cmd === 'values') {
        this._buffer = msg.buffer;
        this._values = new Float32Array(this._buffer);
        this._simMs = msg.simMs || 0;
        this._getValMs = msg.getValMs || 0;
        this._pending = false;
        if (this._autoStep) this.step();
      }
    }

    step() {
      if (!this._ready || this._pending || !this._worker) return;
      this._pending = true;
      if (this._buffer) {
        this._worker.postMessage({ cmd: 'step', buffer: this._buffer }, [this._buffer]);
        this._buffer = null;
      } else {
        this._worker.postMessage({ cmd: 'step' });
      }
    }

    getValues() { return this._values; }
    isReady() { return this._ready; }
    isPending() { return this._pending; }

    destroy() {
      this._destroyed = true;
      this._autoStep = false;
      if (this._worker) {
        this._worker.postMessage({ cmd: 'destroy' });
        this._worker.terminate();
        this._worker = null;
      }
      this._values = null;
      this._buffer = null;
      this._ready = false;
    }
  }

  // === FrameBudget ===
  // Adaptive frame rate controller. Skips sim steps when behind budget.
  class FrameBudget {
    constructor(targetFps) {
      this._targetMs = 1000 / (targetFps || 30);
      this._lastFrame = 0;
      this._avgFrame = this._targetMs;
      this._alpha = 0.1;
      this._skipCount = 0;
    }

    shouldStep() {
      const now = performance.now();
      if (this._lastFrame > 0) {
        const dt = now - this._lastFrame;
        this._avgFrame = this._avgFrame * (1 - this._alpha) + dt * this._alpha;
      }
      this._lastFrame = now;
      if (this._avgFrame > this._targetMs * 1.5) {
        this._skipCount++;
        return this._skipCount % 2 === 0;
      }
      this._skipCount = 0;
      return true;
    }

    get avgFrameMs() { return this._avgFrame; }
    get fps() { return this._avgFrame > 0 ? 1000 / this._avgFrame : 0; }
  }

  return { FastRenderer, LegacyRenderer, PerfMonitor, WorkerBridge, FrameBudget };
})();
