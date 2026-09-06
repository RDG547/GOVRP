// Fictional artwork only. A citizen's RP identity seeds all ridge parameters.
export function fingerprintPaths(citizenId) {
  const seed = String(citizenId || 'unregistered-citizen');
  let a = 0x9e3779b9, b = 0x243f6a88, c = 0xb7e15162, d = 0xdeadbeef;
  for (const char of seed) {
    const n = char.charCodeAt(0);
    a = Math.imul(a ^ n, 2654435761); b = Math.imul(b ^ a, 1597334677);
    c = Math.imul(c ^ b, 2246822507); d = Math.imul(d ^ c, 3266489909);
  }
  const random = () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = ((a + b | 0) + d | 0); d = d + 1 | 0;
    a = b ^ b >>> 9; b = c + (c << 3) | 0; c = (c << 21 | c >>> 11) + t | 0;
    return (t >>> 0) / 4294967296;
  };
  const centerX = 44 + random() * 12, centerY = 43 + random() * 12;
  const lean = (random() - 0.5) * 0.35, phase = random() * Math.PI * 2;
  const paths = [];
  for (let ridge = 0; ridge < 23; ridge++) {
    const radius = 3 + ridge * 2.1;
    const gap = random() > 0.7 ? 0.12 + random() * 0.15 : 0;
    const start = -Math.PI * 0.95 + random() * 0.08;
    const end = Math.PI * 1.05 - gap;
    const points = [];
    for (let i = 0; i <= 120; i++) {
      const angle = start + (end - start) * i / 120;
      const distortion = Math.sin(angle * 3 + phase) * (0.8 + ridge * 0.03);
      const x = centerX + Math.cos(angle) * (radius + distortion) * 0.77 + Math.sin(angle) * radius * lean;
      const y = centerY + Math.sin(angle) * (radius + distortion) * 1.03 + Math.cos(angle * 2 + phase) * 1.5;
      points.push(`${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`);
    }
    paths.push(points.join(' '));
  }
  return paths;
}
