// Injectable randomness so every random choice is testable.

export type Rng = () => number; // returns [0, 1)

/** Small deterministic generator (mulberry32) for tests and replays. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform index in [0, length). */
export function randomIndex(rng: Rng, length: number): number {
  return Math.min(length - 1, Math.floor(rng() * length));
}
