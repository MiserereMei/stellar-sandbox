/**
 * StellarSandbox — Physics Core (AssemblyScript → WASM)
 *
 * This module handles the hot inner loop of the N-body simulation:
 *   1. Compute gravitational acceleration for every body pair.
 *   2. Clamp velocity to speed-of-light limit (C).
 *   3. Euler-integrate positions.
 *
 * Data layout (flat f64 array per body, stride = BODY_STRIDE):
 *   [0] pos.x
 *   [1] pos.y
 *   [2] vel.x
 *   [3] vel.y
 *   [4] mass
 *   [5] radius
 *   [6] isBlackHole  (0.0 or 1.0)
 *
 * All values are in simulation units.
 */

export const BODY_STRIDE: i32 = 7;

// We use a single shared linear-memory buffer exposed to JS.
// JS writes body data into it, calls stepBodies(), then reads back.
let buffer: Float64Array = new Float64Array(0);

/**
 * Initialise (or resize) the shared body buffer.
 * Called once on startup and whenever the body count changes.
 */
export function initBuffer(bodyCount: i32): void {
  buffer = new Float64Array(bodyCount * BODY_STRIDE);
}

/** Raw pointer to the buffer data — used by JS to get a view into WASM memory. */
export function getBufferPtr(): usize {
  return buffer.dataStart;
}

export function getBufferLen(): i32 {
  return buffer.length;
}

/**
 * N-body gravity + Euler integration step.
 *
 * @param n       Number of bodies in the buffer.
 * @param dt      Time-step (sim units).
 * @param G       Gravitational constant (sim units).
 * @param C       Speed-of-light cap (sim units).
 */
export function stepBodies(n: i32, dt: f64, G: f64, C: f64): void {
  const CSq: f64 = C * C;

  // --- Phase 1: Accumulate gravitational accelerations ---
  for (let i: i32 = 0; i < n; i++) {
    const iBase: i32 = i * BODY_STRIDE;
    const mass_i: f64 = buffer[iBase + 4];
    if (mass_i <= 0.0) continue;

    const px_i: f64 = buffer[iBase];
    const py_i: f64 = buffer[iBase + 1];
    const r_i:  f64 = buffer[iBase + 5];

    let ax: f64 = 0.0;
    let ay: f64 = 0.0;

    for (let j: i32 = 0; j < n; j++) {
      if (i === j) continue;
      const jBase: i32 = j * BODY_STRIDE;
      const mass_j: f64 = buffer[jBase + 4];
      if (mass_j <= 0.0) continue;

      const dx: f64 = buffer[jBase]     - px_i;
      const dy: f64 = buffer[jBase + 1] - py_i;
      const distSq: f64 = dx * dx + dy * dy;
      if (distSq === 0.0) continue;

      const dist: f64 = Math.sqrt(distSq);
      const isJBH: f64 = buffer[jBase + 6];
      const r_j:   f64 = buffer[jBase + 5];

      // Softening: never let bodies get unrealistically close
      const softening: f64 = Math.max(r_i, r_j);
      let potDist: f64 = Math.max(dist, softening * 0.1);
      if (isJBH > 0.5) potDist = Math.max(0.2, dist - r_j);

      const force: f64 = G * mass_j / (potDist * potDist);
      ax += force * (dx / dist);
      ay += force * (dy / dist);
    }

    // Apply acceleration to velocity
    let vx: f64 = buffer[iBase + 2] + ax * dt;
    let vy: f64 = buffer[iBase + 3] + ay * dt;

    // Speed-of-light clamp
    const speedSq: f64 = vx * vx + vy * vy;
    if (speedSq > CSq) {
      const speed: f64 = Math.sqrt(speedSq);
      vx = (vx / speed) * C;
      vy = (vy / speed) * C;
    }

    buffer[iBase + 2] = vx;
    buffer[iBase + 3] = vy;
  }

  // --- Phase 2: Integrate positions ---
  for (let i: i32 = 0; i < n; i++) {
    const iBase: i32 = i * BODY_STRIDE;
    if (buffer[iBase + 4] <= 0.0) continue;
    buffer[iBase]     += buffer[iBase + 2] * dt; // x += vx * dt
    buffer[iBase + 1] += buffer[iBase + 3] * dt; // y += vy * dt
  }
}
