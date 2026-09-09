import { Utensils, Droplets, Home, Car, Shirt, Laptop, Wrench, Package, Building2, Store, Briefcase, Radio, Truck, Landmark } from 'lucide-react';

export const categoryIcon = category => ({ Alimentos: Utensils, Bebidas: Droplets, Moradia: Home, Casa: Home, Veículos: Car, Vestuário: Shirt, Eletrônicos: Laptop, Serviços: Wrench })[category] || Package;
export function businessTypeIcon(type) {
  const label = `${type?.id || ''} ${type?.name || ''} ${type?.category || ''}`.toLocaleLowerCase('pt-BR');
  if (/aliment|restaurante|lanchonete|padaria/.test(label)) return Utensils;
  if (/transporte|logística|logistica/.test(label)) return Truck;
  if (/mídia|midia|comunica|jornal|rádio/.test(label)) return Radio;
  if (/banco|financ/.test(label)) return Landmark;
  if (/tecnol|informática|software/.test(label)) return Laptop;
  if (/constru|imobili/.test(label)) return Building2;
  if (/comércio|comercio|varejo|loja/.test(label)) return Store;
  return Briefcase;
}
