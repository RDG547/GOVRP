// Original pen-stroke alphabet. No fonts or external signature assets.
// Unit glyphs connect at the writing baseline (y=16).
const strokes = {
  a: 'C2 15 2 8 7 8 C12 8 8 17 4 16 C0 14 7 7 10 8 L9 15 Q10 19 14 16',
  b: 'C5 11 11 -4 6 -2 C1 0 4 17 7 16 C15 13 10 5 6 10 Q3 17 14 16',
  c: 'C4 9 11 5 10 9 C4 3 1 16 7 17 Q10 18 14 16',
  d: 'C2 9 11 6 10 11 C8 20 1 17 4 11 Q8 7 10 9 C12 4 14 -5 10 -2 C7 2 9 19 15 16',
  e: 'C4 15 13 8 8 8 C2 7 2 18 9 17 L14 16',
  f: 'C7 6 16 -7 10 -3 C3 2 4 27 8 26 C12 25 6 18 3 16 Q8 12 15 12 M5 16 Q11 19 15 16',
  g: 'C2 10 10 6 10 10 C10 19 1 19 3 12 Q6 7 11 8 L8 27 C3 34 -1 24 9 21 L15 16',
  h: 'C5 6 12 -6 7 -3 C2 0 5 17 4 17 Q10 1 11 11 L10 15 Q11 19 15 16',
  i: 'Q5 11 5 9 L4 15 Q5 19 12 16 M7 3 L7.3 3.2 M12 16',
  j: 'Q6 10 7 8 L4 27 C0 34 -5 25 5 21 L13 16 M8 3 L8.3 3.2 M13 16',
  k: 'C5 6 12 -6 7 -3 C2 0 4 17 4 17 Q10 4 12 9 Q13 12 6 12 Q10 18 15 16',
  l: 'C6 11 14 -6 7 -3 C1 0 3 20 13 16',
  m: 'L4 9 L3 17 Q8 2 10 10 L9 17 Q15 2 17 11 L16 15 Q17 19 22 16',
  n: 'L4 9 L3 17 Q10 1 12 11 L11 15 Q12 19 17 16',
  o: 'C1 8 11 6 11 11 C11 20 1 20 3 10 Q8 6 9 11 Q10 16 15 13 L16 16',
  p: 'L6 8 L2 29 M5 14 C14 1 16 17 8 17 Q6 17 6 14 M8 17 L17 16',
  q: 'C2 9 11 6 10 11 C8 21 0 16 4 10 Q7 7 11 8 L8 28 L14 22 M10 16 L16 16',
  r: 'L5 8 Q4 15 7 11 Q10 5 12 10 L10 15 Q11 19 16 16',
  s: 'L9 7 C4 13 12 14 9 17 Q2 20 3 15 M9 17 L15 16',
  t: 'L9 0 L5 14 Q5 20 14 16 M3 7 L13 7 M14 16',
  u: 'L5 8 C-1 21 9 21 12 8 L10 15 Q11 19 16 16',
  v: 'L5 8 Q2 26 13 9 Q11 16 17 13 L18 16',
  w: 'L5 8 C0 24 10 20 12 9 C8 24 19 19 21 9 Q20 16 25 13 L26 16',
  x: 'Q8 5 10 14 Q12 20 17 16 M14 8 L4 19 M17 16',
  y: 'L5 8 C0 23 11 16 12 8 L8 28 C4 35 -1 25 8 21 L17 16',
  z: 'L6 9 Q17 5 12 11 L5 17 Q20 13 12 28 C7 33 4 24 14 21 L18 16',
};
export function citizenSignature(seed, name) {
  let state = 2166136261;
  for (const c of String(seed || name || 'GOVRP')) { state ^= c.charCodeAt(0); state = Math.imul(state, 16777619); }
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
  const words = String(name || 'Cidadão GOVRP').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
  const signature = words.length > 1 ? `${words[0]} ${words.at(-1)}` : words[0];
  const paths = []; let x = 10;
  for (const c of signature.slice(0, 40)) {
    if (c === ' ') { x += 13; continue; }
    const scale = .9 + random() * .25;
    paths.push({ d: `M0 16 ${strokes[c] || strokes.o}`, transform: `translate(${x.toFixed(2)} ${(12 + random() * 2).toFixed(2)}) skewX(-${(8 + random() * 8).toFixed(2)}) scale(${scale.toFixed(3)} 1)`, width: (.9 + random() * .5).toFixed(2) });
    x += ({ m: 20, w: 24, n: 15, i: 10, l: 11 }[c] || 13) * scale;
  }
  paths.push({ d: `M8 39 Q${(x * .4).toFixed(2)} ${(45 + random() * 3).toFixed(2)} ${x.toFixed(2)} 34`, width: '.85' });
  return { paths, viewBox: `0 0 ${Math.ceil(x + 14)} 54` };
}
