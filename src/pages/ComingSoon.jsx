import React from 'react';
import PlatformStatePage from '@/components/PlatformStatePage';
export default function ComingSoon({serviceName='Este recurso',serviceDescription='Estamos preparando uma nova experiência para esta área.'}) {
 return <PlatformStatePage kind="coming_soon" serviceName={serviceName} serviceDescription={serviceDescription}/>;
}
