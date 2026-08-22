import React, { useId } from 'react';

// Silhueta do território brasileiro derivada do Natural Earth (domínio público, escala 1:110m)
// via world-atlas, simplificada para 80 pontos.
const BRAZIL_OUTLINE_PATH = 'M209.5 388.8L206.9 383.4L211.1 378.8L205.5 372.2L174.7 353.4L168.4 354.4L206.9 322.6L207.1 314.8L202.2 309.2L197.4 311.1L200.6 294.5L189.9 293.9L186.1 278.4L165.4 275.8L163.1 257.3L169.6 237.9L162 229.1L162.4 219.7L143.9 219.3L140.5 195.3L103.6 182.6L93.1 173.9L93.7 156.4L81.1 158.1L65.3 168.6L43.3 168.5L43.9 153.8L27.4 159.3L17.4 153.5L19.4 149.4L10 134.8L18.4 126.1L20.6 113L49.6 103.6L54.2 72.8L48.4 56.7L56.1 52.4L50.5 51.4L50.4 45.3L72.4 42.2L77 51L91.7 54.3L112.8 40.6L104.1 37.8L98.8 22.7L115.5 25.4L136 18L138.3 11.6L145.6 13.4L149.9 23.6L145.6 35.3L154.8 49.2L184.1 44.3L184.4 37.6L213.7 41.4L229.4 21.3L237.3 43.5L242.4 45.1L235.4 59.8L238.4 62.7L255.6 64.2L255.9 73.9L263.3 67.6L291.5 77L294.7 88L305.9 85L339.2 89.8L365.9 108.6L381.6 111.8L390 133L386.2 149L351.8 188.3L346.1 234.9L329.8 274.3L319.7 284.3L294 288L265 302.8L256.8 312.4L253 339.5L209.5 388.8Z';

const BrazilFlag = ({ className = '' }) => {
  const clipId = `brazil-citizen-${useId().replace(/:/g, '')}`;

  return (
    <svg viewBox="0 0 400 400" className={`drop-shadow-[0_0_16px_rgba(34,197,94,0.35)] ${className}`} role="img" aria-label="Mapa do Brasil com as cores da bandeira nacional">
      <defs><clipPath id={clipId}><path d={BRAZIL_OUTLINE_PATH} /></clipPath></defs>
      <g clipPath={`url(#${clipId})`}>
        <rect width="400" height="400" fill="#168148" />
        <path d="M200 45L355 200 200 355 45 200z" fill="#F4D03F" />
        <circle cx="200" cy="200" r="72" fill="#174A8B" />
        <path d="M130 185c48-14 95-3 140 30" fill="none" stroke="#fff" strokeWidth="12" />
      </g>
      <path d={BRAZIL_OUTLINE_PATH} fill="none" stroke="#86efac" strokeWidth="4" />
    </svg>
  );
};

export default BrazilFlag;
