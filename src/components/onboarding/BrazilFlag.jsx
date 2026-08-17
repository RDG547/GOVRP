import React, { useId } from 'react';

const BrazilFlag = ({ className = '' }) => {
  const clipId = `brazil-citizen-${useId().replace(/:/g, '')}`;

  return (
    <svg viewBox="0 0 240 230" className={`drop-shadow-[0_0_16px_rgba(34,197,94,0.35)] ${className}`} role="img" aria-label="Mapa do Brasil com as cores da bandeira nacional">
      <defs><clipPath id={clipId}><path d="M87 7l30 10 20-5 18 15 28 7 4 20 25 16-10 25 8 18-18 15-4 29-19 6-11 27-21 11-8 24-17-5-11-24-18-9-4-27-18-15 5-24-17-23 13-18-5-28 23-13 14-25 22 4z" /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}><rect width="240" height="230" fill="#168148" /><path d="M120 31L211 115 120 199 29 115z" fill="#F4D03F" /><circle cx="120" cy="115" r="42" fill="#174A8B" /><path d="M77 106c28-8 57-2 86 18" fill="none" stroke="#fff" strokeWidth="7" /></g>
      <path d="M87 7l30 10 20-5 18 15 28 7 4 20 25 16-10 25 8 18-18 15-4 29-19 6-11 27-21 11-8 24-17-5-11-24-18-9-4-27-18-15 5-24-17-23 13-18-5-28 23-13 14-25 22 4z" fill="none" stroke="#86efac" strokeWidth="4" />
    </svg>
  );
};

export default BrazilFlag;
