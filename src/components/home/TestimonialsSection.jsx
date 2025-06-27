import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, MessageSquare as MessageSquareQuote } from 'lucide-react';
import { wrap } from 'popmotion';
import { cn } from '@/lib/utils';

const testimonials = [
  {
    name: 'Carlos "O Estrategista" Silva',
    role: 'Presidente de Orion',
    text: 'O GOV.RP nos deu as ferramentas para construir uma nação do zero. A complexidade dos sistemas, do banco à diplomacia, é simplesmente fantástica. É o paraíso dos RPlayers.',
    avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=500'
  },
  {
    name: 'Julia "A Diplomata" Costa',
    role: 'Embaixadora de Nova Atlântida',
    text: 'A plataforma é incrivelmente estável e a comunidade é super acolhedora. A equipe de suporte é atenciosa e sempre pronta para ajudar. Recomendo para todos que amam RP sério.',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=500'
  },
  {
    name: 'Marcos "O Industrial" Pereira',
    role: 'CEO da Pereira Corp',
    text: 'O sistema de Negócios Livres me permitiu criar um império empresarial. Comprar, vender, contratar... tudo funciona de forma intuitiva. A economia do servidor é viva e dinâmica!',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=500'
  },
  {
    name: 'Beatriz "A Jornalista" Alves',
    role: 'Editora-Chefe do Diário da Nação',
    text: 'Com a rede social X, posso noticiar os eventos mais importantes em tempo real. A liberdade de expressão é total, o que torna o jogo político ainda mais emocionante.',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=500'
  },
  {
    name: 'Ana "A Legisladora" Martins',
    role: 'Deputada Federal de Aethel',
    text: 'A plataforma permite a criação de leis complexas e debates políticos profundos. É a ferramenta definitiva para quem leva o roleplay legislativo a sério.',
    avatar: 'https://images.unsplash.com/photo-1573496359112-58390b9b5185?w=500'
  },
  {
    name: 'Lucas "O Juiz" Oliveira',
    role: 'Ministro do Supremo Tribunal',
    text: 'O sistema judiciário é robusto e permite interpretações constitucionais fascinantes. A imparcialidade da equipe garante um jogo justo para todos os lados.',
    avatar: 'https://images.unsplash.com/photo-1568602471122-7832951cc4c5?w=500'
  }
];

const variants = {
  enter: (direction) => ({
    x: direction > 0 ? 1000 : -1000,
    opacity: 0,
  }),
  center: {
    zIndex: 1,
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    zIndex: 0,
    x: direction < 0 ? 1000 : -1000,
    opacity: 0,
  }),
};

const swipeConfidenceThreshold = 10000;
const swipePower = (offset, velocity) => Math.abs(offset) * velocity;

const TestimonialsSection = () => {
  const [[page, direction], setPage] = useState([0, 0]);
  const testimonialIndex = wrap(0, testimonials.length, page);

  const paginate = (newDirection) => {
    setPage([page + newDirection, newDirection]);
  };

  return (
    <section className="py-24 bg-slate-900/50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            A Voz da <span className="gradient-text">Comunidade</span>
          </h2>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Veja o que nossos cidadãos mais ativos estão dizendo sobre a plataforma.
          </p>
        </motion.div>

        <div className="relative max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="relative max-w-3xl mx-auto h-[400px] flex items-center justify-center overflow-hidden"
          >
            <AnimatePresence initial={false} custom={direction}>
              <motion.div
                key={page}
                custom={direction}
                variants={variants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ x: { type: 'spring', stiffness: 300, damping: 30 }, opacity: { duration: 0.2 } }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={1}
                onDragEnd={(e, { offset, velocity }) => {
                  const swipe = swipePower(offset.x, velocity.x);
                  if (swipe < -swipeConfidenceThreshold) {
                    paginate(1);
                  } else if (swipe > swipeConfidenceThreshold) {
                    paginate(-1);
                  }
                }}
                className="absolute w-full"
              >
                <div className="glass-effect rounded-2xl p-8 md:p-12 text-center border border-white/10">
                  <MessageSquareQuote className="w-12 h-12 text-blue-400 mx-auto mb-6" />
                  <p className="text-xl italic text-gray-200 mb-8">
                    "{testimonials[testimonialIndex].text}"
                  </p>
                  <div className="flex items-center justify-center">
                     <img  className="w-12 h-12 rounded-full object-cover mr-4" alt={`Avatar of ${testimonials[testimonialIndex].name}`} src={testimonials[testimonialIndex].avatar} />
                    <div>
                      <p className="font-bold text-white text-lg">{testimonials[testimonialIndex].name}</p>
                      <p className="text-blue-300">{testimonials[testimonialIndex].role}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>

          <div className="absolute top-1/2 -translate-y-1/2 w-full flex justify-between px-0 md:-px-12 z-10">
            <button onClick={() => paginate(-1)} className="bg-white/10 p-3 rounded-full hover:bg-white/20 transition-colors text-white">
              <ChevronLeft className="w-6 h-6" />
            </button>
            <button onClick={() => paginate(1)} className="bg-white/10 p-3 rounded-full hover:bg-white/20 transition-colors text-white">
              <ChevronRight className="w-6 h-6" />
            </button>
          </div>
          
          <div className="text-center mt-6 flex flex-col items-center gap-4">
             <div className="flex justify-center gap-3">
                {testimonials.map((_, i) => (
                    <button
                        key={i}
                        onClick={() => setPage([i, i > testimonialIndex ? 1 : -1])}
                        className={cn(
                            "w-3 h-3 rounded-full transition-all duration-300",
                            i === testimonialIndex ? "bg-white scale-125" : "bg-gray-600 hover:bg-gray-400"
                        )}
                    />
                ))}
             </div>
             <p className="text-gray-400 font-mono text-sm">{testimonialIndex + 1} / {testimonials.length}</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;