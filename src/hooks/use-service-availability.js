import { usePlatformAccess } from '@/contexts/PlatformAccessContext';
export function useServiceAvailability(){
 const access=usePlatformAccess();
 return access||{settings:{},loading:true,bypass:false};
}
