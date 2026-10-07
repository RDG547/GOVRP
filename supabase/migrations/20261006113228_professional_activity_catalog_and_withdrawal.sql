begin;
alter table public.professional_work_sessions
  add column activity_key text not null default 'challenge',
  add column execution_mode text not null default 'interactive' check(execution_mode in('timed','interactive','hybrid')),
  add column duration_seconds integer not null default 10 check(duration_seconds between 10 and 3600),
  add column draft_answer jsonb;
drop function public.start_professional_activity(uuid);
create or replace function private.professional_activity_catalog(p_family text)
returns table(activity_key text,title text,description text,execution_mode text,duration_seconds integer)
language sql immutable set search_path='' as $$
  with families(family,routine,description,routine_seconds,focus,focus_seconds) as(values
    ('technology','Revisar solicitações','Organizar as solicitações e prioridades da equipe de tecnologia.',45,'Validar uma entrega',60),
    ('food','Preparar a estação','Organizar utensílios e ingredientes para o próximo serviço.',40,'Conferir pedidos',60),
    ('transport','Inspecionar o veículo','Conferir as condições operacionais antes da próxima rota.',45,'Planejar o trajeto',75),
    ('quality','Preparar a inspeção','Separar as amostras e organizar os instrumentos de medição.',35,'Avaliar um lote',60),
    ('sales','Organizar atendimento','Revisar o catálogo e preparar o atendimento aos clientes.',30,'Negociar uma oferta',60),
    ('logistics','Organizar o estoque','Conferir os setores do estoque e preparar a reposição.',45,'Planejar reposição',75),
    ('health','Preparar atendimento','Organizar as fichas e os recursos para o atendimento no RP.',40,'Priorizar atendimentos',60),
    ('finance','Conferir registros','Organizar lançamentos e documentos da rotina financeira.',45,'Analisar propostas',75)
  ) select task.* from families f cross join lateral(values
    ('routine',f.routine,f.description,'timed',f.routine_seconds),
    ('challenge','Desafio da função','Resolva uma tarefa da sua área e confira a resposta antes de entregar.','interactive',10),
    ('focus',f.focus,'Execute a tarefa e confira o resultado ao final do período de trabalho.','hybrid',f.focus_seconds)
  ) task(activity_key,title,description,execution_mode,duration_seconds) where f.family=p_family;
$$;
revoke all on function private.professional_activity_catalog(text) from public,anon,authenticated;
create or replace function public.start_professional_activity(p_business_id uuid,p_activity_key text default 'challenge') returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; e public.business_employees%rowtype; role public.business_role_templates%rowtype; session public.professional_work_sessions%rowtype; family text; skill text; title text; description text; mode text:='multiple'; options jsonb:='[]'; answer jsonb:='[]'; public_challenge jsonb; option_id text; labels text[]; i integer; value integer; expected_value integer; ordered boolean:=false; ranks integer[]; rank integer; price integer; cost integer; template record;
begin
 if auth.uid() is null then raise exception 'Entre para trabalhar.' using errcode='42501';end if;
 perform id from public.profiles where id=auth.uid() for update;
 select * into b from public.businesses where id=p_business_id and status='active';
 if b.id is null then raise exception 'Esta empresa não está ativa.';end if;
 select * into e from public.business_employees where business_id=b.id and profile_id=auth.uid() and fired_at is null;
 if e.id is not null then select * into role from public.business_role_templates where id=e.role_template_id;family:=role.game_family;skill:=e.skill_area;
 elsif b.owner_id=auth.uid() and b.owner_operates then select game_family into family from public.business_types where id=b.business_type_id;skill:='management';
 else raise exception 'Você precisa ter um vínculo ativo ou atuar como proprietário na operação.' using errcode='42501';end if;
 family:=coalesce(family,'logistics');skill:=coalesce(skill,'management');
 select * into template from private.professional_activity_catalog(family) where activity_key=p_activity_key;
 if not found then raise exception 'Escolha uma atividade disponível para sua função.' using errcode='22023';end if;
 update public.professional_work_sessions set status='expired' where user_id=auth.uid() and status='active' and expires_at<=now();
 select * into session from public.professional_work_sessions where user_id=auth.uid() and status='active';
 if found then
  if session.business_id<>b.id then raise exception 'Conclua ou aguarde expirar a atividade iniciada na outra empresa.';end if;
  return to_jsonb(session)||jsonb_build_object('server_now',clock_timestamp());
 end if;
 if (select count(*) from public.professional_work_sessions where user_id=auth.uid() and started_at>=(date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'))>=5 then raise exception 'Você concluiu as atividades disponíveis de hoje. A operação básica da empresa continua automaticamente.';end if;
 if template.execution_mode='timed' then
  mode:='timed';title:=template.title;description:=template.description;
 elsif family in('technology','food','health') then
  mode:='order';ordered:=true;
  if family='technology' then title:='Organizar a entrega de software';description:='Ordene as etapas: entender requisitos, preparar a alteração, revisar, testar e publicar.';labels:=array['Entender requisitos','Preparar alteração','Revisar a alteração','Executar testes','Publicar a entrega'];
  elsif family='food' then title:='Preparar o pedido';description:='Monte na ordem do pedido: base, recheio, acompanhamento, finalização e entrega.';labels:=array['Preparar a base','Adicionar o recheio','Separar acompanhamento','Finalizar e conferir','Entregar o pedido'];
  else title:='Organizar a triagem do RP';description:='Atenda as fichas por prioridade, do maior número para o menor.';labels:=array['Ficha A · prioridade 95','Ficha B · prioridade 80','Ficha C · prioridade 60','Ficha D · prioridade 35','Ficha E · prioridade 10'];end if;
  for i in 1..5 loop option_id:=gen_random_uuid()::text;options:=options||jsonb_build_array(jsonb_build_object('id',option_id,'label',labels[i]));answer:=answer||jsonb_build_array(option_id);end loop;
 elsif family in('quality','logistics') then
  mode:='multiple';
  if family='quality' then title:='Inspeção do lote';description:='Selecione todas as peças aprovadas: a medida deve estar entre 45 e 55, inclusive.';
  else title:='Reposição do estoque';description:='Selecione os itens com estoque abaixo do mínimo de 50 unidades.';end if;
  for i in 1..6 loop value:=30+floor(random()*41)::integer;option_id:=gen_random_uuid()::text;options:=options||jsonb_build_array(jsonb_build_object('id',option_id,'label',case when family='quality' then 'Peça ' else 'Item ' end||i,'value',value));if (family='quality' and value between 45 and 55) or (family='logistics' and value<50) then answer:=answer||jsonb_build_array(option_id);end if;end loop;
 else
  mode:='single';expected_value:=-1;
  if family='transport' then title:='Planejar a entrega';description:='Escolha a rota com menor tempo total. Considere os dois trechos e o tempo de parada.';
  elsif family='sales' then title:='Negociar com margem';description:='O cliente aceita pagar até R$ 150. Escolha a oferta que cabe no orçamento e deixa a maior margem entre preço e custo.';
  else title:='Analisar propostas financeiras';description:='A política aceita risco até 30 pontos. Escolha a proposta elegível com maior retorno estimado.';end if;
  for i in 1..4 loop
   option_id:=gen_random_uuid()::text;
   if family='transport' then price:=10+floor(random()*30)::integer;cost:=5+floor(random()*25)::integer;value:=5+floor(random()*10)::integer;rank:=200-price-cost-value;options:=options||jsonb_build_array(jsonb_build_object('id',option_id,'label','Rota '||i,'detail',price||' min + '||cost||' min + parada de '||value||' min'));
   elsif family='sales' then price:=100+i*15;cost:=50+floor(random()*41)::integer;rank:=case when price<=150 then price-cost else -1 end;options:=options||jsonb_build_array(jsonb_build_object('id',option_id,'label','Oferta '||i,'detail','Preço R$ '||price||' · custo R$ '||cost));
   else price:=10+floor(random()*31)::integer;cost:=10+i*7;rank:=case when cost<=30 then price else -1 end;options:=options||jsonb_build_array(jsonb_build_object('id',option_id,'label','Proposta '||i,'detail','Retorno estimado '||price||' · risco '||cost));end if;
   if rank>expected_value then expected_value:=rank;answer:=jsonb_build_array(option_id);elsif rank=expected_value then answer:=answer||jsonb_build_array(option_id);end if;
  end loop;
 end if;
 select jsonb_agg(item order by random()) into options from jsonb_array_elements(options) item;
 public_challenge:=jsonb_build_object('title',title,'description',description,'mode',mode,'options',coalesce(options,'[]'),
   'minimum_seconds',template.duration_seconds,'company_name',b.name,'role_name',coalesce(e.role,'Proprietário na operação'));
 insert into public.professional_work_sessions(user_id,business_id,employee_id,game_family,skill_area,challenge,activity_key,execution_mode,duration_seconds,expires_at) values(auth.uid(),b.id,e.id,family,skill,public_challenge,template.activity_key,template.execution_mode,template.duration_seconds,clock_timestamp()+interval '1 day') returning * into session;
 insert into private.professional_work_answers(session_id,answer,ordered) values(session.id,answer,ordered);
 return to_jsonb(session)||jsonb_build_object('server_now',clock_timestamp());
end $$;
create or replace function public.finish_professional_activity(p_session_id uuid,p_answer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<activity>>
declare s public.professional_work_sessions%rowtype; a private.professional_work_answers%rowtype; b public.businesses%rowtype; correct integer:=0; total integer; score integer; xp integer;
begin
 if auth.uid() is null then raise exception 'Entre para concluir a atividade.' using errcode='42501';end if;
 perform id from public.profiles where id=auth.uid() for update;
 select * into s from public.professional_work_sessions where id=p_session_id and user_id=auth.uid() for update;
 if s.id is null then raise exception 'Atividade profissional indisponível.';end if;
 if s.status='completed' then return to_jsonb(s);end if;
 if s.status<>'active' or s.expires_at<=now() then raise exception 'Esta atividade expirou. Inicie uma nova atividade.';end if;
 if clock_timestamp()<s.started_at+make_interval(secs=>s.duration_seconds) then raise exception 'A atividade ainda está em andamento. Aguarde o tempo de execução indicado.';end if;
 select * into b from public.businesses where id=s.business_id;
 if b.status<>'active' or not ((s.employee_id is not null and exists(select 1 from public.business_employees where id=s.employee_id and profile_id=auth.uid() and fired_at is null)) or (s.employee_id is null and b.owner_id=auth.uid() and b.owner_operates)) then raise exception 'Seu vínculo ou acesso à operação foi encerrado.' using errcode='42501';end if;
 if p_answer is null or jsonb_typeof(p_answer)<>'array' or jsonb_array_length(p_answer)>20 or exists(select 1 from jsonb_array_elements(p_answer) item where jsonb_typeof(item)<>'string') then raise exception 'Envie as opções escolhidas na atividade, sem pontuação informada pelo cliente.';end if;
 if (select count(*) from jsonb_array_elements_text(p_answer))<>(select count(distinct value) from jsonb_array_elements_text(p_answer)) then raise exception 'Não repita a mesma opção na resposta.';end if;
 if exists(select 1 from jsonb_array_elements_text(p_answer) selected where not exists(select 1 from jsonb_array_elements(s.challenge->'options') option where option->>'id'=selected)) then raise exception 'Uma opção enviada não pertence a esta atividade.';end if;
 select * into a from private.professional_work_answers where session_id=s.id;
 total:=greatest(jsonb_array_length(a.answer),jsonb_array_length(p_answer),1);
 if s.execution_mode='timed' then score:=100;
 elsif s.challenge->>'mode'='single' then score:=case when jsonb_array_length(p_answer)=1 and a.answer ? (p_answer->>0) then 100 else 0 end;
 elsif a.ordered then
  select count(*) into correct from jsonb_array_elements_text(p_answer) with ordinality p(value,n) where a.answer->>(p.n::integer-1)=p.value;
  score:=floor(correct*100.0/total);
 else
  select count(*) into correct from jsonb_array_elements_text(p_answer) selected where a.answer ? selected;
  score:=case when jsonb_array_length(a.answer)=0 and jsonb_array_length(p_answer)=0 then 100 else greatest(0,floor((correct-(jsonb_array_length(p_answer)-correct))*100.0/total)) end;
 end if;
 xp:=case when score>=60 then least(20,floor(score*.2)) else 0 end;
 update public.professional_work_sessions set status='completed',score=activity.score,experience_earned=xp,completed_at=now() where id=s.id returning * into s;
 if xp>0 then
  insert into public.citizen_professional_experience(profile_id,skill_area,experience) values(auth.uid(),s.skill_area,xp) on conflict(profile_id,skill_area) do update set experience=public.citizen_professional_experience.experience+xp,updated_at=now();
  update public.business_employees set experience=(select experience from public.citizen_professional_experience where profile_id=auth.uid() and skill_area=s.skill_area),qualification_level=least(20,1+(select experience from public.citizen_professional_experience where profile_id=auth.uid() and skill_area=s.skill_area)/100),satisfaction=least(100,satisfaction+1) where id=s.employee_id;
  insert into private.business_daily_effort(business_id,effort_date,boost) values(s.business_id,current_date+1,score*.0004) on conflict(business_id,effort_date) do update set boost=least(.2,private.business_daily_effort.boost+excluded.boost);
 end if;
 insert into public.domain_events(event_type,source_domain,source_table,source_id,actor_id,payload,idempotency_key) values('professional_activity_completed','economy','professional_work_sessions',s.id,auth.uid(),jsonb_build_object('business_id',s.business_id,'family',s.game_family,'score',score,'experience',xp),'professional-activity:'||s.id);
 return to_jsonb(s);
end $$;

create or replace function public.get_professional_activities(p_business_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; e public.business_employees%rowtype; family text; v_day timestamptz;
begin
 if auth.uid() is null then raise exception 'Entre para consultar seu trabalho.' using errcode='42501';end if;
 select * into b from public.businesses where id=p_business_id and status='active';
 select * into e from public.business_employees where business_id=b.id and profile_id=auth.uid() and fired_at is null;
 if e.id is not null then select game_family into family from public.business_role_templates where id=e.role_template_id;
 elsif b.owner_id=auth.uid() and b.owner_operates then select game_family into family from public.business_types where id=b.business_type_id;
 else raise exception 'Você precisa ter um vínculo ativo ou atuar como proprietário na operação.' using errcode='42501';end if;
 v_day:=date_trunc('day',clock_timestamp() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
 return jsonb_build_object('server_now',clock_timestamp(),'daily_limit',5,
   'used_today',(select count(*) from public.professional_work_sessions where user_id=auth.uid() and started_at>=v_day),
   'company_name',b.name,'role_name',coalesce(e.role,'Proprietário na operação'),
   'catalog',(select jsonb_agg(to_jsonb(t)||jsonb_build_object('experience',20)) from private.professional_activity_catalog(coalesce(family,'logistics')) t),
   'active',(select to_jsonb(s) from public.professional_work_sessions s where user_id=auth.uid() and status='active' and expires_at>clock_timestamp() limit 1),
   'recent',(select coalesce(jsonb_agg(to_jsonb(s) order by started_at desc),'[]') from public.professional_work_sessions s where user_id=auth.uid() and business_id=b.id and started_at>=v_day));
end $$;
create or replace function public.save_professional_activity_draft(p_session_id uuid,p_answer jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare s public.professional_work_sessions%rowtype;
begin
 select * into s from public.professional_work_sessions where id=p_session_id and user_id=auth.uid() for update;
 if s.id is null then raise exception 'Atividade profissional indisponível.' using errcode='42501';end if;
 if s.status<>'active' or s.expires_at<=clock_timestamp() then raise exception 'Esta atividade não aceita mais alterações.';end if;
 if jsonb_typeof(p_answer) is distinct from 'array' or jsonb_array_length(p_answer)>20
   or exists(select 1 from jsonb_array_elements(p_answer) v where jsonb_typeof(v)<>'string')
   or exists(select 1 from jsonb_array_elements_text(p_answer) v where not exists(select 1 from jsonb_array_elements(s.challenge->'options') o where o->>'id'=v))
   or (select count(*)<>count(distinct v) from jsonb_array_elements_text(p_answer) v)
 then raise exception 'Confira as opções da sua resposta.' using errcode='22023';end if;
 update public.professional_work_sessions set draft_answer=p_answer where id=s.id;
end $$;
create or replace function public.withdraw_company_application(p_application_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.business_applications%rowtype; b public.businesses%rowtype;
begin
 select * into a from public.business_applications where id=p_application_id and profile_id=auth.uid() for update;
 if a.id is null then raise exception 'Candidatura não encontrada para sua conta.' using errcode='42501';end if;
 if a.status='withdrawn' then return;end if;
 if a.status<>'pending' then raise exception 'Esta candidatura já foi analisada e não pode ser retirada.' using errcode='22023';end if;
 update public.business_applications set status='withdrawn',updated_at=clock_timestamp() where id=a.id;
 select b0.* into b from public.businesses b0 join public.business_vacancies v on v.business_id=b0.id where v.id=a.vacancy_id;
 insert into public.notifications(user_id,sender_id,type,content,link)
 select id,auth.uid(),'job_application_withdrawn','Uma candidatura à vaga de sua empresa foi retirada pelo cidadão.','/services/companies/'||b.id||'?view=management'
 from public.profiles p where p.id=b.owner_id or exists(select 1 from public.business_employees e join public.business_role_templates t on t.id=e.role_template_id where e.business_id=b.id and e.profile_id=p.id and e.fired_at is null and t.can_manage);
 perform economy_private.audit('job_application_withdrawn','business_application',a.id::text,to_jsonb(a),jsonb_build_object('status','withdrawn'),'Retirada solicitada pelo candidato.',auth.uid());
end $$;
CREATE OR REPLACE FUNCTION public.get_company_jobs()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'business_id',b.id,'company_name',b.name,'logo_url',b.logo_url,'region_code',b.region_code,'role',t.name,'skill_area',t.skill_area,'salary',v.salary,'min_level',v.min_level,'positions',v.positions,'description',v.description,'created_at',v.created_at,'applied',exists(select 1 from public.business_applications a where a.vacancy_id=v.id and a.profile_id=auth.uid() and a.status<>'withdrawn')) order by v.created_at desc),'[]'::jsonb)
 from public.business_vacancies v join public.businesses b on b.id=v.business_id join public.business_role_templates t on t.id=v.role_template_id where auth.uid() is not null and v.status='open' and b.status not in('closed','suspended')
$function$;

CREATE OR REPLACE FUNCTION public.apply_company_vacancy(p_vacancy_id uuid, p_message text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.business_vacancies%rowtype; aid uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and onboarding_completed and deleted_at is null) then raise exception 'Conclua sua cidadania antes de se candidatar.' using errcode='42501';end if;
 select * into v from public.business_vacancies where id=p_vacancy_id and status='open' for share;
 if v.id is null then raise exception 'Esta vaga não está mais disponível.';end if;
 if exists(select 1 from public.businesses where id=v.business_id and owner_id=auth.uid()) then raise exception 'O proprietário administra sua empresa pelo painel de gestão.';end if;
 if exists(select 1 from public.business_employees where profile_id=auth.uid() and fired_at is null) then raise exception 'Você já possui um emprego principal. Encerre o vínculo atual antes de se candidatar.';end if;
 insert into public.business_applications(vacancy_id,profile_id,message) values(v.id,auth.uid(),left(coalesce(p_message,''),2000)) on conflict(vacancy_id,profile_id) do update set message=case when public.business_applications.status in('pending','withdrawn') then excluded.message else public.business_applications.message end,status=case when public.business_applications.status='withdrawn' then 'pending' else public.business_applications.status end,updated_at=clock_timestamp() returning id into aid;
 return aid;
end $function$;


revoke all on function public.start_professional_activity(uuid,text),public.get_professional_activities(uuid),public.save_professional_activity_draft(uuid,jsonb),public.withdraw_company_application(uuid) from public,anon;
grant execute on function public.start_professional_activity(uuid,text),public.get_professional_activities(uuid),public.save_professional_activity_draft(uuid,jsonb),public.withdraw_company_application(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
