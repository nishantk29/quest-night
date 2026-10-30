// The randomness and clock each event runs with. The reducer already takes `rng` and `now` as arguments, so an
// event only has to carry four seed words and a time: replaying it gives the same deal, the same first leader and
// the same random picks (event-log.js).

// xoshiro128**: 128 bits of state from four 32-bit words (an all-zero seed is nudged). Returns rng() in [0, 1).
export function seededRng(words) {
  let [a, b, c, d] = words.map((x) => x >>> 0);
  if (!(a | b | c | d)) a = 1;
  const rotl = (x, k) => (x << k) | (x >>> (32 - k));
  return () => {
    const r = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0;
    const t = b << 9;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = rotl(d, 11);
    return r / 0x100000000;
  };
}
export const newSeed = () => [...crypto.getRandomValues(new Uint32Array(4))];
