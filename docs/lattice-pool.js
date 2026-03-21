// ============================================================
//  Lattice Worker Pool v1
//  Reuses warm WebWorkers across piece transitions to avoid
//  construction + script-download overhead (~5-15ms per Worker()).
//  API-compatible with WorkerBridge from lattice-perf.js.
// ============================================================

const LatticePool = (() => {

  // === WorkerPool ===
  // Maintains a pool of idle workers. When a piece transitions,
  // the old worker returns to the pool instead of being terminated.
  // Next init() grabs a warm worker — zero construction cost.
  class WorkerPool {
    constructor(workerUrl, poolSize) {
      this._url = workerUrl || 'lattice-worker.js';
      this._maxSize = poolSize || 4;
      this._idle = [];    // idle Worker instances ready for reuse
      this._active = 0;   // count of workers currently in use
    }

    // Get a worker from the pool (or create a new one)
    acquire() {
      if (this._idle.length > 0) {
        this._active++;
        return this._idle.pop();
      }
      this._active++;
      return new Worker(this._url);
    }

    // Return a worker to the pool (or terminate if pool is full)
    release(worker) {
      this._active--;
      if (this._idle.length < this._maxSize) {
        // Clear any existing message handlers before pooling
        worker.onmessage = null;
        worker.onerror = null;
        this._idle.push(worker);
      } else {
        worker.terminate();
      }
    }

    // Pre-warm the pool with N idle workers
    warmup(count) {
      const n = Math.min(count || this._maxSize, this._maxSize);
      while (this._idle.length < n) {
        this._idle.push(new Worker(this._url));
      }
    }

    // Terminate all idle workers
    drain() {
      for (const w of this._idle) w.terminate();
      this._idle.length = 0;
    }

    get idleCount() { return this._idle.length; }
    get activeCount() { return this._active; }
    get totalCount() { return this._idle.length + this._active; }
  }

  // === PooledBridge ===
  // Drop-in replacement for WorkerBridge that uses the pool.
  // Same API: init(genome, opts), step(), getValues(), destroy()
  class PooledBridge {
    constructor(pool) {
      this._pool = pool;
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
      this._frameCount = 0;
    }

    get w() { return this._simW; }
    get h() { return this._simH; }
    get simMs() { return this._simMs; }
    get getValMs() { return this._getValMs; }
    get frameCount() { return this._frameCount; }

    init(genome, opts) {
      // Return previous worker to pool before acquiring new one
      if (this._worker) {
        this._worker.postMessage({ cmd: 'destroy' });
        this._pool.release(this._worker);
      }

      this._ready = false;
      this._pending = false;
      this._values = null;
      this._buffer = null;
      this._destroyed = false;
      this._frameCount = 0;
      this._onReady = (opts && opts.onReady) || null;
      this._autoStep = (opts && opts.autoStep) !== undefined ? opts.autoStep : false;

      try {
        this._worker = this._pool.acquire();
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
        if (this._autoStep) this.step();
      } else if (msg.cmd === 'values') {
        this._buffer = msg.buffer;
        this._values = new Float32Array(this._buffer);
        this._simMs = msg.simMs || 0;
        this._getValMs = msg.getValMs || 0;
        this._pending = false;
        this._frameCount++;
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
    hasValues() { return this._values !== null; }

    destroy() {
      this._destroyed = true;
      this._autoStep = false;
      if (this._worker) {
        this._worker.postMessage({ cmd: 'destroy' });
        this._pool.release(this._worker);
        this._worker = null;
      }
      this._values = null;
      this._buffer = null;
      this._ready = false;
    }
  }

  // Default shared pool instance
  let _defaultPool = null;
  function getDefaultPool(url) {
    if (!_defaultPool) _defaultPool = new WorkerPool(url, 4);
    return _defaultPool;
  }

  return { WorkerPool, PooledBridge, getDefaultPool };
})();
