import React from 'react';
import PlatformStatePage from '@/components/PlatformStatePage';
export default function MaintenanceMode({serviceName='GOV.RP',serviceDescription='Esta área está passando por melhorias temporárias.'}) {
 return <PlatformStatePage kind="maintenance" serviceName={serviceName} serviceDescription={serviceDescription}/>;
}
