import React, {useEffect,useRef,useState} from 'react';
import {Plus,Minus} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
export default function QuantityControl({value,max=100,onChange,label}) {
 const [draft,setDraft]=useState(String(value)),[message,setMessage]=useState('');
 const timer=useRef(),held=useRef(false),latest=useRef({value,max,onChange});latest.current={value,max,onChange};
 useEffect(()=>setDraft(String(value)),[value]);
 const stop=()=>{clearTimeout(timer.current);held.current=false;};
 useEffect(()=>{window.addEventListener('blur',stop);return()=>{stop();window.removeEventListener('blur',stop);};},[]);
 const step=delta=>{const current=latest.current;const next=Math.max(1,Math.min(current.max,current.value+delta));if(current.max>0&&next!==current.value){latest.current.value=next;current.onChange(next);}};
 const start=(event,delta)=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);stop();held.current=true;step(delta);const started=performance.now();const tick=()=>{if(!held.current)return;step(delta);const elapsed=performance.now()-started;timer.current=setTimeout(tick,elapsed>1800?55:elapsed>700?110:220);};timer.current=setTimeout(tick,350);};
 const button=(delta,Icon)=><Button type="button" variant="outline" size="icon" className="h-10 w-10 touch-none" aria-label={`${delta>0?'Aumentar':'Diminuir'} quantidade de ${label}`} disabled={max<1||(delta>0?value>=max:value<=1)} onPointerDown={event=>start(event,delta)} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onClick={event=>{if(event.detail===0)step(delta);}}><Icon className="h-4 w-4"/></Button>;
 const edit=event=>{const text=event.target.value;setDraft(text);if(!text){setMessage('Informe uma quantidade inteira maior que zero.');return;}if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text))||Number(text)<1){setMessage('Use somente números inteiros maiores que zero.');return;}const n=Number(text);if(n>max){setMessage(`Quantidade máxima disponível: ${max}.`);setDraft(String(Math.max(1,max)));if(max>0)onChange(max);}else{setMessage('');onChange(n);}};
 return <div className="min-w-0 space-y-1"><div className="flex items-center gap-1">{button(-1,Minus)}<Input type="text" inputMode="numeric" role="spinbutton" aria-label={`Quantidade de ${label}`} aria-valuemin={1} aria-valuemax={max} aria-valuenow={value} aria-invalid={Boolean(message)} className="h-10 w-16 text-center font-semibold" value={draft} disabled={max<1} onChange={edit} onBlur={()=>setDraft(String(value))} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();step(event.key==='ArrowUp'?1:-1);}}}/>{button(1,Plus)}</div>{message&&<p role="status" className="max-w-56 text-xs text-amber-500">{message}</p>}</div>;
}
