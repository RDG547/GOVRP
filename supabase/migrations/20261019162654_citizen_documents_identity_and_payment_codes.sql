begin;
-- Support registered 47-digit RP bills and exact historic service references. Do not
-- pretend to process real bank barcodes or 48-digit utility collections.
alter function public.validate_and_get_bill(text) set schema private;
alter function private.validate_and_get_bill(text) rename to validate_registered_rp_bill;
revoke all on function private.validate_registered_rp_bill(text) from public,anon,authenticated;
create function public.validate_and_get_bill(p_bill_code text) returns json language plpgsql stable security definer set search_path='' as $$declare code text:=regexp_replace(coalesce(p_bill_code,''),'[.[:space:]-]','','g');begin
 if auth.uid() is null then raise exception 'Entre para verificar seu boleto.' using errcode='42501';end if;
 if code!~'^[0-9]{47}$' then
  -- Historic service/fine references stay usable only for their registered payer.
  if btrim(p_bill_code)~'^[A-Za-z][A-Za-z0-9-]{3,79}$' and exists(select 1 from public.bills_of_exchange where bill_code=btrim(p_bill_code) and (payer_id is null or payer_id=auth.uid() or public.user_can_manage_national_bank(auth.uid()))) then code:=btrim(p_bill_code);
  else return json_build_object('success',false,'status','invalid','message','Código inválido: use a linha de 47 dígitos ou uma referência antiga emitida pelo GOVRP.');end if;
 end if;
 return private.validate_registered_rp_bill(code);
end $$;
alter function public.pay_boleto(text) set schema private;
alter function private.pay_boleto(text) rename to pay_registered_rp_bill;
revoke all on function private.pay_registered_rp_bill(text) from public,anon,authenticated;
create function public.pay_boleto(p_bill_code text) returns json language plpgsql security definer set search_path='' as $$declare code text:=regexp_replace(coalesce(p_bill_code,''),'[.[:space:]-]','','g');begin
 if auth.uid() is null then raise exception 'Entre para pagar seu boleto.' using errcode='42501';end if;
 if code!~'^[0-9]{47}$' then
  -- Historic service/fine references stay usable only for their registered payer.
  if btrim(p_bill_code)~'^[A-Za-z][A-Za-z0-9-]{3,79}$' and exists(select 1 from public.bills_of_exchange where bill_code=btrim(p_bill_code) and (payer_id is null or payer_id=auth.uid() or public.user_can_manage_national_bank(auth.uid()))) then code:=btrim(p_bill_code);
  else return json_build_object('success',false,'status','invalid','message','Código inválido: use a linha de 47 dígitos ou uma referência antiga emitida pelo GOVRP.');end if;
 end if;
 return private.pay_registered_rp_bill(code);
end $$;
create or replace function public.pay_boleto(p_bill_code text,p_amount numeric) returns json language plpgsql security definer set search_path='' as $$declare checked json;begin
 checked:=public.validate_and_get_bill(p_bill_code);if not coalesce((checked->>'success')::boolean,false) then return checked;end if;
 if p_amount is distinct from (checked->>'amount')::numeric then return json_build_object('success',false,'message','O valor deve corresponder à cobrança registrada.');end if;
 return public.pay_boleto(p_bill_code);
end $$;
revoke all on function public.validate_and_get_bill(text),public.pay_boleto(text),public.pay_boleto(text,numeric) from public,anon;
grant execute on function public.validate_and_get_bill(text),public.pay_boleto(text),public.pay_boleto(text,numeric) to authenticated;

create function public.get_bank_holder_limits(p_user_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not public.user_can_manage_national_bank(auth.uid()) then raise exception 'Consulta restrita à gestão do Banco Nacional.' using errcode='42501';end if;
 return jsonb_build_object('accounts',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'user_id',user_id,'account_number',account_number,'agency_number',agency_number)),'[]') from public.accounts where user_id=p_user_id),'cards',(select coalesce(jsonb_agg((to_jsonb(c)-'cvv'-'card_number')||jsonb_build_object('card_number','••••'||right(c.card_number,4))),'[]') from public.cards c where c.user_id=p_user_id));
end $$;
revoke all on function public.get_bank_holder_limits(uuid) from public,anon;
grant execute on function public.get_bank_holder_limits(uuid) to authenticated;

create function public.get_public_admin_badges(p_ids uuid[]) returns table(user_id uuid,is_admin boolean) language plpgsql stable security definer set search_path='' as $$begin
 if cardinality(p_ids)>100 then raise exception 'Consulte até cem identidades por vez.';end if;
 return query select p.id,exists(select 1 from private.platform_admins a where a.user_id=p.id) from public.profiles p where p.id=any(p_ids) and p.deleted_at is null;
end $$;
revoke all on function public.get_public_admin_badges(uuid[]) from public;
grant execute on function public.get_public_admin_badges(uuid[]) to anon,authenticated;
create function private.admin_identity_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 update public.profiles set updated_at=clock_timestamp() where id=coalesce(new.user_id,old.user_id);return coalesce(new,old);
end $$;
create trigger admin_identity_changed after insert or delete on private.platform_admins for each row execute function private.admin_identity_changed();
revoke all on function private.admin_identity_changed() from public,anon,authenticated;

alter table public.business_employees add column role_history jsonb not null default '[]';
create function private.snapshot_employee_role() returns trigger language plpgsql security definer set search_path='' as $$declare title text;begin
 if new.role_template_id is distinct from old.role_template_id or new.role is distinct from old.role then
  select name into title from public.business_role_templates where id=old.role_template_id;
  new.role_history:=old.role_history||jsonb_build_array(jsonb_build_object('role',coalesce(title,old.role),'from',coalesce(old.role_history->-1->>'until',old.hired_at::text),'until',clock_timestamp()));
 end if;return new;
end $$;
create trigger snapshot_employee_role before update of role_template_id,role on public.business_employees for each row execute function private.snapshot_employee_role();
create function private.document_employment(p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'company',b.name,'role',coalesce(t.name,e.role),'hired_at',e.hired_at,'fired_at',e.fired_at,'history',e.role_history) order by (e.fired_at is null) desc,e.hired_at desc),'[]') from public.business_employees e join public.businesses b on b.id=e.business_id left join public.business_role_templates t on t.id=e.role_template_id where e.profile_id=p_user and not e.is_npc;
$$;
create function private.update_work_document() returns trigger language plpgsql security definer set search_path='' as $$declare uid uuid;begin
 uid:=coalesce(new.profile_id,old.profile_id);if uid is not null then update public.documents set metadata=coalesce(metadata,'{}')||jsonb_build_object('employment_contracts',private.document_employment(uid)) where user_id=uid and type='CTD' and is_valid;end if;return coalesce(new,old);
end $$;
create trigger update_work_document after insert or update or delete on public.business_employees for each row execute function private.update_work_document();
create function private.issue_work_document() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.type='CTD' then new.metadata:=coalesce(new.metadata,'{}')||jsonb_build_object('employment_contracts',private.document_employment(new.user_id));end if;return new;
end $$;
create trigger issue_work_document before insert on public.documents for each row execute function private.issue_work_document();
update public.documents set metadata=coalesce(metadata,'{}')||jsonb_build_object('employment_contracts',private.document_employment(user_id)) where type='CTD' and is_valid;
revoke all on function private.snapshot_employee_role(),private.document_employment(uuid),private.update_work_document(),private.issue_work_document() from public,anon,authenticated;
commit;
