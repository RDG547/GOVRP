import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { useToast } from "@/components/ui/use-toast";
import { useNavigate, Link } from 'react-router-dom';
import { Heart, DollarSign, Users, Code, Share2, Award, Globe, Rocket } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';

const SupportUs = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleShare = async () => {
    const shareData = {
      title: 'GOV.RP - Apoie o Projeto',
      text: 'Ajude a manter e expandir a plataforma GOV.RP. Sua contribuição faz a diferença!',
      url: window.location.origin + '/support-us',
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch (err) {
        if (err.name !== 'AbortError') {
          toast({ title: "Erro ao compartilhar", description: "Não foi possível compartilhar a página.", variant: 'destructive' });
        }
      }
    } else {
      navigator.clipboard.writeText(shareData.url);
      toast({
        title: "Link copiado!",
        description: "O link da página de apoio foi copiado para sua área de transferência.",
      });
    }
  };

  const supportWays = [
    { icon: DollarSign, title: 'Doação Financeira', description: 'Contribua diretamente para os custos de desenvolvimento e manutenção.', actionText: 'Ver Opções de Doação', action: () => navigate('/donation'), color: 'text-green-400' },
    { icon: Code, title: 'Contribuição Técnica', description: 'Ajude no desenvolvimento com código, testes ou documentação em nosso GitHub.', actionText: 'Acessar GitHub', action: () => window.open('https://github.com/RDG547/GOVRP', '_blank'), color: 'text-blue-400' },
    { icon: Users, title: 'Feedback e Ideias', description: 'Compartilhe sugestões e reporte bugs para melhorar a experiência de todos.', actionText: 'Enviar Feedback', action: () => navigate('/contact'), color: 'text-purple-400' },
    { icon: Share2, title: 'Divulgação', description: 'Ajude a espalhar a palavra sobre o GOV.RP em suas redes sociais e comunidades.', actionText: 'Compartilhar Projeto', action: handleShare, color: 'text-sky-400' },
  ];
  
  const impactAreas = [
    { icon: Globe, title: 'Infraestrutura', description: 'Servidores, CDN e ferramentas', color: 'text-green-400' },
    { icon: Code, title: 'Desenvolvimento', description: 'Novos recursos e melhorias', color: 'text-blue-400' },
    { icon: Users, title: 'Comunidade', description: 'Moderação, eventos e suporte', color: 'text-purple-400' },
    { icon: Rocket, title: 'Inovação', description: 'Pesquisa e novas tecnologias', color: 'text-yellow-400' },
  ];

  return (
    <>
      <Helmet>
        <title>Apoie o Projeto - GOV.RP</title>
        <meta name="description" content="Ajude a manter e expandir a plataforma GOV.RP. Sua contribuição faz a diferença!" />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <PageHeader
            icon={Heart}
            title="Apoie o"
            gradientText="Projeto"
            description="O GOV.RP é um projeto de paixão, construído pela comunidade, para a comunidade. Cada forma de apoio, grande ou pequena, nos ajuda a manter a plataforma gratuita, inovadora e em constante crescimento."
            iconColor="text-red-400"
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          {supportWays.map((way, index) => (
            <motion.div key={index} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * index }}>
              <Card className="h-full border-slate-700/50 bg-black/20 hover:border-blue-500/50 transition-all duration-300">
                <CardContent className="p-8 flex flex-col h-full">
                  <div className="flex items-center gap-4 mb-4">
                    <div className={`bg-white/10 p-3 rounded-lg`}>
                        <way.icon className={`h-8 w-8 ${way.color} flex-shrink-0`} />
                    </div>
                    <h3 className="text-2xl font-bold text-white">{way.title}</h3>
                  </div>
                  <p className="text-gray-300 mb-6 flex-grow">{way.description}</p>
                  <Button variant="outline" onClick={way.action} className="mt-auto self-start">
                    {way.actionText}
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white mb-4">Para Onde Vai Sua Contribuição?</h2>
            <p className="text-lg text-gray-400 max-w-2xl mx-auto">Transparência é um dos nossos pilares. Veja as áreas que seu apoio fortalece:</p>
        </div>
          
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
            {impactAreas.map((area, index) => (
              <motion.div key={index} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + 0.1 * index }}>
                <Card className="h-full border-slate-700/50 bg-black/20 text-center p-6">
                  <div className={`inline-flex p-4 bg-white/10 rounded-full mb-4`}>
                     <area.icon className={`h-8 w-8 ${area.color} mx-auto`} />
                  </div>
                  <h3 className="text-xl font-semibold text-white mb-2">{area.title}</h3>
                  <p className="text-gray-400 text-sm">{area.description}</p>
                </Card>
              </motion.div>
            ))}
        </div>
        
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
          <Card className="border-slate-700/50 bg-black/20">
            <CardContent className="p-8 md:p-12 text-center">
              <div className="inline-flex p-4 bg-green-500/20 rounded-full mb-4">
                  <Award className="h-8 w-8 text-green-400" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-4">Um Agradecimento Especial</h2>
              <p className="text-gray-300 text-lg leading-relaxed mb-8 max-w-3xl mx-auto">
                Agradecemos imensamente por considerar apoiar o GOV.RP. Você não está apenas ajudando a pagar por servidores; está investindo em uma visão, em uma comunidade e em um espaço para criatividade e roleplay político. Obrigado por ser parte da nossa história!
              </p>
              <Link to="/donation">
                  <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                      <Heart className="mr-2 h-5 w-5"/> Fazer uma Doação
                  </Button>
              </Link>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </>
  );
};

export default SupportUs;