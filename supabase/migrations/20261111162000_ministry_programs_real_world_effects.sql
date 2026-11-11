BEGIN;

-- Ministry-specific actions use the existing audited public-project / treasury /
-- expenditure / economic-engine workflow, not fake "impact" counters.
CREATE TABLE IF NOT EXISTS public.ministry_program_definitions(
 program_key text PRIMARY KEY,
 ministry_id uuid NOT NULL REFERENCES public.government_ministries(id) ON DELETE RESTRICT,
 title text NOT NULL,
 description text NOT NULL,
 project_type text NOT NULL,
 impact_domain text NOT NULL,
 productivity_impact numeric NOT NULL DEFAULT 0,
 employment_impact numeric NOT NULL DEFAULT 0,
 inflation_impact numeric NOT NULL DEFAULT 0,
 popularity_on_completion numeric NOT NULL DEFAULT 0.2,
 is_active boolean NOT NULL DEFAULT true
);
ALTER TABLE public.ministry_program_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ministry_program_definitions FROM PUBLIC,anon,authenticated;
CREATE POLICY ministry_program_catalog_read ON public.ministry_program_definitions
 FOR SELECT TO authenticated USING(is_active);
GRANT SELECT ON public.ministry_program_definitions TO authenticated;

INSERT INTO public.ministry_program_definitions(
 program_key,ministry_id,title,description,project_type,impact_domain,
 productivity_impact,employment_impact,inflation_impact,popularity_on_completion
)
SELECT x.key,m.id,x.title,x.description,x.project_type,x.domain,x.productivity,x.employment,x.inflation,x.popularity
FROM (VALUES
 ('culture_festivals','Ministério da Cultura','Circuito cultural','Fomento a eventos, artistas e participação cultural.','culture','culture',0.1,0.25,0.02,0.28),
 ('culture_heritage','Ministério da Cultura','Preservação do patrimônio','Recuperação de acervos e conservação cultural.','culture','culture',0.2,0.15,0.01,0.23),
 ('defense_training','Ministério da Defesa','Capacitação militar','Treinamento, prontidão e qualificação dos efetivos.','defense','security',0.15,0.1,0.01,0.2),
 ('defense_logistics','Ministério da Defesa','Logística e equipamentos','Melhoria do abastecimento e manutenção das Forças Armadas.','defense','security',0.3,0.2,0.02,0.2),
 ('economy_development','Ministério da Economia','Programa de produtividade','Estímulo à produtividade e ao emprego nos setores produtivos.','economic_development','economy',0.35,0.3,0.01,0.25),
 ('economy_compliance','Ministério da Economia','Modernização fiscal','Aprimoramento da gestão fiscal e da eficiência administrativa.','economic_development','economy',0.2,0.15,-0.01,0.23),
 ('education_schools','Ministério da Educação','Ampliação da rede escolar','Melhoria da capacidade e da qualidade do ensino.','education','education',0.3,0.2,0.01,0.3),
 ('education_training','Ministério da Educação','Formação profissional','Ações de qualificação profissional e formação continuada.','education','education',0.25,0.25,0.01,0.23),
 ('infrastructure_roads','Ministério da Infraestrutura','Melhoria de transportes','Obras e manutenção de corredores logísticos.','infrastructure','infrastructure',0.35,0.25,0.02,0.27),
 ('infrastructure_energy','Ministério da Infraestrutura','Expansão da infraestrutura energética','Apoio à infraestrutura de geração e distribuição.','infrastructure','infrastructure',0.32,0.2,0.02,0.25),
 ('justice_access','Ministério da Justiça','Acesso à justiça','Serviços jurídicos, atendimento e orientação ao cidadão.','legal_services','justice',0.15,0.2,0.01,0.27),
 ('justice_prevention','Ministério da Justiça','Prevenção e ressocialização','Programas de prevenção e reintegração.','legal_services','justice',0.18,0.18,0.01,0.25),
 ('health_prevention','Ministério da Saúde','Prevenção e vacinação','Campanhas de saúde pública e atenção preventiva.','healthcare','health',0.18,0.25,0.01,0.32),
 ('health_units','Ministério da Saúde','Ampliação de serviços de saúde','Equipamentos, unidades e capacidade de atendimento.','healthcare','health',0.3,0.3,0.02,0.35),
 ('technology_connectivity','Ministério da Tecnologia','Inclusão digital','Acesso, conectividade e transformação digital.','technology','technology',0.35,0.25,0.01,0.28),
 ('technology_cybersecurity','Ministério da Tecnologia','Segurança digital','Proteção da infraestrutura tecnológica pública.','technology','technology',0.28,0.14,0.01,0.24),
 ('research_labs','Ministério de Pesquisa','Laboratórios e pesquisa','Investimento em laboratórios e produção científica.','research','research',0.33,0.2,0.01,0.28),
 ('research_innovation','Ministério de Pesquisa','Inovação aplicada','Pesquisa aplicada e transferência tecnológica.','research','research',0.38,0.2,0.01,0.28),
 ('foreign_trade','Ministério de Relações Exteriores','Missões comerciais','Cooperação e oportunidades comerciais internacionais.','foreign_policy','foreign_relations',0.3,0.2,0.01,0.23),
 ('foreign_cooperation','Ministério de Relações Exteriores','Cooperação internacional','Projetos de diplomacia e parcerias internacionais.','foreign_policy','foreign_relations',0.15,0.15,0.01,0.25),
 ('environment_reforestation','Ministério do Meio Ambiente','Recuperação ambiental','Reflorestamento, biodiversidade e recuperação de áreas.','environment','environment',0.2,0.2,0.01,0.32),
 ('environment_sanitation','Ministério do Meio Ambiente','Saneamento e sustentabilidade','Saneamento, educação ambiental e preservação.','environment','environment',0.25,0.2,0.01,0.29)
) AS x(key,ministry_name,title,description,project_type,domain,productivity,employment,inflation,popularity)
JOIN public.government_ministries m ON m.name=x.ministry_name
ON CONFLICT(program_key) DO UPDATE
SET title=excluded.title,description=excluded.description,project_type=excluded.project_type,
 impact_domain=excluded.impact_domain,productivity_impact=excluded.productivity_impact,
 employment_impact=excluded.employment_impact,inflation_impact=excluded.inflation_impact,
 popularity_on_completion=excluded.popularity_on_completion;

CREATE OR REPLACE FUNCTION public.propose_ministry_program(
 p_program_key text,p_name text,p_description text,p_budget numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE option_row record; project_id uuid; g public.government_terms%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.' USING errcode='42501'; END IF;
 SELECT d.*,m.name AS ministry_name INTO option_row
 FROM public.ministry_program_definitions d JOIN public.government_ministries m ON m.id=d.ministry_id
 WHERE d.program_key=p_program_key AND d.is_active AND m.is_active;
 IF option_row.program_key IS NULL THEN RAISE EXCEPTION 'Programa indisponível.'; END IF;
 IF NOT public.current_minister_has_portfolio(option_row.ministry_name) THEN
   RAISE EXCEPTION 'Seu ministério não tem competência sobre esta pasta.' USING errcode='42501';
 END IF;
 IF length(btrim(coalesce(p_name,'')))<8 OR length(btrim(coalesce(p_name,'')))>180
   OR length(btrim(coalesce(p_description,'')))<30 THEN
   RAISE EXCEPTION 'Informe um nome e uma justificativa com ao menos 30 caracteres.'; END IF;
 IF p_budget IS NULL OR p_budget<100 OR p_budget>500000000 OR p_budget<>trunc(p_budget) THEN
   RAISE EXCEPTION 'Orçamento deve ser um valor inteiro entre R$ 100 e R$ 500 milhões.'; END IF;
 SELECT * INTO g FROM public.government_terms
 WHERE ended_at IS NULL AND term_ends_at>clock_timestamp() AND head_id IS NOT NULL
 ORDER BY term_starts_at DESC LIMIT 1;
 IF g.id IS NULL THEN RAISE EXCEPTION 'Não existe Governo em exercício.'; END IF;
 IF (SELECT count(*) FROM public.government_projects p
    WHERE p.ministry=option_row.ministry_name AND p.metadata->>'ministry_program'='true'
    AND p.status IN ('proposed','funded','in_progress'))>=12 THEN
   RAISE EXCEPTION 'Conclua ou analise os programas existentes antes de abrir mais iniciativas.';
 END IF;
 INSERT INTO public.government_projects(
   name,description,ministry,project_type,approved_budget,expected_completion_at,
   productivity_impact,employment_impact,inflation_impact,
   immediate_multiplier,future_multiplier,created_by,metadata
 )
 VALUES(
   btrim(p_name),btrim(p_description),option_row.ministry_name,option_row.project_type,
   p_budget,clock_timestamp()+interval '14 days',
   option_row.productivity_impact,option_row.employment_impact,option_row.inflation_impact,
   1.15,1.45,auth.uid(),
   jsonb_build_object('ministry_program',true,'program_key',option_row.program_key,
    'ministry_id',option_row.ministry_id,'government_id',g.id,
    'impact_domain',option_row.impact_domain,'popularity_on_completion',option_row.popularity_on_completion)
 ) RETURNING id INTO project_id;
 PERFORM economy_private.audit('ministry_program_proposed','government_project',project_id::text,NULL,
  to_jsonb((SELECT p FROM public.government_projects p WHERE p.id=project_id)),
  'Proposta ministerial sujeita à análise presidencial e reserva de recursos.',auth.uid());
 INSERT INTO public.notifications(user_id,sender_id,type,content,link,metadata)
 SELECT g.head_id,auth.uid(),'ministry_program_proposed',
  'Novo programa do '||option_row.ministry_name||' aguarda aprovação: '||btrim(p_name)||'.',
  '/dashboard/president',jsonb_build_object('project_id',project_id,'ministry',option_row.ministry_name);
 RETURN jsonb_build_object('success',true,'project_id',project_id,'status','proposed');
END $$;
REVOKE ALL ON FUNCTION public.propose_ministry_program(text,text,text,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.propose_ministry_program(text,text,text,numeric) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.review_ministry_program(
 p_project_id uuid,p_approve boolean,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE project public.government_projects%rowtype; approved jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT (
   public.get_user_role(auth.uid())='Presidente' OR public.has_full_admin_access()
 ) THEN RAISE EXCEPTION 'Somente a Presidência pode aprovar despesas ministeriais.' USING errcode='42501'; END IF;
 IF p_approve IS NULL OR length(trim(coalesce(p_reason,'')))<10 THEN
   RAISE EXCEPTION 'Fundamente a decisão com pelo menos 10 caracteres.'; END IF;
 SELECT * INTO project FROM public.government_projects
 WHERE id=p_project_id AND metadata->>'ministry_program'='true' FOR UPDATE;
 IF project.id IS NULL OR project.status<>'proposed' THEN
   RAISE EXCEPTION 'Programa não está aguardando decisão.'; END IF;
 IF p_approve THEN
   approved:=public.approve_government_project(p_project_id,p_reason);
 ELSE
   UPDATE public.government_projects SET status='cancelled',
      metadata=metadata||jsonb_build_object('presidential_review',p_reason,
       'reviewed_by',auth.uid(),'reviewed_at',clock_timestamp()),updated_at=clock_timestamp()
   WHERE id=p_project_id;
 END IF;
 INSERT INTO public.notifications(user_id,sender_id,type,content,link,metadata)
 VALUES(project.created_by,auth.uid(),'ministry_program_reviewed',
  'Programa '||project.name||case when p_approve then ' aprovado e financiado.' else ' rejeitado: '||p_reason end,
  '/dashboard/ministry',jsonb_build_object('project_id',p_project_id,'approved',p_approve));
 RETURN jsonb_build_object('success',true,'approved',p_approve,'project_id',p_project_id);
END $$;
REVOKE ALL ON FUNCTION public.review_ministry_program(uuid,boolean,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.review_ministry_program(uuid,boolean,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.execute_ministry_program(
 p_project_id uuid,p_installment numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE project public.government_projects%rowtype;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Autenticação obrigatória.' USING errcode='42501'; END IF;
 SELECT * INTO project FROM public.government_projects
 WHERE id=p_project_id AND metadata->>'ministry_program'='true';
 IF project.id IS NULL THEN RAISE EXCEPTION 'Programa ministerial não encontrado.'; END IF;
 IF NOT public.current_minister_has_portfolio(project.ministry) THEN
  RAISE EXCEPTION 'A execução pertence ao ministro responsável por esta pasta.' USING errcode='42501';
 END IF;
 IF project.status NOT IN ('funded','in_progress','delayed') THEN
   RAISE EXCEPTION 'Aguarde a aprovação e o financiamento presidencial.'; END IF;
 IF p_installment IS NOT NULL AND p_installment<=0 THEN RAISE EXCEPTION 'Parcela inválida.'; END IF;
 RETURN economy_private.process_project(p_project_id,p_installment,auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.execute_ministry_program(uuid,numeric) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.execute_ministry_program(uuid,numeric) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.on_ministry_program_completion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE d public.ministry_program_definitions%rowtype;
        minister_id uuid; government_id uuid; delta numeric;
BEGIN
 IF NEW.metadata->>'ministry_program'<>'true' OR NEW.status<>'completed'
     OR OLD.status='completed' THEN RETURN NEW; END IF;
 SELECT * INTO d FROM public.ministry_program_definitions WHERE program_key=NEW.metadata->>'program_key';
 IF d.program_key IS NULL THEN RETURN NEW; END IF;
 delta:=least(0.75,greatest(0,d.popularity_on_completion));
 UPDATE public.government_ministries SET
    public_impact=least(100,greatest(-100,public_impact+delta)),
    efficiency_score=least(100,greatest(0,efficiency_score+0.25)),
    updated_at=clock_timestamp()
 WHERE id=d.ministry_id;
 PERFORM public.apply_government_impact(d.impact_domain,'ministry_program_completed',
    'Programa concluído: '||NEW.name,delta,0,
    'government_projects',NEW.id::text,
    jsonb_build_object('ministry_id',d.ministry_id,'program_key',d.program_key,
      'approved_budget',NEW.approved_budget,'spent_amount',NEW.spent_amount));
 SELECT user_id INTO minister_id FROM public.ministers m
 WHERE m.status='active' AND m.ministry_id=coalesce((
    SELECT x.primary_ministry_id FROM public.government_ministry_merges x
    WHERE x.government_id=(NEW.metadata->>'government_id')::uuid AND x.merged_ministry_id=d.ministry_id
 ),d.ministry_id) LIMIT 1;
 IF minister_id IS NOT NULL THEN
   INSERT INTO public.minister_history(minister_profile_id,ministry_id,event_type,summary,
      reputation_delta,performance_delta,actor_id,metadata)
   VALUES(minister_id,d.ministry_id,'program_completed','Programa executado: '||NEW.name,
      0.5,1,auth.uid(),jsonb_build_object('project_id',NEW.id,'budget',NEW.approved_budget));
   UPDATE public.ministers SET reputation_score=least(100,reputation_score+0.5),
       performance_score=least(100,performance_score+1)
     WHERE user_id=minister_id AND status='active';
 END IF;
 UPDATE public.country_rp_states
   SET last_event_type='ministry_program_completed',
       last_event_summary='Programa de '||d.impact_domain||' concluído: '||NEW.name,
       updated_at=clock_timestamp()
   WHERE country_code='BR' AND is_playable;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS govrp_ministry_program_completed ON public.government_projects;
CREATE TRIGGER govrp_ministry_program_completed AFTER UPDATE OF status ON public.government_projects
 FOR EACH ROW EXECUTE FUNCTION private.on_ministry_program_completion();

-- Keep the legacy generic operations from permitting ministers to impersonate
-- departments they do not hold. Admin/President can still manage all portfolios.
DO $patch$
DECLARE def text; original text; replacement text;
BEGIN
 SELECT pg_get_functiondef('public.propose_government_project(text,text,text,uuid,text,numeric,timestamptz,numeric,numeric,numeric)'::regprocedure) INTO def;
 original:='  if p_approved_budget<=0';
 replacement:='  if not public.economic_has_role(array[''Admin'',''Presidente'']) and not public.current_minister_has_portfolio(p_ministry) then raise exception ''Este Ministério não pertence à sua pasta.'' using errcode=''42501'';end if;'||chr(10)||'  if p_approved_budget<=0';
 IF strpos(def,original)=0 THEN RAISE EXCEPTION 'Proposta genérica mudou de estrutura.'; END IF;
 EXECUTE replace(def,original,replacement);

 SELECT pg_get_functiondef('public.process_government_project(uuid,numeric)'::regprocedure) INTO def;
 original:='  return economy_private.process_project(p_project_id,p_installment,auth.uid());';
 replacement:='  if not public.economic_has_role(array[''Admin'',''Presidente'']) and not exists (select 1 from public.government_projects project where project.id=p_project_id and public.current_minister_has_portfolio(project.ministry)) then raise exception ''A execução pertence ao ministério responsável.'' using errcode=''42501'';end if;'||chr(10)||original;
 IF strpos(def,original)=0 THEN RAISE EXCEPTION 'Execução genérica mudou de estrutura.'; END IF;
 EXECUTE replace(def,original,replacement);
END $patch$;

COMMIT;