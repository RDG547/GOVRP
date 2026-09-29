import React, { useEffect, useState } from 'react';
import { brandFont } from '@/lib/brandFonts';
import { partyColor } from '@/lib/partyIdentity';
function usePreview(file, url) {
  const [objectUrl,setObjectUrl]=useState('');
  useEffect(()=>{if(!file){setObjectUrl('');return;}const next=URL.createObjectURL(file);setObjectUrl(next);return()=>URL.revokeObjectURL(next);},[file]);
  return file ? objectUrl : url;
}
export default function PartyBrandPreview({name,acronym,logoUrl,logoFile,bannerUrl,bannerFile,color,fontKey}) {
  const logo=usePreview(logoFile,logoUrl), banner=usePreview(bannerFile,bannerUrl);
  return <figure aria-label="Prévia da identidade do partido" className="overflow-hidden rounded-xl border" style={{borderColor:partyColor(color)}}>
    {banner&&<img src={banner} alt="Prévia do banner do partido" className="aspect-[3/1] w-full object-cover"/>}
    <figcaption className="flex min-w-0 items-center gap-3 p-4" style={{borderTop:`4px solid ${partyColor(color)}`}}>{logo&&<img src={logo} alt="Prévia do logo do partido" className="h-12 w-12 shrink-0 rounded-lg object-contain"/>}<span className="min-w-0 break-words text-xl font-semibold" style={{fontFamily:brandFont(fontKey)}}>{name||'Nome do partido'}{acronym&&` - ${acronym}`}</span></figcaption>
  </figure>;
}
