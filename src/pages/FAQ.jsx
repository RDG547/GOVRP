import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { Plus, Minus, Search, ArrowRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

const faqData = [
  {
    question: 'O que é o GOV.RP?',
    answer: 'GOV.RP é um ecossistema completo e imersivo de roleplay (RP) político. Aqui, você pode criar seu personagem, fundar ou participar de nações, entrar na política, abrir negócios, e interagir com uma comunidade vibrante. É uma simulação de um mundo político virtual, com todos os sistemas necessários para uma experiência autêntica.'
  },
  {
    question: 'Como posso me cadastrar?',
    answer: 'O cadastro é rápido e gratuito! Basta clicar no botão "Cadastrar" no canto superior direito, preencher o formulário com seus dados (nome, email, etc.), gerar seus documentos virtuais (CPF/RG) e confirmar seu e-mail. Em poucos minutos, você será um cidadão oficial do GOV.RP.'
  },
  {
    question: 'Quais são os serviços disponíveis?',
    answer: 'Oferecemos um conjunto de 6 serviços integrados para enriquecer sua experiência: o Banco Nacional para suas finanças, Negócios Livres para comércio, o DIC para seus documentos, a rede social X para interação, e a Biblioteca Nacional e Acervo Digital como fontes de conhecimento.'
  },
  {
    question: 'O GOV.RP é gratuito?',
    answer: 'Sim, a plataforma é 100% gratuita. Acreditamos que a experiência de roleplay deve ser acessível a todos. Mantemos o projeto através de doações voluntárias da nossa incrível comunidade, o que nos permite operar sem custos para os jogadores e sem anúncios.'
  },
  {
    question: 'Como funciona o sistema de governo?',
    answer: 'Nosso sistema é flexível e dinâmico. Os cidadãos podem criar partidos políticos, lançar candidaturas para cargos legislativos e executivos, participar de eleições democráticas e, uma vez no poder, propor e votar em leis que moldam o futuro de suas nações. A diplomacia e as relações internacionais também são uma parte crucial do jogo.'
  },
  {
    question: 'Posso criar meu próprio país?',
    answer: 'Sim! A criação de nações é um dos pilares do GOV.RP. Você pode fundar seu próprio país, definir sua forma de governo (democracia, monarquia, etc.), criar sua bandeira, hino, leis e cultura. É a sua chance de construir a sociedade utópica que você sempre sonhou (ou uma distopia, se preferir).'
  },
  {
    question: 'Como posso entrar em contato com o suporte?',
    answer: 'Se precisar de ajuda, temos vários canais! Você pode usar a página de "Contato" para enviar um ticket diretamente para nossa equipe. Para ajuda mais rápida e interação com outros jogadores, recomendamos entrar em nossa comunidade no Discord ou WhatsApp.'
  }
];

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filteredFaq = faqData.filter(item =>
    item.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
    item.answer.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      <Helmet>
        <title>FAQ - GOV.RP</title>
        <meta name="description" content="Perguntas Frequentes sobre o GOV.RP. Encontre respostas para as dúvidas mais comuns sobre nossa plataforma de roleplay político." />
      </Helmet>

      <div className="min-h-screen py-20">
        <section className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mb-16"
          >
            <h1 className="text-5xl md:text-6xl font-bold text-white mb-6">
              Perguntas <span className="gradient-text">Frequentes</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
              Tem alguma dúvida? Confira as respostas para as perguntas mais comuns sobre o GOV.RP.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="relative mb-12"
          >
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="Pesquisar por uma dúvida..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-6 text-lg bg-white/5 border-white/10 rounded-lg text-white placeholder-gray-400 focus:ring-blue-500"
            />
          </motion.div>

          <div className="space-y-4">
            {filteredFaq.map((item, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + index * 0.05 }}
                className="glass-effect rounded-lg overflow-hidden"
              >
                <button
                  onClick={() => setOpenIndex(openIndex === index ? null : index)}
                  className="w-full flex justify-between items-center p-6 text-left"
                >
                  <h2 className="text-lg font-semibold text-white">{item.question}</h2>
                  <motion.div animate={{ rotate: openIndex === index ? 180 : 0 }} className="text-blue-400">
                    <Plus />
                  </motion.div>
                </button>
                <AnimatePresence>
                  {openIndex === index && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <p className="px-6 pb-6 text-gray-300 leading-relaxed">{item.answer}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>

          {filteredFaq.length === 0 && (
             <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 text-gray-400"
            >
              <p>Nenhuma pergunta encontrada para "{searchTerm}".</p>
              <p>Tente refinar sua busca ou entre em contato com nosso suporte.</p>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="text-center mt-16"
          >
            <div className="glass-effect rounded-2xl p-8">
              <h3 className="text-2xl font-bold text-white mb-4">Ainda com dúvidas?</h3>
              <p className="text-gray-300 mb-6 max-w-xl mx-auto">
                Se não encontrou a resposta que procurava, nossa equipe de suporte está pronta para ajudar.
              </p>
              <Link to="/contact">
                <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                  Fale Conosco <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              </Link>
            </div>
          </motion.div>

        </section>
      </div>
    </>
  );
};

export default FAQ;