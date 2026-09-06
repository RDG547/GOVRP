export function isCurrentElection(election, now = Date.now()) {
  if (['Finished', 'Cancelled', 'Canceled', 'Archived', 'Finalizada', 'Cancelada'].includes(election.status)) return false;
  const start = Date.parse(election.candidacy_start_date || election.voting_start_date);
  const end = Date.parse(election.voting_end_date);
  return Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end;
}
