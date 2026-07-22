export const hashString = (str: string): number => {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h >>> 0;
};

const mulberry32 = (seed: number) => {
  let a = seed;
  return (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export class SeededRandom {
  private next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  uniform(min = 0, max = 1): number {
    return min + this.next() * (max - min);
  }

  gaussian(mean = 0, std = 1): number {
    const u1 = Math.max(this.next(), 1e-9);
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z * std;
  }
}

// A mean-reverting random walk: each step nudges the value toward `target`
// (proportional to how far it has drifted) and adds a small gaussian shock.
// This produces serially-correlated, bounded noise that looks like a real
// sensor trace, unlike independent-each-minute white noise or an unbounded walk.
export class MeanRevertingWalk {
  value: number;
  private rng: SeededRandom;
  private reversionRate: number;
  private stepStd: number;

  constructor(rng: SeededRandom, initialValue: number, reversionRate: number, stepStd: number) {
    this.rng = rng;
    this.value = initialValue;
    this.reversionRate = reversionRate;
    this.stepStd = stepStd;
  }

  step(target: number, noiseScale = 1): number {
    const pull = this.reversionRate * (target - this.value);
    const shock = this.rng.gaussian(0, this.stepStd * noiseScale);
    this.value += pull + shock;
    return this.value;
  }
}
