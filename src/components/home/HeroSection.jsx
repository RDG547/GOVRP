import React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
const HeroSection = ({
  session
}) => {
  return <section className="relative min-h-screen flex items-center justify-center overflow-hidden hero-pattern">
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
          {/* INÍCIO DA ALTERAÇÃO */}
          <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-black mb-6 text-white" style={{
          textShadow: '2px 2px 0px #8B5CF6, 4px 4px 0px #6D28D9, 6px 6px 0px #5B21B6, 8px 8px 0px rgba(0,0,0,0.3)'
          // boxShadow: '0 0 10px rgba(139, 92, 246, 0.5), 0 0 20px rgba(109, 40, 217, 0.5)'
        }}
        // Animação de pulsação sutil
        animate={{
          scale: [1, 1.05, 1]
        }}
        // Configuração da transição para parecer um batimento cardíaco
        transition={{
          duration: 3,
          // O "batimento" (expandir e contrair) leva 2 segundos
          ease: "easeInOut",
          // Suaviza o movimento
          repeat: Infinity,
          // Repete para sempre
          repeatDelay: 0.5 // Pausa de meio segundo entre cada batimento
        }}>GOV.RP</motion.h1>
          {/* FIM DA ALTERAÇÃO */}

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


    </section>;
};
export default HeroSection;
