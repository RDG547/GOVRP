BEGIN;

-- The presidential dashboard already lists every row in state_enterprises.
-- The utilities below have integrated services and management sectors, but
-- were never provisioned as permanent state-enterprise records. Without them,
-- the presidency sees only the bank, marketplace, national market and housing.
--
-- Keep existing enterprises (including privatized and custom businesses)
-- unchanged: never overwrite names, ownership, fees or operating settings.
-- is_system=true makes these essential institutions survive universe resets.

WITH essential(name, sector, description, service_key) AS (
  VALUES
    ('Internet Nacional', 'Internet',
     'Serviço público de acesso à internet e planos de conectividade do GOVRP.', 'national_internet'),
    ('Telefonia Nacional', 'Telefonia',
     'Serviço público de telefonia e planos móveis para os cidadãos.', 'national_telephony'),
    ('Companhia Nacional de Energia', 'Energia Elétrica',
     'Fornecimento de energia elétrica e gestão dos serviços essenciais.', 'national_electricity'),
    ('Companhia Nacional de Água', 'Água',
     'Distribuição de água e gestão do abastecimento dos cidadãos.', 'national_water'),
    ('Companhia Nacional de Gás', 'Gás',
     'Distribuição de gás e gestão do serviço público de abastecimento.', 'national_gas')
)
INSERT INTO public.state_enterprises
  (name, sector, description, service_key, is_system, is_active)
SELECT e.name, e.sector, e.description, e.service_key, TRUE, TRUE
FROM essential e
WHERE NOT EXISTS (
  SELECT 1 FROM public.state_enterprises existing
  WHERE existing.sector = e.sector OR existing.service_key = e.service_key
)
ON CONFLICT (service_key) DO NOTHING;

COMMIT;
