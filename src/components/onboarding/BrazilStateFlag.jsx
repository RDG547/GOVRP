import React, { lazy, Suspense } from 'react';

const OfficialStateFlag = lazy(() => import('br-state-flags').then((module) => ({ default: module.Flag })));

const BrazilStateFlag = ({ code, className = '' }) => (
  <span className={`inline-flex shrink-0 overflow-hidden rounded-sm border border-white/20 bg-white ${className}`}>
    <Suspense fallback={<span className="flex h-full w-full items-center justify-center bg-slate-100 text-[7px] font-bold text-slate-700">{code}</span>}>
      <OfficialStateFlag uf={code} locale="pt-BR" className="h-full w-full" preserveAspectRatio="xMidYMid slice" />
    </Suspense>
  </span>
);

export default BrazilStateFlag;
