import React, { useState, useEffect, useCallback } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { Globe, Users, DollarSign, Landmark, HeartPulse, BrainCircuit, Waves, Cloud, Mountain, Sun, User, Building, Factory, Droplet, TreePine as TreePalm, Vote, Shield, HeartHandshake as Handshake, Languages, Utensils, BookOpen, School, Hotel as Hospital, Plane, Train, Car, Lightbulb, Wifi, Home, ArrowUp, ArrowDown } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { formatCurrency } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const InfoCard = ({ icon: Icon, title, children }) => (
  <div className="glass-effect p-6 rounded-lg">
    <div className="flex items-center text-primary mb-3">
      <Icon className="w-6 h-6 mr-3" />
      <h3 className="text-xl font-semibold">{title}</h3>
    </div>
    <div className="text-muted-foreground space-y-2">{children}</div>
  </div>
);

const CountryInfo = () => {
  const { toast } = useToast();
  const [govFinances, setGovFinances] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchGovFinances = useCallback(async () => {
      setLoading(true);
      const { data, error } = await supabase
          .rpc('get_public_dashboard_stats');

      if (error) {
          toast({ title: 'Erro ao buscar finanças do governo', description: error.message, variant: 'destructive' });
      } else {
          setGovFinances(data);
      }
      setLoading(false);
  }, [toast]);

  useEffect(() => {
      fetchGovFinances();
  }, [fetchGovFinances]);

  const surplusDeficit = govFinances ? govFinances.government_revenue - govFinances.government_expenses : 0;

  const sections = [
    {
      title: 'Dados Geográficos',
      icon: Globe,
      content: [
        { icon: Waves, label: 'Localização', value: 'Continente Sul, fazendo fronteira com 3 nações.' },
        { icon: Cloud, label: 'Área Territorial', value: '5,120,000 km² (4,950,000 km² de terra, 170,000 km² de água).' },
        { icon: Mountain, label: 'Relevo', value: 'Planícies costeiras, planaltos centrais e cordilheiras a oeste.' },
        { icon: Sun, label: 'Clima', value: 'Predominantemente tropical, com regiões áridas no nordeste e temperadas no sul.' },
      ]
    },
    {
      title: 'Dados Demográficos',
      icon: Users,
      content: [
        { icon: User, label: 'População', value: '150 milhões de habitantes. 60% urbana, 40% rural.' },
        { icon: Building, label: 'Principais Cidades', value: 'Capital City (12M), Porto Belo (8M), Serra Vista (5M).' },
        { icon: Users, label: 'Diversidade Étnica', value: 'Mestiça (45%), Branca (35%), Negra (15%), Indígena e Asiática (5%).' },
        { icon: Languages, label: 'Línguas', value: 'Português (Oficial), Libras, dialetos nativos.' },
      ]
    },
    {
      title: 'Economia',
      icon: DollarSign,
      content: [
        { icon: DollarSign, label: 'PIB (Produto Interno Bruto)', value: govFinances ? formatCurrency(govFinances.government_balance) : <Loader2 className="h-4 w-4 animate-spin" /> },
        { icon: Factory, label: 'Setores Econômicos', value: 'Serviços (65%), Indústria (25%), Agricultura (10%).' },
        { icon: Droplet, label: 'Moeda', value: 'Real (R$).' },
        { icon: Handshake, label: 'Comércio Exterior', value: 'Principais parceiros: China, EUA, Argentina. Exporta soja, minério de ferro e tecnologia.' },
        { 
          icon: surplusDeficit >= 0 ? ArrowUp : ArrowDown, 
          label: surplusDeficit >= 0 ? 'Superávit' : 'Déficit', 
          value: loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <span className={surplusDeficit >= 0 ? 'text-green-400' : 'text-red-400'}>{formatCurrency(Math.abs(surplusDeficit))}</span>
        },
      ]
    },
    {
      title: 'Governo e Política',
      icon: Landmark,
      content: [
        { icon: Landmark, label: 'Forma de Governo', value: 'República Presidencialista.' },
        { icon: Vote, label: 'Partidos e Eleições', value: 'Sistema multipartidário. Eleições diretas a cada 4 anos para presidente, deputados e senadores.' },
        { icon: BookOpen, label: 'Sistema Jurídico', value: 'Baseado no Direito Civil, com uma Constituição Federal como lei suprema.' },
      ]
    },
    {
      title: 'Cultura e Sociedade',
      icon: HeartPulse,
      content: [
        { icon: Utensils, label: 'Costumes e Tradições', value: 'Carnaval, Festas Juninas, culinária rica e diversificada.' },
        { icon: School, label: 'Educação', value: 'Taxa de alfabetização de 95%. Sistema público e privado em todos os níveis.' },
        { icon: Hospital, label: 'Saúde', value: 'Sistema Único de Saúde (SUS) universal, com setor privado complementar.' },
      ]
    },
    {
      title: 'Infraestrutura e Tecnologia',
      icon: BrainCircuit,
      content: [
        { icon: Plane, label: 'Transporte', value: 'Extensa rede rodoviária, aeroportos internacionais e portos movimentados.' },
        { icon: Lightbulb, label: 'Energia', value: 'Matriz energética diversificada com forte presença de hidrelétricas e fontes renováveis.' },
        { icon: Wifi, label: 'Tecnologia', value: 'Alta penetração de internet (85%) e cobertura 5G nas principais cidades.' },
        { icon: Home, label: 'Saneamento', value: 'Acesso a água potável (98%) e esgoto tratado (80%) nas áreas urbanas.' },
      ]
    },
    {
      title: 'Relações Internacionais',
      icon: Handshake,
      content: [
        { icon: Handshake, label: 'Diplomacia', value: 'Membro ativo da ONU, G20 e MERCOSUL. Mantém relações diplomáticas com mais de 180 países.' },
        { icon: Shield, label: 'Defesa e Segurança', value: 'Forças Armadas com três ramos: Exército, Marinha e Aeronáutica.' },
      ]
    }
  ];

  return (
    <>
      <Helmet>
        <title>Sobre o País - GOV.RP</title>
        <meta name="description" content="Conheça os dados geográficos, demográficos, econômicos e culturais do nosso país." />
      </Helmet>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <PageHeader
          icon={Globe}
          title="Sobre o"
          gradientText="País"
          description="Um panorama completo sobre a nossa nação. Explore os dados e características que nos definem."
          iconColor="text-blue-400"
          centered={true}
        />
        <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sections.map((section, index) => (
            <InfoCard key={index} icon={section.icon} title={section.title}>
              {section.content.map((item, itemIndex) => (
                <div key={itemIndex} className="flex items-start">
                  <item.icon className="w-4 h-4 mr-2 mt-1 flex-shrink-0" />
                  <span><strong>{item.label}:</strong> {item.value}</span>
                </div>
              ))}
            </InfoCard>
          ))}
        </div>
        <div className="md:hidden">
          <Accordion type="single" collapsible className="w-full">
            {sections.map((section, index) => (
              <AccordionItem key={index} value={`item-${index}`} className="glass-effect rounded-lg mb-4 px-4">
                <AccordionTrigger>
                  <div className="flex items-center text-lg font-semibold">
                    <section.icon className="w-6 h-6 mr-3 text-primary" />
                    {section.title}
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="text-muted-foreground space-y-3 pt-2">
                    {section.content.map((item, itemIndex) => (
                      <div key={itemIndex} className="flex items-start">
                        <item.icon className="w-4 h-4 mr-2 mt-1 flex-shrink-0" />
                        <span><strong>{item.label}:</strong> {item.value}</span>
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