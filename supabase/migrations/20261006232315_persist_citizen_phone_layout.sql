begin;
create or replace function public.save_phone_app_order(p_order jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare allowed text[]:=array['/services/bank','/services/x','/services/business','/services/internet','/services/phone','/services/national-housing','/services/my-work','/news','/services/health','/services/stock-exchange']; result jsonb;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para organizar os aplicativos.' using errcode='42501'; end if;
 if p_order is null or jsonb_typeof(p_order)<>'array' then raise exception 'Escolha uma ordem válida para os aplicativos.' using errcode='22023';end if;
 if jsonb_array_length(p_order)<>cardinality(allowed) or exists(select 1 from jsonb_array_elements(p_order) v where jsonb_typeof(v)<>'string')
 or (select count(distinct v) from jsonb_array_elements_text(p_order) v)<>cardinality(allowed)
 or exists(select 1 from jsonb_array_elements_text(p_order) v where not(v=any(allowed))) then raise exception 'A lista deve conter cada aplicativo uma única vez.' using errcode='22023';end if;
 update public.profiles set ui_preferences=coalesce(ui_preferences,'{}'::jsonb)||jsonb_build_object('phone_app_order',p_order)
 where id=auth.uid() and deleted_at is null returning ui_preferences into result;
 if result is null then raise exception 'Conta indisponível.' using errcode='42501';end if;
 return result;
end $$;
revoke all on function public.save_phone_app_order(jsonb) from public,anon;
grant execute on function public.save_phone_app_order(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
