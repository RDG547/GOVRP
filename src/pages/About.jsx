import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Users, Zap, Palette, Shield, Puzzle, Code, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';

const About = () => {
  const { user } = useAuth();

  const teamMembers = [
    { name: 'RDG' },
    { name: 'Damon' },
    { name: 'André' },
    { name: 'André Vitor' },
    { name: 'Gabriel' },
    { name: 'Gabriel Vinícius' },
    { name: 'Ryan' },
    { name: 'Lucas Cândido' },
  ];

  const values = [
    { icon: Palette, title: 'Liberdade Criativa', description: 'Nós fornecemos a tela; você pinta a obra-prima. Crie narrativas, sistemas políticos e economias sem limites.' },
    { icon: Users, title: 'Comunidade Soberana', description: 'Acreditamos no poder da comunidade. O futuro do GOV.RP é moldado pelas vozes e ações dos nossos cidadãos.' },
    { icon: Zap, title: 'Inovação Constante', description: 'O mundo não para, e nós também não. Estamos sempre desenvolvendo novos sistemas para um universo dinâmico.' },
    { icon: Shield, title: 'Imparcialidade e Justiça', description: 'Nosso compromisso é manter um ambiente equilibrado, onde a estratégia e a interpretação de papéis prevalecem.' },
  ];

  return (
    <>
      <Helmet>
        <title>Sobre Nós - GOV.RP</title>
        <meta name="description" content="Descubra a missão, os valores e a equipe por trás do GOV.RP, a mais imersiva plataforma de simulação e roleplay político." />
      </Helmet>

      <div className="overflow-x-hidden">
        <div className="relative py-20 hero-pattern text-center">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <PageHeader
              icon={Users}
              title="A Plataforma Onde a Sua História"
              gradientText="se Torna Legado"
              description="GOV.RP é mais que um jogo. É um universo digital movido pela criatividade, estratégia e colaboração. Fundado por entusiastas de RP, nosso propósito é oferecer uma ferramenta poderosa para a criação de narrativas políticas complexas e imersivas."
              iconColor="text-pink-400"
            />
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
          <motion.div 
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.8 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center mb-24"
          >
            <div>
              <h2 className="text-3xl font-bold text-foreground mb-6">Nossa <span className="gradient-text">Filosofia</span></h2>
              <p className="text-muted-foreground mb-4 leading-relaxed text-lg">
                Nascemos da convicção de que o roleplay é uma forma de arte. Nossa missão é fornecer a infraestrutura tecnológica para que essa arte floresça sem barreiras. Aqui, cada decisão importa, cada aliança tem peso e cada cidadão pode, de fato, mudar o rumo da história.
              </p>
              <p className="text-muted-foreground leading-relaxed text-lg">
                Somos uma plataforma independente, o que nos permite focar 100% na experiência do jogador. O poder está em suas mãos.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <motion.div whileHover={{ y: -5 }} className="glass-effect p-6 rounded-2xl text-center border-border"><Puzzle className="w-10 h-10 mx-auto text-blue-400 mb-3"/><h3 className="text-lg font-bold text-foreground">Sistemas Modulares</h3><p className="text-sm text-muted-foreground">Flexibilidade para criar governos, leis e economias únicas.</p></motion.div>
              <motion.div whileHover={{ y: -5 }} className="glass-effect p-6 rounded-2xl text-center border-border"><Code className="w-10 h-10 mx-auto text-purple-400 mb-3"/><h3 className="text-lg font-bold text-foreground">Tecnologia de Ponta</h3><p className="text-sm text-muted-foreground">Uma plataforma rápida, segura e em constante evolução.</p></motion.div>
            </div>
          </motion.div>

          <div className="my-24">
            <h2 className="text-4xl font-bold text-foreground text-center mb-12">Nossos <span className="gradient-text">Pilares</span></h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
              {values.map((value, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="glass-effect p-8 rounded-2xl text-center hover:bg-accent transition-colors duration-300 border border-border"
                >
                  <div className="inline-block p-4 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-6">
                    <value.icon className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground mb-3">{value.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{value.description}</p>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="my-24">
            <h2 className="text-4xl font-bold text-foreground text-center mb-4">Os Arquitetos da <span className="gradient-text">Plataforma</span></h2>
             <p className="text-center text-muted-foreground max-w-2xl mx-auto mb-12">
              Uma equipe dedicada de desenvolvedores, designers e entusiastas de roleplay que trabalham incansavelmente para construir e manter o universo dinâmico do GOV.RP.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-8">
              {teamMembers.map((member, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="text-center group"
                >
                   <div className="relative inline-block">
                    <img  className="w-24 h-24 md:w-32 md:h-32 mx-auto rounded-full object-cover mb-4 border-4 border-transparent group-hover:border-primary/50 transition-all duration-300" alt={`Avatar de ${member.name}`} src="https://images.unsplash.com/photo-1695938542997-a2c3f39d0dbf" />
                   </div>
                  <h4 className="text-xl font-bold text-foreground">{member.name}</h4>
                </motion.div>
              ))}
            </div>
          </div>

          {!user && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mt-12"
            >
              <div className="glass-effect rounded-2xl p-8 md:p-12">
                <h3 className="text-3xl font-bold text-foreground mb-4">Pronto para Deixar sua Marca?</h3>
                <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
                  A história está sendo escrita agora. Junte-se a nós e comece a construir seu legado no universo do GOV.RP.
                </p>
                <Link to="/register">
                  <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white">
                    Criar Minha Conta Agora
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              </div>
            </motion.div>
          )}

        </div>
      </div>
    </>
  );
};

export default About;