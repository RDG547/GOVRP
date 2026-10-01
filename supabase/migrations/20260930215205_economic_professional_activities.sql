begin;
create table public.professional_work_sessions(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),business_id uuid not null references public.businesses(id),employee_id uuid references public.business_employees(id),game_family text not null,skill_area text not null,challenge jsonb not null,started_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '15 minutes',completed_at timestamptz,status text not null default 'active' check(status in('active','completed','expired')),score integer check(score between 0 and 100),experience_earned integer not null default 0 check(experience_earned between 0 and 20));
create unique index one_active_work_activity on public.professional_work_sessions(user_id) where status='active';
create index work_activity_daily on public.professional_work_sessions(user_id,started_at);
create table private.professional_work_answers(session_id uuid primary key references public.professional_work_sessions(id),answer jsonb not null,ordered boolean not null);
revoke all on private.professional_work_answers from public,anon,authenticated;
alter table public.professional_work_sessions enable row level security;
create policy professional_activity_own on public.professional_work_sessions for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.professional_work_sessions from anon,authenticated;
grant select on public.professional_work_sessions to authenticated;
create or replace function public.start_professional_activity(p_business_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.businesses%rowtype; e public.business_employees%rowtype; role public.business_role_templates%rowtype; session public.professional_work_sessions%rowtype; family text; skill text; title text; description text; mode text:='multiple'; options jsonb:='[]'; answer jsonb:='[]'; public_challenge jsonb; option_id text; labels text[]; i integer; value integer; expected_value integer; ordered boolean:=false; ranks integer[]; rank integer; price integer; cost integer;
begin
 if auth.uid() is null then raise exception 'Entre para trabalhar.' using errcode='42501';end if;
 perform id from public.profiles where id=auth.uid() for update;
 select * into b from public.businesses where id=p_business_id and status='active';
 if b.id is null then raise exception 'Esta empresa não está ativa.';end if;
 select * into e from public.business_employees where business_id=b.id and profile_id=auth.uid() and fired_at is null;
 if e.id is not null then select * into role from public.business_role_templates where id=e.role_template_id;family:=role.game_family;skill:=e.skill_area;
 elsif b.owner_id=auth.uid() and b.owner_operates then family:='logistics';skill:='management';
 else raise exception 'Você precisa ter um vínculo ativo ou atuar como proprietário na operação.' using errcode='42501';end if;
 family:=coalesce(family,'logistics');skill:=coalesce(skill,'management');
 update public.professional_work_sessions set status='expired' where user_id=auth.uid() and status='active' and expires_at<=now();
 select * into session from public.professional_work_sessions where user_id=auth.uid() and status='active';
 if found then
  if session.business_id<>b.id then raise exception 'Conclua ou aguarde expirar a atividade iniciada na outra empresa.';end if;
  return to_jsonb(session);
 end if;
 if (select count(*) from public.professional_work_sessions where user_id=auth.uid() and started_at>=date_trunc('day',now()))>=5 then raise exception 'Você concluiu as atividades disponíveis de hoje. A operação básica da empresa continua automaticamente.';end if;
 if exists(select 1 from public.professional_work_sessions where user_id=auth.uid() and started_at>now()-interval '60 seconds') then raise exception 'Aguarde um minuto entre atividades profissionais.';end if;
 if family in('technology','food','health') then
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
 public_challenge:=jsonb_build_object('title',title,'description',description,'mode',mode,'options',options,'minimum_seconds',10);
 insert into public.professional_work_sessions(user_id,business_id,employee_id,game_family,skill_area,challenge) values(auth.uid(),b.id,e.id,family,skill,public_challenge) returning * into session;
 insert into private.professional_work_answers(session_id,answer,ordered) values(session.id,answer,ordered);
 return to_jsonb(session);
end $$;
create or replace function public.finish_professional_activity(p_session_id uuid,p_answer jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<activity>>
declare s public.professional_work_sessions%rowtype; a private.professional_work_answers%rowtype; b public.businesses%rowtype; correct integer:=0; total integer; score integer; xp integer;
begin
 if auth.uid() is null then raise exception 'Entre para concluir a atividade.' using errcode='42501';end if;
 select * into s from public.professional_work_sessions where id=p_session_id and user_id=auth.uid() for update;
 if s.id is null then raise exception 'Atividade profissional indisponível.';end if;
 if s.status='completed' then return to_jsonb(s);end if;
 if s.status<>'active' or s.expires_at<=now() then raise exception 'Esta atividade expirou. Inicie uma nova atividade.';end if;
 if s.started_at>now()-interval '10 seconds' then raise exception 'Revise a tarefa antes de concluir. O tempo mínimo de execução é de 10 segundos.';end if;
 select * into b from public.businesses where id=s.business_id;
 if b.status<>'active' or not ((s.employee_id is not null and exists(select 1 from public.business_employees where id=s.employee_id and profile_id=auth.uid() and fired_at is null)) or (s.employee_id is null and b.owner_id=auth.uid() and b.owner_operates)) then raise exception 'Seu vínculo ou acesso à operação foi encerrado.' using errcode='42501';end if;
 if p_answer is null or jsonb_typeof(p_answer)<>'array' or jsonb_array_length(p_answer)>20 or exists(select 1 from jsonb_array_elements(p_answer) item where jsonb_typeof(item)<>'string') then raise exception 'Envie as opções escolhidas na atividade, sem pontuação informada pelo cliente.';end if;
 if (select count(*) from jsonb_array_elements_text(p_answer))<>(select count(distinct value) from jsonb_array_elements_text(p_answer)) then raise exception 'Não repita a mesma opção na resposta.';end if;
 if exists(select 1 from jsonb_array_elements_text(p_answer) selected where not exists(select 1 from jsonb_array_elements(s.challenge->'options') option where option->>'id'=selected)) then raise exception 'Uma opção enviada não pertence a esta atividade.';end if;
 select * into a from private.professional_work_answers where session_id=s.id;
 total:=greatest(jsonb_array_length(a.answer),jsonb_array_length(p_answer),1);
 if s.challenge->>'mode'='single' then score:=case when jsonb_array_length(p_answer)=1 and a.answer ? (p_answer->>0) then 100 else 0 end;
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
revoke all on function public.start_professional_activity(uuid),public.finish_professional_activity(uuid,jsonb) from public,anon;
grant execute on function public.start_professional_activity(uuid),public.finish_professional_activity(uuid,jsonb) to authenticated;
alter publication supabase_realtime add table public.professional_work_sessions;
notify pgrst,'reload schema';
commit;
