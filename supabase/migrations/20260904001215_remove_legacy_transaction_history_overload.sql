begin;
drop function if exists public.get_admin_transaction_history(integer,integer,text,text,text,date,date,numeric,numeric,uuid,uuid,text);
notify pgrst,'reload schema';
commit;
