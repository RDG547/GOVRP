import React, { useId, useState } from 'react';
import { Check, ChevronsUpDown, Type } from 'lucide-react';
import { BRAND_FONTS, brandFont } from '@/lib/brandFonts';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command';

export default function BrandFontPicker({ value = 'default', onChange, name = 'Sua marca' }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="flex items-center gap-2 text-sm"><Type className="h-4 w-4"/>Fonte da marca</label>
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild><Button id={id} type="button" variant="outline" role="combobox" aria-label="Fonte da marca" aria-expanded={open} className="h-11 w-full justify-between gap-2"><span className="truncate" style={{fontFamily:brandFont(value)}}>{BRAND_FONTS.find(font=>font.key===value)?.label || 'Padrão GOVRP'}</span><ChevronsUpDown className="h-4 w-4 shrink-0"/></Button></PopoverTrigger>
      <PopoverContent align="start" className="w-[min(90vw,26rem)] p-1">
        <Command><CommandInput placeholder="Buscar fonte ou estilo…" aria-label="Buscar fonte ou estilo"/><CommandList label="Fontes da marca" className="max-h-[min(18rem,50dvh)]"><CommandEmpty>Nenhuma fonte encontrada.</CommandEmpty>{BRAND_FONTS.map(font=><CommandItem key={font.key} value={`${font.label} ${font.category}`} onSelect={()=>{onChange(font.key);setOpen(false);}} className="min-h-14 gap-2 px-3"><div className="min-w-0 flex-1"><span className="block truncate text-lg" style={{fontFamily:font.family}}>{font.label}</span><span className="text-xs text-muted-foreground">{font.category}</span></div>{font.key===value&&<Check aria-label="Fonte selecionada" className="h-4 w-4 shrink-0"/>}</CommandItem>)}</CommandList></Command>
      </PopoverContent>
    </Popover>
    <p className="break-words rounded-lg border p-4 text-center text-xl" style={{fontFamily:brandFont(value)}}>{name}</p>
    <p className="text-xs text-muted-foreground">50 fontes para a identidade da marca. Menus e formulários mantêm o padrão GOVRP.</p>
  </div>;
}
