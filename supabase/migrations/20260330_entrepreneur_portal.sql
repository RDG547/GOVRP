-- ═══════════════════════════════════════════════════════════════
-- PORTAL DO EMPREENDEDOR — Tabelas para o sistema empresarial
-- Migração: 2026-03-30
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- 1. Tipos de empresa (catálogo estático)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_types (
  id TEXT PRIMARY KEY,                           -- ex: 'banco', 'construtora', 'fabrica'
  name TEXT NOT NULL,                            -- Nome legível: "Banco", "Construtora"
  category TEXT NOT NULL,                        -- "Serviços Financeiros", "Construção Civil" …
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'Building2',         -- Nome do ícone Lucide
  color TEXT NOT NULL DEFAULT 'text-cyan-400',    -- Classe CSS de cor

  registration_fee NUMERIC(12,2) NOT NULL DEFAULT 0,       -- Taxa única de abertura
  min_employees INTEGER NOT NULL DEFAULT 1,                 -- Mínimo de funcionários
  profit_potential TEXT NOT NULL DEFAULT 'Médio'
    CHECK (profit_potential IN ('Baixo', 'Médio', 'Alto', 'Muito Alto')),
  risk_level TEXT NOT NULL DEFAULT 'Médio'
    CHECK (risk_level IN ('Baixo', 'Médio', 'Alto')),

  requirements JSONB NOT NULL DEFAULT '[]'::jsonb,          -- Array de strings
  monthly_costs JSONB NOT NULL DEFAULT '{}'::jsonb,          -- { "employees": 8000, "rent": 2500, … }

  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed com os 8 tipos iniciais
INSERT INTO business_types (id, name, category, description, icon, color, registration_fee, min_employees, profit_potential, risk_level, requirements, monthly_costs)
VALUES
  ('banco', 'Banco', 'Serviços Financeiros',
   'Ofereça serviços financeiros como contas, empréstimos e investimentos aos cidadãos.',
   'Landmark', 'text-emerald-400', 50000, 10, 'Alto', 'Alto',
   '["Aprovação do Banco Central", "Capital mínimo de R$ 50.000"]'::jsonb,
   '{"employees": 8000, "infrastructure": 5000, "licenses": 3000, "security": 4000}'::jsonb),

  ('construtora', 'Construtora', 'Construção Civil',
   'Construa imóveis, infraestrutura e grandes projetos de engenharia para a nação.',
   'HardHat', 'text-amber-400', 35000, 15, 'Alto', 'Médio',
   '["Licença de construção", "Engenheiro responsável"]'::jsonb,
   '{"employees": 12000, "materials": 8000, "equipment": 6000, "licenses": 2000}'::jsonb),

  ('fabrica', 'Fábrica', 'Indústria',
   'Produza bens industriais em grande escala, desde eletrônicos até alimentos processados.',
   'Factory', 'text-blue-400', 40000, 20, 'Muito Alto', 'Médio',
   '["Alvará ambiental", "Inspeção de segurança"]'::jsonb,
   '{"employees": 15000, "rawMaterials": 10000, "energy": 5000, "maintenance": 3000}'::jsonb),

  ('loja', 'Loja / Comércio', 'Comércio Varejista',
   'Abra um ponto de venda para comercializar produtos diretamente ao consumidor final.',
   'Store', 'text-violet-400', 10000, 3, 'Médio', 'Baixo',
   '["Alvará de funcionamento", "CNPJ ativo"]'::jsonb,
   '{"employees": 4000, "stock": 3000, "rent": 2500, "marketing": 1000}'::jsonb),

  ('transportadora', 'Transportadora', 'Logística',
   'Transporte cargas e mercadorias conectando produtores, fábricas e lojas do país.',
   'Truck', 'text-orange-400', 25000, 8, 'Médio', 'Médio',
   '["Licença de transporte", "Seguro obrigatório"]'::jsonb,
   '{"employees": 6000, "fuel": 8000, "vehicleMaintenance": 4000, "insurance": 2000}'::jsonb),

  ('consultoria', 'Consultoria', 'Serviços Profissionais',
   'Preste serviços especializados em gestão, tecnologia, finanças ou estratégia empresarial.',
   'Lightbulb', 'text-cyan-400', 8000, 2, 'Médio', 'Baixo',
   '["CNPJ ativo", "Profissionais certificados"]'::jsonb,
   '{"employees": 5000, "tools": 1500, "marketing": 1000, "office": 1500}'::jsonb),

  ('seguranca', 'Empresa de Segurança', 'Segurança Privada',
   'Forneça serviços de segurança patrimonial e pessoal para empresas e cidadãos.',
   'Shield', 'text-red-400', 20000, 12, 'Médio', 'Alto',
   '["Autorização da Polícia Federal", "Treinamento obrigatório"]'::jsonb,
   '{"employees": 10000, "equipment": 3000, "training": 2000, "insurance": 2500}'::jsonb),

  ('distribuidora', 'Distribuidora', 'Atacado e Distribuição',
   'Distribua produtos no atacado para lojas, fábricas e empresas de todo o país.',
   'Boxes', 'text-teal-400', 20000, 8, 'Alto', 'Médio',
   '["Licença sanitária (se alimentos)", "Galpão de armazenamento"]'::jsonb,
   '{"employees": 7000, "warehouse": 4000, "logistics": 5000, "inventory": 3000}'::jsonb)
ON CONFLICT (id) DO NOTHING;


-- ─────────────────────────────────────────
-- 2. Empresas criadas pelos cidadãos
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_type_id TEXT NOT NULL REFERENCES business_types(id),

  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'suspended', 'closed')),

  employees INTEGER NOT NULL DEFAULT 0,
  monthly_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,     -- Dados flexíveis futuros

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para consultas frequentes
CREATE INDEX IF NOT EXISTS idx_businesses_owner ON businesses(owner_id);
CREATE INDEX IF NOT EXISTS idx_businesses_type ON businesses(business_type_id);
CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status);

-- ─────────────────────────────────────────
-- 3. Histórico de transações das empresas
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  type TEXT NOT NULL CHECK (type IN ('registration', 'monthly_cost', 'revenue', 'expense', 'tax', 'other')),
  amount NUMERIC(12,2) NOT NULL,
  description TEXT NOT NULL DEFAULT '',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_transactions_business ON business_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_business_transactions_type ON business_transactions(type);

-- ─────────────────────────────────────────
-- 4. Funcionários das empresas
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS business_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  profile_id UUID REFERENCES profiles(id) ON DELETE SET NULL,   -- Pode ser NPC (NULL) ou cidadão real

  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Funcionário',
  salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_npc BOOLEAN NOT NULL DEFAULT true,

  hired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fired_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_business_employees_business ON business_employees(business_id);
CREATE INDEX IF NOT EXISTS idx_business_employees_profile ON business_employees(profile_id);

-- ─────────────────────────────────────────
-- 5. RLS (Row Level Security)
-- ─────────────────────────────────────────

-- business_types: leitura pública
ALTER TABLE business_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_types_read" ON business_types
  FOR SELECT USING (true);

-- businesses: dono vê as suas, admin vê todas
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "businesses_select_own" ON businesses
  FOR SELECT USING (
    auth.uid() = owner_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin')
  );
CREATE POLICY "businesses_insert_own" ON businesses
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "businesses_update_own" ON businesses
  FOR UPDATE USING (
    auth.uid() = owner_id
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin')
  );

-- business_transactions: visíveis apenas ao dono da empresa
ALTER TABLE business_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_transactions_select" ON business_transactions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM businesses WHERE businesses.id = business_transactions.business_id AND businesses.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin')
  );
CREATE POLICY "business_transactions_insert" ON business_transactions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM businesses WHERE businesses.id = business_transactions.business_id AND businesses.owner_id = auth.uid())
  );

-- business_employees: visíveis ao dono da empresa
ALTER TABLE business_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "business_employees_select" ON business_employees
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM businesses WHERE businesses.id = business_employees.business_id AND businesses.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'Admin')
  );
CREATE POLICY "business_employees_insert" ON business_employees
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM businesses WHERE businesses.id = business_employees.business_id AND businesses.owner_id = auth.uid())
  );
CREATE POLICY "business_employees_update" ON business_employees
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM businesses WHERE businesses.id = business_employees.business_id AND businesses.owner_id = auth.uid())
  );

-- ─────────────────────────────────────────
-- 6. Trigger de updated_at automático
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_business_types'
  ) THEN
    CREATE TRIGGER set_updated_at_business_types
      BEFORE UPDATE ON business_types
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_businesses'
  ) THEN
    CREATE TRIGGER set_updated_at_businesses
      BEFORE UPDATE ON businesses
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END;
$$;
