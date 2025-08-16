import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Search, ArrowRight, User, Server, AlertTriangle, HelpCircle, Scale, Briefcase, Heart, Crown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/layout/PageHeader';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqData = [
  // Geral
  { category: 'Geral', question: 'O que é o GOV.RP?', answer: 'GOV.RP é um ecossistema completo e imersivo de roleplay (RP) político. Aqui, você pode criar seu personagem, fundar nações, entrar na política, abrir negócios e interagir com uma comunidade ativa.' },
  { category: 'Geral', question: 'O GOV.RP é gratuito?', answer: 'Sim, a plataforma é 100% gratuita. Mantemos o projeto através de doações voluntárias da nossa comunidade, o que nos permite operar sem custos para os jogadores.' },
  { category: 'Geral', question: 'Como posso me juntar à comunidade?', answer: 'É fácil! Você pode entrar em nossos grupos de WhatsApp, Discord ou Telegram. Os links estão disponíveis na página da Comunidade. É a melhor forma de ficar por dentro de tudo e conhecer outros jogadores.' },

  // Conta
  { category: 'Sua Conta', question: 'Como posso me cadastrar?', answer: 'O cadastro é rápido! Basta clicar em "Cadastrar" no canto superior direito, preencher o formulário e confirmar seu e-mail. Em poucos minutos, você será um cidadão oficial do GOV.RP.' },
  { category: 'Sua Conta', question: 'Esqueci minha senha, o que fazer?', answer: 'Na página de login, clique em "Esqueceu a senha?". Você poderá redefinir sua senha através de um link enviado para o seu e-mail de cadastro.' },
  { category: 'Sua Conta', question: 'Como posso alterar meus dados pessoais?', answer: 'Você pode atualizar a maioria dos seus dados, como nome de usuário ou avatar, na página de "Configurações" do seu perfil após fazer o login.' },
  { category: 'Sua Conta', question: 'É seguro fornecer meus dados?', answer: 'Sim. Levamos a segurança a sério e usamos criptografia de ponta. Seus dados são usados apenas para fins da plataforma, conforme nossa Política de Privacidade.' },

  // Serviços
  { category: 'Serviços', question: 'Quais são os serviços disponíveis?', answer: 'Oferecemos uma vasta gama de serviços, incluindo Banco Nacional, Negócios Livres, DIC (documentos), a rede social X, Parlamento, Sistema Penal, Eleições, e painéis para corporações como Polícia, AGIES e Forças Armadas. Estamos sempre em expansão para enriquecer o universo do GOV.RP.' },
  { category: 'Serviços', question: 'Como funciona o sistema de governo?', answer: 'Nosso sistema é flexível. Os cidadãos podem criar partidos, lançar candidaturas, participar de eleições e, uma vez no poder, propor e votar em leis que moldam o futuro de suas nações.' },
  { category: 'Serviços', question: 'Posso criar meu próprio país?', answer: 'Sim! A criação de nações é um dos pilares do GOV.RP. Você pode fundar seu próprio país, definir sua forma de governo, criar sua bandeira, hino e cultura.' },

  // Economia & Negócios
  { category: 'Economia & Negócios', question: 'Como ganho dinheiro no jogo?', answer: 'Existem várias formas! Você pode receber um salário correspondente ao seu cargo público, abrir seu próprio negócio através do serviço "Negócios Livres", fazendo investimentos através do Banco Nacional, trabalhando para outros jogadores, ou através da Renda Cidadã semanal.' },
  { category: 'Economia & Negócios', question: 'O que é a Renda Cidadã?', answer: 'É um benefício semanal pago a todos os cidadãos com conta bancária para garantir um poder de compra mínimo. O valor e o dia do pagamento são definidos pela administração e podem ser consultados no Painel do Admin.' },
  { category: 'Economia & Negócios', question: 'O que posso fazer com o Banco Nacional?', answer: 'No Banco Nacional, você pode guardar seu dinheiro com segurança, realizar transferências para outros cidadãos, solicitar empréstimos e aplicar seu dinheiro em opções de investimento para obter rendimentos.' },
  { category: 'Economia & Negócios', question: 'Como abro uma empresa?', answer: 'Através do serviço "Negócios Livres", você pode registrar sua empresa, definir seu ramo de atuação, contratar funcionários e participar ativamente da economia do servidor, vendendo produtos e serviços.' },
  
  // Roleplay & Regras
  { category: 'Roleplay & Regras', question: 'O que é "Metagaming" e por que é proibido?', answer: 'Metagaming é usar informações que você sabe fora do jogo (Out of Character - OOC) para ganhar vantagens dentro do jogo (In Character - IC). É proibido para garantir um roleplay justo e imersivo para todos.' },
  { category: 'Roleplay & Regras', question: 'O que é "Powergaming"?', answer: 'Powergaming é forçar ações sobre outros jogadores sem lhes dar a oportunidade de reagir, ou realizar feitos que seriam impossíveis para seu personagem. Isso também prejudica a justiça e a imersão do jogo.' },
  { category: 'Roleplay & Regras', question: 'O que acontece se eu quebrar uma regra?', answer: 'Dependendo da gravidade, as consequências vão desde advertências verbais até suspensão temporária ou banimento permanente da plataforma. Nosso objetivo é manter um ambiente divertido e justo.' },

  // Administração
  { category: 'Administração', question: 'O que é o Painel do Admin?', answer: 'É uma área restrita para administradores da plataforma. Ele permite gerenciar usuários, moderar conteúdo, ajustar configurações do sistema (como a Renda Cidadã) e visualizar análises gerais.' },
  { category: 'Administração', question: 'Como me torno um administrador?', answer: 'Os administradores são selecionados pela equipe fundadora com base na confiança, tempo de comunidade e contribuições para o projeto. Não há um processo de candidatura aberto.' },
  { category: 'Administração', question: 'Um admin pode alterar o saldo da minha conta?', answer: 'Sim. Administradores têm a capacidade de adicionar ou remover fundos das contas dos usuários. Essa ferramenta é usada para corrigir erros, aplicar multas de RP ou distribuir recompensas de eventos, sempre com transparência.' },

  // Técnico
  { category: 'Técnico', question: 'Como posso entrar em contato com o suporte?', answer: 'Para problemas técnicos, visite nossa página de "Suporte" e abra um ticket detalhando o problema. Nossa equipe responderá o mais rápido possível.' },
  { category: 'Técnico', question: 'Onde posso relatar um bug?', answer: 'Você pode relatar bugs diretamente na nossa Central de Suporte. Detalhes como prints e uma boa descrição do que aconteceu são sempre bem-vindos para nos ajudar a corrigir o problema.' },
  { category: 'Técnico', question: 'O site está lento, o que posso fazer?', answer: 'Tente limpar o cache do seu navegador. Se o problema persistir, verifique sua conexão com a internet. Se ainda assim estiver lento, entre em contato com nosso suporte para investigarmos.' },

  // Doações
  { category: 'Doações', question: 'Para onde vai minha doação?', answer: '100% da sua doação é revertida para custos de infraestrutura (servidores, banco de dados), desenvolvimento de novos recursos e manutenção geral da plataforma.' },
  { category: 'Doações', question: 'A doação é recorrente?', answer: 'Não. Todas as doações são únicas. Você pode doar novamente sempre que desejar, mas não há cobranças automáticas.' },
  { category: 'Doações', question: 'Recebo alguma recompensa por doar?', answer: 'No momento, as doações não oferecem recompensas dentro do jogo ou plataforma. Seu apoio é um ato de generosidade para manter o projeto vivo e acessível a todos. Agradecemos imensamente!' },
];

const categories = [
  { id: 'Geral', name: 'Geral', icon: HelpCircle },
  { id: 'Sua Conta', name: 'Sua Conta', icon: User },
  { id: 'Serviços', name: 'Serviços', icon: Server },
  { id: 'Economia & Negócios', name: 'Economia', icon: Briefcase },
  { id: 'Administração', name: 'Administração', icon: Crown },
  { id: 'Doações', name: 'Doações', icon: Heart },
  { id: 'Roleplay & Regras', name: 'Regras de RP', icon: Scale },
  { id: 'Técnico', name: 'Técnico', icon: AlertTriangle },
];

const FAQ = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState('Geral');

  const filteredFaq = faqData.filter(item =>
    item.category === activeCategory &&
    (item.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.answer.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <>
      <Helmet>
        <title>FAQ - GOV.RP</title>
        <meta name="description" content="Perguntas Frequentes sobre o GOV.RP. Encontre respostas para as dúvidas mais comuns." />
      </Helmet>

      <div className="min-h-screen py-24">
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <PageHeader
                icon={HelpCircle}
                title="Perguntas"
                gradientText="Frequentes"
                description="Tem alguma dúvida? Navegue pelas categorias ou pesquise para encontrar sua resposta."
                iconColor="text-yellow-400"
            />

          <div className="mb-12">
            <div className="flex flex-wrap justify-center gap-2 md:gap-4 mb-8">
              {categories.map(cat => (
                <Button key={cat.id} variant={activeCategory === cat.id ? "default" : "outline"}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn("border-white/20 text-white", activeCategory === cat.id && "bg-gradient-to-r from-blue-600 to-purple-600 border-transparent")}
                >
                  <cat.icon className="w-4 h-4 mr-2" />
                  {cat.name}
                </Button>
              ))}
            </div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                type="text"
                placeholder={`Pesquisar em "${activeCategory}"...`}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-6 text-lg bg-white/5 border-white/10 rounded-lg text-white placeholder-gray-400 focus:ring-blue-500"
              />
            </motion.div>
          </div>

          <Accordion type="single" collapsible className="w-full space-y-4">
            <AnimatePresence>
            {filteredFaq.map((item, index) => (
               <motion.div
                key={item.question}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
               >
                <AccordionItem value={item.question} className="glass-effect rounded-lg border border-white/10 overflow-hidden">
                  <AccordionTrigger className="p-6 text-lg font-semibold text-white hover:no-underline text-left">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="px-6 pb-6 text-gray-300">
                    <p>{item.answer}</p>
                  </AccordionContent>
                </AccordionItem>
              </motion.div>
            ))}
            </AnimatePresence>
          </Accordion>
          
          {filteredFaq.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-12 glass-effect rounded-lg"
            >
              <h3 className="text-2xl font-bold text-white">Nenhuma pergunta encontrada</h3>
              <p className="text-gray-400 mt-2">Tente um termo de busca diferente ou selecione outra categoria.</p>
            </motion.div>
          )}

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-16 text-center">
            <h3 className="text-2xl font-bold text-white mb-4">Não encontrou sua resposta?</h3>
            <p className="text-gray-300 mb-6 max-w-xl mx-auto">Nossa equipe de suporte está pronta para ajudar com qualquer outra dúvida que você possa ter.</p>
            <Link to="/contact">
              <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:scale-105 transition-transform">
                Entre em Contato <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </motion.div>

        </section>
      </div>
    </>
  );
};

export default FAQ;