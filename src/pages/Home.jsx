import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Helmet } from 'react-helmet-async';
import { ArrowRight, Users, Shield, Zap, Globe, Star, TrendingUp, Newspaper, Megaphone, Quote, Scale, LandPlot, Gavel } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
const Home = () => {
  const {
    session
  } = useAuth();
  const [stats, setStats] = useState([{
    number: '0',
    label: 'Cidadãos',
    icon: Users
  }, {
    number: '6',
    label: 'Serviços Disponíveis',
    icon: Shield
  }, {
    number: '24/7',
    label: 'Disponibilidade',
    icon: Zap
  }, {
    number: '0',
    label: 'Transações/Mês',
    icon: Globe
  }]);
  useEffect(() => {
    const fetchStats = async () => {
      const {
        data: users,
        error: usersError
      } = await supabase.from('profiles').select('id', {
        count: 'exact'
      });
      if (usersError) {
        console.error("Error fetching user stats:", usersError);
        return;
      }
      setStats(prevStats => [{
        ...prevStats[0],
        number: `${users.length}+`
      }, ...prevStats.slice(1)]);
    };
    fetchStats();
  }, []);
  const services = [{
    name: 'Banco Nacional',
    description: 'Sistema bancário completo com transferências, empréstimos e investimentos',
    icon: '🏦',
    path: '/services/bank',
    color: 'from-green-500 to-emerald-600'
  }, {
    name: 'Negócios Livres',
    description: 'Marketplace completo para compra, venda e negociação entre cidadãos',
    icon: '💼',
    path: '/services/business',
    color: 'from-blue-500 to-cyan-600'
  }, {
    name: 'DIC',
    description: 'Departamento de Identificação Civil - Todas as documentações oficiais',
    icon: '📋',
    path: '/services/dic',
    color: 'from-purple-500 to-violet-600'
  }, {
    name: 'X',
    description: 'Rede social completa inspirada no X para interação política',
    icon: '🐦',
    path: '/services/x',
    color: 'from-indigo-500 to-blue-600'
  }, {
    name: 'Biblioteca Nacional',
    description: 'Acesso a uma vasta coleção de livros e recursos educacionais',
    icon: '📚',
    path: '/services/library',
    color: 'from-orange-500 to-red-600'
  }, {
    name: 'Acervo Digital',
    description: 'Repositório digital com links e recursos diversos',
    icon: '💾',
    path: '/services/digital-archive',
    color: 'from-pink-500 to-rose-600'
  }];
  const news = [{
    title: "Eleições Presidenciais Anunciadas",
    description: "As próximas eleições para presidente da nação foram marcadas. Partidos já se movimentam para lançar seus candidatos.",
    date: "20/06/2025",
    icon: Megaphone
  }, {
    title: "Nova Reforma Econômica Aprovada",
    description: "O congresso aprovou um novo pacote de medidas econômicas visando o crescimento e a estabilidade.",
    date: "18/06/2025",
    icon: TrendingUp
  }, {
    title: "Banco Nacional lança novas linhas de crédito",
    description: "Empreendedores e cidadãos agora têm acesso a novas opções de financiamento para impulsionar a economia.",
    date: "15/06/2025",
    icon: Newspaper
  }];
  const testimonials = [{
    name: "Presidente Silva",
    quote: "O GOV.RP transformou a maneira como fazemos política. É a ferramenta mais completa que já vi.",
    avatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=500"
  }, {
    name: "Empresária Souza",
    quote: "Graças ao marketplace, meu negócio prosperou. A economia virtual é vibrante e cheia de oportunidades.",
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=500"
  }, {
    name: "Jornalista Costa",
    quote: "A rede social X é a minha principal fonte de informação. Tudo acontece lá, em tempo real.",
    avatar: "https://images.unsplash.com/photo-1557862921-37829c790f19?w=500"
  }];
  return <>
      <Helmet>
        <title>GOV.RP - Ecossistema de Roleplay Político</title>
        <meta name="description" content="O ecossistema mais completo para roleplay político. Conecte-se, governe e construa o futuro do seu país virtual com nossos 6 serviços integrados." />
      </Helmet>

      <div className="w-full overflow-x-hidden">
        <section className="relative min-h-screen flex items-center justify-center overflow-hidden hero-pattern">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-900/30 via-purple-900/30 to-slate-900/80" />
          <motion.div className="absolute inset-0" animate={{
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"]
        }} transition={{
          duration: 40,
          ease: "linear",
          repeat: Infinity
        }} style={{
          backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%239C92AC\' fill-opacity=\'0.05\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
          backgroundSize: '300px 300px'
        }} />
          
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div initial={{
            opacity: 0,
            y: 50
          }} animate={{
            opacity: 1,
            y: 0
          }} transition={{
            duration: 0.8
          }}>
              <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-6 gradient-text" initial={{
              scale: 0.5
            }} animate={{
              scale: 1
            }} transition={{
              duration: 0.8,
              delay: 0.2
            }}>
                GOV.RP
              </motion.h1>
              
              <motion.p className="text-xl md:text-2xl text-gray-200 mb-10 max-w-3xl mx-auto" initial={{
              opacity: 0
            }} animate={{
              opacity: 1
            }} transition={{
              duration: 0.8,
              delay: 0.4
            }}>
                O ecossistema definitivo para <span className="text-blue-400 font-semibold">roleplay político</span>. 
                Conecte-se, governe e construa o futuro do seu país virtual.
              </motion.p>

              <motion.div className="flex flex-col sm:flex-row gap-4 justify-center items-center" initial={{
              opacity: 0,
              y: 20
            }} animate={{
              opacity: 1,
              y: 0
            }} transition={{
              duration: 0.8,
              delay: 0.6
            }}>
                {session ? <Link to="/dashboard">
                    <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-4 neon-border rounded-full">
                      Acessar Dashboard
                      <ArrowRight className="ml-2 w-5 h-5" />
                    </Button>
                  </Link> : <>
                  <Link to="/register">
                    <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-8 py-4 neon-border rounded-full">
                      Começar Agora
                      <ArrowRight className="ml-2 w-5 h-5" />
                    </Button>
                  </Link>
                  <Link to="/about">
                    <Button variant="outline" size="lg" className="text-lg px-8 py-4 border-white/20 hover:bg-white/10 rounded-full">
                      Saiba Mais
                    </Button>
                  </Link>
                  </>}
              </motion.div>
            </motion.div>
          </div>

          <motion.div className="absolute bottom-8 left-1/2 transform -translate-x-1/2" animate={{
          y: [0, 10, 0]
        }} transition={{
          duration: 2,
          repeat: Infinity
        }}>
            <div className="w-6 h-10 border-2 border-white/30 rounded-full flex justify-center p-1">
              <motion.div className="w-1 h-3 bg-white/50 rounded-full" animate={{
              y: [0, 12, 0]
            }} transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut"
            }} />
            </div>
          </motion.div>
        </section>

        <section className="py-20 bg-black/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {stats.map((stat, index) => <motion.div key={index} initial={{
              opacity: 0,
              y: 20
            }} whileInView={{
              opacity: 1,
              y: 0
            }} viewport={{
              once: true
            }} transition={{
              duration: 0.6,
              delay: index * 0.1
            }} className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-full mb-4 ring-4 ring-blue-500/20">
                    <stat.icon className="w-8 h-8 text-white" />
                  </div>
                  <div className="text-3xl font-bold text-white mb-2">{stat.number}</div>
                  <div className="text-gray-300">{stat.label}</div>
                </motion.div>)}
            </div>
          </div>
        </section>
        
        <section className="py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <motion.div initial={{
            opacity: 0,
            x: -50
          }} whileInView={{
            opacity: 1,
            x: 0
          }} viewport={{
            once: true
          }} transition={{
            duration: 0.8
          }}>
                <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Explore um Universo de <span className="gradient-text">Possibilidades</span></h2>
                <p className="text-xl text-gray-300 mb-8">No GOV.RP, você não é apenas um jogador, você é um cidadão. Crie leis, funde empresas, participe de eleições e molde o futuro da nação. A plataforma oferece todas as ferramentas para uma imersão política sem precedentes.</p>
                <div className="space-y-4">
                    <div className="flex items-center gap-3"><Gavel className="w-6 h-6 text-orange-400" /><p className="text-lg text-gray-200">Poderes Executivo, Legislativo e Judiciário</p></div>
                    <div className="flex items-center gap-3"><TrendingUp className="w-6 h-6 text-green-400" /><p className="text-lg text-gray-200">Economia Dinâmica</p></div>
                    <div className="flex items-center gap-3"><LandPlot className="w-6 h-6 text-purple-400" /><p className="text-lg text-gray-200">Criação e Gestão de Nações</p></div>
                </div>
              </motion.div>
              <motion.div initial={{
            opacity: 0,
            scale: 0.8
          }} whileInView={{
            opacity: 1,
            scale: 1
          }} viewport={{
            once: true
          }} transition={{
            duration: 0.8,
            delay: 0.2
          }}>
                <img alt="Mapa político estilizado com várias nações e fronteiras" className="rounded-2xl shadow-2xl" src="https://images.unsplash.com/photo-1679830238737-5bc41f101bbb" />
              </motion.div>
          </div>
        </section>

        <section id="services-section" className="py-24 bg-black/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div initial={{
            opacity: 0,
            y: 20
          }} whileInView={{
            opacity: 1,
            y: 0
          }} viewport={{
            once: true
          }} className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Nossos <span className="gradient-text">Serviços</span></h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">Serviços integrados que formam o ecossistema completo para sua experiência de roleplay político</p>
            </motion.div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {services.map((service, index) => <motion.div key={index} initial={{
              opacity: 0,
              y: 20
            }} whileInView={{
              opacity: 1,
              y: 0
            }} viewport={{
              once: true
            }} transition={{
              duration: 0.6,
              delay: index * 0.1
            }} whileHover={{
              y: -8,
              scale: 1.02
            }} className="service-card">
                  <Link to={service.path} className="block h-full">
                    <div className="glass-effect rounded-2xl p-8 h-full hover:bg-white/10 transition-all duration-300 group flex flex-col">
                      <div className={`inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r ${service.color} rounded-xl mb-6 text-2xl group-hover:scale-110 transition-transform`}>{service.icon}</div>
                      <h3 className="text-2xl font-bold text-white mb-4 group-hover:text-blue-400 transition-colors">{service.name}</h3>
                      <p className="text-gray-300 mb-6 leading-relaxed flex-grow">{service.description}</p>
                      <div className="flex items-center text-blue-400 group-hover:text-blue-300 transition-colors mt-auto">
                        <span className="font-medium">Acessar Serviço</span>
                        <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </div>
                  </Link>
                </motion.div>)}
            </div>
          </div>
        </section>
        
        <section className="py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div initial={{
            opacity: 0,
            y: 20
          }} whileInView={{
            opacity: 1,
            y: 0
          }} viewport={{
            once: true
          }} className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Últimas <span className="gradient-text">Notícias</span></h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">Fique por dentro dos acontecimentos mais recentes no universo RP</p>
            </motion.div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {news.map((item, index) => <motion.div key={index} initial={{
              opacity: 0,
              y: 20
            }} whileInView={{
              opacity: 1,
              y: 0
            }} viewport={{
              once: true
            }} transition={{
              duration: 0.6,
              delay: index * 0.1
            }} className="glass-effect rounded-2xl p-6 flex flex-col hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                          <item.icon className="w-6 h-6 text-white" />
                      </div>
                      <h3 className="text-xl font-bold text-white flex-grow">{item.title}</h3>
                    </div>
                    <p className="text-gray-300 mb-4 flex-grow">{item.description}</p>
                    <p className="text-sm text-gray-400 mt-auto">{item.date}</p>
                </motion.div>)}
            </div>
          </div>
        </section>

        <section className="py-24 bg-black/20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div initial={{
            opacity: 0,
            y: 20
          }} whileInView={{
            opacity: 1,
            y: 0
          }} viewport={{
            once: true
          }} className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Voz da <span className="gradient-text">Comunidade</span></h2>
              <p className="text-xl text-gray-300 max-w-3xl mx-auto">Veja o que nossos cidadãos estão dizendo sobre o GOV.RP</p>
            </motion.div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {testimonials.map((item, index) => <motion.div key={index} initial={{
              opacity: 0,
              y: 20
            }} whileInView={{
              opacity: 1,
              y: 0
            }} viewport={{
              once: true
            }} transition={{
              duration: 0.6,
              delay: index * 0.1
            }} className="glass-effect rounded-2xl p-8 text-center flex flex-col">
                  <Quote className="w-10 h-10 text-blue-400/50 mx-auto mb-4" />
                  <p className="text-gray-300 mb-6 flex-grow italic">"{item.quote}"</p>
                  <div className="flex items-center justify-center gap-4 mt-auto">
                    <img src={item.avatar} alt={item.name} className="w-12 h-12 rounded-full object-cover" />
                    <div>
                      <p className="font-bold text-white">{item.name}</p>
                    </div>
                  </div>
                </motion.div>)}
            </div>
          </div>
        </section>

        <section className="py-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div initial={{
            opacity: 0,
            y: 20
          }} whileInView={{
            opacity: 1,
            y: 0
          }} viewport={{
            once: true
          }} className="glass-effect rounded-3xl p-12">
              <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">Pronto para <span className="gradient-text">governar</span>?</h2>
              <p className="text-xl text-gray-300 mb-8 max-w-2xl mx-auto">Cadastre-se agora e comece sua jornada no mundo do roleplay político. Construa sua carreira, faça negócios e influencie o destino do país.</p>
              <Link to="/register">
                <Button size="lg" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-lg px-12 py-4 pulse-glow rounded-full">
                  Cadastre-se
                  <ArrowRight className="ml-2 w-5 h-5" />
                </Button>
              </Link>
            </motion.div>
          </div>
        </section>
      </div>
    </>;
};
export default Home;