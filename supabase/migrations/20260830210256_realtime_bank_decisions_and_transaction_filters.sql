begin;

-- Toda decisão do Banco Nacional passa a produzir um registro imutável e uma
-- notificação para o solicitante. O gatilho cobre tanto as RPCs quanto futuras
-- rotas administrativas autorizadas.
create or replace function public.audit_bank_application_decision()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_kind text;
  v_action text;
begin
  if new.status is not distinct from old.status
     or old.status not in ('Pendente','pending')
     or new.status not in ('Aprovado','approved','Rejeitado','rejected') then
    return new;
  end if;

  v_kind := case when tg_table_name='credit_card_applications' then 'cartão' else 'empréstimo' end;
  v_action := case when new.status in ('Aprovado','approved') then 'approved' else 'rejected' end;

  perform economy_private.audit(
    'bank_application_'||v_action,
    tg_table_name,
    new.id::text,
    to_jsonb(old),
    to_jsonb(new),
    coalesce(new.admin_feedback,new.feedback,'Decisão registrada pelo Banco Nacional.'),
    new.reviewed_by
  );

  -- A aprovação de cartão já envia uma notificação enriquecida na RPC.
  if tg_table_name<>'credit_card_applications' or v_action<>'approved' then
    insert into public.notifications(user_id,sender_id,type,content,link,is_read,metadata,created_at)
    values(
      new.user_id,
      new.reviewed_by,
      'bank_'||case when tg_table_name='credit_card_applications' then 'credit' else 'loan' end||'_review',
      'Sua solicitação de '||v_kind||' foi '||case when v_action='approved' then 'aprovada' else 'rejeitada' end||' pelo Banco Nacional.',
      '/services/bank',
      false,
      jsonb_build_object(
        'application_id',new.id,
        'decision',v_action,
        'feedback',coalesce(new.admin_feedback,new.feedback)
      ),
      clock_timestamp()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists credit_card_application_decision_audit on public.credit_card_applications;
create trigger credit_card_application_decision_audit
after update of status on public.credit_card_applications
for each row execute function public.audit_bank_application_decision();

drop trigger if exists loan_application_decision_audit on public.loan_applications;
create trigger loan_application_decision_audit
after update of status on public.loan_applications
for each row execute function public.audit_bank_application_decision();

do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then
    null;
  end;
end;
$$;

create or replace function public.block_economic_audit_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'AUDIT_LOG_IS_IMMUTABLE' using errcode='42501';
end;
$$;

drop trigger if exists economic_audit_immutable on public.economic_audit_log;
create trigger economic_audit_immutable
before update or delete on public.economic_audit_log
for each row execute function public.block_economic_audit_mutation();

revoke insert,update,delete on public.economic_audit_log from anon,authenticated;

-- Visão administrativa paginada com filtros completos. A assinatura ampliada
-- preserva a RPC anterior para clientes antigos enquanto a interface nova passa
-- todos os filtros explicitamente.
create or replace function public.get_admin_transaction_history(
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default null,
  p_type text default null,
  p_status text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_min_amount numeric default null,
  p_max_amount numeric default null,
  p_sender_id uuid default null,
  p_recipient_id uuid default null,
  p_sort text default 'newest'
)
returns table(
  id uuid,
  created_at timestamptz,
  type text,
  description text,
  amount numeric,
  currency text,
  status text,
  sender_user_id uuid,
  sender_name text,
  sender_username text,
  sender_account_id uuid,
  sender_account_number text,
  recipient_user_id uuid,
  recipient_name text,
  recipient_username text,
  recipient_account_id uuid,
  recipient_account_number text,
  fee_amount numeric,
  tax_amount numeric,
  reference text,
  idempotency_key uuid,
  metadata jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_limit integer:=least(100,greatest(5,coalesce(p_page_size,25)));
  v_offset integer:=(greatest(1,coalesce(p_page,1))-1)*least(100,greatest(5,coalesce(p_page_size,25)));
  v_sort text:=case when p_sort in ('newest','oldest','amount_desc','amount_asc') then p_sort else 'newest' end;
begin
  if not public.economic_has_role(array['Admin']) then
    raise exception 'ADMIN_REQUIRED' using errcode='42501';
  end if;

  return query
  select
    transaction.id,
    transaction.created_at,
    transaction.type,
    transaction.description,
    transaction.amount,
    transaction.currency,
    transaction.status,
    sender.id,
    coalesce(nullif(sender.full_name,''),nullif(sender.username,'')),
    sender.username,
    sender_account.id,
    sender_account.account_number::text,
    recipient.id,
    coalesce(nullif(recipient.full_name,''),nullif(recipient.username,'')),
    recipient.username,
    recipient_account.id,
    recipient_account.account_number::text,
    case
      when coalesce(transaction.metadata->>'fee_amount','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (transaction.metadata->>'fee_amount')::numeric
      when coalesce(transaction.metadata->>'fee','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (transaction.metadata->>'fee')::numeric
      else 0
    end,
    case
      when coalesce(transaction.metadata->>'tax_amount','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (transaction.metadata->>'tax_amount')::numeric
      when coalesce(transaction.metadata->>'tax','') ~ '^-?[0-9]+(\.[0-9]+)?$' then (transaction.metadata->>'tax')::numeric
      else 0
    end,
    coalesce(
      transaction.metadata->>'reference',
      transaction.metadata->>'source_reference',
      transaction.metadata->>'order_id',
      transaction.metadata->>'business_id'
    ),
    transaction.idempotency_key,
    transaction.metadata,
    count(*) over()
  from public.transactions transaction
  left join public.accounts sender_account on sender_account.id=transaction.from_account_id
  left join public.profiles sender on sender.id=sender_account.user_id
  left join public.accounts recipient_account on recipient_account.id=transaction.to_account_id
  left join public.profiles recipient on recipient.id=recipient_account.user_id
  where (p_type is null or p_type='' or transaction.type=p_type)
    and (p_status is null or p_status='' or lower(transaction.status)=lower(p_status))
    and (p_date_from is null or transaction.created_at>=p_date_from::timestamptz)
    and (p_date_to is null or transaction.created_at<(p_date_to+1)::timestamptz)
    and (p_min_amount is null or transaction.amount>=p_min_amount)
    and (p_max_amount is null or transaction.amount<=p_max_amount)
    and (p_sender_id is null or sender.id=p_sender_id)
    and (p_recipient_id is null or recipient.id=p_recipient_id)
    and (
      p_search is null or btrim(p_search)='' or
      transaction.description ilike '%'||btrim(p_search)||'%' or
      transaction.id::text ilike '%'||btrim(p_search)||'%' or
      transaction.idempotency_key::text ilike '%'||btrim(p_search)||'%' or
      sender.full_name ilike '%'||btrim(p_search)||'%' or
      sender.username ilike '%'||btrim(p_search)||'%' or
      sender_account.account_number::text ilike '%'||btrim(p_search)||'%' or
      recipient.full_name ilike '%'||btrim(p_search)||'%' or
      recipient.username ilike '%'||btrim(p_search)||'%' or
      recipient_account.account_number::text ilike '%'||btrim(p_search)||'%'
    )
  order by
    case when v_sort='newest' then transaction.created_at end desc,
    case when v_sort='oldest' then transaction.created_at end asc,
    case when v_sort='amount_desc' then transaction.amount end desc,
    case when v_sort='amount_asc' then transaction.amount end asc,
    transaction.id desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.audit_bank_application_decision() from public,anon,authenticated;
revoke all on function public.block_economic_audit_mutation() from public,anon,authenticated;
revoke all on function public.get_admin_transaction_history(integer,integer,text,text,text,date,date,numeric,numeric,uuid,uuid,text) from public,anon;
grant execute on function public.get_admin_transaction_history(integer,integer,text,text,text,date,date,numeric,numeric,uuid,uuid,text) to authenticated,service_role;

commit;
