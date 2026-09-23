import React, { useEffect, useId, useState } from 'react';
import { partyColor, partyColorText } from '@/lib/partyIdentity';
import { Input } from '@/components/ui/input';

export function hsvToHex(h, s, v) {
  const c=v*s, x=c*(1-Math.abs((h/60)%2-1)), m=v-c;
  const rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
  return '#'+rgb.map(n=>Math.round((n+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function hexToHsv(hex) {
  const [r,g,b]=partyColor(hex).slice(1).match(/../g).map(n=>parseInt(n,16)/255);
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  return [d===0?0:((max===r?(g-b)/d:max===g?(b-r)/d+2:(r-g)/d+4)*60+360)%360,max?d/max:0,max];
}
export default function PartyColorPicker({ value='#64748B', onChange, party }) {
  const id=useId(), [hsv,setHsv]=useState(()=>hexToHsv(value)), [hex,setHex]=useState(value);
  useEffect(()=>{setHex(value);setHsv(current=>hsvToHex(...current)===value.toUpperCase()?current:hexToHsv(value));},[value]);
  const update=next=>{setHsv(next);const color=hsvToHex(...next);setHex(color);onChange(color);};
  const point=event=>{const rect=event.currentTarget.getBoundingClientRect(),x=(event.clientX-rect.left)/rect.width*2-1,y=(event.clientY-rect.top)/rect.height*2-1;update([(Math.atan2(y,x)*180/Math.PI+450)%360,Math.min(1,Math.hypot(x,y)),hsv[2]]);};
  const angle=(hsv[0]-90)*Math.PI/180;
  return <fieldset className="space-y-3 rounded-xl border p-4"><legend className="px-1 text-sm font-semibold">Cor oficial do partido</legend>
    <div className="mx-auto h-40 w-40 touch-none rounded-full relative ring-1 ring-border" role="slider" tabIndex={0} aria-label="Roda de cor do partido" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv[0])} aria-valuetext={`${hex}; saturação ${Math.round(hsv[1]*100)}%`} style={{background:'radial-gradient(circle, white 0%, transparent 70%), conic-gradient(red, yellow, lime, cyan, blue, magenta, red)'}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);point(e);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))point(e);}} onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();update([e.key==='Home'?0:e.key==='End'?359:e.key==='ArrowLeft'?(hsv[0]+355)%360:e.key==='ArrowRight'?(hsv[0]+5)%360:hsv[0],Math.max(0,Math.min(1,hsv[1]+(e.key==='ArrowUp'?.05:e.key==='ArrowDown'?-.05:0))),hsv[2]]);}}>
      <span aria-hidden="true" className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ring-1 ring-black" style={{left:`${50+Math.cos(angle)*hsv[1]*50}%`,top:`${50+Math.sin(angle)*hsv[1]*50}%`}}/>
    </div>
    <label className="block text-sm" htmlFor={`${id}-brightness`}>Luminosidade</label><input id={`${id}-brightness`} className="w-full min-h-8" type="range" min="0" max="100" value={Math.round(hsv[2]*100)} onChange={e=>update([hsv[0],hsv[1],Number(e.target.value)/100])}/>
    <label className="block text-sm" htmlFor={`${id}-hex`}>Código HEX</label><Input id={`${id}-hex`} value={hex} maxLength={7} pattern="#[0-9a-fA-F]{6}" onChange={e=>{setHex(e.target.value);if(/^#[0-9a-f]{6}$/i.test(e.target.value))onChange(e.target.value.toUpperCase());}} onBlur={()=>setHex(value)} />
    <div className="rounded-lg p-3 text-center font-semibold" style={{backgroundColor:partyColor(value),color:partyColorText(value)}}>{party?.logo_url&&<img src={party.logo_url} alt="" className="mx-auto mb-2 h-10 w-10 rounded object-contain"/>}{party?.name || "Nome do partido"} {party?.acronym ? `- ${party.acronym}` : ""}</div>
    <p className="text-xs text-muted-foreground">Arraste na roda ou use as setas: esquerda/direita para matiz e cima/baixo para saturação.</p>
  </fieldset>;
}
