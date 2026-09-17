// The avatar is rendered locally from an allowlisted configuration, with no remote image dependency.
export const AVATAR_OPTIONS = {
  hair: { label: 'Cabelo', values: { short: 'Curto', long: 'Longo', curly: 'Cacheado', side: 'Lateral', bald: 'Sem cabelo' } },
  hairColor: { label: 'Cor do cabelo', values: { '#211c19': 'Preto', '#603c28': 'Castanho', '#d9ae60': 'Loiro', '#a64c2b': 'Ruivo', '#c5c5c5': 'Grisalho', '#6b4f9d': 'Violeta' } },
  skin: { label: 'Pele', values: { '#f8dcc2': 'Clara', '#e8bb96': 'Clara dourada', '#c88c61': 'Média', '#a76d49': 'Morena', '#754a34': 'Escura', '#4b3027': 'Retinta' } },
  brows: { label: 'Sobrancelha', values: { soft: 'Suave', straight: 'Reta', arched: 'Arqueada' } },
  eyes: { label: 'Olhos', values: { round: 'Redondos', almond: 'Amendoados', narrow: 'Estreitos' } },
  eyeColor: { label: 'Cor dos olhos', values: { '#493126': 'Castanhos', '#20262b': 'Pretos', '#56889c': 'Azuis', '#6a885b': 'Verdes', '#a99a61': 'Mel' } },
  nose: { label: 'Nariz', values: { small: 'Pequeno', wide: 'Largo', straight: 'Reto' } },
  mouth: { label: 'Boca', values: { smile: 'Sorriso', calm: 'Serena', full: 'Lábios cheios' } },
  beard: { label: 'Barba', values: { none: 'Sem barba', stubble: 'Curta', full: 'Cheia', goatee: 'Cavanhaque' } },
  makeup: { label: 'Maquiagem', values: { none: 'Sem maquiagem', soft: 'Suave', bold: 'Marcante' } },
};
export const DEFAULT_AVATAR = Object.fromEntries(Object.entries(AVATAR_OPTIONS).map(([key, field]) => [key, Object.keys(field.values)[0]]));
export function normalizeAvatar(config = {}) {
  return Object.fromEntries(Object.entries(AVATAR_OPTIONS).map(([key, field]) => [key, Object.hasOwn(field.values, config?.[key]) ? config[key] : DEFAULT_AVATAR[key]]));
}
export function citizenAvatarSvg(config) {
  const c = normalizeAvatar(config), ry = { round: 12, almond: 8, narrow: 5 }[c.eyes];
  const hair = {
    short: '<path d="M64 103Q48 34 118 28Q190 19 197 98L176 69Q130 90 86 69Z"/>',
    long: '<path d="M59 186L52 94Q49 24 124 22Q204 23 205 102L202 194L178 181L178 67Q120 96 79 65L80 187Z"/>',
    curly: '<path d="M60 107Q36 95 50 75Q35 53 62 47Q57 24 84 30Q95 9 119 25Q143 6 158 27Q189 18 190 44Q216 50 200 72Q220 97 193 107L176 74Q130 87 81 73Z"/>',
    side: '<path d="M63 110Q43 44 100 27Q188 2 198 100L176 63Q149 120 74 124L86 64Z"/>',
    bald: '',
  }[c.hair];
  const brows = { soft: ['M85 96Q96 89 107 96', 'M149 96Q160 89 171 96'], straight: ['M85 93L107 94', 'M149 94L171 93'], arched: ['M85 95L95 88L108 93', 'M148 93L161 88L171 95'] }[c.brows];
  const beard = c.beard === 'none' ? '' : c.beard === 'goatee' ? '<path d="M108 176Q128 188 148 176L142 196Q128 208 114 196Z"/>' : `<path opacity="${c.beard === 'stubble' ? '.3' : '1'}" d="M68 138Q80 173 107 171L111 180Q128 191 145 180L149 171Q180 169 188 138L178 183Q130 232 80 183Z"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 256 256"><rect width="256" height="256" rx="40" fill="#123044"/><path d="M32 256Q35 208 106 200H150Q220 210 224 256" fill="#418396"/><path d="M108 179H148V212Q128 230 108 212Z" fill="${c.skin}"/><g fill="${c.hairColor}">${c.hair === 'long' ? hair : ''}</g><ellipse cx="66" cy="124" rx="13" ry="20" fill="${c.skin}"/><ellipse cx="190" cy="124" rx="13" ry="20" fill="${c.skin}"/><path d="M65 96Q65 43 128 42Q191 43 191 96V142Q187 197 128 208Q69 197 65 142Z" fill="${c.skin}"/><g fill="${c.hairColor}">${hair}${beard}</g><g fill="none" stroke="${c.hairColor}" stroke-width="5" stroke-linecap="round">${brows.map(d => `<path d="${d}"/>`).join('')}</g>${[96, 160].map(x => `<ellipse cx="${x}" cy="117" rx="15" ry="${ry}" fill="#fff"/><ellipse cx="${x}" cy="117" rx="6" ry="${Math.min(ry, 9)}" fill="${c.eyeColor}"/><circle cx="${x}" cy="117" r="3" fill="#111827"/><circle cx="${x + 2}" cy="114" r="2" fill="#fff"/>`).join('')}<path d="${{ small: 'M129 131L125 142L132 143', wide: 'M124 128L117 147Q129 155 139 147', straight: 'M129 127L122 150L134 150' }[c.nose]}" fill="none" stroke="#704a3e" opacity=".65" stroke-width="3" stroke-linecap="round"/>${c.makeup !== 'none' ? `<g fill="#b84865" opacity="${c.makeup === 'bold' ? '.5' : '.25'}"><ellipse cx="84" cy="147" rx="15" ry="7"/><ellipse cx="172" cy="147" rx="15" ry="7"/></g><path d="M79 111L108 109M149 109L178 111" stroke="#33233f" stroke-width="3"/>` : ''}<path d="${{ smile: 'M110 166Q128 185 146 166Q128 172 110 166Z', calm: 'M112 170Q128 176 144 170', full: 'M110 171Q121 160 128 167Q135 160 146 171Q128 186 110 171Z' }[c.mouth]}" fill="${c.mouth === 'calm' ? 'none' : c.makeup === 'bold' ? '#a72f50' : '#ae645b'}" stroke="#814b46" stroke-width="2" stroke-linecap="round"/></svg>`;
}
export const citizenAvatarDataUrl = config => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(citizenAvatarSvg(config))}`;
export async function citizenAvatarFile(config) {
  const image = new Image(); image.src = citizenAvatarDataUrl(config); await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  canvas.getContext('2d').drawImage(image, 0, 0, 512, 512);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Não foi possível gerar a imagem do avatar.');
  return new File([blob], 'avatar-govrp.png', { type: 'image/png' });
}
