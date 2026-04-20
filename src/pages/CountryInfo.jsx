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
  Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';
import { SALARY_TABLE } from '@/lib/salary';

const CONSTITUTION_PDF_PATH = '/constituicao-govrp.pdf';

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
  const { toast } = useToast();
  const [govFinances, setGovFinances] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('constituticao');

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
      description: 'A Constituição fica disponível dentro do próprio GOV.RP, sem depender de programas externos.',
    },
    {
      icon: Vote,
      title: 'Base institucional',
      description: 'O texto constitucional centraliza os princípios de governo, organização dos poderes e garantias civis.',
    },
    {
      icon: Download,
      title: 'Acesso rápido',
      description: 'Você pode baixar o PDF oficial a qualquer momento para consulta offline ou arquivamento.',
    },
  ];

  return (
    <>
      <Helmet>
        <title>Sobre o País - GOV.RP</title>
        <meta name="description" content="Conheça os dados geográficos, demográficos, econômicos, institucionais e constitucionais do nosso país." />
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
                    <Button variant="outline" onClick={() => document.getElementById('constitution-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                      <ScrollText className="mr-2 h-4 w-4" />
                      Ler Constituição
                    </Button>
                    <Button asChild className="bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white border-0">
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

                  <div id="constitution-viewer" className="overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
                    <object data={`${CONSTITUTION_PDF_PATH}#toolbar=1&navpanes=0&scrollbar=1`} type="application/pdf" className="h-[560px] w-full sm:h-[720px]">
                      <div className="space-y-3 p-6 text-slate-900 border border-slate-200 m-4 rounded-lg bg-slate-50">
                        <p className="text-lg font-semibold flex items-center gap-2"><Info className="text-blue-500"/> Seu navegador não não exibir o PDF.</p>
                        <p className="text-sm text-slate-600">Para ler o documento, faça o download utilizando o botão abaixo.</p>
                        <Button asChild className="mt-2 text-slate-100 bg-slate-800 hover:bg-slate-700">
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
                <DetailItem icon={Waves} label="Localização" value="Continente Sul, fazendo fronteira com 3 nações." />
                <DetailItem icon={Cloud} label="Área Territorial" value="5,120,000 km² (4,950,000 km² de terra, 170,000 km² de água)." />
                <DetailItem icon={Mountain} label="Relevo" value="Planícies costeiras, planaltos centrais e cordilheiras a oeste." />
                <DetailItem icon={Sun} label="Clima" value="Predominantemente tropical, com regiões áridas no nordeste e temperadas no sul." />
              </DetailedSection>
            </TabsContent>

            <TabsContent value="demografia" className="mt-0 outline-none">
              <DetailedSection title="Dados Demográficos" icon={Users} description="Estatísticas populacionais e socioculturais.">
                <DetailItem icon={User} label="População" value="150 milhões de habitantes. 60% urbana, 40% rural." />
                <DetailItem icon={Building} label="Principais Cidades" value="Capital City (12M), Porto Belo (8M), Serra Vista (5M)." />
                <DetailItem icon={Users} label="Diversidade Étnica" value="Mestiça (45%), Branca (35%), Negra (15%), Indígena e Asiática (5%)." />
                <DetailItem icon={Languages} label="Línguas" value="Português (Oficial), Libras, dialetos nativos." />
              </DetailedSection>
            </TabsContent>

            <TabsContent value="economia" className="mt-0 outline-none">
              <DetailedSection title="Economia" icon={DollarSign} description="Indicadores econômicos e base financeira nacional.">
                <DetailItem
                  icon={DollarSign}
                  label="PIB (Produto Interno Bruto)"
                  value={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'R$ 3.000.150,34'}
                />
                <DetailItem icon={Factory} label="Setores Econômicos" value="Serviços (65%), Indústria (25%), Agricultura (10%)." />
                <DetailItem icon={Droplet} label="Moeda" value="Real (R$)." />
                <DetailItem icon={Handshake} label="Comércio Exterior" value="Principais parceiros: China, EUA, Argentina. Exporta soja, minério de ferro e tecnologia." />
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
                <DetailItem icon={Landmark} label="Forma de Governo" value="República Presidencialista." />
                <DetailItem icon={Vote} label="Partidos e Eleições" value="Sistema multipartidário. Eleições diretas para Presidente e Vice-Presidente em chapa conjunta, além de eleições legislativas regulares para deputados e senadores com mandatos mensais." />
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
