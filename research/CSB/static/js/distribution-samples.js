const samplesPerCloud = 128;

// xoshiro128** 1.1, seeded once per visit from the browser's entropy source.
// https://prng.di.unimi.it/xoshiro128starstar.c
export function createVisitRandom() {
  const state = crypto.getRandomValues(new Uint32Array(4));
  if (state.every(word => word === 0)) state[0] = 1;

  return () => {
    const product = Math.imul(state[1], 5);
    const bits = Math.imul((product << 7) | (product >>> 25), 9) >>> 0;
    const shift = state[1] << 9;
    state[2] ^= state[0];
    state[3] ^= state[1];
    state[1] ^= state[2];
    state[0] ^= state[3];
    state[2] ^= shift;
    state[3] = (state[3] << 11) | (state[3] >>> 21);
    return bits / 0x100000000;
  };
}

// SplitMix32 supplies a repeatable sampling stream from a 32-bit seed.
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let value = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 0x100000000;
  };
}

export function sampleWithoutReplacement(values, count, random) {
  const pool = values.slice();
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

export function sampleStandardNormalPair(random = Math.random) {
  // Box–Muller gives a pair of independent standard normal samples.
  const radius = Math.sqrt(-2 * Math.log(1 - random()));
  const angle = random() * 2 * Math.PI;
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export function sampleCloud(centerX, centerY, slope, color, rotation = 0, options = {}) {
  const { stdX = 0.76, stdY = 0.44, normalPair = sampleStandardNormalPair, count = samplesPerCloud } = options;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return Array.from({ length: count }, () => {
    const { x: u, y: v } = normalPair();
    const dx = stdX * u;
    const dy = slope * u + stdY * v;
    return {
      x: centerX + cos * dx - sin * dy,
      y: centerY + sin * dx + cos * dy,
      color,
    };
  });
}
