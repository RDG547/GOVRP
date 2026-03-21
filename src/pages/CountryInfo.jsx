import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
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
  Factory,
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
} from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';

const CONSTITUTION_PDF_PATH = '/constituicao-govrp.pdf';

const InfoCard = ({ icon: Icon, title, children }) => (
  <div className="glass-effect rounded-2xl p-6">
    <div className="mb-3 flex items-center text-primary">
      <Icon className="mr-3 h-6 w-6" />
      <h3 className="text-xl font-semibold">{title}</h3>
    </div>
    <div className="space-y-2 text-muted-foreground">{children}</div>
  </div>
);

const CountryInfo = () => {
  const { toast } = useToast();
  const [govFinances, setGovFinances] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchGovFinances = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase.rpc('get_public_dashboard_stats');

    if (error) {
      toast({
        title: 'Erro ao buscar finanças do governo',
        description: error.message,
        variant: 'destructive',
      });
    } else {
      setGovFinances(data);
    }

    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchGovFinances();
  }, [fetchGovFinances]);

  const surplusDeficit = govFinances
    ? govFinances.government_revenue - govFinances.government_expenses
    : 0;

  const constitutionHighlights = [
    {
      icon: ScrollText,
      title: 'Leitura integrada',
      description:
        'A Constituição fica disponível dentro do próprio GOV.RP, sem depender de programas externos.',
    },
    {
      icon: Vote,
      title: 'Base institucional',
      description:
        'O texto constitucional centraliza os princípios de governo, organização dos poderes e garantias civis.',
    },
    {
      icon: Download,
      title: 'Acesso rápido',
      description:
        'Você pode baixar o PDF oficial a qualquer momento para consulta offline ou arquivamento.',
    },
  ];

  const sections = [
    {
      title: 'Dados Geográficos',
      icon: Globe,
      content: [
        { icon: Waves, label: 'Localização', value: 'Continente Sul, fazendo fronteira com 3 nações.' },
        { icon: Cloud, label: 'Área Territorial', value: '5,120,000 km² (4,950,000 km² de terra, 170,000 km² de água).' },
        { icon: Mountain, label: 'Relevo', value: 'Planícies costeiras, planaltos centrais e cordilheiras a oeste.' },
        { icon: Sun, label: 'Clima', value: 'Predominantemente tropical, com regiões áridas no nordeste e temperadas no sul.' },
      ],
    },
    {
      title: 'Dados Demográficos',
      icon: Users,
      content: [
        { icon: User, label: 'População', value: '150 milhões de habitantes. 60% urbana, 40% rural.' },
        { icon: Building, label: 'Principais Cidades', value: 'Capital City (12M), Porto Belo (8M), Serra Vista (5M).' },
        { icon: Users, label: 'Diversidade Étnica', value: 'Mestiça (45%), Branca (35%), Negra (15%), Indígena e Asiática (5%).' },
        { icon: Languages, label: 'Línguas', value: 'Português (Oficial), Libras, dialetos nativos.' },
      ],
    },
    {
      title: 'Economia',
      icon: DollarSign,
      content: [
        {
          icon: DollarSign,
          label: 'PIB (Produto Interno Bruto)',
          value: govFinances ? formatCurrency(govFinances.government_balance) : <Loader2 className="h-4 w-4 animate-spin" />,
        },
        { icon: Factory, label: 'Setores Econômicos', value: 'Serviços (65%), Indústria (25%), Agricultura (10%).' },
        { icon: Droplet, label: 'Moeda', value: 'Real (R$).' },
        { icon: Handshake, label: 'Comércio Exterior', value: 'Principais parceiros: China, EUA, Argentina. Exporta soja, minério de ferro e tecnologia.' },
        {
          icon: surplusDeficit >= 0 ? ArrowUp : ArrowDown,
          label: surplusDeficit >= 0 ? 'Superávit' : 'Déficit',
          value: loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span className={surplusDeficit >= 0 ? 'text-green-400' : 'text-red-400'}>
              {formatCurrency(Math.abs(surplusDeficit))}
            </span>
          ),
        },
      ],
    },
    {
      title: 'Governo e Política',
      icon: Landmark,
      content: [
        { icon: Landmark, label: 'Forma de Governo', value: 'República Presidencialista.' },
        { icon: Vote, label: 'Partidos e Eleições', value: 'Sistema multipartidário. Eleições diretas a cada 4 anos para presidente, deputados e senadores.' },
        { icon: BookOpen, label: 'Sistema Jurídico', value: 'Baseado no Direito Civil, com a Constituição Federal como lei suprema.' },
      ],
    },
    {
      title: 'Cultura e Sociedade',
      icon: HeartPulse,
      content: [
        { icon: Utensils, label: 'Costumes e Tradições', value: 'Carnaval, Festas Juninas, culinária rica e diversificada.' },
        { icon: School, label: 'Educação', value: 'Taxa de alfabetização de 95%. Sistema público e privado em todos os níveis.' },
        { icon: Hospital, label: 'Saúde', value: 'Sistema Único de Saúde (SUS) universal, com setor privado complementar.' },
      ],
    },
    {
      title: 'Infraestrutura e Tecnologia',
      icon: BrainCircuit,
      content: [
        { icon: Plane, label: 'Transporte', value: 'Extensa rede rodoviária, aeroportos internacionais e portos movimentados.' },
        { icon: Lightbulb, label: 'Energia', value: 'Matriz energética diversificada com forte presença de hidrelétricas e fontes renováveis.' },
        { icon: Wifi, label: 'Tecnologia', value: 'Alta penetração de internet (85%) e cobertura 5G nas principais cidades.' },
        { icon: Home, label: 'Saneamento', value: 'Acesso a água potável (98%) e esgoto tratado (80%) nas áreas urbanas.' },
      ],
    },
    {
      title: 'Relações Internacionais',
      icon: Handshake,
      content: [
        { icon: Handshake, label: 'Diplomacia', value: 'Membro ativo da ONU, G20 e MERCOSUL. Mantém relações diplomáticas com mais de 180 países.' },
        { icon: Shield, label: 'Defesa e Segurança', value: 'Forças Armadas com três ramos: Exército, Marinha e Aeronáutica.' },
      ],
    },
  ];

  return (
    <>
      <Helmet>
        <title>Sobre o País - GOV.RP</title>
        <meta
          name="description"
          content="Conheça os dados geográficos, demográficos, econômicos, institucionais e constitucionais do nosso país."
        />
      </Helmet>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeader
          icon={Globe}
          title="Sobre o"
          gradientText="País"
          description="Um panorama completo sobre a nossa nação. Explore os dados, as instituições e a Constituição que orienta o GOV.RP."
          iconColor="text-blue-400"
          centered={true}
        />

        <section className="mt-10 rounded-2xl border border-white/10 bg-slate-950/40 p-6 backdrop-blur-sm">
          <div className="flex flex-col gap-6 border-b border-white/10 pb-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">
                <FileText className="h-3.5 w-3.5" />
                Constituição Federal
              </div>
              <h2 className="text-3xl font-bold text-foreground">Constituição Federal</h2>
              <p className="text-muted-foreground">
                Consulte os principais pontos constitucionais e acesse o PDF oficial diretamente nesta pagina.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => {
                  document.getElementById('constitution-viewer')?.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start',
                  });
                }}
              >
                <ScrollText className="mr-2 h-4 w-4" />
                Ler no Projeto
              </Button>
              <Button asChild className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600">
                <a href={CONSTITUTION_PDF_PATH} download="constituicao-govrp.pdf">
                  <Download className="mr-2 h-4 w-4" />
                  Baixar PDF
                </a>
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[0.95fr_1.35fr]">
            <div className="grid gap-4">
              {constitutionHighlights.map((item) => (
                <div key={item.title} className="rounded-xl border border-white/10 bg-white/5 p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="rounded-full bg-blue-500/15 p-2 text-blue-300">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold text-foreground">{item.title}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>

            <div
              id="constitution-viewer"
              className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl"
            >
              <object
                data={`${CONSTITUTION_PDF_PATH}#toolbar=1&navpanes=0&scrollbar=1`}
                type="application/pdf"
                className="h-[560px] w-full sm:h-[720px]"
              >
                <div className="space-y-3 p-6 text-slate-900">
                  <p className="text-lg font-semibold">Seu navegador não conseguiu exibir o PDF embutido.</p>
                  <p className="text-sm text-slate-600">
                    Mesmo assim, você ainda pode baixar a Constituição e visualizá-la diretamente pelo GOV.RP em navegadores compatíveis.
                  </p>
                  <Button asChild>
                    <a href={CONSTITUTION_PDF_PATH} download="constituicao-govrp.pdf">
                      <Download className="mr-2 h-4 w-4" />
                      Baixar Constituição
                    </a>
                  </Button>
                </div>
              </object>
            </div>
          </div>
        </section>

        <div className="mt-10 hidden gap-6 md:grid md:grid-cols-2 lg:grid-cols-3">
          {sections.map((section) => (
            <InfoCard key={section.title} icon={section.icon} title={section.title}>
              {section.content.map((item) => (
                <div key={item.label} className="flex items-start">
                  <item.icon className="mr-2 mt-1 h-4 w-4 flex-shrink-0" />
                  <span>
                    <strong>{item.label}:</strong> {item.value}
                  </span>
                </div>
              ))}
            </InfoCard>
          ))}
        </div>

        <div className="mt-10 md:hidden">
          <Accordion type="single" collapsible className="w-full">
            {sections.map((section, index) => (
              <AccordionItem
                key={section.title}
                value={`item-${index}`}
                className="glass-effect mb-4 rounded-lg px-4"
              >
                <AccordionTrigger>
                  <div className="flex items-center text-lg font-semibold">
                    <section.icon className="mr-3 h-6 w-6 text-primary" />
                    {section.title}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-2 text-muted-foreground">
                    {section.content.map((item) => (
                      <div key={item.label} className="flex items-start">
                        <item.icon className="mr-2 mt-1 h-4 w-4 flex-shrink-0" />
                        <span>
                          <strong>{item.label}:</strong> {item.value}
                        </span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </>
  );
};

export default CountryInfo;
