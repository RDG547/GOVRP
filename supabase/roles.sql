-- Custom roles referenced by GRANTs in the database schema.
-- On the hosted project this role is managed via the Supabase dashboard;
-- locally it must exist before migrations run, or GRANT statements fail.
do $$
begin
  if not exists (select from pg_roles where rolname = 'admin_user') then
    create role admin_user nologin;
  end if;
end
$$;
