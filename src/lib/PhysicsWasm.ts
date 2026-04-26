/**
 * PhysicsWasm — Bridge between Simulation.ts and the AssemblyScript WASM core.
 *
 * Usage:
 *   const wasm = new PhysicsWasm();
 *   await wasm.load();          // call once on startup
 *   wasm.step(bodies, dt, G, C); // call every physics substep
 */

export const BODY_STRIDE = 9; // must match wasm-src/physics.ts

export interface PhysicsBody {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  mass: number;
  radius: number;
  isBlackHole?: boolean;
}

interface WasmExports {
  initBuffer(bodyCount: number): void;
  getBufferPtr(): number;
  getBufferLen(): number;
  stepBodies(n: number, dt: number, G: number, C: number): void;
  memory: WebAssembly.Memory;
}

export class PhysicsWasm {
  private exports: WasmExports | null = null;
  private wasmMemory: WebAssembly.Memory | null = null;
  private lastBodyCount = 0;

  /** Set to true to force JS fallback even when WASM is loaded */
  forceDisabled = false;

  /** Whether WASM is loaded and ready (and not force-disabled) */
  get ready(): boolean {
    return this.exports !== null;
  }

  /** Whether WASM is currently active (loaded + not disabled) */
  get active(): boolean {
    return this.exports !== null && !this.forceDisabled;
  }

  /**
   * Load and instantiate the WASM module.
   * Must be awaited before calling step().
   */
  async load(wasmUrl?: string): Promise<void> {
    const resolvedUrl = wasmUrl ?? `${import.meta.env.BASE_URL}physics.wasm`;
    try {
      const result = await WebAssembly.instantiateStreaming(fetch(resolvedUrl), {
        env: {
          abort: (msg: number, file: number, line: number, col: number) => {
            console.error(`[PhysicsWasm] abort at line ${line}:${col}`);
          },
        },
      });

      this.exports = result.instance.exports as unknown as WasmExports;
      this.wasmMemory = this.exports.memory;
      console.info('[PhysicsWasm] ✅ WASM physics core loaded.');
    } catch (err) {
      console.warn('[PhysicsWasm] ⚠️ Failed to load WASM, falling back to JS:', err);
      this.exports = null;
    }
  }

  /** Raw pointer to the buffer data — used by JS to get a view into WASM memory. */
  getBufferPtr(): number {
    return this.exports ? this.exports.getBufferPtr() : 0;
  }

  getBufferLen(): number {
    return this.exports ? this.exports.getBufferLen() : 0;
  }

  /**
   * Upload all body data to WASM memory.
   * Call this once at the start of the frame.
   */
  upload(bodies: PhysicsBody[]): void {
    if (!this.exports || !this.wasmMemory) return;
    const n = bodies.length;
    if (n !== this.lastBodyCount) {
      this.exports.initBuffer(n);
      this.lastBodyCount = n;
    }
    const ptr = this.exports.getBufferPtr();
    const view = new Float64Array(this.wasmMemory.buffer, ptr, n * BODY_STRIDE);
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      const base = i * BODY_STRIDE;
      view[base + 0] = b.position.x;
      view[base + 1] = b.position.y;
      view[base + 2] = b.position.z;
      view[base + 3] = b.velocity.x;
      view[base + 4] = b.velocity.y;
      view[base + 5] = b.velocity.z;
      // If anchored, set mass to 0 in WASM to disable gravity simulation for this body
      view[base + 6] = (b as any).parentBodyId ? 0.0 : b.mass;
      view[base + 7] = b.radius;
      view[base + 8] = b.isBlackHole ? 1.0 : 0.0;
    }
  }

  /**
   * Run the physics math on the data currently in WASM memory.
   * No memory sync happens here. Very fast.
   */
  execute(dt: number, G: number, C: number): void {
    if (!this.exports) return;
    this.exports.stepBodies(this.lastBodyCount, dt, G, C);
  }

  /**
   * Download updated positions/velocities from WASM memory.
   * Call this once at the end of the frame.
   */
  download(bodies: PhysicsBody[]): void {
    if (!this.exports || !this.wasmMemory) return;
    const n = bodies.length;
    const ptr = this.exports.getBufferPtr();
    const viewOut = new Float64Array(this.wasmMemory.buffer, ptr, n * BODY_STRIDE);

    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      const base = i * BODY_STRIDE;
      b.position.x = viewOut[base + 0];
      b.position.y = viewOut[base + 1];
      b.position.z = viewOut[base + 2];
      b.velocity.x = viewOut[base + 3];
      b.velocity.y = viewOut[base + 4];
      b.velocity.z = viewOut[base + 5];
    }
  }

  /**
   * Perform multiple physics sub-steps in a single call to minimize JS<->WASM bridge overhead.
   */
  stepMultiple(bodies: PhysicsBody[], totalDt: number, substeps: number, G: number, C: number): boolean {
    if (!this.exports || !this.wasmMemory || substeps <= 0) return false;
    this.upload(bodies);
    const stepDt = totalDt / substeps;
    for (let s = 0; s < substeps; s++) {
      this.execute(stepDt, G, C);
    }
    this.download(bodies);
    return true;
  }

  /**
   * Download only a single body's position and velocity from WASM.
   * Useful for syncing the vehicle for the autopilot during the substep loop.
   */
  downloadSingleBody(index: number, body: PhysicsBody): void {
    if (!this.exports || !this.wasmMemory || index < 0 || index >= this.lastBodyCount) return;
    const ptr = this.exports.getBufferPtr();
    const base = index * BODY_STRIDE;
    // Read only the first 6 fields: pos.x,y,z and vel.x,y,z
    const view = new Float64Array(this.wasmMemory.buffer, ptr + (base * 8), 6);
    body.position.x = view[0];
    body.position.y = view[1];
    body.position.z = view[2];
    body.velocity.x = view[3];
    body.velocity.y = view[4];
    body.velocity.z = view[5];
  }

  /** Legacy single-step method (can be kept for compatibility or simple cases) */
  step(bodies: PhysicsBody[], dt: number, G: number, C: number): boolean {
    return this.stepMultiple(bodies, dt, 1, G, C);
  }
}
