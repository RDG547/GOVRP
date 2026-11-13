BEGIN;

-- Salary records are not broadcast directly: their table currently has
-- a public SELECT policy. Notify only the actual recipient through the
-- already-published, owner-RLS-protected notifications table.
-- The payload intentionally excludes amount, account and salary_snapshot.
CREATE UNIQUE INDEX IF NOT EXISTS salary_payment_received_notice_once
  ON public.notifications(user_id, (metadata->>'salary_payment_id'))
  WHERE type='salary_payment_received' AND metadata ? 'salary_payment_id';

CREATE OR REPLACE FUNCTION private.notify_salary_payment_received()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='' AS $$
BEGIN
  INSERT INTO public.notifications(user_id,type,content,link,metadata)
  VALUES (
    NEW.user_id,
    'salary_payment_received',
    'Seu pagamento de salário foi confirmado.',
    '/services/bank',
    jsonb_build_object('salary_payment_id', NEW.id)
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_salary_payment_received()
  FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS salary_payment_received_realtime_event
  ON public.salary_payments;
CREATE TRIGGER salary_payment_received_realtime_event
  AFTER INSERT ON public.salary_payments
  FOR EACH ROW EXECUTE FUNCTION private.notify_salary_payment_received();

COMMIT;
