// Platform font stacks only: no arbitrary CSS, remote imports or uploaded fonts.
export const BRAND_FONTS = [
  { key: 'default', label: 'Padrão GOVRP', family: 'inherit' },
  { key: 'modern', label: 'Moderna · Arial', family: 'Arial, Helvetica, sans-serif' },
  { key: 'institutional', label: 'Institucional · Verdana', family: 'Verdana, Geneva, sans-serif' },
  { key: 'classic', label: 'Clássica · Georgia', family: 'Georgia, serif' },
  { key: 'elegant', label: 'Elegante · Palatino', family: 'Palatino, "Palatino Linotype", Georgia, serif' },
  { key: 'geometric', label: 'Geométrica · Trebuchet', family: '"Trebuchet MS", Arial, sans-serif' },
  { key: 'editorial', label: 'Editorial · Times', family: '"Times New Roman", Times, serif' },
  { key: 'technical', label: 'Técnica · Monoespaçada', family: 'ui-monospace, "Courier New", monospace' },
];
export const brandFont = key => BRAND_FONTS.find(font => font.key === key)?.family || 'inherit';
