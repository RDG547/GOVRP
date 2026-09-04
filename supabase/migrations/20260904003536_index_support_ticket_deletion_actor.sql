-- Índice de apoio para auditoria dos chamados arquivados.
begin;

create index if not exists support_tickets_deleted_by_idx
  on public.support_tickets(deleted_by)
  where deleted_by is not null;

commit;
