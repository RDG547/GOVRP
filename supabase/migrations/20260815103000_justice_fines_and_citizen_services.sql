-- Serviços civis de segurança e ciclo completo/atômico de multas.

create sequence if not exists public.police_fine_number_seq;

alter table public.police_fines
  add column if not exists points integer not null default 0,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_transaction_id uuid references public.transactions(id) on delete set null,
  add column if not exists issuer_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists payment_snapshot jsonb not null default '{}'::jsonb;

create or replace function public.assign_police_fine_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.fine_code is null or new.fine_code='' or new.fine_code like 'FINE-%' then
    new.fine_code := 'MUL-'||to_char(clock_timestamp(),'YYYY')||'-'||lpad(nextval('public.police_fine_number_seq')::text,6,'0');
  end if;
  return new;
end;
$$;

drop trigger if exists police_fines_assign_number on public.police_fines;
create trigger police_fines_assign_number before insert on public.police_fines
for each row execute function public.assign_police_fine_number();

create or replace function public.protect_police_fine_number()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.fine_code is distinct from old.fine_code then raise exception 'O número da multa é imutável.'; end if;
  return new;
end; $$;

drop trigger if exists police_fines_immutable_number on public.police_fines;
create trigger police_fines_immutable_number before update of fine_code on public.police_fines
for each row execute function public.protect_police_fine_number();

create table if not exists public.fine_appeals (
  id uuid primary key default gen_random_uuid(),
  fine_id uuid not null references public.police_fines(id) on delete cascade,
  appellant_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check(status in('pending','under_review','approved','rejected','cancelled')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  decision_reason text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(fine_id)
);

create table if not exists public.fine_hearing_requests (
  id uuid primary key default gen_random_uuid(),
  fine_id uuid not null references public.police_fines(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  preferred_times jsonb not null default '[]'::jsonb,
  status text not null default 'requested' check(status in('requested','scheduled','held','denied','cancelled')),
  scheduled_at timestamptz,
  decided_by uuid references public.profiles(id) on delete set null,
  decision_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investigation_subjects (
  investigation_id uuid not null references public.criminal_investigations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_status text not null default 'under_review' check(subject_status in('under_review','investigated','cleared','indicted')),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(investigation_id,profile_id)
);

create table if not exists public.citizen_justice_requests (
  id uuid primary key default gen_random_uuid(),
  protocol_number text not null unique default public.justice_next_number('REQ'),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  request_type text not null check(request_type in('formal_investigation','asset_release')),
  subject text not null,
  description text not null,
  related_occurrence_id uuid references public.police_occurrences(id) on delete set null,
  related_investigation_id uuid references public.criminal_investigations(id) on delete set null,
  evidence jsonb not null default '[]'::jsonb,
  status text not null default 'submitted' check(status in('submitted','under_review','more_information','approved','denied','completed','cancelled')),
  assigned_to uuid references public.profiles(id) on delete set null,
  decision_notes text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.public_safety_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  content text not null,
  category text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  is_published boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.issue_fine(p_user_id uuid,p_reason text,p_amount numeric,p_due_date timestamptz)
returns json
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); fine public.police_fines%rowtype; actor_name text;
begin
  if not public.justice_has_role(array['Admin','Policial','Police','Delegado','Juiz']) then
    return json_build_object('success',false,'message','Acesso não autorizado para emitir multas.');
  end if;
  if p_amount<=0 then return json_build_object('success',false,'message','O valor da multa deve ser positivo.'); end if;
  if nullif(trim(p_reason),'') is null then return json_build_object('success',false,'message','Informe o motivo da multa.'); end if;
  if not exists(select 1 from public.profiles where id=p_user_id) then return json_build_object('success',false,'message','Cidadão não encontrado.'); end if;
  select full_name into actor_name from public.profiles where id=actor;
  insert into public.police_fines(user_id,officer_id,reason,amount,status,due_date,fine_code,issuer_snapshot)
  values(p_user_id,actor,trim(p_reason),round(p_amount,2),'Pendente',p_due_date,'',jsonb_build_object('id',actor,'name',actor_name,'role',public.get_user_role(actor)))
  returning * into fine;
  insert into public.notifications(user_id,sender_id,type,content,link)
  values(p_user_id,actor,'fine_issued','Você recebeu a multa '||fine.fine_code||' no valor de R$ '||to_char(fine.amount,'FM999G999G990D00'),'/services/justice?view=citizen');
  perform public.justice_write_audit('fine.issued','police_fine',fine.id,null,to_jsonb(fine),'Multa emitida');
  return json_build_object('success',true,'message','Multa emitida com sucesso.','fine',to_jsonb(fine),'fine_code',fine.fine_code);
end; $$;

create or replace function public.pay_fine(p_fine_id uuid)
returns json
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); fine public.police_fines%rowtype; account public.accounts%rowtype;
  days_overdue int:=0; interest numeric(15,2):=0; total numeric(15,2); transaction_id uuid;
begin
  select * into fine from public.police_fines where id=p_fine_id and user_id=actor for update;
  if not found then return json_build_object('success',false,'message','Multa não encontrada ou não pertence a você.'); end if;
  if fine.status='Paga' then
    return json_build_object('success',true,'message','Esta multa já foi paga.','receipt',fine.payment_snapshot);
  end if;
  if fine.status not in('Pendente','Vencida') then return json_build_object('success',false,'message','Esta multa não está disponível para pagamento.'); end if;
  if fine.due_date is not null and fine.due_date<clock_timestamp() then days_overdue:=greatest(0,floor(extract(epoch from(clock_timestamp()-fine.due_date))/86400)::int); end if;
  interest:=round(fine.amount*0.0033*days_overdue,2); total:=round(fine.amount+interest,2);
  select * into account from public.accounts where user_id=actor for update;
  if not found or account.balance<total then return json_build_object('success',false,'message','Saldo insuficiente para pagar a multa e os juros.'); end if;
  update public.accounts set balance=balance-total,updated_at=clock_timestamp() where id=account.id;
  update public.government_finances set treasury_balance=treasury_balance+total,updated_at=clock_timestamp() where id=1;
  insert into public.transactions(from_account_id,amount,description,type,metadata)
  values(account.id,total,'Pagamento da multa '||fine.fine_code,'fine_payment',jsonb_build_object('fineId',fine.id,'fineCode',fine.fine_code,'baseAmount',fine.amount,'interestAmount',interest,'daysOverdue',days_overdue))
  returning id into transaction_id;
  update public.police_fines set status='Paga',paid_at=clock_timestamp(),updated_at=clock_timestamp(),payment_transaction_id=transaction_id,
    payment_snapshot=jsonb_build_object('fineCode',fine.fine_code,'transactionId',transaction_id,'baseAmount',fine.amount,'interestAmount',interest,'totalAmount',total,'paidAt',clock_timestamp())
  where id=fine.id;
  perform public.justice_write_audit('fine.paid','police_fine',fine.id,to_jsonb(fine),jsonb_build_object('status','Paga','transactionId',transaction_id),'Pagamento atômico de multa');
  return json_build_object('success',true,'message','Multa paga com sucesso.','receipt',jsonb_build_object('fineCode',fine.fine_code,'transactionId',transaction_id,'baseAmount',fine.amount,'interestAmount',interest,'totalAmount',total));
end; $$;

create or replace function public.appeal_fine(p_fine_id uuid,p_reason text)
returns json
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); appeal public.fine_appeals%rowtype;
begin
  if length(trim(coalesce(p_reason,'')))<20 then return json_build_object('success',false,'message','Explique o recurso em pelo menos 20 caracteres.'); end if;
  perform 1 from public.police_fines where id=p_fine_id and user_id=actor and status in('Pendente','Vencida') for update;
  if not found then return json_build_object('success',false,'message','Multa não encontrada ou não pode ser contestada.'); end if;
  insert into public.fine_appeals(fine_id,appellant_id,reason) values(p_fine_id,actor,trim(p_reason)) returning * into appeal;
  update public.police_fines set status='Em Recurso',updated_at=clock_timestamp() where id=p_fine_id;
  perform public.justice_write_audit('fine.appealed','police_fine',p_fine_id,null,to_jsonb(appeal),'Recurso de multa protocolado');
  return json_build_object('success',true,'message','Recurso enviado com sucesso.','appeal',to_jsonb(appeal));
exception when unique_violation then return json_build_object('success',false,'message','Já existe recurso para esta multa.');
end; $$;

create or replace function public.request_fine_hearing(p_fine_id uuid,p_reason text,p_preferred_times jsonb default '[]'::jsonb)
returns public.fine_hearing_requests
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result public.fine_hearing_requests%rowtype;
begin
  if length(trim(coalesce(p_reason,'')))<20 then raise exception 'Explique o pedido em pelo menos 20 caracteres.'; end if;
  if not exists(select 1 from public.police_fines where id=p_fine_id and user_id=actor) then raise exception 'Multa não encontrada.'; end if;
  insert into public.fine_hearing_requests(fine_id,requester_id,reason,preferred_times)
  values(p_fine_id,actor,trim(p_reason),coalesce(p_preferred_times,'[]'::jsonb)) returning * into result;
  return result;
end; $$;

create or replace function public.create_citizen_justice_request(
  p_request_type text,p_subject text,p_description text,p_related_occurrence_id uuid default null,
  p_related_investigation_id uuid default null,p_evidence jsonb default '[]'::jsonb
)
returns public.citizen_justice_requests
language plpgsql security definer set search_path='' as $$
declare result public.citizen_justice_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária.'; end if;
  if p_request_type not in('formal_investigation','asset_release') then raise exception 'Tipo de pedido inválido.'; end if;
  if length(trim(coalesce(p_subject,'')))<5 or length(trim(coalesce(p_description,'')))<20 then raise exception 'Preencha assunto e fundamentação completos.'; end if;
  insert into public.citizen_justice_requests(requester_id,request_type,subject,description,related_occurrence_id,related_investigation_id,evidence)
  values(auth.uid(),p_request_type,trim(p_subject),trim(p_description),p_related_occurrence_id,p_related_investigation_id,coalesce(p_evidence,'[]'::jsonb)) returning * into result;
  return result;
end; $$;

create or replace function public.get_my_security_status()
returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'warrants',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'number',w.warrant_number,'type',w.warrant_type,'status',w.status,'issuedAt',w.issued_at,'expiresAt',w.expires_at)) from public.warrants w where w.target_profile_id=auth.uid() and w.status='issued' and w.expires_at>clock_timestamp()),'[]'::jsonb),
    'investigations',coalesce((select jsonb_agg(jsonb_build_object('number',i.investigation_number,'status',s.subject_status,'openedAt',i.opened_at)) from public.investigation_subjects s join public.criminal_investigations i on i.id=s.investigation_id where s.profile_id=auth.uid()),'[]'::jsonb)
  );
$$;

create or replace function public.issue_criminal_clearance_certificate()
returns public.documents
language plpgsql security definer set search_path='' as $$
declare result public.documents%rowtype; has_record boolean; certificate_number text;
begin
  if auth.uid() is null then raise exception 'Autenticação necessária.'; end if;
  select exists(select 1 from public.criminal_records where user_id=auth.uid() and is_active and record_status not in('expired','annulled')) into has_record;
  certificate_number:='AAC-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.documents(user_id,type,document_number,issued_at,expires_at,is_valid,metadata,qr_code_data,full_name)
  select p.id,'Atestado de Antecedentes',certificate_number,clock_timestamp(),clock_timestamp()+interval '90 days',true,
    jsonb_build_object('result',case when has_record then 'positive' else 'nothing_found' end,'generatedAt',clock_timestamp()),
    'GOVRP:AAC:'||certificate_number,p.full_name from public.profiles p where p.id=auth.uid()
  returning * into result;
  return result;
end; $$;

create or replace function public.get_public_wanted_list()
returns table(profile_id uuid,full_name text,avatar_url text,warrant_number text,warrant_type text,issued_at timestamptz,expires_at timestamptz)
language sql stable security definer set search_path='' as $$
  select p.id,p.full_name,p.avatar_url,w.warrant_number,w.warrant_type,w.issued_at,w.expires_at
  from public.warrants w join public.profiles p on p.id=w.target_profile_id
  where w.warrant_type='arrest' and w.status='issued' and w.expires_at>clock_timestamp();
$$;

create or replace function public.get_police_efficiency_metrics()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'reported',count(*),
    'inInvestigation',count(*) filter(where status='Em investigação'),
    'resolved',count(*) filter(where status in('Concluída','Arquivada')),
    'resolutionRate',case when count(*)=0 then 0 else round(100.0*count(*) filter(where status in('Concluída','Arquivada'))/count(*),2) end,
    'averageTriageHours',coalesce(round(avg(extract(epoch from(updated_at-created_at))/3600) filter(where status<>'Pendente')::numeric,2),0)
  ) from public.police_occurrences;
$$;

alter table public.fine_appeals enable row level security;
alter table public.fine_hearing_requests enable row level security;
alter table public.investigation_subjects enable row level security;
alter table public.citizen_justice_requests enable row level security;
alter table public.public_safety_campaigns enable row level security;

create policy fine_appeals_own_read on public.fine_appeals for select to authenticated using(appellant_id=auth.uid() or public.justice_has_role(array['Admin','Policial','Police','Delegado','Juiz'])) ;
create policy fine_hearings_own_read on public.fine_hearing_requests for select to authenticated using(requester_id=auth.uid() or public.justice_has_role(array['Admin','Corregedor','Juiz'])) ;
create policy investigation_subjects_own_read on public.investigation_subjects for select to authenticated using(profile_id=auth.uid() or public.justice_has_role(array['Admin','Policial','Police','Delegado','Promotor','Juiz'])) ;
create policy citizen_justice_requests_own_read on public.citizen_justice_requests for select to authenticated using(requester_id=auth.uid() or public.justice_has_role(array['Admin','Policial','Police','Delegado','Promotor','Juiz'])) ;
create policy safety_campaigns_public_read on public.public_safety_campaigns for select to anon,authenticated using(is_published and starts_at<=clock_timestamp() and(ends_at is null or ends_at>clock_timestamp()));

drop policy if exists "Police and Admins can manage all fines" on public.police_fines;
create policy police_and_justice_manage_fines on public.police_fines for all to authenticated
using(public.justice_has_role(array['Admin','Policial','Police','Delegado','Juiz']))
with check(public.justice_has_role(array['Admin','Policial','Police','Delegado','Juiz']));

grant select on public.fine_appeals,public.fine_hearing_requests,public.investigation_subjects,public.citizen_justice_requests,public.public_safety_campaigns to authenticated;
grant select on public.public_safety_campaigns to anon;
grant all on public.fine_appeals,public.fine_hearing_requests,public.investigation_subjects,public.citizen_justice_requests,public.public_safety_campaigns to service_role;
grant execute on function public.request_fine_hearing(uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.create_citizen_justice_request(text,text,text,uuid,uuid,jsonb) to authenticated,service_role;
grant execute on function public.get_my_security_status() to authenticated,service_role;
grant execute on function public.issue_criminal_clearance_certificate() to authenticated,service_role;
grant execute on function public.get_public_wanted_list() to anon,authenticated,service_role;
grant execute on function public.get_police_efficiency_metrics() to anon,authenticated,service_role;

do $$ begin alter publication supabase_realtime add table public.police_fines; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.fine_appeals; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.fine_hearing_requests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.citizen_justice_requests; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.public_safety_campaigns; exception when duplicate_object then null; end $$;
