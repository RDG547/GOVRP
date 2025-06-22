import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
	return twMerge(clsx(inputs));
}

export function generateCPF() {
  const rnd = (n) => Math.round(Math.random() * n);
  const mod = (a, b) => Math.round(a - Math.floor(a / b) * b);
  const num = Array(9).fill(0).map(() => rnd(9));
  
  let d1 = num.map((v, i) => v * (10 - i)).reduce((acc, v) => acc + v, 0);
  d1 = 11 - mod(d1, 11);
  if (d1 >= 10) d1 = 0;

  let d2 = num.map((v, i) => v * (11 - i)).reduce((acc, v) => acc + v, 0) + d1 * 2;
  d2 = 11 - mod(d2, 11);
  if (d2 >= 10) d2 = 0;

  return `${num.join('')}${d1}${d2}`;
}

export function generateRG() {
  const rnd = (n) => Math.round(Math.random() * n);
  const num = Array(8).fill(0).map(() => rnd(9));
  const dv = rnd(9);
  return `${num.join('')}${dv}`;
}

export function formatCPF(cpf) {
  if (!cpf) return '';
  cpf = cpf.replace(/\D/g, '');
  if (cpf.length > 11) cpf = cpf.slice(0, 11);
  cpf = cpf.replace(/(\d{3})(\d)/, '$1.$2');
  cpf = cpf.replace(/(\d{3})(\d)/, '$1.$2');
  cpf = cpf.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return cpf;
}

export function formatRG(rg) {
  if (!rg) return '';
  rg = rg.replace(/\D/g, '');
  if (rg.length > 9) rg = rg.slice(0, 9);
  rg = rg.replace(/(\d{2})(\d)/, '$1.$2');
  rg = rg.replace(/(\d{3})(\d)/, '$1.$2');
  rg = rg.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return rg;
}

export function formatPhone(phone) {
  if (!phone) return '';
  phone = phone.replace(/\D/g, '');
  if (phone.length > 11) phone = phone.slice(0, 11);
  if (phone.length > 10) {
    phone = phone.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  } else {
    phone = phone.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  }
  return phone;
}

export function formatCurrency(value) {
  if (!value) return '';
  let numericValue = String(value).replace(/\D/g, '');
  if (!numericValue) return '';
  numericValue = (parseInt(numericValue, 10) / 100);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numericValue);
}

export function parseCurrency(value) {
  if (!value) return 0;
  return parseFloat(String(value).replace(/\D/g, '')) / 100;
}


export function checkPasswordStrength(password) {
  const strength = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  const score = Object.values(strength).filter(Boolean).length;
  return { strength, score };
}