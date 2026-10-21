import React,{useState} from 'react';
import {ImageOff} from 'lucide-react';
export default function ContainedImage({src,alt,className='',fallback:Fallback=ImageOff}){
 const [failed,setFailed]=useState(null);
 return src&&failed!==src?<img src={src} alt={alt} loading="lazy" decoding="async" className={`h-full w-full object-contain ${className}`} onError={()=>setFailed(src)}/>:<span role="img" aria-label={`${alt} · imagem indisponível`} className={`flex h-full w-full items-center justify-center ${className}`}><Fallback className="h-12 w-12 text-muted-foreground" aria-hidden="true"/></span>;
}
