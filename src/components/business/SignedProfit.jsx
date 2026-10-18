import React from 'react';
import { formatCurrency } from '@/lib/utils';
export default function SignedProfit({ value, className = '' }) {
 const number=Number(value||0),label=number>0?'Lucro':number<0?'Prejuízo':'Resultado neutro';
 return <span aria-label={`${label}: ${formatCurrency(number)}`} className={`${number>0?'text-emerald-500':number<0?'text-red-400':'text-muted-foreground'} ${className}`}>{number>0?'+':number<0?'−':''}{formatCurrency(Math.abs(number))}</span>;
}
