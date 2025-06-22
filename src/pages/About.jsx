
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Target, 
  Eye, 
  Heart, 
  Users, 
  Globe, 
  Shield, 
  Zap, 
  Award,
  Lightbulb,
  Rocket,
  Star,
  CheckCircle,
  TrendingUp,
  Code,
  Database,
  Smartphone
} from 'lucide-react';

const About = () => {
  const values = [
    {
      icon: Shield,
      title: 'Segurança',
      description: 'Proteção máxima dos dados pessoais e financeiros dos cidadãos com criptografia de ponta.'
    },
    {
      icon: Users,
      title: 'Inclusão',
      description: 'Plataforma acessível para todos, independente de conhecimento técnico ou condição social.'
    },
    {
      icon: Zap,
      title: 'Inovação',
      description: 'Tecnologia de vanguarda aplicada para simplificar processos burocráticos complexos.'
    },
    {
      icon: Heart,
      title: 'Transparência',
      description: 'Operações claras e auditáveis, com total visibilidade dos processos governamentais.'
    }
  ];

  const features = [
    {
      icon: Globe,
      title: 'Ecossistema Integrado',
      description: 'Todos os serviços conectados em uma única plataforma unificada.'
    },
    {
      icon: Database,
      title: 'Dados Centralizados',
      description: 'Informações seguras e organizadas em um banco de dados robusto.'
    },
    {
      icon: Smartphone,
      title: 'Acesso Universal',
      description: 'Disponível 24/7 em qualquer dispositivo com conexão à internet.'
    },
    {
      icon: Code,
      title: 'Open Source',
      description: 'Código aberto para transparência e colaboração da comunidade.'
    }
  ];

  const achievements = [
    { number: '100%', label: 'Digital', description: 'Processos completamente digitalizados' },
    { number: '24/7', label: 'Disponibilidade', description: 'Acesso ininterrupto aos serviços' },
    { number: '0', label: 'Filas', description: 'Eliminação total de esperas presenciais' },
    { number: '∞', label: 'Escalabilidade', description: 'Capacidade ilimitada de crescimento' }
  ];

  const timeline = [
    {
      year: '2024',
      title: 'Concepção',
      description: 'Idealização da plataforma GOV.RP como solução para modernização dos serviços públicos.'
    },
    {
      year: '2024',
      title: 'Desenvolvimento',
      description: 'Criação da arquitetura base com React, Supabase e tecnologias modernas.'
    },
    {
      year: '2024',
      title: 'Lançamento Beta',
      description: 'Disponibilização da versão inicial com serviços bancários e rede social.'
    },
    {
      year: '2025',
      title: 'Expansão',
      description: 'Planejamento para novos serviços e integração com órgãos governamentais.'
    }
  ];

  return (
    <>
      <Helmet>
        <title>Sobre Nós - GOV.RP</title>
        <meta name="description" content="Conheça a missão, visão e valores da plataforma GOV.RP - revolucionando os serviços públicos digitais." />
      </Helmet>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="text-center mb-16">
            <Target className="mx-auto h-16 w-16 text-blue-400 mb-6" />
            <h1 className="text-4xl md:text-6xl font-bold text-white mb-6">
              Sobre o <span className="gradient-text">GOV.RP</span>
            </h1>
            <p className="text-xl text-gray-300 max-w-4xl mx-auto leading-relaxed">
              Somos uma plataforma revolucionária que reimagina como os cidadãos interagem com serviços públicos. 
              Nossa missão é criar um ecossistema digital completo, seguro e acessível para todos.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
            <Card className="border-slate-700/50 bg-black/20">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-3">
                  <Target className="h-6 w-6 text-blue-400" />
                  Nossa Missão
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-300 text-lg leading-relaxed">
                  Democratizar o acesso aos serviços públicos através da tecnologia, eliminando barreiras burocráticas 
                  e criando uma experiência cidadã verdadeiramente digital, eficiente e humanizada.
                </p>
              </CardContent>
            </Card>

            <Card className="border-slate-700/50 bg-black/20">
              <CardHeader>
                <CardTitle className="text-white flex items-center gap-3">
                  <Eye className="h-6 w-6 text-purple-400" />
                  Nossa Visão
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-300 text-lg leading-relaxed">
                  Ser a plataforma de referência mundial em serviços públicos digitais, inspirando governos 
                  a adotarem soluções tecnológicas centradas no cidadão e na transparência.
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="mb-16">
            <h2 className="text-3xl font-bold text-white text-center mb-12">
              Nossos <span className="gradient-text">Valores</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {values.map((value, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Card className="border-slate-700/50 bg-black/20 h-full">
                    <CardHeader className="text-center">
                      <value.icon className="h-12 w-12 mx-auto text-blue-400 mb-4" />
                      <CardTitle className="text-white">{value.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-gray-300 text-center">{value.description}</p>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
            </div>
          </div>

          <div className="mb-16">
            <h2 className="text-3xl font-bold text-white text-center mb-12">
              Diferenciais <span className="gradient-text">Tecnológicos</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {features.map((feature, index) => (
                <Card key={index} className="border-slate-700/50 bg-black/20">
                  <CardHeader>
                    <CardTitle className="text-white flex items-center gap-3">
                      <feature.icon className="h-6 w-6 text-green-400" />
                      {feature.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-300">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="mb-16">
            <h2 className="text-3xl font-bold text-white text-center mb-12">
              Conquistas e <span className="gradient-text">Impacto</span>
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {achievements.map((achievement, index) => (
                <Card key={index} className="border-slate-700/50 bg-black/20 text-center">
                  <CardContent className="pt-6">
                    <div className="text-4xl font-bold gradient-text mb-2">{achievement.number}</div>
                    <div className="text-xl font-semibold text-white mb-2">{achievement.label}</div>
                    <p className="text-gray-400 text-sm">{achievement.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          <div className="mb-16">
            <h2 className="text-3xl font-bold text-white text-center mb-12">
              Nossa <span className="gradient-text">Jornada</span>
            </h2>
            <div className="space-y-8">
              {timeline.map((item, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.2 }}
                  className="flex items-start gap-6"
                >
                  <div className="flex-shrink-0 w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-500 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold">{item.year}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-2">{item.title}</h3>
                    <p className="text-gray-300">{item.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          <Card className="border-slate-700/50 bg-black/20">
            <CardHeader>
              <CardTitle className="text-white text-center flex items-center justify-center gap-3">
                <Rocket className="h-6 w-6 text-yellow-400" />
                O Futuro dos Serviços Públicos
              </CardTitle>
            </CardHeader>
            <CardContent className="text-center">
              <p className="text-gray-300 text-lg leading-relaxed mb-6">
                O GOV.RP representa mais que uma plataforma digital - é uma nova forma de pensar a relação 
                entre governo e cidadão. Através da tecnologia, criamos pontes que conectam necessidades 
                reais com soluções eficientes, sempre priorizando a experiência humana.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-8">
                <div className="flex flex-col items-center">
                  <Lightbulb className="h-8 w-8 text-yellow-400 mb-3" />
                  <h4 className="font-semibold text-white mb-2">Inovação Contínua</h4>
                  <p className="text-gray-400 text-sm">Sempre evoluindo com as melhores práticas tecnológicas</p>
                </div>
                <div className="flex flex-col items-center">
                  <Star className="h-8 w-8 text-purple-400 mb-3" />
                  <h4 className="font-semibold text-white mb-2">Excelência</h4>
                  <p className="text-gray-400 text-sm">Compromisso com a qualidade em cada detalhe</p>
                </div>
                <div className="flex flex-col items-center">
                  <TrendingUp className="h-8 w-8 text-green-400 mb-3" />
                  <h4 className="font-semibold text-white mb-2">Crescimento</h4>
                  <p className="text-gray-400 text-sm">Expansão constante de serviços e funcionalidades</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </>
  );
};

export default About;
