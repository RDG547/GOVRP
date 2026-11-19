import React,{useState} from 'react';
import {ImageOff} from 'lucide-react';
export default function ContainedImage({src,alt,className='',fallback:Fallback=ImageOff}){
 const [failed,setFailed]=useState(null);
 return src&&failed!==src?<span className="relative block h-full w-full overflow-hidden bg-muted/30"><span aria-hidden="true" className="pointer-events-none absolute -inset-6 bg-cover bg-center opacity-20 blur-xl" style={{backgroundImage:`url(${JSON.stringify(src)})`}}/><img src={src} alt={alt} loading="lazy" decoding="async" className={`relative h-full w-full object-contain ${className}`} onError={()=>setFailed(src)}/></span>:<span role="img" aria-label={`${alt} · imagem indisponível`} className={`flex h-full w-full items-center justify-center ${className}`}><Fallback className="h-12 w-12 text-muted-foreground" aria-hidden="true"/></span>;
}
