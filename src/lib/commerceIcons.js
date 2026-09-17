import { Utensils, Droplets, Home, Car, Shirt, Laptop, Wrench, Package, Building2, HardHat, HeartPulse, GraduationCap, Newspaper, Wifi, Hammer, Wheat, Hotel, Palette, Coffee, Store, Briefcase, Radio, Truck, Landmark } from 'lucide-react';

export const categoryIcon = category => ({ Alimentos: Utensils, Bebidas: Droplets, Moradia: Home, Casa: Home, Veículos: Car, Vestuário: Shirt, Eletrônicos: Laptop, Serviços: Wrench })[category] || Package;
export function businessTypeIcon(type) {
  const label = `${type?.id || ''} ${type?.name || ''} ${type?.category || ''}`.toLocaleLowerCase('pt-BR');
  if (/café|cafe|cafeteria/.test(label)) return Coffee;
  if (/saúde|saude|clínica|clinica|hospital/.test(label)) return HeartPulse;
  if (/educa|escola|universidade/.test(label)) return GraduationCap;
  if (/jornal|imprensa/.test(label)) return Newspaper;
  if (/internet|telecom/.test(label)) return Wifi;
  if (/agric|fazenda|agro/.test(label)) return Wheat;
  if (/hotel|hospeda|turismo/.test(label)) return Hotel;
  if (/arte|design|cultura/.test(label)) return Palette;
  if (/oficina|mecân|mecan|manuten/.test(label)) return Wrench;
  if (/indústr|industr|fábrica|fabrica/.test(label)) return Hammer;
  if (/aliment|restaurante|lanchonete|padaria/.test(label)) return Utensils;
  if (/transporte|logística|logistica/.test(label)) return Truck;
  if (/mídia|midia|comunica|jornal|rádio/.test(label)) return Radio;
  if (/banco|financ/.test(label)) return Landmark;
  if (/tecnol|informática|software/.test(label)) return Laptop;
  if (/constru/.test(label)) return HardHat;
  if (/imobili/.test(label)) return Home;
  if (/comércio|comercio|varejo|loja/.test(label)) return Store;
  return Briefcase;
}
