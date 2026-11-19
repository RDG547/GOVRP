import React from 'react';
import {Input} from './input';
import {decimalToCents,moneyInputValue,centsToDecimal,formatCents} from '@/lib/money';
export const CurrencyInput=React.forwardRef(function CurrencyInput({value='',onValueChange,onChange,onBlur,allowEmpty=true,decimal=false,allowNegative=false,currency='BRL',...props},ref){
 const precision=currency==='JPY'?0:2;
 const formatted=cents=>currency==='BRL'?formatCents(cents):new Intl.NumberFormat('pt-BR',{style:'currency',currency,minimumFractionDigits:precision,maximumFractionDigits:precision}).format(Number(cents)/100);
 const parsedInput=(raw)=>moneyInputValue(raw,allowNegative)*(precision===0?100n:1n);
 const input=React.useRef(null),errorId=React.useId();const [inputError,setInputError]=React.useState('');
 let cents=0n,parseError='';try{cents=typeof value==='string'&&/[R$,]/.test(value)?moneyInputValue(value,true):decimalToCents(value);}catch(error){parseError=error.message;}
 let error=(precision===0&&cents%100n!==0n?'Esta moeda não admite casas decimais.':'')||parseError||inputError||(!allowNegative&&cents<0n?'Informe um valor positivo.':'');
 if(value!==''&&!error&&props.min!==undefined&&cents<decimalToCents(props.min))error=`Valor mínimo: ${formatted(decimalToCents(props.min))}.`;
 if(value!==''&&!error&&props.max!==undefined&&cents>decimalToCents(props.max))error=`Valor máximo: ${formatted(decimalToCents(props.max))}.`;
 React.useEffect(()=>{input.current?.setCustomValidity(error);},[error]);
 const display=parseError?String(value):value===''&&allowEmpty?'':formatted(cents);
 return <div className="min-w-0"><Input {...props} ref={node=>{input.current=node;if(typeof ref==='function')ref(node);else if(ref)ref.current=node;}} aria-invalid={Boolean(error)||undefined} aria-describedby={error?errorId:props['aria-describedby']} type="text" inputMode="numeric" placeholder={props.placeholder||formatted(0n)} value={display} onChange={event=>{
  const raw=event.target.value;if(raw.includes('-')&&!allowNegative){setInputError('Informe um valor positivo.');return;}const next=raw===''&&allowEmpty?'':formatted(parsedInput(raw));
  setInputError(raw.replace(/\D/g,'').length>15?'O valor informado ultrapassa o limite permitido.':'');
  event.target.value=decimal?(next===''?'':centsToDecimal(parsedInput(raw))):next;
  onValueChange?.(next===''?'':centsToDecimal(parsedInput(raw)));onChange?.(event);
 }} onBlur={event=>{onBlur?.(event);}}/>{error&&<p id={errorId} role="status" className="mt-1 text-xs text-destructive">{error}</p>}</div>;
});
