-- Script to fix auto-closing of expired parliament votings by bypassing RLS restrictions for citizens

-- Create a SECURITY DEFINER function to update bill status
CREATE OR REPLACE FUNCTION update_bill_status(p_bill_id UUID, p_new_status TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE bills
  SET status = p_new_status
  WHERE id = p_bill_id;
END;
$$;

-- Create a SECURITY DEFINER function to close a voting session
CREATE OR REPLACE FUNCTION close_parliament_voting(p_voting_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE parliament_votings
  SET status = 'closed'
  WHERE id = p_voting_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION update_bill_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION close_parliament_voting(UUID) TO authenticated;
