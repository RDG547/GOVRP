import { useDomainRealtime } from './use-domain-realtime';

// The server broadcasts only an ID. Consumers read the authorized public projection.
const events = [{ topic: 'citizen-public-profile', broadcast: 'public-profile-changed' }];
export function usePublicProfileChanges(onChanges, enabled = true) {
  useDomainRealtime('public-profiles', 'public', events, onChanges, enabled);
}
