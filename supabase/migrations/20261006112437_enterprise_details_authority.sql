begin;
create or replace function public.update_enterprise_details(
  p_enterprise_id uuid,p_name text,p_sector text,p_description text,p_market_value numeric,p_health_score numeric
) returns public.state_enterprises language plpgsql security definer set search_path='' as $$
declare e public.state_enterprises%rowtype; updated public.state_enterprises%rowtype;
begin
  select * into e from public.state_enterprises where id=p_enterprise_id for update;
  if not coalesce(public.can_manage_state_enterprise(e.id),false) then
    raise exception 'Você não tem permissão para administrar esta empresa.' using errcode='42501';
  end if;
  if char_length(btrim(coalesce(p_name,''))) not between 3 and 120 or char_length(coalesce(p_description,''))>3000
    or p_sector is null or p_sector not in('Habitação','Comércio Varejista','Marketplace','Banco Nacional','Internet','Energia Elétrica','Água','Telefonia','Gás','Outros')
    or p_market_value is null or p_market_value not between 0 and 1000000000000
    or p_health_score is null or p_health_score not between 0 and 100 then
    raise exception 'Confira o nome, setor, descrição, valor de mercado e saúde operacional da empresa.' using errcode='22023';
  end if;
  if e.is_system and p_sector<>e.sector then
    raise exception 'O setor deste serviço essencial é fixo para preservar sua integração.' using errcode='22023';
  end if;
  update public.state_enterprises set name=btrim(p_name),sector=p_sector,description=btrim(coalesce(p_description,'')),
    market_value=round(p_market_value,2),health_score=p_health_score,updated_at=clock_timestamp()
    where id=e.id returning * into updated;
  perform economy_private.audit('state_enterprise_details_updated','state_enterprise',e.id::text,to_jsonb(e),to_jsonb(updated),'Atualização dos dados da empresa.',auth.uid());
  if not e.is_privatized then
    insert into public.dou_entries(title,summary,content,type,source_id)
    values('Atualização de Estatal: '||updated.name,'Dados institucionais da estatal atualizados.',
      'A empresa estatal '||updated.name||', do setor '||updated.sector||', teve seus dados atualizados pela gestão autorizada.','Decreto',gen_random_uuid());
  end if;
  return updated;
end $$;
revoke all on function public.update_enterprise_details(uuid,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.update_enterprise_details(uuid,text,text,text,numeric,numeric) to authenticated;
notify pgrst,'reload schema';
commit;
