import { useDomainRealtime } from './use-domain-realtime';
// Only company IDs are broadcast. Financial rows remain private under the existing RLS.
const events = [{ topic: 'company-public-identity', broadcast: 'public-company-changed' }];
export function usePublicCompanyChanges(onChanges, enabled = true) {
  useDomainRealtime('public-companies', 'public', events, onChanges, enabled);
}
