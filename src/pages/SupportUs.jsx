import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from "@/components/ui/use-toast";
import { Heart, DollarSign, Users, Code, MessageSquare, Star, Gift, CreditCard, Banknote, Coins, Award, Target, Zap, Globe, CheckCircle, Coffee, Rocket } from 'lucide-react';
const SupportUs = () => {
  const {
    toast
  } = useToast();
  const [donationAmount, setDonationAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorMessage, setDonorMessage] = useState('');
  const donationTiers = [{
    amount: 10,
    title: 'Apoiador',
    icon: Coffee,
    color: 'text-yellow-400',
    benefits: ['Reconhecimento no site', 'Acesso a atualizações exclusivas'],
    description: 'Um cafezinho para a equipe continuar desenvolvendo!'
  }, {
    amount: 25,
    title: 'Contribuidor',
    icon: Heart,
    color: 'text-pink-400',
    benefits: ['Todos os benefícios anteriores', 'Badge especial no perfil', 'Acesso ao canal VIP'],
    description: 'Ajude a manter os servidores funcionando perfeitamente.'
  }, {
    amount: 50,
    title: 'Patrocinador',
    icon: Star,
    color: 'text-purple-400',
    benefits: ['Todos os benefícios anteriores', 'Menção em releases', 'Acesso beta a novos recursos'],
    description: 'Contribuição significativa para novas funcionalidades.'
  }, {
    amount: 100,
    title: 'Investidor',
    icon: Award,
    color: 'text-blue-400',
    benefits: ['Todos os benefícios anteriores', 'Reunião mensal com a equipe', 'Influência no roadmap'],
    description: 'Seja parte ativa do desenvolvimento da plataforma.'
  }, {
    amount: 250,
    title: 'Parceiro',
    icon: Rocket,
    color: 'text-green-400',
    benefits: ['Todos os benefícios anteriores', 'Logo na página de parceiros', 'Consultoria técnica'],
    description: 'Parceria estratégica para crescimento mútuo.'
  }];
  const supportWays = [{
    icon: DollarSign,
    title: 'Doação Financeira',
    description: 'Contribua diretamente para o desenvolvimento e manutenção da plataforma.',
    action: 'Doar Agora'
  }, {
    icon: Code,
    title: 'Contribuição Técnica',
    description: 'Ajude no desenvolvimento com código, testes ou documentação.',
    action: 'Ver GitHub'
  }, {
    icon: MessageSquare,
    title: 'Feedback e Ideias',
    description: 'Compartilhe sugestões e reporte bugs para melhorar a experiência.',
    action: 'Enviar Feedback'
  }, {
    icon: Users,
    title: 'Divulgação',
    description: 'Ajude a espalhar a palavra sobre o GOV.RP nas suas redes sociais.',
    action: 'Compartilhar'
  }];
  const impactAreas = [{
    icon: Globe,
    title: 'Infraestrutura',
    description: 'Servidores, CDN e ferramentas de desenvolvimento',
    percentage: 40
  }, {
    icon: Code,
    title: 'Desenvolvimento',
    description: 'Novos recursos e melhorias na plataforma',
    percentage: 35
  }, {
    icon: Users,
    title: 'Suporte',
    description: 'Atendimento ao usuário e documentação',
    percentage: 15
  }, {
    icon: Zap,
    title: 'Inovação',
    description: 'Pesquisa e desenvolvimento de novas tecnologias',
    percentage: 10
  }];
  const handleDonation = e => {
    e.preventDefault();
    toast({
      title: "🚧 Funcionalidade em Desenvolvimento",
      description: "O sistema de doações será implementado em breve. Obrigado pelo interesse!"
    });
  };
  const handleQuickDonation = amount => {
    setDonationAmount(amount.toString());
    toast({
      title: "🚧 Funcionalidade em Desenvolvimento",
      description: `Doação de R$ ${amount} selecionada. Sistema será implementado em breve!`
    });
  };
  return <>
      <Helmet>
        <title>Apoie o Projeto - GOV.RP</title>
        <meta name="description" content="Ajude a manter e expandir a plataforma GOV.RP. Sua contribuição faz a diferença!" />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{
        opacity: 0,
        y: 20
      }} animate={{
        opacity: 1,
        y: 0
      }}>
          <div className="text-center mb-16">
            <Heart className="mx-auto h-16 w-16 text-red-400 mb-6" />
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">
              Apoie o <span className="gradient-text">GOV.RP</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-4xl mx-auto leading-relaxed">Sua contribuição é fundamental para manter a plataforma funcionando e em constante evolução. Juntos, estamos construindo o futuro dos RP's políticos.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
            <div>
              <h2 className="text-3xl font-bold text-white mb-8">
                Como Você Pode <span className="gradient-text">Ajudar</span>
              </h2>
              <div className="space-y-6">
                {supportWays.map((way, index) => <Card key={index} className="border-slate-700/50 bg-black/20">
                    <CardContent className="p-6">
                      <div className="flex items-start gap-4">
                        <way.icon className="h-8 w-8 text-blue-400 flex-shrink-0 mt-1" />
                        <div className="flex-1">
                          <h3 className="text-xl font-semibold text-white mb-2">{way.title}</h3>
                          <p className="text-gray-300 mb-4">{way.description}</p>
                          <Button variant="outline" size="sm">
                            {way.action}
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>)}
              </div>
            </div>

            <div>
              <h2 className="text-3xl font-bold text-white mb-8">
                Faça uma <span className="gradient-text">Doação</span>
              </h2>
              
              <Card className="border-slate-700/50 bg-black/20 mb-6">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Gift className="h-5 w-5 text-green-400" />
                    Níveis de Contribuição
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    {donationTiers.slice(0, 4).map((tier, index) => <motion.div key={index} whileHover={{
                    scale: 1.02
                  }} className="p-4 rounded-lg border border-slate-600 bg-slate-800/50 cursor-pointer hover:border-blue-500 transition-colors" onClick={() => handleQuickDonation(tier.amount)}>
                        <div className="flex items-center gap-3 mb-2">
                          <tier.icon className={`h-5 w-5 ${tier.color}`} />
                          <span className="font-semibold text-white">{tier.title}</span>
                        </div>
                        <div className="text-2xl font-bold gradient-text mb-2">R$ {tier.amount}</div>
                        <p className="text-xs text-gray-400">{tier.description}</p>
                      </motion.div>)}
                  </div>

                  <form onSubmit={handleDonation} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="donorName">Nome (Opcional)</Label>
                        <Input id="donorName" value={donorName} onChange={e => setDonorName(e.target.value)} placeholder="Seu nome" />
                      </div>
                      <div>
                        <Label htmlFor="donorEmail">Email (Opcional)</Label>
                        <Input id="donorEmail" type="email" value={donorEmail} onChange={e => setDonorEmail(e.target.value)} placeholder="seu@email.com" />
                      </div>
                    </div>
                    
                    <div>
                      <Label htmlFor="donationAmount">Valor da Doação (R$)</Label>
                      <Input id="donationAmount" type="number" min="1" value={donationAmount} onChange={e => setDonationAmount(e.target.value)} placeholder="Digite o valor" required />
                    </div>

                    <div>
                      <Label htmlFor="donorMessage">Mensagem (Opcional)</Label>
                      <Textarea id="donorMessage" value={donorMessage} onChange={e => setDonorMessage(e.target.value)} placeholder="Deixe uma mensagem de apoio..." rows={3} />
                    </div>

                    <div className="flex gap-3">
                      <Button type="submit" className="flex-1">
                        <CreditCard className="mr-2 h-4 w-4" />
                        Doar com Cartão
                      </Button>
                      <Button type="button" variant="outline" className="flex-1">
                        <Banknote className="mr-2 h-4 w-4" />
                        PIX
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>

              <Card className="border-slate-700/50 bg-black/20">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Coins className="h-5 w-5 text-yellow-400" />
                    Benefícios Exclusivos
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {donationTiers[1].benefits.map((benefit, index) => <div key={index} className="flex items-center gap-3">
                        <CheckCircle className="h-4 w-4 text-green-400 flex-shrink-0" />
                        <span className="text-gray-300">{benefit}</span>
                      </div>)}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="mb-16">
            <h2 className="text-3xl font-bold text-white text-center mb-12">
              Como Usamos os <span className="gradient-text">Recursos</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {impactAreas.map((area, index) => <Card key={index} className="border-slate-700/50 bg-black/20">
                  <CardContent className="p-6 text-center">
                    <area.icon className="h-12 w-12 mx-auto text-blue-400 mb-4" />
                    <h3 className="text-xl font-semibold text-white mb-2">{area.title}</h3>
                    <div className="text-3xl font-bold gradient-text mb-3">{area.percentage}%</div>
                    <p className="text-gray-400 text-sm">{area.description}</p>
                  </CardContent>
                </Card>)}
            </div>
          </div>

          <Card className="border-slate-700/50 bg-black/20">
            <CardHeader>
              <CardTitle className="text-white text-center flex items-center justify-center gap-3">
                <Target className="h-6 w-6 text-green-400" />
                Transparência Total
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-gray-300 text-lg leading-relaxed mb-6">
                Acreditamos na transparência total. Todos os recursos recebidos são utilizados exclusivamente 
                para o desenvolvimento, manutenção e expansão da plataforma GOV.RP. Publicamos relatórios 
                mensais detalhando como cada real foi investido.
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                <div className="bg-slate-800/50 p-6 rounded-lg">
                  <h4 className="font-semibold text-white mb-2">📊 Relatórios Mensais</h4>
                  <p className="text-gray-400 text-sm">Detalhamento completo de todos os gastos e investimentos</p>
                </div>
                <div className="bg-slate-800/50 p-6 rounded-lg">
                  <h4 className="font-semibold text-white mb-2">🔍 Auditoria Externa</h4>
                  <p className="text-gray-400 text-sm">Verificação independente da aplicação dos recursos</p>
                </div>
                <div className="bg-slate-800/50 p-6 rounded-lg">
                  <h4 className="font-semibold text-white mb-2">💬 Comunicação Direta</h4>
                  <p className="text-gray-400 text-sm">Canal direto com apoiadores para esclarecimentos</p>
                </div>
              </div>

              <div className="mt-8 p-6 bg-gradient-to-r from-blue-500/10 to-purple-500/10 rounded-lg border border-blue-500/20">
                <h4 className="text-xl font-semibold text-white mb-3">🎯 Meta Atual: Expansão de Serviços</h4>
                <p className="text-gray-300 mb-4">Estamos trabalhando para adicionar novos serviços como concursos, sistema de saúde e sistema de votação eletrônica. Sua contribuição acelera esse desenvolvimento.</p>
                <div className="w-full bg-slate-700 rounded-full h-3 mb-2">
                  <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-3 rounded-full" style={{
                  width: '65%'
                }}></div>
                </div>
                <p className="text-sm text-gray-400">0% da meta alcançada - R$ 00.00 de R$ 00.00</p>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </>;
};
export default SupportUs;