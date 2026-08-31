import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Briefcase,
  Building2,
  TrendingUp,
  Package,
  ShoppingBag,
  Plus,
  DollarSign,
  Users,
  Factory,
  Landmark,
  HardHat,
  Store,
  Truck,
  Boxes,
  ChevronRight,
  Search,
  X,
  AlertTriangle,
  CheckCircle,
  Clock,
  Info,
  Loader2,
  BarChart3,
  Wallet,
  Settings,
  Eye,
  Wrench,
  Lightbulb,
  Shield,
  Tag,
  ShoppingCart,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import PageHeader from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { fetchWithSessionAuth } from '@/lib/apiAuth';

// ═══════════════════════════════════════════════════════════════
// BUSINESS TYPE CATALOG — all company types with costs & details
// ═══════════════════════════════════════════════════════════════
const BUSINESS_TYPES = [
  {
    id: 'banco',
    name: 'Banco',
    icon: Landmark,
    color: 'text-emerald-400',
    bgGlow: 'from-emerald-500/20 to-emerald-700/5',
    borderColor: 'border-emerald-500/20',
    description: 'Ofereça serviços financeiros como contas, empréstimos e investimentos aos cidadãos.',
    category: 'Serviços Financeiros',
    registrationFee: 50000,
    monthlyCosts: {
      employees: 8000,
      infrastructure: 5000,
      licenses: 3000,
      security: 4000,
    },
    minEmployees: 10,
    requirements: ['Aprovação do Banco Central', 'Capital mínimo de R$ 50.000'],
    profitPotential: 'Alto',
    risk: 'Alto',
  },
  {
    id: 'construtora',
    name: 'Construtora',
    icon: HardHat,
    color: 'text-amber-400',
    bgGlow: 'from-amber-500/20 to-amber-700/5',
    borderColor: 'border-amber-500/20',
    description: 'Construa imóveis, infraestrutura e grandes projetos de engenharia para a nação.',
    category: 'Construção Civil',
    registrationFee: 35000,
    monthlyCosts: {
      employees: 12000,
      materials: 8000,
      equipment: 6000,
      licenses: 2000,
    },
    minEmployees: 15,
    requirements: ['Licença de construção', 'Engenheiro responsável'],
    profitPotential: 'Alto',
    risk: 'Médio',
  },
  {
    id: 'fabrica',
    name: 'Fábrica',
    icon: Factory,
    color: 'text-blue-400',
    bgGlow: 'from-blue-500/20 to-blue-700/5',
    borderColor: 'border-blue-500/20',
    description: 'Produza bens industriais em grande escala, desde eletrônicos até alimentos processados.',
    category: 'Indústria',
    registrationFee: 40000,
    monthlyCosts: {
      employees: 15000,
      rawMaterials: 10000,
      energy: 5000,
      maintenance: 3000,
    },
    minEmployees: 20,
    requirements: ['Alvará ambiental', 'Inspeção de segurança'],
    profitPotential: 'Muito Alto',
    risk: 'Médio',
  },
  {
    id: 'loja',
    name: 'Loja / Comércio',
    icon: Store,
    color: 'text-violet-400',
    bgGlow: 'from-violet-500/20 to-violet-700/5',
    borderColor: 'border-violet-500/20',
    description: 'Abra um ponto de venda para comercializar produtos diretamente ao consumidor final.',
    category: 'Comércio Varejista',
    registrationFee: 10000,
    monthlyCosts: {
      employees: 4000,
      stock: 3000,
      rent: 2500,
      marketing: 1000,
    },
    minEmployees: 3,
    requirements: ['Alvará de funcionamento', 'CNPJ ativo'],
    profitPotential: 'Médio',
    risk: 'Baixo',
  },
  {
    id: 'transportadora',
    name: 'Transportadora',
    icon: Truck,
    color: 'text-orange-400',
    bgGlow: 'from-orange-500/20 to-orange-700/5',
    borderColor: 'border-orange-500/20',
    description: 'Transporte cargas e mercadorias conectando produtores, fábricas e lojas do país.',
    category: 'Logística',
    registrationFee: 25000,
    monthlyCosts: {
      employees: 6000,
      fuel: 8000,
      vehicleMaintenance: 4000,
      insurance: 2000,
    },
    minEmployees: 8,
    requirements: ['Licença de transporte', 'Seguro obrigatório'],
    profitPotential: 'Médio',
    risk: 'Médio',
  },
  {
    id: 'consultoria',
    name: 'Consultoria',
    icon: Lightbulb,
    color: 'text-cyan-400',
    bgGlow: 'from-cyan-500/20 to-cyan-700/5',
    borderColor: 'border-cyan-500/20',
    description: 'Preste serviços especializados em gestão, tecnologia, finanças ou estratégia empresarial.',
    category: 'Serviços Profissionais',
    registrationFee: 8000,
    monthlyCosts: {
      employees: 5000,
      tools: 1500,
      marketing: 1000,
      office: 1500,
    },
    minEmployees: 2,
    requirements: ['CNPJ ativo', 'Profissionais certificados'],
    profitPotential: 'Médio',
    risk: 'Baixo',
  },
  {
    id: 'seguranca',
    name: 'Empresa de Segurança',
    icon: Shield,
    color: 'text-red-400',
    bgGlow: 'from-red-500/20 to-red-700/5',
    borderColor: 'border-red-500/20',
    description: 'Forneça serviços de segurança patrimonial e pessoal para empresas e cidadãos.',
    category: 'Segurança Privada',
    registrationFee: 20000,
    monthlyCosts: {
      employees: 10000,
      equipment: 3000,
      training: 2000,
      insurance: 2500,
    },
    minEmployees: 12,
    requirements: ['Autorização da Polícia Federal', 'Treinamento obrigatório'],
    profitPotential: 'Médio',
    risk: 'Alto',
  },
  {
    id: 'distribuidora',
    name: 'Distribuidora',
    icon: Boxes,
    color: 'text-teal-400',
    bgGlow: 'from-teal-500/20 to-teal-700/5',
    borderColor: 'border-teal-500/20',
    description: 'Distribua produtos no atacado para lojas, fábricas e empresas de todo o país.',
    category: 'Atacado e Distribuição',
    registrationFee: 20000,
    monthlyCosts: {
      employees: 7000,
      warehouse: 4000,
      logistics: 5000,
      inventory: 3000,
    },
    minEmployees: 8,
    requirements: ['Licença sanitária (se alimentos)', 'Galpão de armazenamento'],
    profitPotential: 'Alto',
    risk: 'Médio',
  },
];

const COST_LABELS = {
  employees: 'Funcionários',
  infrastructure: 'Infraestrutura',
  licenses: 'Licenças',
  security: 'Segurança',
  materials: 'Materiais',
  equipment: 'Equipamentos',
  rawMaterials: 'Matérias-Primas',
  energy: 'Energia',
  maintenance: 'Manutenção',
  stock: 'Estoque',
  rent: 'Aluguel',
  marketing: 'Marketing',
  fuel: 'Combustível',
  vehicleMaintenance: 'Manutenção Veicular',
  insurance: 'Seguro',
  tools: 'Ferramentas',
  office: 'Escritório',
  training: 'Treinamento',
  warehouse: 'Armazém',
  logistics: 'Logística',
  inventory: 'Inventário',
};

const RISK_COLOR = {
  Baixo: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
  Médio: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
  Alto: 'text-red-400 bg-red-500/15 border-red-500/30',
};

const PROFIT_COLOR = {
  Baixo: 'text-slate-400',
  Médio: 'text-amber-400',
  Alto: 'text-emerald-400',
  'Muito Alto': 'text-cyan-400',
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const parseCurrencyInput = (value = '') => {
  const numericString = `${value}`
    .replace(/[^\d,.-]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();

  return Number.parseFloat(numericString) || 0;
};

const formatCurrencyInput = (value = '') => {
  const digits = `${value}`.replace(/\D/g, '');
  const amount = digits ? Number.parseInt(digits, 10) / 100 : 0;
  return formatCurrency(amount);
};

const STATE_SECTOR_BUSINESS_TYPE = {
  Internet: 'consultoria',
  Telefonia: 'consultoria',
  'Energia Elétrica': 'fabrica',
  Água: 'distribuidora',
  Gás: 'distribuidora',
};

// ════════════════════════════════════════════════
// COMPONENTS
// ════════════════════════════════════════════════

const StatCard = ({ icon: Icon, label, value, color, delay = 0 }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
  >
    <Card className="glass-effect border-white/10 h-full">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground truncate">{label}</p>
          <p className="text-2xl font-bold text-foreground">{value}</p>
        </div>
      </CardContent>
    </Card>
  </motion.div>
);

const CostBreakdownBar = ({ costs }) => {
  const total = Object.values(costs).reduce((sum, v) => sum + v, 0);
  const colors = [
    'bg-cyan-500', 'bg-violet-500', 'bg-amber-500', 'bg-emerald-500',
    'bg-rose-500', 'bg-blue-500', 'bg-orange-500', 'bg-teal-500',
  ];

  return (
    <div className="space-y-3">
      <div className="flex rounded-full h-3 overflow-hidden bg-white/5">
        {Object.entries(costs).map(([key, value], i) => (
          <div
            key={key}
            className={`${colors[i % colors.length]} transition-all duration-500`}
            style={{ width: `${(value / total) * 100}%` }}
            title={`${COST_LABELS[key] || key}: ${formatCurrency(value)}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {Object.entries(costs).map(([key, value], i) => (
          <div key={key} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${colors[i % colors.length]}`} />
              <span className="text-muted-foreground">{COST_LABELS[key] || key}</span>
            </div>
            <span className="font-medium text-foreground">{formatCurrency(value)}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-white/10">
        <span className="text-sm font-semibold text-muted-foreground">Total Mensal</span>
        <span className="text-lg font-bold text-foreground">{formatCurrency(total)}</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════
// DETAIL MODAL w/ create button
// ═══════════════════════════════════════════════
const BusinessDetailModal = ({ business, onClose, onRegister, isRegistering }) => {
  if (!business) return null;
  const Icon = business.icon;
  const totalMonthlyCost = Object.values(business.monthlyCosts).reduce((s, v) => s + v, 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 30 }}
        transition={{ type: 'spring', damping: 22 }}
        className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`relative p-8 bg-gradient-to-br ${business.bgGlow} rounded-t-2xl border-b border-white/10`}>
          <button onClick={onClose} className="absolute top-4 right-4 p-2 text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-white/10">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-5">
            <div className={`flex items-center justify-center w-16 h-16 rounded-2xl bg-white/10 ${business.color}`}>
              <Icon className="w-8 h-8" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground mb-1">{business.category}</p>
              <h2 className="text-3xl font-bold text-foreground">{business.name}</h2>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-8 space-y-8">
          <p className="text-muted-foreground leading-relaxed">{business.description}</p>

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <DollarSign className="w-5 h-5 mx-auto mb-2 text-emerald-400" />
              <p className="text-xs text-muted-foreground">Taxa de registro</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(business.registrationFee)}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <Users className="w-5 h-5 mx-auto mb-2 text-blue-400" />
              <p className="text-xs text-muted-foreground">Funcionários mín.</p>
              <p className="text-lg font-bold text-foreground">{business.minEmployees}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <Wallet className="w-5 h-5 mx-auto mb-2 text-amber-400" />
              <p className="text-xs text-muted-foreground">Custo mensal</p>
              <p className="text-lg font-bold text-foreground">{formatCurrency(totalMonthlyCost)}</p>
            </div>
          </div>

          {/* Cost Breakdown */}
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-4">
              <BarChart3 className="w-5 h-5 text-primary" />
              Custos Operacionais Mensais
            </h3>
            <CostBreakdownBar costs={business.monthlyCosts} />
          </div>

          {/* Requirements */}
          <div>
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2 mb-3">
              <Info className="w-5 h-5 text-cyan-400" />
              Requisitos
            </h3>
            <ul className="space-y-2">
              {business.requirements.map((req, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-muted-foreground">
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  {req}
                </li>
              ))}
            </ul>
          </div>

          {/* Risk & Profit */}
          <div className="flex items-center gap-4 flex-wrap">
            <Badge className={`border text-sm px-3 py-1 ${RISK_COLOR[business.risk]}`}>
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
              Risco: {business.risk}
            </Badge>
            <Badge className="border text-sm px-3 py-1 bg-white/5 border-white/20 text-foreground">
              <TrendingUp className={`w-3.5 h-3.5 mr-1.5 ${PROFIT_COLOR[business.profitPotential]}`} />
              Potencial: {business.profitPotential}
            </Badge>
          </div>

          {/* Register CTA */}
          <Button
            onClick={() => onRegister(business)}
            disabled={isRegistering}
            className="w-full h-14 text-lg font-semibold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20"
          >
            {isRegistering ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Registrando…
              </>
            ) : (
              <>
                <Plus className="w-5 h-5 mr-2" />
                Registrar Empresa — {formatCurrency(business.registrationFee)}
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ════════════════════════════════════════
// BUSINESS TYPE CARD
// ════════════════════════════════════════
const BusinessTypeCard = ({ business, index, onSelect }) => {
  const Icon = business.icon;
  const totalMonthlyCost = Object.values(business.monthlyCosts).reduce((s, v) => s + v, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        className={`glass-effect h-full ${business.borderColor} hover:border-primary/40 cursor-pointer group transition-all duration-300 hover:shadow-lg hover:shadow-black/20`}
        onClick={() => onSelect(business)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className={`flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br ${business.bgGlow} mb-3`}>
              <Icon className={`w-7 h-7 ${business.color}`} />
            </div>
            <Badge className={`border text-xs ${RISK_COLOR[business.risk]}`}>
              {business.risk}
            </Badge>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{business.category}</span>
          </div>
          <CardTitle className="text-xl group-hover:text-primary transition-colors">{business.name}</CardTitle>
          <CardDescription className="line-clamp-2 leading-relaxed">{business.description}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Registro</p>
              <p className="font-semibold text-foreground">{formatCurrency(business.registrationFee)}</p>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Custo/mês</p>
              <p className="font-semibold text-foreground">{formatCurrency(totalMonthlyCost)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm pt-1">
            <span className="text-muted-foreground flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> {business.minEmployees}+ funcionários</span>
            <span className={`font-medium ${PROFIT_COLOR[business.profitPotential]}`}>{business.profitPotential}</span>
          </div>
          <div className="flex items-center justify-end text-primary font-medium text-sm group-hover:translate-x-1 transition-transform">
            Ver detalhes <ChevronRight className="w-4 h-4 ml-1" />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

// ═════════════════════════════════════════════
// MY BUSINESSES SECTION
// ═════════════════════════════════════════════
const MyBusinessCard = ({ biz, index, onSell, onCancelSale }) => {
  const typeData = BUSINESS_TYPES.find((t) => t.id === biz.type) || BUSINESS_TYPES[0];
  const Icon = typeData.icon;
  const totalMonthlyCost = Object.values(typeData.monthlyCosts).reduce((s, v) => s + v, 0);

  const statusMeta = {
    active: { label: 'Ativa', icon: CheckCircle, class: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
    pending: { label: 'Pendente', icon: Clock, class: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
    suspended: { label: 'Suspensa', icon: AlertTriangle, class: 'text-red-400 bg-red-500/15 border-red-500/30' },
  };
  const status = statusMeta[biz.status] || statusMeta.active;
  const StatusIcon = status.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <Card className={`glass-effect ${typeData.borderColor} hover:border-primary/40 transition-all duration-300`}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className={`flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br ${typeData.bgGlow}`}>
                <Icon className={`w-6 h-6 ${typeData.color}`} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">{biz.name}</h3>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">{typeData.category}</p>
              </div>
            </div>
            <Badge className={`border ${status.class}`}>
              <StatusIcon className="w-3 h-3 mr-1" />
              {status.label}
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <div className="rounded-lg bg-white/5 py-2">
              <p className="text-muted-foreground text-xs">Funcionários</p>
              <p className="font-bold text-foreground">{biz.employees}</p>
            </div>
            <div className="rounded-lg bg-white/5 py-2">
              <p className="text-muted-foreground text-xs">Custo/mês</p>
              <p className="font-bold text-foreground">{formatCurrency(totalMonthlyCost)}</p>
            </div>
            <div className="rounded-lg bg-white/5 py-2">
              <p className="text-muted-foreground text-xs">Receita/mês</p>
              <p className="font-bold text-emerald-400">{formatCurrency(biz.revenue)}</p>
            </div>
          </div>

          {biz.isForSale ? (
            <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              À venda por <span className="font-bold">{formatCurrency(biz.salePrice || 0)}</span>
            </div>
          ) : null}

          <div className="flex gap-2 mt-4">
            <Button variant="outline" size="sm" className="flex-1 text-xs">
              <Settings className="w-3.5 h-3.5 mr-1.5" />
              Gerenciar
            </Button>
            <Button variant="outline" size="sm" className="flex-1 text-xs">
              <Eye className="w-3.5 h-3.5 mr-1.5" />
              Detalhes
            </Button>
            <Button variant="outline" size="sm" className="flex-1 text-xs">
              <Wrench className="w-3.5 h-3.5 mr-1.5" />
              Operações
            </Button>
          </div>
          <div className="mt-2">
            {biz.isForSale ? (
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => onCancelSale(biz)}>
                <XCircle className="w-3.5 h-3.5 mr-1.5" />
                Cancelar Venda
              </Button>
            ) : (
              <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => onSell(biz)}>
                <Tag className="w-3.5 h-3.5 mr-1.5" />
                Colocar à Venda
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

const SalePriceDialog = ({ open, onOpenChange, title, description, onConfirm, loading }) => {
  const [price, setPrice] = useState('');

  useEffect(() => {
    if (open) {
      setPrice('');
    }
  }, [open]);

  const handleConfirm = () => {
    const numericPrice = parseCurrencyInput(price);
    onConfirm(numericPrice);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-effect">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </DialogHeader>
        <div className="space-y-2 py-4">
          <Label htmlFor="sale-price">Preço de venda</Label>
          <Input
            id="sale-price"
            value={price}
            onChange={(event) => setPrice(formatCurrencyInput(event.target.value))}
            placeholder="R$ 0,00"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={loading || parseCurrencyInput(price) <= 0}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Tag className="mr-2 h-4 w-4" />}
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const BusinessForSaleCard = ({ listing, index, onBuy, buyingId }) => {
  const isStateListing = listing.listingType === 'state';
  const typeData = BUSINESS_TYPES.find((type) => type.id === listing.type) || BUSINESS_TYPES[0];
  const Icon = isStateListing ? Landmark : typeData.icon;
  const isBuying = buyingId === `${listing.listingType}:${listing.id}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="glass-effect h-full border-white/10 hover:border-primary/40 transition-colors">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 ${isStateListing ? 'text-amber-400' : typeData.color}`}>
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <CardTitle>{listing.name}</CardTitle>
                <CardDescription>{isStateListing ? 'Privatização estatal' : 'Venda privada'}</CardDescription>
              </div>
            </div>
            <Badge className={isStateListing ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'}>
              {isStateListing ? 'Governo' : 'Privado'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground line-clamp-3">{listing.description || 'Sem descrição.'}</p>
          <div className="rounded-lg bg-white/5 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Preço de venda</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{formatCurrency(listing.price || 0)}</p>
          </div>
          <Button className="w-full" onClick={() => onBuy(listing)} disabled={isBuying}>
            {isBuying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShoppingCart className="mr-2 h-4 w-4" />}
            Comprar Empresa
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
};


// ═══════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════
const EntrepreneurPortal = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('catalog');
  const [myBusinesses, setMyBusinesses] = useState([]);
  const [saleListings, setSaleListings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [salesLoading, setSalesLoading] = useState(true);
  const [businessTariffs, setBusinessTariffs] = useState({});
  const [businessToSell, setBusinessToSell] = useState(null);
  const [savingSale, setSavingSale] = useState(false);
  const [buyingListingId, setBuyingListingId] = useState(null);

  // Fetch base tariffs for registration fees
  useEffect(() => {
    const fetchTariffs = async () => {
      const { data } = await supabase.from('system_settings').select('value').eq('key', 'base_tariffs').single();
      if (data?.value) setBusinessTariffs(data.value);
    };
    fetchTariffs();
  }, []);

  // Merge tariffs into business types
  const TARIFF_KEY_MAP = {
    banco: 'biz_banco', construtora: 'biz_construtora', fabrica: 'biz_fabrica',
    loja: 'biz_loja', transportadora: 'biz_transportadora', consultoria: 'biz_consultoria',
    seguranca: 'biz_seguranca', distribuidora: 'biz_distribuidora',
  };
  const businessTypes = BUSINESS_TYPES.map(bt => {
    const tariffKey = TARIFF_KEY_MAP[bt.id];
    if (tariffKey && businessTariffs[tariffKey] != null) {
      return { ...bt, registrationFee: businessTariffs[tariffKey] };
    }
    return bt;
  });

  const fetchMyBusinesses = useCallback(async () => {
    if (!user?.id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setMyBusinesses(
        (data || []).map((b) => ({
          id: b.id,
          name: b.name,
          type: b.business_type_id,
          status: b.status,
          employees: b.employees,
          revenue: parseFloat(b.monthly_revenue) || 0,
          createdAt: b.created_at?.split('T')[0],
          isForSale: Boolean(b.is_for_sale),
          salePrice: Number(b.sale_price || 0),
        }))
      );
    } catch (err) {
      console.error('Erro ao buscar empresas:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  // Fetch user's businesses from Supabase
  useEffect(() => {
    fetchMyBusinesses();
  }, [fetchMyBusinesses]);

  const fetchSaleListings = useCallback(async () => {
    setSalesLoading(true);
    try {
      const [privateListingsResponse, stateListingsResponse] = await Promise.all([
        supabase
          .from('businesses')
          .select('id, owner_id, business_type_id, name, description, sale_price, sale_listed_at, owner:profiles(full_name)')
          .eq('is_for_sale', true)
          .order('sale_listed_at', { ascending: false }),
        supabase
          .from('state_enterprises')
          .select('id, name, sector, description, privatization_price, updated_at')
          .eq('privatization_status', 'for_sale')
          .or('is_privatized.eq.false,is_privatized.is.null')
          .order('updated_at', { ascending: false }),
      ]);

      if (privateListingsResponse.error) {
        console.error('Erro ao buscar empresas privadas à venda:', privateListingsResponse.error);
      }

      if (stateListingsResponse.error) {
        console.error('Erro ao buscar estatais em privatização:', stateListingsResponse.error);
      }

      const privateListings = privateListingsResponse.error ? [] : (privateListingsResponse.data || [])
        .filter((business) => business.owner_id !== user?.id)
        .map((business) => ({
          id: business.id,
          listingType: 'private',
          name: business.name,
          description: business.description,
          type: business.business_type_id,
          price: Number(business.sale_price || 0),
          sellerName: business.owner?.full_name || 'Empreendedor',
        }));
      const stateListings = stateListingsResponse.error ? [] : (stateListingsResponse.data || []).map((enterprise) => ({
        id: enterprise.id,
        listingType: 'state',
        name: enterprise.name,
        description: enterprise.description,
        type: STATE_SECTOR_BUSINESS_TYPE[enterprise.sector] || 'consultoria',
        sector: enterprise.sector,
        price: Number(enterprise.privatization_price || 0),
        sellerName: 'Governo Federal',
      }));

      setSaleListings([...stateListings, ...privateListings]);
    } catch (err) {
      console.error('Erro ao buscar empresas à venda:', err);
      setSaleListings([]);
    } finally {
      setSalesLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchSaleListings();
  }, [fetchSaleListings]);

  useEffect(() => {
    const channel = supabase
      .channel('entrepreneur-sale-listings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'state_enterprises' }, fetchSaleListings)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'businesses' }, fetchSaleListings)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchSaleListings]);

  const filteredTypes = useMemo(() => {
    if (!searchQuery.trim()) return businessTypes;
    const q = searchQuery.toLowerCase();
    return businessTypes.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const totalRevenue = myBusinesses.reduce((s, b) => s + b.revenue, 0);
  const totalEmployees = myBusinesses.reduce((s, b) => s + b.employees, 0);
  const totalMonthlyCosts = myBusinesses.reduce((s, b) => {
    const type = businessTypes.find((t) => t.id === b.type);
    return s + (type ? Object.values(type.monthlyCosts).reduce((a, v) => a + v, 0) : 0);
  }, 0);

  const handleRegister = async (business) => {
    if (!user?.id) {
      toast({ title: 'Erro', description: 'Você precisa estar logado para registrar uma empresa.', variant: 'destructive' });
      return;
    }

    setIsRegistering(true);

    try {
      const companyName = `${business.name} do ${user?.full_name?.split(' ')[0] || 'Cidadão'}`;
      const response = await fetchWithSessionAuth('/api/businesses/register', {
        method: 'POST',
        body: JSON.stringify({
          businessTypeId: business.id,
          companyName,
          description: business.description,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || payload?.message || 'Não foi possível registrar a empresa.');
      }

      const newBiz = payload.business;

      setMyBusinesses((prev) => [
        {
          id: newBiz.id,
          name: newBiz.name,
          type: newBiz.business_type_id,
          status: newBiz.status,
          employees: newBiz.employees,
          revenue: 0,
          createdAt: newBiz.created_at?.split('T')[0],
        },
        ...prev,
      ]);

      setSelectedBusiness(null);
      setActiveTab('my-businesses');

      toast({
        title: '🎉 Empresa registrada com sucesso!',
        description: payload?.message || `${companyName} foi criada e está pendente de aprovação.`,
      });
    } catch (err) {
      console.error('Erro ao registrar empresa:', err);
      toast({
        title: 'Erro ao registrar empresa',
        description: err.message || 'Ocorreu um erro inesperado. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleConfirmBusinessSale = async (price) => {
    if (!businessToSell?.id || price <= 0) {
      toast({ title: 'Preço inválido', description: 'Informe um preço maior que zero.', variant: 'destructive' });
      return;
    }

    setSavingSale(true);
    const { error } = await supabase
      .from('businesses')
      .update({
        is_for_sale: true,
        sale_price: price,
        sale_listed_at: new Date().toISOString(),
      })
      .eq('id', businessToSell.id)
      .eq('owner_id', user.id);

    if (error) {
      toast({ title: 'Erro ao colocar empresa à venda', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Empresa colocada à venda', description: `${businessToSell.name} agora aparece na aba Empresas à Venda.` });
      setMyBusinesses((current) =>
        current.map((business) =>
          business.id === businessToSell.id
            ? { ...business, isForSale: true, salePrice: price }
            : business
        )
      );
      setBusinessToSell(null);
      fetchSaleListings();
    }
    setSavingSale(false);
  };

  const handleCancelBusinessSale = async (business) => {
    const { error } = await supabase
      .from('businesses')
      .update({
        is_for_sale: false,
        sale_price: null,
        sale_listed_at: null,
      })
      .eq('id', business.id)
      .eq('owner_id', user.id);

    if (error) {
      toast({ title: 'Erro ao cancelar venda', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Venda cancelada' });
      setMyBusinesses((current) =>
        current.map((item) =>
          item.id === business.id ? { ...item, isForSale: false, salePrice: 0 } : item
        )
      );
      fetchSaleListings();
    }
  };

  const handleBuyListing = async (listing) => {
    if (!user?.id) {
      toast({ title: 'Login necessário', description: 'Entre na sua conta para comprar empresas.', variant: 'destructive' });
      return;
    }

    const listingKey = `${listing.listingType}:${listing.id}`;
    setBuyingListingId(listingKey);

    const { data, error } = await supabase.rpc('buy_business_listing', {
      p_listing_type: listing.listingType,
      p_listing_id: listing.id,
    });

    if (error || data?.success === false) {
      toast({
        title: 'Erro na compra',
        description: data?.message || error?.message || 'Não foi possível comprar a empresa.',
        variant: 'destructive',
      });
    } else {
      toast({ title: 'Empresa comprada!', description: data?.message || `${listing.name} agora é sua empresa.` });
      fetchSaleListings();
      fetchMyBusinesses();
      setActiveTab('my-businesses');
    }

    setBuyingListingId(null);
  };

  const tabs = [
    { id: 'catalog', label: 'Catálogo de Empresas', icon: ShoppingBag },
    { id: 'my-businesses', label: `Minhas Empresas (${myBusinesses.length})`, icon: Building2 },
    { id: 'for-sale', label: `Empresas à Venda (${saleListings.length})`, icon: Tag },
  ];

  return (
    <>
      <Helmet>
        <title>Portal do Empreendedor - GOV.RP</title>
        <meta
          name="description"
          content="Crie, gerencie e expanda seus negócios na nação digital do GOV.RP. Abra bancos, fábricas, lojas e muito mais."
        />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          icon={Briefcase}
          title="Portal do"
          gradientText="Empreendedor"
          description="O centro operacional da economia privada do GOV.RP. Crie empresas, gerencie operações, controle custos e faça seus negócios prosperarem."
          iconColor="text-cyan-400"
          centered={true}
        />

        {/* Hero Banner */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10 rounded-3xl border border-cyan-500/15 bg-gradient-to-br from-cyan-500/10 via-slate-950/80 to-blue-950/60 p-8"
        >
          <div className="grid gap-8 lg:grid-cols-[1.4fr_0.9fr] lg:items-center">
            <div className="space-y-4">
              <span className="inline-flex rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
                Economia Privada
              </span>
              <h2 className="text-3xl font-bold text-foreground sm:text-4xl">
                Construa seu império empresarial
              </h2>
              <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">
                Desde bancos e fábricas até lojas e consultorias — crie e administre qualquer tipo de empresa.
                Cada negócio tem custos reais: funcionários, matérias-primas, manutenção e mais.
                Faça sua empresa crescer e domine a economia do GOV.RP.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  onClick={() => setActiveTab('catalog')}
                  className="w-full sm:w-auto bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Criar Empresa
                </Button>
                <Link to="/services/business">
                  <Button variant="outline" className="w-full sm:w-auto">
                    <Store className="w-4 h-4 mr-2" />
                    Negócios Livres
                  </Button>
                </Link>
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-black/20 p-6">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                O que você pode criar
              </p>
              <ul className="mt-4 space-y-3 text-sm text-foreground">
                <li className="flex items-center gap-2"><Landmark className="w-4 h-4 text-emerald-400" /> Bancos e instituições financeiras</li>
                <li className="flex items-center gap-2"><HardHat className="w-4 h-4 text-amber-400" /> Construtoras e imobiliárias</li>
                <li className="flex items-center gap-2"><Factory className="w-4 h-4 text-blue-400" /> Fábricas e indústrias</li>
                <li className="flex items-center gap-2"><Store className="w-4 h-4 text-violet-400" /> Lojas e comércios</li>
                <li className="flex items-center gap-2"><Truck className="w-4 h-4 text-orange-400" /> Transportadoras e logística</li>
                <li className="flex items-center gap-2"><Shield className="w-4 h-4 text-red-400" /> Empresas de segurança</li>
              </ul>
            </div>
          </div>
        </motion.section>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard icon={Building2} label="Minhas Empresas" value={myBusinesses.length} color="text-cyan-400" delay={0} />
          <StatCard icon={Users} label="Funcionários Totais" value={totalEmployees} color="text-blue-400" delay={0.05} />
          <StatCard icon={TrendingUp} label="Receita Mensal" value={formatCurrency(totalRevenue)} color="text-emerald-400" delay={0.1} />
          <StatCard icon={DollarSign} label="Custos Mensais" value={formatCurrency(totalMonthlyCosts)} color="text-amber-400" delay={0.15} />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-white/10 pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-t-xl text-sm font-semibold transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-white/10 text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* TAB: Catalog */}
        <AnimatePresence mode="wait">
          {activeTab === 'catalog' && (
            <motion.div
              key="catalog"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {/* Search */}
              <div className="relative mb-8">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  placeholder="Pesquisar tipo de empresa..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-12 h-12 bg-white/5 border-white/10 text-lg"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {filteredTypes.length === 0 ? (
                <div className="text-center py-16">
                  <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
                  <p className="text-lg text-muted-foreground">Nenhum tipo de empresa encontrado para "{searchQuery}"</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredTypes.map((business, index) => (
                    <BusinessTypeCard
                      key={business.id}
                      business={business}
                      index={index}
                      onSelect={setSelectedBusiness}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* TAB: My Businesses */}
          {activeTab === 'my-businesses' && (
            <motion.div
              key="my-businesses"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {myBusinesses.length === 0 ? (
                <div className="text-center py-20">
                  <Building2 className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
                  <h3 className="text-xl font-bold text-foreground mb-2">Nenhuma empresa registrada</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                    Explore o catálogo de empresas e comece seu império empresarial no GOV.RP.
                  </p>
                  <Button onClick={() => setActiveTab('catalog')} className="bg-gradient-to-r from-cyan-600 to-blue-600">
                    <Plus className="w-4 h-4 mr-2" />
                    Explorar Catálogo
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {myBusinesses.map((biz, index) => (
                    <MyBusinessCard
                      key={biz.id}
                      biz={biz}
                      index={index}
                      onSell={setBusinessToSell}
                      onCancelSale={handleCancelBusinessSale}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* TAB: Businesses for Sale */}
          {activeTab === 'for-sale' && (
            <motion.div
              key="for-sale"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              {salesLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-10 w-10 animate-spin text-primary" />
                </div>
              ) : saleListings.length === 0 ? (
                <div className="text-center py-20">
                  <Tag className="w-16 h-16 text-muted-foreground mx-auto mb-4 opacity-30" />
                  <h3 className="text-xl font-bold text-foreground mb-2">Nenhuma empresa à venda</h3>
                  <p className="text-muted-foreground max-w-md mx-auto">
                    Empresas privadas anunciadas por donos e estatais em privatização aparecerão aqui.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
                  {saleListings.map((listing, index) => (
                    <BusinessForSaleCard
                      key={`${listing.listingType}-${listing.id}`}
                      listing={listing}
                      index={index}
                      onBuy={handleBuyListing}
                      buyingId={buyingListingId}
                    />
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Links */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-16"
        >
          <h2 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-3">
            <ArrowRight className="w-5 h-5 text-primary" />
            Acesso Rápido
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { title: 'Negócios Livres', description: 'Marketplace para comprar e vender produtos.', icon: ShoppingBag, path: '/services/business', accent: 'text-blue-400' },
              { title: 'Banco Nacional', description: 'Gerencie finanças e solicite empréstimos.', icon: Landmark, path: '/services/bank', accent: 'text-emerald-400' },
              { title: 'DIC - Documentos', description: 'Emita CNPJ e documentação empresarial.', icon: Package, path: '/services/dic', accent: 'text-purple-400' },
            ].map((action, index) => (
              <motion.div
                key={action.title}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + index * 0.06 }}
              >
                <Link to={action.path}>
                  <Card className="glass-effect h-full border-white/10 hover:border-primary/40 transition-all duration-300 group">
                    <CardContent className="p-5 flex items-center gap-4">
                      <div className={`flex-shrink-0 flex items-center justify-center w-12 h-12 rounded-xl bg-white/5 ${action.accent}`}>
                        <action.icon className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{action.title}</h3>
                        <p className="text-sm text-muted-foreground truncate">{action.description}</p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all flex-shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        </motion.section>
      </div>

      {/* Detail Modal */}
      <AnimatePresence>
        {selectedBusiness && (
          <BusinessDetailModal
            business={selectedBusiness}
            onClose={() => setSelectedBusiness(null)}
            onRegister={handleRegister}
            isRegistering={isRegistering}
          />
        )}
      </AnimatePresence>

      <SalePriceDialog
        open={Boolean(businessToSell)}
        onOpenChange={(open) => !open && setBusinessToSell(null)}
        title="Colocar empresa à venda"
        description={businessToSell ? `Defina o preço de venda para ${businessToSell.name}.` : ''}
        onConfirm={handleConfirmBusinessSale}
        loading={savingSale}
      />
    </>
  );
};

export default EntrepreneurPortal;
