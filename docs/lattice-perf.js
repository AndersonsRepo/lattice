// ============================================================
//  Lattice Performance Module
//  Shared rendering utilities + measurement
// ============================================================

const LatticePerf = (() => {

  // === FastRenderer ===
  // Replaces per-pixel fillRect with bulk ImageData writes + GPU-accelerated scaling.
  // For a 120x80 grid, this reduces 9,600 fillRect calls to 1 putImageData + 1 drawImage.
  class FastRenderer {
    constructor() {
      this._simCanvas = null;
      this._simCtx = null;
      this._imageData = null;
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
      this._w = w;
      this._h = h;
    }

    // Render values (Float32Array, 0-1) using a Uint8Array LUT (256*3 RGB stops)
    // to the target canvas context, scaling to fill targetW x targetH.
    render(ctx, values, simW, simH, lut, alpha, targetW, targetH) {
      if (alpha <= 0) return;
      this._ensureSim(simW, simH);
      const data = this._imageData.data;
      const len = simW * simH;

      for (let i = 0; i < len; i++) {
        const ci = (values[i] * 255 | 0) * 3;
        const pi = i << 2;
        data[pi]     = lut[ci];
        data[pi + 1] = lut[ci + 1];
        data[pi + 2] = lut[ci + 2];
        data[pi + 3] = 255;
      }

      this._simCtx.putImageData(this._imageData, 0, 0);
      ctx.globalAlpha = alpha;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this._simCanvas, 0, 0, targetW, targetH);
      ctx.globalAlpha = 1;
    }

    // Render with aspect-ratio-preserving centering (used by live.html)
    renderCentered(ctx, values, simW, simH, lut, alpha, viewW, viewH) {
      if (alpha <= 0) return;
      this._ensureSim(simW, simH);
      const data = this._imageData.data;
      const len = simW * simH;

      for (let i = 0; i < len; i++) {
        const ci = (values[i] * 255 | 0) * 3;
        const pi = i << 2;
        data[pi]     = lut[ci];
        data[pi + 1] = lut[ci + 1];
        data[pi + 2] = lut[ci + 2];
        data[pi + 3] = 255;
      }

      this._simCtx.putImageData(this._imageData, 0, 0);

      // Calculate centered scaling
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

    // Draw a cached vignette overlay
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
  // Tracks timing samples for simulation, rendering, and total frame time.
  class PerfMonitor {
    constructor(maxSamples) {
      this._max = maxSamples || 120;
      this.samples = { sim: [], render: [], frame: [] };
      this._starts = {};
    }

    start(key) {
      this._starts[key] = performance.now();
    }

    end(key) {
      const elapsed = performance.now() - (this._starts[key] || 0);
      const arr = this.samples[key];
      if (arr) {
        arr.push(elapsed);
        if (arr.length > this._max) arr.shift();
      }
      return elapsed;
    }

    avg(key) {
      const arr = this.samples[key];
      if (!arr || arr.length === 0) return 0;
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i];
      return sum / arr.length;
    }

    p95(key) {
      const arr = this.samples[key];
      if (!arr || arr.length === 0) return 0;
      const sorted = arr.slice().sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.95)] || 0;
    }

    report() {
      return {
        simAvg:    this.avg('sim'),
        simP95:    this.p95('sim'),
        renderAvg: this.avg('render'),
        renderP95: this.p95('render'),
        frameAvg:  this.avg('frame'),
        fps:       this.avg('frame') > 0 ? 1000 / this.avg('frame') : 0,
      };
    }

    formatReport() {
      const r = this.report();
      return `sim: ${r.simAvg.toFixed(1)}ms (p95: ${r.simP95.toFixed(1)}ms) | ` +
             `render: ${r.renderAvg.toFixed(1)}ms (p95: ${r.renderP95.toFixed(1)}ms) | ` +
             `frame: ${r.frameAvg.toFixed(1)}ms | ${r.fps.toFixed(0)} fps`;
    }
  }

  return { FastRenderer, LegacyRenderer, PerfMonitor };
})();
