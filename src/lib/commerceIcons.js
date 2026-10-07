import { Pill, Sprout, Beef, Milk, Fish, Trees, Sandwich, Croissant, ShoppingCart, Ruler, Construction, School, BookOpen, Wind, Waves, Sun, Flame, Fuel, Shovel, Mountain, Coins, TrendingUp, ShieldCheck, Factory, Wine, CircuitBoard, Tablets, FlaskConical, Scissors, Cog, CarFront, FileStack, Magnet, Tv, Rss, Stethoscope, Microscope, Megaphone, Calculator, Code, Scale, Brush, Plane, Route, Ship, CarTaxiFront, Bus, Monitor } from 'lucide-react';
import { Utensils, Droplets, Home, Car, Shirt, Laptop, Wrench, Package, Building2, HardHat, HeartPulse, GraduationCap, Newspaper, Wifi, Hammer, Wheat, Hotel, Palette, Coffee, Store, Briefcase, Radio, Truck, Landmark, Shield, Boxes, Lightbulb } from 'lucide-react';

export const categoryIcon = category => ({ Alimentos: Utensils, Bebidas: Droplets, Moradia: Home, Casa: Home, Veículos: Car, Vestuário: Shirt, Eletrônicos: Laptop, Serviços: Wrench })[category] || Package;
export const BUSINESS_TYPE_ICONS = {
  agricultura: Sprout,
  fazenda: Wheat,
  criacao_gado: Beef,
  pecuaria: Milk,
  pesca: Fish,
  silvicultura: Trees,
  lanchonete: Sandwich,
  padaria: Croissant,
  restaurante: Utensils,
  atacadista: ShoppingCart,
  concessionaria: Car,
  distribuidora: Boxes,
  farmacia: Pill,
  loja: Laptop,
  loja_roupas: Shirt,
  supermercado: Store,
  construtora: HardHat,
  engenharia: Ruler,
  incorporadora: Building2,
  materiais_construcao: Construction,
  curso_profissionalizante: GraduationCap,
  escola: School,
  faculdade: BookOpen,
  eolica: Wind,
  hidreletrica: Waves,
  solar: Sun,
  termeletrica: Flame,
  extracao_gas: Fuel,
  petroleo: Droplets,
  mineracao: Shovel,
  pedreira: Mountain,
  banco: Landmark,
  financeira: Coins,
  gestora_investimentos: TrendingUp,
  seguradora: ShieldCheck,
  fabrica: Factory,
  industria_bebidas: Wine,
  industria_eletronicos: CircuitBoard,
  farmaceutica: Tablets,
  quimica: FlaskConical,
  textil: Scissors,
  metalurgica: Hammer,
  moinho: Cog,
  montadora: CarFront,
  papel_celulose: FileStack,
  siderurgica: Magnet,
  agencia_noticias: Rss,
  televisao: Tv,
  jornal: Newspaper,
  radio: Radio,
  clinica: Stethoscope,
  hospital_privado: HeartPulse,
  laboratorio: Microscope,
  marketing: Megaphone,
  consultoria: Lightbulb,
  contabilidade: Calculator,
  software: Code,
  advocacia: Scale,
  limpeza: Brush,
  seguranca: Shield,
  tecnologia: Monitor,
  telecomunicacoes: Wifi,
  aviacao: Plane,
  logistica: Route,
  navegacao: Ship,
  taxi: CarTaxiFront,
  transportadora: Truck,
  onibus: Bus
};
export function businessTypeIcon(type) {
  if (BUSINESS_TYPE_ICONS[type?.id]) return BUSINESS_TYPE_ICONS[type.id];
  const label = `${type?.id || ''} ${type?.name || ''} ${type?.category || ''}`.toLocaleLowerCase('pt-BR');
  if (/seguran|vigil/.test(label)) return Shield;
  if (/distribui|atacad/.test(label)) return Boxes;
  if (/consultor/.test(label)) return Lightbulb;
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

export const businessCategoryIcon = category => ({'Agronegócio':Sprout,'Alimentação':Utensils,'Comércio':Store,'Construção':HardHat,'Educação':GraduationCap,'Energia':Lightbulb,'Extração':Shovel,'Financeiro':Landmark,'Indústria':Factory,'Mídia':Radio,'Saúde':HeartPulse,'Serviços':Briefcase,'Transporte':Truck})[category] || Building2;
