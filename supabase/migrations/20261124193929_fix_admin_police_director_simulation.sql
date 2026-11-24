-- Align police director simulation with the canonical official role; retain legacy alias compatibility.
CREATE OR REPLACE FUNCTION public.set_admin_development_mode(p_mode text, p_simulated_role text DEFAULT NULL::text, p_execute_real boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.is_admin(auth.uid()) then raise exception 'Somente administradores podem utilizar o modo de desenvolvimento.' using errcode='42501';end if;
 if p_mode is null or p_mode not in('normal','total','simulate') then raise exception 'Selecione um modo válido.';end if;
 if p_mode='simulate' and p_simulated_role in ('Delegado','Diretor da Polícia Federal') then p_simulated_role := 'Diretor-Geral de Polícia'; end if;
 if p_mode='simulate' and (p_simulated_role is null or p_simulated_role not in('Cidadão','Presidente','Vice-Presidente','Deputado','Senador','Policial','Diretor-Geral de Polícia','Promotor','Procurador-Geral da República','Juiz Federal','Ministro','Empresário','Agente Secreto','Militar','Presidente do STF','Presidente do Banco Nacional','Presidente do Portal Eleitoral')) then raise exception 'Selecione um cargo válido para simular.';end if;
 if coalesce(p_execute_real,false) and p_mode<>'total' then raise exception 'A execução administrativa real exige Acesso Total.';end if;
 insert into private.admin_development_modes(user_id,mode,simulated_role,execute_real) values(auth.uid(),p_mode,case when p_mode='simulate' then p_simulated_role end,coalesce(p_execute_real,false))
 on conflict(user_id) do update set mode=excluded.mode,simulated_role=excluded.simulated_role,execute_real=excluded.execute_real,updated_at=clock_timestamp();
 insert into public.security_audit_log(action,target_table,target_id,actor_id,actor_role,metadata)
 values('admin_development_mode_changed','admin_development_modes',auth.uid()::text,auth.uid(),'Admin',jsonb_build_object('mode',p_mode,'simulated_role',p_simulated_role,'impacts_production',false,'execution',case when p_execute_real then 'real_enabled' else 'preview' end));
 return public.get_admin_development_state();
end $function$;
