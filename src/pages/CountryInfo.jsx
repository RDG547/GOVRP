import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import isoCountries from 'iso-3166-1';
import PageHeader from '@/components/layout/PageHeader';
import {
  Globe,
  Users,
  DollarSign,
  Landmark,
  HeartPulse,
  BrainCircuit,
  Waves,
  Cloud,
  Mountain,
  Sun,
  User,
  Building,
  Droplet,
  Vote,
  Shield,
  HeartHandshake as Handshake,
  Languages,
  Utensils,
  BookOpen,
  School,
  Hotel as Hospital,
  Plane,
  Lightbulb,
  Wifi,
  Home,
  ArrowUp,
  ArrowDown,
  FileText,
  Download,
  ScrollText,
  Loader2,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';
import { SALARY_TABLE } from '@/lib/salary';
import {
  buildInvestmentAnnualRate,
  DEFAULT_ECONOMIC_POLICY,
  ECONOMIC_POLICY_SETTINGS_KEY,
  normalizeBankPolicyForEconomicPolicy,
  normalizeEconomicPolicy,
} from '@/lib/economicPolicy';
import { BANK_POLICY_SETTINGS_KEY, DEFAULT_BANK_POLICY } from '@/components/bank/BankManagementPanel';
import { useAuth } from '@/contexts/AuthContext';
import { loadCountryProfile } from '@/lib/countryProfile';
import { useCountryRpProfile } from '@/hooks/use-country-rp-profile';

const CONSTITUTION_PDF_PATH = '/constituicao-govrp.pdf';
const EmbeddedEconomyPanel = React.lazy(() => import('@/features/economy/components/EmbeddedEconomyPanel'));
const regionNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['pt-BR'], { type: 'region' })
  : null;

const toFlagEmoji = (alpha2) => alpha2
  .toUpperCase()
  .split('')
  .map((letter) => String.fromCodePoint(letter.charCodeAt(0) + 127397))
  .join('');

const constitutionSections = [
  {
    title: 'Preâmbulo',
    paragraphs: ['Nós, representantes e cidadãos do GOV.RP, estabelecemos esta Constituição para organizar o Estado, proteger direitos, garantir o equilíbrio entre os Poderes e orientar a vida pública.'],
  },
  {
    title: 'Título I — Princípios Fundamentais',
    paragraphs: [
      'Art. 1º O GOV.RP constitui-se em uma República presidencialista, democrática e soberana.',
      'Art. 2º São Poderes da Nação, independentes e harmônicos entre si, o Executivo, o Legislativo e o Judiciário.',
      'Art. 3º Todo poder emana do povo, que o exerce por representantes eleitos e pelos mecanismos de participação popular.',
    ],
  },
  {
    title: 'Título II — Direitos e Garantias',
    paragraphs: [
      'Art. 4º São assegurados aos cidadãos a dignidade, a liberdade de expressão, o devido processo legal, o acesso aos serviços públicos e a igualdade de tratamento perante as instituições do GOV.RP.',
      'Art. 5º Nenhum cidadão será privado de seus direitos sem fundamento legal e decisão da autoridade competente.',
    ],
  },
  {
    title: 'Título III — Organização Política',
    paragraphs: [
      'Art. 6º O Presidente da República exerce a chefia de Estado e de Governo, nos termos desta Constituição.',
      'Art. 7º O Parlamento representa a vontade popular, fiscaliza o Executivo e delibera sobre projetos e plebiscitos.',
      'Art. 8º O Judiciário assegura a interpretação da lei, a garantia de direitos e a solução dos conflitos.',
    ],
  },
  {
    title: 'Participação Popular',
    paragraphs: [
      'Art. 9º O povo poderá sugerir projetos, participar de consultas públicas e apresentar plebiscitos na forma da lei.',
      'Art. 10. O voto é instrumento legítimo de escolha dos representantes e de definição do rumo político do GOV.RP.',
    ],
  },
  {
    title: 'Ordem Econômica e Social',
    paragraphs: [
      'Art. 11. A ordem econômica observa a livre iniciativa, a função social e a responsabilidade fiscal do Estado.',
      'Art. 12. O Estado promoverá educação, saúde, segurança, infraestrutura e acesso digital de forma progressiva.',
    ],
  },
  {
    title: 'Emendas e Revisão',
    paragraphs: [
      'Art. 13. A Constituição poderá ser alterada por emenda, observado o rito legislativo próprio e o interesse nacional.',
      'Art. 14. Nenhuma emenda poderá abolir o voto popular, a separação dos Poderes e os direitos fundamentais.',
    ],
  },
  {
    title: 'Disposição Final',
    paragraphs: ['Art. 15. Esta Constituição entra em vigor na data de sua publicação e orienta todo o funcionamento institucional do GOV.RP.'],
  },
];

const DetailedSection = ({ title, icon: Icon, description, children }) => (
  <section className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 p-6 backdrop-blur-sm">
    <div className="mb-6">
      <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-300 mb-3">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <h2 className="text-3xl font-bold text-foreground">{title}</h2>
      {description && <p className="text-muted-foreground mt-2">{description}</p>}
    </div>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
      {children}
    </div>
  </section>
);

const DetailItem = ({ label, value, icon: Icon }) => (
  <div className="flex items-start gap-4 p-4 rounded-xl border border-white/5 bg-white/5 hover:bg-white/10 transition-colors">
    <div className="rounded-full bg-blue-500/10 p-2 text-blue-400 shrink-0 mt-0.5">
      <Icon className="w-5 h-5" />
    </div>
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-1">{label}</h4>
      <p className="text-sm text-muted-foreground">{value}</p>
    </div>
  </div>
);

const CountryInfo = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [govFinances, setGovFinances] = useState(null);
  const [economicPolicy, setEconomicPolicy] = useState(DEFAULT_ECONOMIC_POLICY);
  const [bankPolicy, setBankPolicy] = useState(DEFAULT_BANK_POLICY);
  const [realCountryProfile, setRealCountryProfile] = useState(null);
  const [populationSegments, setPopulationSegments] = useState([]);
  const [nationalEvents, setNationalEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('constituticao');
  const countryCode = (user?.residence_country_code || user?.country_code || 'BR').toUpperCase();
  const country = useMemo(() => {
    const iso = isoCountries.whereAlpha2(countryCode) || isoCountries.whereAlpha2('BR');
    return {
      info: {
        alpha2: iso.alpha2,
        alpha3: iso.alpha3,
        name: regionNames?.of(iso.alpha2) || iso.country,
        flag: toFlagEmoji(iso.alpha2),
      },
    };
  }, [countryCode]);
  const { profile: countryProfile, rpContext } = useCountryRpProfile(country, realCountryProfile);

  useEffect(() => {
    let active = true;
    loadCountryProfile({ alpha2: country.info.alpha2, alpha3: country.info.alpha3 })
      .then((profile) => {
        if (active) setRealCountryProfile(profile);
      })
      .catch(() => {
        if (active) setRealCountryProfile(null);
      });
    return () => { active = false; };
  }, [country]);

  const fetchCountryGameplay = useCallback(async () => {
    const [segmentsResponse, eventsResponse] = await Promise.all([
      supabase
        .from('country_population_segments')
        .select('segment_key, name, description, population_share, population_count, welfare_index')
        .eq('country_code', country.info.alpha2)
        .order('population_share', { ascending: false }),
      supabase
        .from('national_game_events')
        .select('id, title, description, category, severity, status, starts_at, ends_at')
        .eq('country_code', country.info.alpha2)
        .in('status', ['scheduled', 'active'])
        .order('starts_at', { ascending: false })
        .limit(5),
    ]);

    if (!segmentsResponse.error) setPopulationSegments(segmentsResponse.data || []);
    if (!eventsResponse.error) {
      const now = Date.now();
      setNationalEvents((eventsResponse.data || []).filter((event) => (
        new Date(event.starts_at).getTime() <= now && (!event.ends_at || new Date(event.ends_at).getTime() > now)
      )));
    }
  }, [country]);

  const fetchGovFinances = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);

    const [statsResponse, settingsResponse, economicStateResponse] = await Promise.all([
      supabase.rpc('get_public_dashboard_stats'),
      supabase.from('system_settings').select('key, value').in('key', [ECONOMIC_POLICY_SETTINGS_KEY, BANK_POLICY_SETTINGS_KEY]),
      supabase.from('economic_state').select('current_selic').eq('id', true).single(),
    ]);

    if (statsResponse.error) {
      toast({
        title: 'Erro ao buscar finanças do governo',
        description: statsResponse.error.message,
        variant: 'destructive',
      });
    } else {
      setGovFinances(statsResponse.data);
    }

    if (settingsResponse.error) {
      toast({
        title: 'Erro ao buscar indicadores monetários',
        description: settingsResponse.error.message,
        variant: 'destructive',
      });
    } else {
      const settingsMap = (settingsResponse.data || []).reduce((accumulator, item) => {
        accumulator[item.key] = item.value;
        return accumulator;
      }, {});
      const normalizedEconomicPolicy = normalizeEconomicPolicy({
        ...settingsMap[ECONOMIC_POLICY_SETTINGS_KEY],
        ...(economicStateResponse.data?.current_selic != null
          ? { selic_rate: economicStateResponse.data.current_selic }
          : {}),
      });

      setEconomicPolicy(normalizedEconomicPolicy);
      setBankPolicy(
        normalizeBankPolicyForEconomicPolicy(
          settingsMap[BANK_POLICY_SETTINGS_KEY],
          normalizedEconomicPolicy,
          DEFAULT_BANK_POLICY
        )
      );
    }

    if (showLoading) setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchGovFinances();
    fetchCountryGameplay();
  }, [fetchCountryGameplay, fetchGovFinances]);

  useEffect(() => {
    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => fetchGovFinances(false), 250);
    };
    let channel = supabase.channel('country-info-live');

    ['economic_state', 'system_settings', 'government_finances', 'investment_options']
      .forEach((table) => {
        channel = channel.on('postgres_changes', {
          event: '*', schema: 'public', table,
        }, scheduleRefresh);
      });

    channel.subscribe();
    return () => {
      window.clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [fetchGovFinances]);

  useEffect(() => {
    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(fetchCountryGameplay, 250);
    };
    const channel = supabase
      .channel(`country-gameplay:${country.info.alpha2}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'country_population_segments', filter: `country_code=eq.${country.info.alpha2}`,
      }, scheduleRefresh)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'national_game_events', filter: `country_code=eq.${country.info.alpha2}`,
      }, scheduleRefresh)
      .subscribe();

    return () => {
      window.clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [country, fetchCountryGameplay]);

  const surplusDeficit = govFinances
    ? govFinances.government_revenue - govFinances.government_expenses
    : 0;
  const conservativeInvestmentRate = buildInvestmentAnnualRate(economicPolicy.selic_rate, 'low');

  const economy = countryProfile?.economy;
  const exchange = countryProfile?.exchange;
  const government = countryProfile?.government;
  const regime = countryProfile?.regime;
  const formatPopulation = (value) => Number(value || 0).toLocaleString('pt-BR');
  const formatArea = (value) => `${Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} km²`;

  return (
    <>
      <Helmet>
        <title>Sobre o País - GOV.RP</title>
        <meta name="description" content="Conheça os dados geográficos, demográficos, econômicos, institucionais e constitucionais do nosso país." />
      </Helmet>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={Globe}
          title={`${country.info.flag} Sobre o`}
          gradientText={country.info.name}
          description={`Um panorama vivo de ${country.info.name}, com dados da economia, da população e das instituições do RP.`}
          iconColor="text-blue-400"
          centered={true}
        />

        {nationalEvents.length > 0 && (
          <section className="mt-8 rounded-2xl border border-amber-400/20 bg-amber-500/5 p-5">
            <div className="mb-4 flex items-center gap-2 text-amber-200">
              <Clock className="h-5 w-5" />
              <h2 className="font-semibold">Acontecimentos nacionais em andamento</h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {nationalEvents.map((event) => (
                <article key={event.id} className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-foreground">{event.title}</h3>
                    <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200">{event.severity === 'information' ? 'Informativo' : event.severity === 'attention' ? 'Atenção' : event.severity === 'important' ? 'Importante' : 'Crítico'}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        <div className="mt-10">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="flex justify-center mb-8">
              <TabsList className="bg-slate-900/50 border border-white/10 h-auto flex flex-wrap justify-center p-1 rounded-2xl gap-1">
                <TabsTrigger value="constituticao" className="rounded-xl px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><ScrollText className="w-4 h-4 mr-1.5 inline-block" />Constituição</TabsTrigger>
                <TabsTrigger value="transparencia" className="rounded-xl px-4 py-2 data-[state=active]:bg-emerald-600 data-[state=active]:text-white"><DollarSign className="w-4 h-4 mr-1.5 inline-block" />Transparência (Salários)</TabsTrigger>
                <TabsTrigger value="geografia" className="rounded-xl px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><Mountain className="w-4 h-4 mr-1.5 inline-block" />Geografia</TabsTrigger>
                <TabsTrigger value="demografia" className="rounded-xl px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><Users className="w-4 h-4 mr-1.5 inline-block" />Demografia</TabsTrigger>
                <TabsTrigger value="economia" className="rounded-xl px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><Landmark className="w-4 h-4 mr-1.5 inline-block" />Economia</TabsTrigger>
                <TabsTrigger value="governo" className="rounded-xl px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><Building className="w-4 h-4 mr-1.5 inline-block" />Governo e Política</TabsTrigger>
                <TabsTrigger value="cultura" className="rounded-xl px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><BookOpen className="w-4 h-4 mr-1.5 inline-block" />Cultura e Sociedade</TabsTrigger>
                <TabsTrigger value="infraestrutura" className="rounded-xl px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><Lightbulb className="w-4 h-4 mr-1.5 inline-block" />Infraestrutura</TabsTrigger>
                <TabsTrigger value="internacional" className="rounded-xl px-4 py-2 data-[state=active]:bg-blue-600 data-[state=active]:text-white"><Globe className="w-4 h-4 mr-1.5 inline-block" />Relações Internacionais</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="constituticao" className="mt-0 outline-none">
              <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 backdrop-blur-sm">
                <div className="flex flex-col gap-6 border-b border-white/10 pb-6 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-3xl space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
                      <FileText className="h-3.5 w-3.5" />
                      Constituição Federal
                    </div>
                    <h2 className="text-3xl font-bold text-foreground">Constituição Federal</h2>
                    <p className="text-muted-foreground">
                      Leia o texto constitucional completo diretamente no GOV.RP ou baixe a versão oficial em PDF.
                    </p>
                  </div>

                  <Button asChild className="shrink-0 border-0 bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:from-blue-700 hover:to-cyan-600">
                    <a href={CONSTITUTION_PDF_PATH} download="constituicao-govrp.pdf">
                      <Download className="mr-2 h-4 w-4" />
                      Baixar PDF
                    </a>
                  </Button>
                </div>

                <div className="mx-auto mt-6 max-w-4xl rounded-2xl border border-slate-200 bg-slate-50 px-5 py-8 text-slate-900 shadow-2xl sm:px-10 sm:py-12">
                  <header className="mb-10 border-b-2 border-slate-800 pb-6 text-center">
                    <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">República Digital</p>
                    <h3 className="mt-3 text-2xl font-black uppercase sm:text-3xl">Constituição Federal do GOV.RP</h3>
                  </header>
                  <div className="space-y-9">
                    {constitutionSections.map((section) => (
                      <section key={section.title}>
                        <h4 className="mb-4 border-l-4 border-blue-600 pl-3 text-sm font-black uppercase tracking-[0.12em] text-slate-800">{section.title}</h4>
                        <div className="space-y-3 text-sm leading-7 text-slate-700 sm:text-base">
                          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="transparencia" className="mt-0 outline-none">
              <section className="rounded-2xl border border-white/10 bg-slate-950/40 p-6 backdrop-blur-sm">
                <div className="mb-6">
                  <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300 mb-3">
                    <DollarSign className="h-3.5 w-3.5" />
                    Transparência
                  </div>
                  <h2 className="text-3xl font-bold text-foreground">Salários dos Servidores Públicos</h2>
                  <p className="text-muted-foreground mt-2">
                    Consulte os valores salariais dos ocupantes de cargos públicos. Os salários são pagos semanalmente,
                    toda <strong className="text-foreground">Segunda-feira às 10h da manhã</strong>, com recursos do Cofre da União.
                  </p>
                </div>

                <div className="overflow-hidden rounded-xl border border-white/10">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5">
                        <th className="px-6 py-4 text-left text-sm font-semibold text-foreground">Cargo</th>
                        <th className="px-6 py-4 text-right text-sm font-semibold text-foreground">Salário Semanal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SALARY_TABLE.map((item, index) => (
                        <tr key={item.role} className={`border-b border-white/5 transition-colors hover:bg-white/5 ${index % 2 === 0 ? '' : 'bg-white/[0.02]'}`}>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-2 h-2 rounded-full bg-emerald-400" />
                              <span className="font-medium text-foreground">{item.title}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="font-bold text-emerald-400">{formatCurrency(item.salary)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-white/5">
                        <td className="px-6 py-4 font-semibold text-foreground">Total (caso todos estivessem preenchidos)</td>
                        <td className="px-6 py-4 text-right font-bold text-emerald-400">
                          {formatCurrency(SALARY_TABLE.reduce((sum, item) => sum + item.salary, 0))}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                <div className="mt-4 flex items-start gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                  <Landmark className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Nota:</strong> Todos os pagamentos são realizados automaticamente a cada segunda-feira e
                    publicados no Diário Oficial da União para garantir total transparência com os cidadãos.
                  </div>
                </div>
              </section>
            </TabsContent>

            <TabsContent value="geografia" className="mt-0 outline-none">
              <DetailedSection title="Dados Geográficos" icon={Globe} description="Informações sobre o território, clima e relevo do país.">
                <DetailItem icon={Waves} label="País de referência" value={`${country.info.flag} ${country.info.name} (${country.info.alpha2})`} />
                <DetailItem icon={Cloud} label="Área Territorial" value={economy?.area?.value ? formatArea(economy.area.value) : 'Indicador territorial em atualização.'} />
                <DetailItem icon={Mountain} label="Origem dos dados" value={rpContext?.hasGameplayData ? 'Estado persistente do GOV.RP, iniciado a partir de indicadores reais.' : 'Indicadores públicos do país selecionado.'} />
                <DetailItem icon={Sun} label="Atualização" value={rpContext?.updatedAt ? `Última mudança do RP em ${new Date(rpContext.updatedAt).toLocaleString('pt-BR')}.` : 'Atualizado conforme a disponibilidade das fontes nacionais.'} />
              </DetailedSection>
            </TabsContent>

            <TabsContent value="demografia" className="mt-0 outline-none">
              <DetailedSection title="Dados Demográficos" icon={Users} description="Estatísticas populacionais e socioculturais.">
                <DetailItem icon={User} label="População" value={economy?.population?.value ? `${formatPopulation(economy.population.value)} habitantes` : 'Indicador populacional em atualização.'} />
                <DetailItem icon={Building} label="Cidadãos no GOV.RP" value={govFinances?.total_users != null ? formatPopulation(govFinances.total_users) : 'Contagem em atualização.'} />
                <DetailItem icon={Users} label="Segmentos da população" value={populationSegments.length ? `${populationSegments.length} grupos nacionais acompanhados pelo RP.` : 'Os segmentos serão formados quando o país iniciar sua simulação.'} />
                <DetailItem icon={Languages} label="País vinculado ao cidadão" value={`${country.info.flag} ${country.info.name}`} />
              </DetailedSection>
              {populationSegments.length > 0 && (
                <section className="mt-6 rounded-2xl border border-white/10 bg-slate-950/40 p-6">
                  <h2 className="text-xl font-bold text-foreground">Grupos da sociedade</h2>
                  <p className="mt-1 text-sm text-muted-foreground">A composição é persistente e poderá reagir a políticas e acontecimentos nacionais.</p>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {populationSegments.map((segment) => (
                      <article key={segment.segment_key} className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-semibold text-foreground">{segment.name}</h3>
                          <span className="text-sm font-bold text-blue-300">{(Number(segment.population_share) * 100).toFixed(0)}%</span>
                        </div>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">{segment.description}</p>
                        <p className="mt-3 text-xs text-slate-400">{formatPopulation(segment.population_count)} pessoas · bem-estar {Number(segment.welfare_index).toFixed(0)}/100</p>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </TabsContent>

            <TabsContent value="economia" className="mt-0 outline-none">
              <section className="rounded-2xl border border-cyan-500/20 bg-slate-950/40 p-6 backdrop-blur-sm">
                <div className="mb-6">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
                    <Landmark className="h-3.5 w-3.5" />
                    Dados oficiais
                  </div>
                  <h2 className="text-3xl font-bold text-foreground">Economia Nacional</h2>
                  <p className="mt-2 text-muted-foreground">
                    PIB, inflação, emprego, juros, dívida e poder de compra calculados pelo motor econômico a partir das ações do RP.
                  </p>
                </div>

                {country.info.alpha2 === 'BR' ? (
                  <React.Suspense
                    fallback={(
                      <div className="flex min-h-56 items-center justify-center gap-3 text-sm text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                        Carregando os indicadores oficiais...
                      </div>
                    )}
                  >
                    <EmbeddedEconomyPanel view="public" showHeader={false} />
                  </React.Suspense>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <DetailItem icon={DollarSign} label="PIB" value={economy?.gdp?.value ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: economy.gdp.currency || 'USD', notation: 'compact' }).format(economy.gdp.value) : 'Em atualização'} />
                    <DetailItem icon={ArrowUp} label="Crescimento" value={economy?.growth?.value != null ? `${Number(economy.growth.value).toFixed(2)}%` : 'Em atualização'} />
                    <DetailItem icon={DollarSign} label="Inflação" value={economy?.inflation?.value != null ? `${Number(economy.inflation.value).toFixed(2)}%` : 'Em atualização'} />
                    <DetailItem icon={Users} label="Desemprego" value={economy?.unemployment?.value != null ? `${Number(economy.unemployment.value).toFixed(2)}%` : 'Em atualização'} />
                  </div>
                )}
              </section>

              <DetailedSection
                title="Estrutura Econômica e Financeira"
                icon={DollarSign}
                description="Informações complementares sobre moeda, crédito, investimentos e comércio exterior."
              >
                <DetailItem icon={Droplet} label="Moeda" value={exchange?.currency ? `${exchange.currency}${exchange.currency === 'BRL' ? ' · Real Brasileiro' : ''}` : 'Em atualização'} />
                <DetailItem icon={Handshake} label="Crédito bancário de referência" value={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : `${Number(bankPolicy.loan_interest_rate || 0).toFixed(2)}% a.m. para empréstimos e ${Number(bankPolicy.credit_card_revolving_rate || 0).toFixed(2)}% a.m. no rotativo.`} />
                <DetailItem icon={DollarSign} label="Rendimento conservador" value={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : `${(conservativeInvestmentRate * 100).toFixed(2)}% a.a. nas aplicações de baixo risco.`} />
                <DetailItem icon={Handshake} label="Câmbio com o dólar" value={exchange?.usd ? `${Number(exchange.usd).toFixed(4)} ${exchange.currency} por USD` : 'Cotação em atualização.'} />
                <DetailItem
                  icon={surplusDeficit >= 0 ? ArrowUp : ArrowDown}
                  label={surplusDeficit >= 0 ? 'Superávit' : 'Déficit'}
                  value={loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <span className={surplusDeficit >= 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                      {formatCurrency(Math.abs(surplusDeficit))}
                    </span>
                  )}
                />
              </DetailedSection>
            </TabsContent>

            <TabsContent value="governo" className="mt-0 outline-none">
              <DetailedSection title="Governo e Política" icon={Landmark} description="Estrutura de estado e representação política.">
                <DetailItem icon={Landmark} label="Forma de Governo" value={government?.governmentForm || 'República Presidencialista no GOV.RP.'} />
                <DetailItem icon={User} label={government?.office || 'Chefia de Estado'} value={government?.leader || 'Cargo em atualização.'} />
                <DetailItem icon={Vote} label={government?.partyLabel || 'Representação política'} value={government?.party || 'Sem filiação informada.'} />
                <DetailItem icon={Building} label="Regime político" value={regime?.label || 'Classificação em atualização.'} />
                <DetailItem icon={BookOpen} label="Sistema Jurídico" value="Baseado no Direito Civil, com a Constituição Federal como lei suprema." />
              </DetailedSection>
            </TabsContent>

            <TabsContent value="cultura" className="mt-0 outline-none">
              <DetailedSection title="Cultura e Sociedade" icon={HeartPulse} description="Aspectos culturais, desenvolvimento humano e bem-estar.">
                <DetailItem icon={Utensils} label="Costumes e Tradições" value="Carnaval, Festas Juninas, culinária rica e diversificada." />
                <DetailItem icon={School} label="Educação" value="Taxa de alfabetização de 95%. Sistema público e privado em todos os níveis." />
                <DetailItem icon={Hospital} label="Saúde" value="Sistema Único de Saúde (SUS) universal, com setor privado complementar." />
              </DetailedSection>
            </TabsContent>

            <TabsContent value="infraestrutura" className="mt-0 outline-none">
              <DetailedSection title="Infraestrutura e Tecnologia" icon={BrainCircuit} description="Desenvolvimento físico e bases tecnológicas na nação.">
                 <DetailItem icon={Plane} label="Transporte" value="Extensa rede rodoviária, aeroportos internacionais e portos movimentados." />
                 <DetailItem icon={Lightbulb} label="Energia" value="Matriz energética diversificada com forte presença de hidrelétricas e fontes renováveis." />
                 <DetailItem icon={Wifi} label="Tecnologia" value="Alta penetração de internet (85%) e cobertura 5G nas principais cidades." />
                 <DetailItem icon={Home} label="Saneamento" value="Acesso a água potável (98%) e esgoto tratado (80%) nas áreas urbanas." />
              </DetailedSection>
            </TabsContent>

            <TabsContent value="internacional" className="mt-0 outline-none">
              <DetailedSection title="Relações Internacionais" icon={Globe} description="Posicionamento global e estratégias de segurança.">
                <DetailItem icon={Handshake} label="Diplomacia" value="Membro ativo da ONU, G20 e MERCOSUL. Mantém relações diplomáticas com mais de 180 países." />
                <DetailItem icon={Shield} label="Defesa e Segurança" value="Forças Armadas com três ramos: Exército, Marinha e Aeronáutica." />
              </DetailedSection>
            </TabsContent>

          </Tabs>
        </div>

      </div>
    </>
  );
};

export default CountryInfo;
