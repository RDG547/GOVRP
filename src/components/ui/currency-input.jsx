import React from 'react';
import {Input} from './input';
import {decimalToCents,moneyInputValue,centsToDecimal,formatCents} from '@/lib/money';
export const CurrencyInput=React.forwardRef(function CurrencyInput({value='',onValueChange,onChange,onBlur,allowEmpty=true,decimal=false,allowNegative=false,...props},ref){
 const input=React.useRef(null),errorId=React.useId();const [inputError,setInputError]=React.useState('');
 let cents=0n,parseError='';try{cents=typeof value==='string'&&/[R$,]/.test(value)?moneyInputValue(value,true):decimalToCents(value);}catch(error){parseError=error.message;}
 let error=parseError||inputError||(!allowNegative&&cents<0n?'Informe um valor positivo.':'');
 if(value!==''&&!error&&props.min!==undefined&&cents<decimalToCents(props.min))error=`Valor mínimo: ${formatCents(decimalToCents(props.min))}.`;
 if(value!==''&&!error&&props.max!==undefined&&cents>decimalToCents(props.max))error=`Valor máximo: ${formatCents(decimalToCents(props.max))}.`;
 React.useEffect(()=>{input.current?.setCustomValidity(error);},[error]);
 const display=parseError?String(value):value===''&&allowEmpty?'':formatCents(cents);
 return <div className="min-w-0"><Input {...props} ref={node=>{input.current=node;if(typeof ref==='function')ref(node);else if(ref)ref.current=node;}} aria-invalid={Boolean(error)||undefined} aria-describedby={error?errorId:props['aria-describedby']} type="text" inputMode="numeric" placeholder={props.placeholder||'R$ 0,00'} value={display} onChange={event=>{
  const raw=event.target.value;if(raw.includes('-')&&!allowNegative){setInputError('Informe um valor positivo.');return;}const next=raw===''&&allowEmpty?'':formatCents(moneyInputValue(raw,allowNegative));
  setInputError(raw.replace(/\D/g,'').length>15?'O valor informado ultrapassa o limite permitido.':'');
  event.target.value=decimal?(next===''?'':centsToDecimal(moneyInputValue(raw,allowNegative))):next;
  onValueChange?.(next===''?'':centsToDecimal(moneyInputValue(raw,allowNegative)));onChange?.(event);
 }} onBlur={event=>{onBlur?.(event);}}/>{error&&<p id={errorId} role="status" className="mt-1 text-xs text-destructive">{error}</p>}</div>;
});
