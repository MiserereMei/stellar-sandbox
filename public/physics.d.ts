declare namespace __AdaptedExports {
  /** Exported memory */
  export const memory: WebAssembly.Memory;
  /** wasm-src/physics/BODY_STRIDE */
  export const BODY_STRIDE: {
    /** @type `i32` */
    get value(): number
  };
  /**
   * wasm-src/physics/initBuffer
   * @param bodyCount `i32`
   */
  export function initBuffer(bodyCount: number): void;
  /**
   * wasm-src/physics/getBufferPtr
   * @returns `usize`
   */
  export function getBufferPtr(): number;
  /**
   * wasm-src/physics/getBufferLen
   * @returns `i32`
   */
  export function getBufferLen(): number;
  /**
   * wasm-src/physics/stepBodies
   * @param n `i32`
   * @param dt `f64`
   * @param G `f64`
   * @param C `f64`
   */
  export function stepBodies(n: number, dt: number, G: number, C: number): void;
}
/** Instantiates the compiled WebAssembly module with the given imports. */
export declare function instantiate(module: WebAssembly.Module, imports: {
  env: unknown,
}): Promise<typeof __AdaptedExports>;
