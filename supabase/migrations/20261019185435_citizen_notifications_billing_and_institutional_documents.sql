begin;
alter table public.notifications add column phone_dismissed_at timestamptz;
create function public.dismiss_phone_notifications(p_ids uuid[]) returns integer language plpgsql security definer set search_path='' as $$declare changed integer;begin
 if auth.uid() is null then raise exception 'Entre para dispensar os avisos.' using errcode='42501';end if;
 if coalesce(cardinality(p_ids),0) not between 1 and 100 then raise exception 'Selecione até cem avisos do seu celular.';end if;
 update public.notifications set phone_dismissed_at=clock_timestamp() where id=any(p_ids) and user_id=auth.uid() and phone_dismissed_at is null;get diagnostics changed=row_count;return changed;
end $$;
revoke all on function public.dismiss_phone_notifications(uuid[]) from public,anon;grant execute on function public.dismiss_phone_notifications(uuid[]) to authenticated;
alter table public.card_invoice_items drop constraint card_invoice_items_entry_kind_check;
alter table public.card_invoice_items add constraint card_invoice_items_entry_kind_check check(entry_kind in('charge','payment','credit','interest')),
 add column charge_type text check(charge_type is null or charge_type in('late_interest','financing_interest','late_fee','additional_charge','legacy_interest')),
 add column rate_snapshot numeric,add column base_amount numeric,add column charge_rule_snapshot jsonb;
create unique index invoice_financing_charge_once on public.card_invoice_items(invoice_id,charge_type) where entry_kind='interest' and charge_type in('financing_interest','legacy_interest') and voided_at is null;
create temporary table preserved_invoice_interest on commit drop as select id,card_id,interest_amount,interest_rate,coalesce(interest_applied_at,updated_at,created_at) applied_at from public.card_invoices where interest_amount>0;
CREATE OR REPLACE FUNCTION private.refresh_card_balances(p_card uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform id from public.cards where id=p_card for update;
 with totals as(select i.id,i.opening_amount+coalesce(sum(it.amount) filter(where it.entry_kind='charge'),0) charges,coalesce(sum(it.amount) filter(where it.entry_kind='payment'),0) payments,coalesce(sum(it.amount) filter(where it.entry_kind='credit'),0) credits,coalesce(sum(it.amount) filter(where it.entry_kind='interest'),0) interest from public.card_invoices i left join public.card_invoice_items it on it.invoice_id=i.id and it.voided_at is null where i.card_id=p_card group by i.id), balances as(select t.*,greatest(0,t.charges+t.interest-t.payments-t.credits) due from totals t join public.card_invoices i on i.id=t.id)
 update public.card_invoices i set interest_amount=b.interest,charges_total=b.charges,payments_total=b.payments,credits_total=b.credits,amount=b.due,status=case when b.due=0 then 'paid' when i.due_date<current_date then 'overdue' when i.closing_date<current_date then 'closed' else 'open' end,updated_at=clock_timestamp() from balances b where b.id=i.id and (i.interest_amount,i.charges_total,i.payments_total,i.credits_total,i.amount,i.status) is distinct from (b.interest,b.charges,b.payments,b.credits,b.due,case when b.due=0 then 'paid' when i.due_date<current_date then 'overdue' when i.closing_date<current_date then 'closed' else 'open' end);
 update public.cards set used_limit=coalesce((select sum(amount) from public.card_invoices where card_id=p_card),0) where id=p_card and used_limit is distinct from coalesce((select sum(amount) from public.card_invoices where card_id=p_card),0);
end $function$
;
insert into public.card_invoice_items(invoice_id,description,amount,entry_kind,charge_type,rate_snapshot,base_amount,created_at,charge_rule_snapshot)
 select id,'Encargo histórico registrado na fatura',interest_amount,'interest','legacy_interest',interest_rate,null,applied_at,jsonb_build_object('source','preserved_invoice_interest','recorded_rate',interest_rate,'historical',true) from preserved_invoice_interest;
create or replace function public.close_due_invoices() returns jsonb language plpgsql security definer set search_path='' as $$
declare c record;i public.card_invoices%rowtype;rate numeric;affected integer:=0;policy jsonb;
begin
 policy:=public.get_bank_policy();rate:=coalesce((policy->>'credit_card_revolving_rate')::numeric,8.9);
 if rate<0 or rate>100 or rate::text in('NaN','Infinity','-Infinity') then raise exception 'A taxa de financiamento cadastrada é inválida.';end if;
 for c in select id from public.cards order by id for update loop perform private.refresh_card_balances(c.id);end loop;
 for i in select * from public.card_invoices where amount>0 and due_date<current_date and interest_applied_at is null order by card_id,id for update loop
  if rate>0 then insert into public.card_invoice_items(invoice_id,description,amount,entry_kind,charge_type,rate_snapshot,base_amount,charge_rule_snapshot)
   values(i.id,'Juros de financiamento da fatura após o vencimento',round(i.amount*rate/100,2),'interest','financing_interest',rate,i.amount,jsonb_build_object('policy_key','credit_card_revolving_rate','rate',rate,'basis_amount',i.amount,'applied_at',clock_timestamp())) on conflict do nothing;end if;
  update public.card_invoices set interest_rate=rate,interest_applied_at=clock_timestamp() where id=i.id;affected:=affected+1;
 end loop;
 for c in select id from public.cards order by id for update loop perform private.refresh_card_balances(c.id);end loop;
 return jsonb_build_object('success',true,'affected_count',affected);
end $$;
revoke all on function public.close_due_invoices() from public,anon,authenticated;grant execute on function public.close_due_invoices() to service_role;
drop function public.get_invoice_items(uuid);
create function public.get_invoice_items(p_invoice_id uuid) returns table(id uuid,transaction_id uuid,description text,amount numeric,created_at timestamptz,entry_kind text,charge_type text,rate_snapshot numeric,base_amount numeric,charge_rule_snapshot jsonb) language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'Entre para consultar a fatura.' using errcode='42501';end if;
 return query select it.id,it.transaction_id,it.description,case when it.entry_kind in('payment','credit') then -it.amount else it.amount end,it.created_at,it.entry_kind,it.charge_type,it.rate_snapshot,it.base_amount,it.charge_rule_snapshot from public.card_invoice_items it join public.card_invoices i on i.id=it.invoice_id where i.id=p_invoice_id and i.user_id=auth.uid() and it.voided_at is null order by it.created_at,it.id;
end $$;
revoke all on function public.get_invoice_items(uuid) from public,anon;grant execute on function public.get_invoice_items(uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.document_employment(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'company',b.name,'role',coalesce(t.name,e.role),'salary',e.salary,'hired_at',e.hired_at,'fired_at',e.fired_at,'history',e.role_history) order by (e.fired_at is null) desc,e.hired_at desc),'[]') from public.business_employees e join public.businesses b on b.id=e.business_id left join public.business_role_templates t on t.id=e.role_template_id where e.profile_id=p_user and not e.is_npc;
$function$
;
-- Institutional appointments are projected from existing mandates, appointments
-- and role_changed events. They are not business employment contracts.
create function private.document_institutional_history(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 with person as(select * from public.profiles where id=p_user and deleted_at is null),
 events as(select e.id,e.created_at,e.payload,lead(e.created_at) over(order by e.created_at,e.id) ended from public.domain_events e where e.event_type='role_changed' and e.source_id=p_user),
 appointments as(
 select 'election:'||a.id id,a.office_role role,'Mandato Eletivo' kind,case when a.office_role in('Presidente','Vice-Presidente') then 'Governo Federal' else 'Parlamento' end institution,a.term_starts_at started,coalesce(a.ended_at,a.term_ends_at) ended,10 priority from public.election_office_assignments a where a.profile_id=p_user AND (a.status='active' OR a.ended_at>=a.term_starts_at)
 union all select 'government:'||g.id,'Presidente',case when g.is_interim then 'Exercício interino' else 'Mandato Eletivo' end,'Governo Federal',case when g.head_id=g.original_president_id then g.term_starts_at else coalesce(p.role_assigned_at,g.vacancy_at,g.term_starts_at) end,coalesce(g.ended_at,g.term_ends_at),20 from public.government_terms g cross join person p where g.head_id=p_user
 union all select 'government-original:'||g.id,'Presidente','Mandato Eletivo','Governo Federal',g.term_starts_at,coalesce(g.vacancy_at,g.ended_at,g.term_ends_at),20 from public.government_terms g where g.original_president_id=p_user and g.head_id is distinct from p_user
 union all select 'minister:'||m.id,'Ministro','Nomeação',coalesce(m.ministry,'Governo Federal'),m.appointed_at,m.ended_at,30 from public.ministers m where m.user_id=p_user
 union all select 'parliament:'||m.id,case when h.name ilike '%senado%' then 'Senador' else 'Deputado' end,'Mandato Parlamentar',h.name,m.term_start_date::timestamptz,m.term_end_date::timestamptz+interval '1 day',40 from public.parliament_members m join public.parliament_houses h on h.id=m.house_id where m.user_id=p_user
 ), role_history as(
 select 'role:'||e.id id,e.payload->>'new_role' role,case when e.payload->>'origin'='administration' then 'Designação administrativa' else 'Cargo institucional' end kind,'GOVRP' institution,coalesce(nullif(e.payload->>'term_start_at','')::timestamptz,nullif(e.payload->>'role_assigned_at','')::timestamptz,e.created_at) started,e.ended,50 priority from events e where e.payload->>'new_role' not in('Cidadão','Admin','Preso','Prisioneiro')
 ), all_rows as(
 select * from appointments union all select e.* from role_history e where not exists(select 1 from appointments a where a.role=e.role and e.started>=a.started and e.started<=coalesce(a.ended,'infinity'))
 union all select 'profile:'||p.id,p.role,case when p.manual_role_override then 'Designação administrativa' else 'Cargo institucional' end,'GOVRP',p.role_assigned_at,null::timestamptz,60 from person p where p.role not in('Cidadão','Admin','Preso','Prisioneiro') and not exists(select 1 from appointments a where a.role=p.role and a.started<=now() and coalesce(a.ended,'infinity')>now()) and not exists(select 1 from role_history e where e.role=p.role and e.ended is null AND NOT EXISTS(SELECT 1 FROM appointments a WHERE a.role=e.role AND e.started>=a.started AND e.started<=coalesce(a.ended,'infinity')))
 ), clean as(select distinct on(role,started::date) * from all_rows order by role,started::date,priority)
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'role',case x.role when 'Presidente' then 'Presidente da República' when 'Vice-Presidente' then 'Vice-Presidente da República' else x.role end,'institution',x.institution,'type',x.kind,'started_at',x.started,'ended_at',case when x.ended<=now() then x.ended when NOT x.role=ANY(public.official_role_capabilities(p.role)) AND p.role_assigned_at>x.started then p.role_assigned_at else null end,'expected_end_at',x.ended,'active',coalesce(x.started<=now(),true) and coalesce(x.ended>now(),true) and x.role=ANY(public.official_role_capabilities(p.role))) order by (coalesce(x.ended>now(),true) and x.role=ANY(public.official_role_capabilities(p.role))) desc,x.started desc nulls last,x.priority),'[]') from clean x cross join person p;
$$;
revoke all on function private.document_institutional_history(uuid) from public,anon,authenticated;
create function private.refresh_institutional_documents(p_user uuid) returns void language sql security definer set search_path='' as $$
 update public.documents set metadata=coalesce(metadata,'{}')||jsonb_build_object('institutional_appointments',private.document_institutional_history(p_user)) where user_id=p_user and type='CTD' and is_valid;
$$;
revoke all on function private.refresh_institutional_documents(uuid) from public,anon,authenticated;
create function private.on_institutional_document_event() returns trigger language plpgsql security definer set search_path='' as $$declare uid uuid;begin
 if tg_table_name='profiles' then uid:=coalesce(new.id,old.id);
 elsif tg_table_name='government_terms' then perform private.refresh_institutional_documents(coalesce(new.head_id,old.head_id));perform private.refresh_institutional_documents(coalesce(new.original_president_id,old.original_president_id));if tg_op='UPDATE' and new.head_id is distinct from old.head_id then perform private.refresh_institutional_documents(old.head_id);end if;return coalesce(new,old);
 elsif tg_table_name='domain_events' then uid:=new.source_id;
 elsif tg_table_name='election_office_assignments' then uid:=coalesce(new.profile_id,old.profile_id);
 else uid:=coalesce(new.user_id,old.user_id);end if;
 perform private.refresh_institutional_documents(uid);return coalesce(new,old);
end $$;
revoke all on function private.on_institutional_document_event() from public,anon,authenticated;
create trigger institutional_document_profile after update of role,role_assigned_at on public.profiles for each row execute function private.on_institutional_document_event();
create trigger institutional_document_event after insert on public.domain_events for each row when(new.event_type='role_changed') execute function private.on_institutional_document_event();
create trigger institutional_document_government after insert or update or delete on public.government_terms for each row execute function private.on_institutional_document_event();
create trigger institutional_document_office_assignment after insert or update or delete on public.election_office_assignments for each row execute function private.on_institutional_document_event();
create trigger institutional_document_minister after insert or update or delete on public.ministers for each row execute function private.on_institutional_document_event();
create trigger institutional_document_parliament after insert or update or delete on public.parliament_members for each row execute function private.on_institutional_document_event();
CREATE OR REPLACE FUNCTION private.issue_work_document()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if new.type='CTD' then new.metadata:=coalesce(new.metadata,'{}')||jsonb_build_object('employment_contracts',private.document_employment(new.user_id),'institutional_appointments',private.document_institutional_history(new.user_id));end if;return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.get_my_invitations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare government jsonb;vice jsonb;
begin
 if auth.uid() is null then raise exception 'Entre para consultar seus convites.' using errcode='42501';end if;
 if not exists(select 1 from private.admin_development_modes where user_id=auth.uid() and mode<>'normal' and not execute_real) then perform private.maintain_minister_invitations();end if;
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('office',coalesce(m.name,o.role_label),'inviter',p.full_name,'kind','government') order by i.created_at desc),'[]') into government from public.minister_invitations i left join public.government_ministries m on m.id=i.ministry_id left join public.executive_office_definitions o on o.office_key=i.office_key left join public.profiles p on p.id=i.invited_by where i.candidate_id=auth.uid();
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'office','Vice-Presidência · '||coalesce(n.metadata->>'election_name','Chapa eleitoral'),'inviter',n.metadata->>'candidate_name','created_at',n.created_at,'expires_at',e.candidacy_end_date,'kind','vice','status',case when n.metadata->>'status'='pending' and (e.candidacy_end_date<=clock_timestamp() or e.status in ('Finished','Cancelled')) then 'expired' else coalesce(n.metadata->>'status','pending') end,'popup_deferred_at',n.metadata->>'popup_deferred_at','metadata',n.metadata) order by n.created_at desc),'[]') into vice from public.notifications n left join public.elections e on e.id::text=n.metadata->>'election_id' where n.user_id=auth.uid() and n.type='vice_candidacy_invitation';
 return jsonb_build_object('server_now',clock_timestamp(),'items',government||vice);
end $function$
;
update public.documents set metadata=coalesce(metadata,'{}')||jsonb_build_object('employment_contracts',private.document_employment(user_id),'institutional_appointments',private.document_institutional_history(user_id)) where type='CTD' and is_valid;
CREATE OR REPLACE FUNCTION private.reconcile_card_history(p_card uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cards%rowtype;i public.card_invoices%rowtype;t public.transactions%rowtype;pid uuid;remaining numeric;payable numeric;before_state jsonb;old_limit numeric;documented numeric;
begin
 select * into c from public.cards where id=p_card for update;old_limit:=c.used_limit;
 select jsonb_agg(to_jsonb(x)) into before_state from public.card_invoices x where x.card_id=c.id;
 -- Import only real card charges; payments can never enter this set.
 for t in select tx.* from public.transactions tx where tx.metadata->>'card_id'=c.id::text and tx.type in('purchase_card','subscription_payment_card','purchase') and not exists(select 1 from public.card_invoice_items it where it.transaction_id=tx.id and it.entry_kind='charge' and it.voided_at is null) order by tx.created_at,tx.id loop
  select id into pid from public.card_invoices where card_id=c.id and closing_date>=t.created_at::date order by closing_date,id limit 1;
  if pid is null then insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status) values(c.id,c.user_id,current_date+30,current_date+40,0,'open') returning id into pid;end if;
  insert into public.card_invoice_items(invoice_id,transaction_id,description,amount,created_at,reconciliation_note) values(pid,t.id,t.description,t.amount,t.created_at,'Compra vinculada pelo identificador original da transação.');
 end loop;
 -- A prior administrative settlement remains a credit, with its original row.
 for i in select * from public.card_invoices where card_id=c.id and status='paid' and amount=0 loop
  select greatest(0,i.opening_amount+coalesce(sum(case when entry_kind IN('charge','interest') then amount else -amount end),0)) into payable from public.card_invoice_items where invoice_id=i.id and voided_at is null;
  if payable>0 and not exists(select 1 from public.transactions where metadata->>'card_id'=c.id::text and type in('card_payment','invoice_payment')) then insert into public.card_invoice_items(invoice_id,description,amount,entry_kind,reconciliation_note) values(i.id,'Quitação administrativa anterior preservada',payable,'credit','Saldo já estava quitado antes da conciliação; não recriar dívida.');end if;
 end loop;
 perform private.refresh_card_balances(c.id);
 for t in select tx.* from public.transactions tx where tx.metadata->>'card_id'=c.id::text and tx.type in('card_payment','invoice_payment') order by tx.created_at,tx.id loop
  select greatest(0,t.amount-coalesce(sum(it.amount),0)) into remaining from public.card_invoice_items it where it.transaction_id=t.id and it.entry_kind='payment' and it.voided_at is null;
  if remaining<=0 then continue;end if;
  for i in select inv.* from public.card_invoices inv where card_id=c.id and amount>0 and (inv.created_at<=t.created_at or exists(select 1 from public.card_invoice_items it where it.invoice_id=inv.id and it.entry_kind='charge' and it.created_at<=t.created_at)) and (t.metadata->>'invoice_id' is null or inv.id::text=t.metadata->>'invoice_id') order by due_date,created_at,id for update loop
   payable:=least(remaining,i.amount);insert into public.card_invoice_items(invoice_id,transaction_id,description,amount,entry_kind,created_at,reconciliation_note) values(i.id,t.id,t.description,payable,'payment',t.created_at,'Pagamento original conciliado; nenhuma nova cobrança.');remaining:=remaining-payable;perform private.refresh_card_balances(c.id);exit when remaining<=0;
  end loop;
 end loop;
 -- Remove only interest proven to have been assessed on already-paid principal.
 update public.card_invoices inv set interest_amount=least(inv.interest_amount,round(greatest(0,inv.opening_amount+coalesce((select sum(case when it.entry_kind='charge' then it.amount else -it.amount end) from public.card_invoice_items it where it.invoice_id=inv.id and it.voided_at is null and it.created_at<=inv.interest_applied_at),0))*coalesce(inv.interest_rate,0)/100,2)) where inv.card_id=c.id AND NOT EXISTS(SELECT 1 FROM public.card_invoice_items posted WHERE posted.invoice_id=inv.id AND posted.entry_kind='interest' AND posted.voided_at IS NULL) and inv.interest_applied_at is not null and exists(select 1 from public.card_invoice_items it where it.invoice_id=inv.id and it.entry_kind='payment' and it.created_at<=inv.interest_applied_at);
 perform private.refresh_card_balances(c.id);
 select coalesce(sum(amount),0) into documented from public.card_invoices where card_id=c.id;
 if old_limit>documented then
  insert into public.card_invoices(card_id,user_id,closing_date,due_date,amount,status,opening_amount) values(c.id,c.user_id,current_date+30,current_date+40,old_limit-documented,'open',old_limit-documented);
 end if;
 perform private.refresh_card_balances(c.id);
 perform economy_private.audit('card_ledger_reconciled','cards',c.id::text,jsonb_build_object('used_limit',old_limit,'invoices',before_state),jsonb_build_object('used_limit',(select used_limit from public.cards where id=c.id),'invoices',(select jsonb_agg(to_jsonb(x)) from public.card_invoices x where x.card_id=c.id)),'Conciliação de compras, pagamentos e encargos por identificadores persistidos; sem débito ou exclusão de transações.',auth.uid());
end $function$
;
commit;
