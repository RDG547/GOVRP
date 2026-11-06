import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Globe2,
  Loader2,
  Minus,
  MousePointer2,
  Plus,
  Search,
  X,
} from 'lucide-react';
import {
  geoArea,
  geoCentroid,
  geoGraticule10,
  geoOrthographic,
  geoPath,
} from 'd3-geo';
import { feature as topoFeature } from 'topojson-client';
import isoCountries from 'iso-3166-1';
import worldAtlas from 'world-atlas/countries-110m.json';
import { loadCountryProfile,preloadCountryBasics,getCountryBasics } from '@/lib/countryProfile';
import { useCountryRpProfile } from '@/hooks/use-country-rp-profile';

const VIEWBOX_SIZE = 620;
const GLOBE_CENTER = VIEWBOX_SIZE / 2;
const BASE_SCALE = 238;
const EARTH_SURFACE_KM2 = 510_072_000;
const INITIAL_ROTATION = [-18, -8, 0];
const MIN_ZOOM = 0.82;
const MAX_ZOOM = 1.28;

const regionNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['pt-BR'], { type: 'region' })
  : null;

const rawCountries = topoFeature(
  worldAtlas,
  worldAtlas.objects.countries,
).features;

const specialTerritories = {
  Kosovo: { id: 'XKX', alpha2: 'XK', alpha3: 'XKX', name: 'Kosovo' },
  'N. Cyprus': { id: 'XNC', alpha2: null, alpha3: null, flag: '🇨🇾', name: 'Chipre do Norte' },
  Somaliland: { id: 'XSL', alpha2: null, alpha3: null, flag: '🇸🇴', name: 'Somalilândia' },
};

const toFlagEmoji = (alpha2) => {
  if (!alpha2) return '🌐';

  return alpha2
    .toUpperCase()
    .split('')
    .map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397))
    .join('');
};

const countries = rawCountries.map((country) => {
  const iso = isoCountries.whereNumeric(String(country.id));
  const specialTerritory = specialTerritories[country.properties?.name];
  const alpha2 = iso?.alpha2 ?? specialTerritory?.alpha2 ?? null;
  const alpha3 = iso?.alpha3 ?? specialTerritory?.alpha3 ?? null;
  const localizedName = alpha2 ? regionNames?.of(alpha2) : null;
  const area = (geoArea(country) / (4 * Math.PI)) * EARTH_SURFACE_KM2;

  return {
    ...country,
    id: alpha3 || specialTerritory?.id || `${country.id}:${country.properties?.name}`,
    info: {
      alpha2,
      alpha3,
      area,
      centroid: geoCentroid(country),
      flag: specialTerritory?.flag || toFlagEmoji(alpha2),
      name: localizedName || specialTerritory?.name || country.properties?.name || 'Território sem nome',
    },
  };
});

const countriesById = new Map(countries.map((country) => [String(country.id), country]));
const sortedCountries = [...countries].sort((a, b) => a.info.name.localeCompare(b.info.name, 'pt-BR'));
const graticule = geoGraticule10();

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeLongitude = (longitude) => {
  const normalized = (longitude + 540) % 360;
  return normalized - 180;
};

const formatArea = (area) => `${Math.round(area).toLocaleString('pt-BR')} km²`;

const formatGdp = (value, currency = 'USD') => {
  if (value === null || value === undefined) return 'Indisponível';

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'USD',
    notation: 'compact',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatPopulation = (value) => {
  if (value === null || value === undefined) return 'Indisponível';

  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
};

const formatGrowth = (value) => {
  if (value === null || value === undefined) return 'Indisponível';

  return `${value >= 0 ? '+' : ''}${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
};

const formatRate = (value) => {
  if (value === null || value === undefined) return 'Indisponível';

  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
};

const indicatorDetail = (indicator) => {
  if (!indicator) return null;
  if (indicator.year === 'RP') return indicator.source || 'GOV.RP';
  return [indicator.source, indicator.year ? `Referência ${indicator.year}` : null]
    .filter(Boolean)
    .join(' · ') || null;
};

const formatExchange = (rate, base, currency) => {
  if (rate === null || rate === undefined || !currency) return 'Indisponível';

  const formattedRate = rate.toLocaleString('pt-BR', {
    minimumFractionDigits: rate < 10 ? 2 : 0,
    maximumFractionDigits: rate < 1 ? 4 : 2,
  });

  return `${base} 1 = ${currency} ${formattedRate}`;
};

const normalizeSearch = (value) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR');

const ProfileMetric = ({ label, value, detail, loading, multiline = false }) => (
  <div className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.035] px-2.5 py-2">
    <dt className="text-[8px] font-semibold uppercase tracking-[0.12em] text-slate-500 sm:text-[9px]">{label}</dt>
    {loading ? (
      <dd className="mt-1.5 h-3.5 w-4/5 animate-pulse rounded bg-slate-700/70" />
    ) : (
      <dd
        className={`mt-0.5 text-[11px] font-semibold text-slate-100 sm:text-xs ${
          multiline ? 'break-words leading-snug' : 'truncate'
        }`}
        title={value}
      >
        {value}
      </dd>
    )}
    {detail && !loading && <p className="mt-0.5 text-[8px] text-slate-500 sm:text-[9px]">{detail}</p>}
  </div>
);

const InteractiveGlobe = () => {
  const [rotation, setRotation] = useState(INITIAL_ROTATION);
  const [zoom, setZoom] = useState(1);
  const [isRotationPaused, setIsRotationPaused] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredCountryId, setHoveredCountryId] = useState(null);
  const [selectedCountryId, setSelectedCountryId] = useState(null);
  const [isCountryMenuOpen, setIsCountryMenuOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  useEffect(()=>{void preloadCountryBasics().catch(()=>{});},[]);
  const [countryProfile, setCountryProfile] = useState(null);
  const [profileStatus, setProfileStatus] = useState('idle');
  const rotationPausedRef = useRef(false);
  const resumeRotationTimer = useRef(null);
  const countryMenuRef = useRef(null);
  const pointerState = useRef({
    active: false,
    moved: false,
    pointerId: null,
    pressedCountryId: null,
    startX: 0,
    startY: 0,
    startRotation: INITIAL_ROTATION,
  });

  const selectedCountry = selectedCountryId
    ? countriesById.get(String(selectedCountryId))
    : null;
  const hoveredCountry = hoveredCountryId
    ? countriesById.get(String(hoveredCountryId))
    : null;
  const { profile: displayedCountryProfile, rpContext } = useCountryRpProfile(
    selectedCountry,
    countryProfile,
  );
  const filteredCountries = useMemo(() => {
    const normalizedQuery = normalizeSearch(countrySearch.trim());

    if (!normalizedQuery) return sortedCountries;

    return sortedCountries.filter((country) => (
      normalizeSearch(country.info.name).includes(normalizedQuery)
    ));
  }, [countrySearch]);

  const projection = useMemo(
    () => geoOrthographic()
      .translate([GLOBE_CENTER, GLOBE_CENTER - 18])
      .scale(BASE_SCALE * zoom)
      .rotate(rotation)
      .clipAngle(90)
      .precision(0.35),
    [rotation, zoom],
  );

  const path = useMemo(() => geoPath(projection), [projection]);
  const projectedCountries = useMemo(
    () => countries.map((country) => ({
      country,
      path: path(country),
    })),
    [path],
  );
  const graticulePath = useMemo(() => path(graticule), [path]);

  const pauseRotation = useCallback(() => {
    if (resumeRotationTimer.current) {
      window.clearTimeout(resumeRotationTimer.current);
      resumeRotationTimer.current = null;
    }

    rotationPausedRef.current = true;
    setIsRotationPaused(true);
  }, []);

  const scheduleRotationResume = useCallback(() => {
    if (resumeRotationTimer.current) window.clearTimeout(resumeRotationTimer.current);

    resumeRotationTimer.current = window.setTimeout(() => {
      rotationPausedRef.current = false;
      setIsRotationPaused(false);
      resumeRotationTimer.current = null;
    }, 3000);
  }, []);

  useEffect(() => {
    const rotationInterval = window.setInterval(() => {
      if (rotationPausedRef.current || pointerState.current.active) return;

      setRotation(([longitude, latitude]) => [
        normalizeLongitude(longitude + 0.135),
        latitude,
        0,
      ]);
    }, 32);

    return () => window.clearInterval(rotationInterval);
  }, []);

  useEffect(() => () => {
    if (resumeRotationTimer.current) window.clearTimeout(resumeRotationTimer.current);
  }, []);

  useEffect(() => {
    let isCurrentSelection = true;
    let refreshInterval;

    if (!selectedCountry) {
      setCountryProfile(null);
      setProfileStatus('idle');
      return undefined;
    }

    const cached=getCountryBasics(selectedCountry.info.alpha2);setCountryProfile(cached);setProfileStatus(cached?'refreshing':'loading');
    void preloadCountryBasics().then(()=>{if(isCurrentSelection){setCountryProfile(previous=>previous||getCountryBasics(selectedCountry.info.alpha2));setProfileStatus(previous=>previous==='loading'?'refreshing':previous);}}).catch(()=>{});

    const refreshProfile = (force = false) => loadCountryProfile({
      ...selectedCountry.info,
      force,
    }).then((profile) => {
      if (!isCurrentSelection) return;

      setCountryProfile({...getCountryBasics(selectedCountry.info.alpha2),...profile,capital:getCountryBasics(selectedCountry.info.alpha2)?.capital,economy:{...profile.economy,population:profile.economy?.population||getCountryBasics(selectedCountry.info.alpha2)?.economy?.population}});
      setProfileStatus(profile.unavailable ? 'error' : 'ready');
    }).catch(() => {
      if (!isCurrentSelection) return;

      setProfileStatus('error');
    });

    refreshProfile();
    refreshInterval = window.setInterval(() => refreshProfile(true), 15 * 60 * 1000);

    return () => {
      isCurrentSelection = false;
      window.clearInterval(refreshInterval);
    };
  }, [selectedCountry]);

  useEffect(() => {
    if (!isCountryMenuOpen) return undefined;

    const handleOutsidePointerDown = (event) => {
      if (!countryMenuRef.current?.contains(event.target)) {
        setIsCountryMenuOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === 'Escape') setIsCountryMenuOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isCountryMenuOpen]);

  const selectCountry = useCallback((country) => {
    setSelectedCountryId(String(country.id));
    setHoveredCountryId(null);
    setIsCountryMenuOpen(false);
    setCountrySearch('');
    pauseRotation();
    scheduleRotationResume();

    const [longitude, latitude] = country.info.centroid;
    setRotation([
      normalizeLongitude(-longitude),
      clamp(-latitude, -72, 72),
      0,
    ]);
  }, [pauseRotation, scheduleRotationResume]);

  const handlePointerDown = useCallback((event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    pointerState.current = {
      active: true,
      moved: false,
      pointerId: event.pointerId,
      pressedCountryId: event.target.closest?.('[data-country-id]')?.dataset.countryId ?? null,
      startX: event.clientX,
      startY: event.clientY,
      startRotation: rotation,
    };
    setIsDragging(true);
    pauseRotation();
  }, [pauseRotation, rotation]);

  const handlePointerMove = useCallback((event) => {
    const pointer = pointerState.current;

    if (!pointer.active || pointer.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;

    if (Math.hypot(deltaX, deltaY) > 4) pointer.moved = true;

    setRotation([
      normalizeLongitude(pointer.startRotation[0] + (deltaX * 0.32)),
      clamp(pointer.startRotation[1] - (deltaY * 0.25), -78, 78),
      0,
    ]);
  }, []);

  const finishPointerInteraction = useCallback((event) => {
    const pointer = pointerState.current;

    if (pointer.pointerId !== event.pointerId) return;

    const selectedByTap = event.type === 'pointerup' && !pointer.moved
      ? countriesById.get(String(pointer.pressedCountryId))
      : null;

    pointer.active = false;
    pointer.pointerId = null;
    pointer.pressedCountryId = null;
    setIsDragging(false);

    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (selectedByTap) {
      selectCountry(selectedByTap);
    } else {
      scheduleRotationResume();
    }
  }, [scheduleRotationResume, selectCountry]);

  const changeZoom = useCallback((amount) => {
    setZoom((currentZoom) => clamp(currentZoom + amount, MIN_ZOOM, MAX_ZOOM));
    pauseRotation();
    scheduleRotationResume();
  }, [pauseRotation, scheduleRotationResume]);

  const isProfileLoading = profileStatus === 'loading';
  const economicData = displayedCountryProfile?.economy;
  const exchangeData = displayedCountryProfile?.exchange;
  const governmentData = displayedCountryProfile?.government;
  const regimeData = displayedCountryProfile?.regime;
  const isRpProfile = Boolean(displayedCountryProfile?.rp?.active);

  return (
    <div
      className="group relative isolate h-full w-full overflow-hidden rounded-3xl border border-blue-400/20 bg-[#020611] shadow-[0_28px_90px_rgba(25,80,220,0.24)]"
      aria-label="Globo interativo com territórios de países"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage: [
            'radial-gradient(circle at 15% 22%, rgba(125,211,252,.9) 0 1px, transparent 1.6px)',
            'radial-gradient(circle at 76% 18%, rgba(255,255,255,.8) 0 1px, transparent 1.5px)',
            'radial-gradient(circle at 42% 74%, rgba(96,165,250,.75) 0 1px, transparent 1.4px)',
          ].join(','),
          backgroundPosition: '0 0, 22px 38px, 58px 12px',
          backgroundSize: '91px 91px, 137px 137px, 173px 173px',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(18,73,190,0.16),transparent_64%)]" />

      <div className="absolute left-4 top-4 z-20 flex max-w-[44%] items-center gap-2 rounded-full border border-white/10 bg-slate-950/70 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-blue-100 backdrop-blur-md sm:max-w-[56%] sm:text-xs">
        <Globe2 className="h-4 w-4 shrink-0 text-cyan-300" />
        <span className="truncate">{hoveredCountry?.info.name || 'Planeta GOV.RP'}</span>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isRotationPaused ? 'bg-amber-400' : 'animate-pulse bg-emerald-400'}`} />
      </div>

      <div className="absolute right-4 top-4 z-30 flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/75 p-1.5 shadow-lg backdrop-blur-md">
        <button
          type="button"
          onClick={() => changeZoom(-0.1)}
          className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
          aria-label="Diminuir o globo"
          title="Diminuir"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => changeZoom(0.1)}
          className="rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
          aria-label="Ampliar o globo"
          title="Ampliar"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <svg
        viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
        className={`absolute inset-0 h-full w-full select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        role="img"
        aria-label="Arraste para girar o planeta e clique em um país para consultar suas informações"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
        onPointerLeave={() => {
          if (!pointerState.current.active) setHoveredCountryId(null);
        }}
        style={{ touchAction: 'none' }}
      >
        <defs>
          <radialGradient id="globe-ocean" cx="35%" cy="25%" r="76%">
            <stop offset="0%" stopColor="#1748a6" />
            <stop offset="42%" stopColor="#082b72" />
            <stop offset="78%" stopColor="#041a4c" />
            <stop offset="100%" stopColor="#01081d" />
          </radialGradient>
          <linearGradient id="globe-land" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#1477c9" />
            <stop offset="100%" stopColor="#07346f" />
          </linearGradient>
          <linearGradient id="globe-land-selected" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#67e8f9" />
            <stop offset="100%" stopColor="#2563eb" />
          </linearGradient>
          <filter id="globe-atmosphere" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
          <filter id="globe-selected-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <clipPath id="globe-clip">
            <circle cx={GLOBE_CENTER} cy={GLOBE_CENTER - 18} r={BASE_SCALE * zoom} />
          </clipPath>
        </defs>

        <circle
          cx={GLOBE_CENTER}
          cy={GLOBE_CENTER - 18}
          r={(BASE_SCALE * zoom) + 8}
          fill="none"
          stroke="#1d8cff"
          strokeWidth="13"
          opacity="0.32"
          filter="url(#globe-atmosphere)"
        />
        <circle
          cx={GLOBE_CENTER}
          cy={GLOBE_CENTER - 18}
          r={BASE_SCALE * zoom}
          fill="url(#globe-ocean)"
          stroke="#38bdf8"
          strokeWidth="1.8"
          opacity="0.98"
        />

        <g clipPath="url(#globe-clip)">
          <path
            d={graticulePath || undefined}
            fill="none"
            stroke="#55b7ff"
            strokeWidth="0.55"
            opacity="0.2"
            pointerEvents="none"
          />

          {projectedCountries.map(({ country, path: countryPath }) => {
            const isSelected = String(country.id) === String(selectedCountryId);
            const isHovered = String(country.id) === String(hoveredCountryId);

            return (
              <path
                key={country.id}
                data-country-id={country.id}
                d={countryPath || undefined}
                fill={isSelected ? 'url(#globe-land-selected)' : 'url(#globe-land)'}
                fillOpacity={isHovered && !isSelected ? 0.98 : 0.82}
                stroke={isSelected ? '#d8fbff' : (isHovered ? '#7dd3fc' : '#22b8ff')}
                strokeWidth={isSelected ? 2.2 : (isHovered ? 1.5 : 0.72)}
                vectorEffect="non-scaling-stroke"
                filter={isSelected ? 'url(#globe-selected-glow)' : undefined}
                className="cursor-pointer outline-none transition-[fill-opacity] duration-150"
                onPointerEnter={() => {
                  if (!pointerState.current.active) setHoveredCountryId(String(country.id));
                }}
                onPointerLeave={() => setHoveredCountryId(null)}
              >
                <title>{country.info.name}</title>
              </path>
            );
          })}
        </g>

      </svg>

      <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-20 sm:bottom-4 sm:left-4 sm:right-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selectedCountry?.id || 'globe-help'}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.22 }}
            className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/80 p-3 shadow-2xl backdrop-blur-xl sm:p-4"
          >
            <div className="flex items-center gap-3">
              {selectedCountry ? (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="text-3xl leading-none" aria-hidden="true">{selectedCountry.info.flag}</span>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">Território selecionado</p>
                    <h3 className="truncate text-base font-bold text-white sm:text-lg">{selectedCountry.info.name}</h3>
                  </div>
                </div>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-cyan-300">
                    <MousePointer2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-white">Explore os territórios</p>
                    <p className="truncate text-xs text-slate-400">Arraste o planeta e clique em um país</p>
                  </div>
                </div>
              )}

              <div ref={countryMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => setIsCountryMenuOpen((current) => !current)}
                  className="flex max-w-[145px] items-center gap-2 rounded-xl border border-white/10 bg-slate-900/95 px-2.5 py-2 text-left text-xs text-slate-200 shadow-lg outline-none transition hover:border-cyan-400/40 hover:bg-slate-800 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 sm:max-w-[190px] sm:px-3"
                  aria-haspopup="listbox"
                  aria-expanded={isCountryMenuOpen}
                >
                  <span className="text-base leading-none" aria-hidden="true">
                    {selectedCountry?.info.flag || '🌐'}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {selectedCountry?.info.name || 'Escolher país'}
                  </span>
                  {isCountryMenuOpen
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-cyan-300" />
                    : <ChevronUp className="h-4 w-4 shrink-0 text-cyan-300" />}
                </button>

                <AnimatePresence>
                  {isCountryMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.98 }}
                      transition={{ duration: 0.16 }}
                      className="absolute bottom-full right-0 z-50 mb-2 w-[min(320px,calc(100vw-3.5rem))] overflow-hidden rounded-2xl border border-cyan-300/15 bg-[#07101f]/95 shadow-[0_22px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl"
                    >
                      <div className="border-b border-white/10 p-2.5">
                        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 focus-within:border-cyan-400/50">
                          <Search className="h-4 w-4 shrink-0 text-slate-500" />
                          <input
                            type="search"
                            value={countrySearch}
                            onChange={(event) => setCountrySearch(event.target.value)}
                            placeholder="Buscar país..."
                            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-white outline-none placeholder:text-slate-600"
                            autoFocus
                          />
                        </div>
                      </div>
                      <div className="custom-scrollbar max-h-40 overflow-y-auto p-1.5" role="listbox" aria-label="Países disponíveis">
                        {filteredCountries.map((country) => {
                          const isCurrentCountry = String(country.id) === String(selectedCountryId);

                          return (
                            <button
                              key={country.id}
                              type="button"
                              role="option"
                              aria-selected={isCurrentCountry}
                              onClick={() => selectCountry(country)}
                              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
                                isCurrentCountry
                                  ? 'bg-blue-500/15 text-cyan-100'
                                  : 'text-slate-300 hover:bg-white/[0.06] hover:text-white'
                              }`}
                            >
                              <span className="text-lg leading-none" aria-hidden="true">{country.info.flag}</span>
                              <span className="min-w-0 flex-1 truncate">{country.info.name}</span>
                              {isCurrentCountry && <Check className="h-4 w-4 shrink-0 text-cyan-300" />}
                            </button>
                          );
                        })}
                        {!filteredCountries.length && (
                          <p className="px-3 py-6 text-center text-sm text-slate-500">Nenhum país encontrado.</p>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {selectedCountry && (
                <button
                  type="button"
                  onClick={() => setSelectedCountryId(null)}
                  className="rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  aria-label="Fechar informações do país"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {selectedCountry && (
              <div className="custom-scrollbar mt-3 max-h-[270px] overflow-y-auto border-t border-white/10 pr-1 pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Panorama nacional</p>
                  <div className="flex items-center gap-2">
                    {!isProfileLoading && profileStatus !== 'error' && (
                      <span className={`rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-wider ${
                        isRpProfile
                          ? 'border-cyan-400/25 bg-cyan-400/10 text-cyan-300'
                          : 'border-white/10 bg-white/[0.035] text-slate-500'
                      }`}
                      >
                        {isRpProfile ? 'Dados do GOV.RP' : 'Base real'}
                      </span>
                    )}
                    {isProfileLoading && (
                      <span className="flex items-center gap-1.5 text-[9px] text-cyan-300">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Carregando dados
                      </span>
                    )}
                    {profileStatus === 'error' && (
                      <span className="text-[9px] text-amber-300">Dados externos indisponíveis</span>
                    )}
                  </div>
                </div>

                <section className="rounded-xl border border-cyan-400/10 bg-cyan-400/[0.025] p-2">
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.16em] text-cyan-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    Economia
                  </h4>
                  <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    <ProfileMetric
                      label="PIB nominal em USD"
                      value={formatGdp(economicData?.gdp?.value, economicData?.gdp?.currency)}
                      detail={indicatorDetail(economicData?.gdp)}
                      loading={isProfileLoading}
                    />
                    {economicData?.gdpBrl&&<ProfileMetric label="PIB nominal em BRL" value={formatGdp(economicData.gdpBrl.value,'BRL')} detail={indicatorDetail(economicData.gdpBrl)} loading={isProfileLoading}/>}
                    <ProfileMetric
                      label="Taxa de crescimento"
                      value={formatGrowth(economicData?.growth?.value)}
                      detail={indicatorDetail(economicData?.growth)}
                      loading={isProfileLoading}
                    />
                    <ProfileMetric
                      label="Inflação atual"
                      value={formatRate(economicData?.inflation?.value)}
                      detail={indicatorDetail(economicData?.inflation)}
                      loading={isProfileLoading}
                    />
                    <ProfileMetric
                      label="Taxa de desemprego"
                      value={formatRate(economicData?.unemployment?.value)}
                      detail={indicatorDetail(economicData?.unemployment)}
                      loading={isProfileLoading}
                    />
                    <ProfileMetric
                      label="Câmbio com o dólar"
                      value={formatExchange(exchangeData?.usd, 'US$', exchangeData?.currency)}
                      detail={exchangeData?.date ? `Cotação ${exchangeData.date}` : null}
                      loading={isProfileLoading}
                    />
                    <ProfileMetric
                      label="Câmbio com o euro"
                      value={formatExchange(exchangeData?.eur, '€', exchangeData?.currency)}
                      detail={exchangeData?.date ? `Cotação ${exchangeData.date}` : null}
                      loading={isProfileLoading}
                    />
                  </dl>
                </section>

                <section className="mt-2 rounded-xl border border-blue-400/10 bg-blue-400/[0.025] p-2">
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.16em] text-blue-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                    Demografia e território
                  </h4>
                  <dl className="grid grid-cols-2 gap-1.5">
                    <ProfileMetric label="Capital" value={displayedCountryProfile?.capital||'Não cadastrada'}/><ProfileMetric
                      label="População total"
                      value={formatPopulation(economicData?.population?.value)}
                      detail={indicatorDetail(economicData?.population)}
                      loading={isProfileLoading}
                    />
                    <ProfileMetric
                      label="Área aproximada"
                      value={formatArea(economicData?.area?.value ?? selectedCountry.info.area)}
                      detail={indicatorDetail(economicData?.area) || 'Geometria territorial do globo'}
                    />
                  </dl>
                </section>

                <section className="mt-2 rounded-xl border border-violet-400/10 bg-violet-400/[0.025] p-2">
                  <h4 className="mb-1.5 flex items-center gap-1.5 text-[8px] font-bold uppercase tracking-[0.16em] text-violet-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                    Política e governo
                  </h4>
                  <dl className="grid gap-1.5 sm:grid-cols-3">
                    <ProfileMetric
                      label={governmentData?.office || 'Presidente / chefe de Estado'}
                      value={governmentData?.leader || 'Indisponível'}
                      loading={isProfileLoading}
                      multiline
                    />
                    <ProfileMetric
                      label={governmentData?.partyLabel || 'Partido'}
                      value={governmentData?.party || 'Não informado'}
                      loading={isProfileLoading}
                      multiline
                    />
                    <ProfileMetric
                      label="Ideologia política"
                      value={governmentData?.ideology || 'Não informada'}
                      loading={isProfileLoading}
                      multiline
                    />
                    <ProfileMetric
                      label="Regime político"
                      value={regimeData?.label || 'Não classificado'}
                      detail={indicatorDetail(regimeData)}
                      loading={isProfileLoading}
                      multiline
                    />
                    <ProfileMetric
                      label="Forma de governo"
                      value={governmentData?.governmentForm || 'Não informado'}
                      loading={isProfileLoading}
                      multiline
                    />
                  </dl>
                </section>

                {isRpProfile && rpContext?.lastEventSummary && (
                  <p className="mt-2 rounded-lg border border-cyan-400/10 bg-cyan-400/[0.04] px-2.5 py-2 text-[9px] leading-relaxed text-cyan-100/70">
                    <span className="font-semibold uppercase tracking-wider text-cyan-300">Mudança mais recente: </span>
                    {rpContext.lastEventSummary}
                  </p>
                )}

                <p className="mt-2 text-[8px] leading-relaxed text-slate-600">
                  {isRpProfile ? (
                    'O país iniciou com uma fotografia dos dados reais; desde então, estes valores pertencem ao estado do GOV.RP.'
                  ) : (
                    <>
                      Indicadores: Banco Mundial/FMI via DBnomics · Câmbio: Frankfurter/
                      <a
                        href="https://www.exchangerate-api.com"
                        target="_blank"
                        rel="noreferrer"
                        className="transition hover:text-slate-400"
                      >
                        ExchangeRate-API
                      </a>
                      {' '}· Política: Wikidata/Wikipedia e V-Dem/Our World in Data
                    </>
                  )}
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default InteractiveGlobe;
