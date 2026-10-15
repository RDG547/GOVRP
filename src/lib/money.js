// Decimal strings at RPC boundaries; integer cents for parsing and formatting.
export function decimalToCents(value) {
 if(value===null||value===undefined||value==='')return 0n;
 const text=String(value).trim();
 if(!/^-?\d+(\.\d{1,2})?$/.test(text))throw new Error('Informe um valor monetário válido com até duas casas decimais.');
 const negative=text.startsWith('-'),[whole,fraction='']=text.replace(/^-/, '').split('.');const cents=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(cents>999999999999999n)throw new Error('O valor informado ultrapassa o limite permitido.');
 return negative?-cents:cents;
}
const absolute=cents=>cents<0n?-cents:cents;
export const centsToDecimal=cents=>`${cents<0n?'-':''}${absolute(cents)/100n}.${String(absolute(cents)%100n).padStart(2,'0')}`;
export const formatCents=cents=>`${cents<0n?'-':''}R$ ${(absolute(cents)/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.')},${String(absolute(cents)%100n).padStart(2,'0')}`;
export function moneyInputValue(text,allowNegative=false){
 const digits=String(text).replace(/\D/g,'').slice(0,15),cents=BigInt(digits||'0');return allowNegative&&String(text).includes('-')?-cents:cents;
}
