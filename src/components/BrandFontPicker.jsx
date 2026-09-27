import React from 'react';
import { Type } from 'lucide-react';
import { BRAND_FONTS, brandFont } from '@/lib/brandFonts';
export default function BrandFontPicker({ value = 'default', onChange, name = 'Sua marca' }) {
  return <div className="space-y-2"><label className="block text-sm"><span className="flex items-center gap-2 mb-2"><Type className="h-4 w-4"/>Fonte da marca</span><select aria-label="Fonte da marca" className="h-11 w-full rounded-md border bg-background px-3" value={value} onChange={e=>onChange(e.target.value)}>{BRAND_FONTS.map(font=><option key={font.key} value={font.key}>{font.label}</option>)}</select></label><p className="rounded-lg border p-4 text-center text-xl break-words" style={{fontFamily:brandFont(value)}}>{name}</p><p className="text-xs text-muted-foreground">A fonte aparece somente na identidade da marca. Menus e formulários mantêm o padrão GOVRP.</p></div>;
}
