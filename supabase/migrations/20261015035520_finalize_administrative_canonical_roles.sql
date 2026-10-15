begin;
-- Apply after the code recognizes independent technical administrators.
-- Convert legacy technical labels; subsequent RP office changes preserve membership.
select set_config('govrp.role_change_reason','Administração técnica separada do cargo do personagem. Seu acesso ao Painel Admin foi preservado.',true);
update public.profiles set role='Cidadão',titles=array_remove(coalesce(titles,'{}'),'Admin'),updated_at=clock_timestamp() where role='Admin';
select set_config('govrp.role_change_reason','',true);
notify pgrst,'reload schema';
commit;
