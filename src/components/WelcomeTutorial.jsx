import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { ArrowRight, ArrowLeft, Check, Sparkles, LayoutDashboard, Landmark, Users, MessageSquare, Scale, BriefcaseBusiness, Newspaper, Shield, Vote, GraduationCap, FileText } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const introductionStep =
  {
    icon: Sparkles,
    title: 'Sua jornada começa agora',
    description: 'Sua cidadania foi reconhecida. Este tour foi preparado a partir da aspiração escolhida, sem limitar nenhum caminho futuro.',
    target: null,
    gradient: 'from-purple-500 to-indigo-600',
  };

const step = (icon, title, description, gradient = 'from-blue-500 to-cyan-600') => ({ icon, title, description, target: null, gradient });

const tutorialPaths = {
  politics: [
    step(LayoutDashboard, 'Dashboard', 'Acompanhe sua situação e os próximos passos recomendados.'),
    step(Users, 'Partidos', 'Conheça as legendas e escolha se deseja construir uma filiação.'),
    step(Landmark, 'Parlamento', 'Acompanhe propostas, debates e decisões legislativas.', 'from-yellow-500 to-amber-600'),
    step(Vote, 'Eleições', 'Veja o calendário eleitoral e prepare uma futura candidatura.', 'from-emerald-500 to-green-600'),
    step(MessageSquare, 'Rede X', 'Construa influência e participe do debate público.', 'from-sky-500 to-blue-600'),
  ],
  entrepreneurship: [
    step(LayoutDashboard, 'Dashboard', 'Acompanhe sua evolução econômica e os primeiros objetivos.'),
    step(Landmark, 'Banco Nacional', 'Use sua conta, transferências e produtos financeiros.', 'from-green-500 to-emerald-600'),
    step(BriefcaseBusiness, 'Negócios Livres', 'Conheça o comércio e as oportunidades entre cidadãos.'),
    step(BriefcaseBusiness, 'Portal do Empreendedor', 'Estruture empresas e acompanhe sua atividade econômica.'),
    step(Sparkles, 'Economia e investimentos', 'Observe indicadores e tome decisões com base no cenário do país.'),
  ],
  justice: [
    step(LayoutDashboard, 'Dashboard', 'Acompanhe sua situação civil e jurídica.'),
    step(Scale, 'Sistema de Justiça', 'Conheça processos, serviços e instituições jurídicas.', 'from-violet-500 to-purple-600'),
    step(Landmark, 'Leis e Parlamento', 'Acompanhe como as normas são propostas e aprovadas.'),
    step(Shield, 'Antecedentes', 'Seu histórico é construído por fatos do gameplay, nunca escolhido no cadastro.'),
    step(GraduationCap, 'Carreiras jurídicas', 'Busque formação e oportunidades quando estiverem disponíveis.'),
  ],
  security: [
    step(LayoutDashboard, 'Dashboard', 'Acompanhe sua situação e serviços recomendados.'),
    step(Shield, 'Segurança e Justiça', 'Conheça as instituições que protegem a sociedade.', 'from-slate-500 to-slate-700'),
    step(FileText, 'Boletins e denúncias', 'Use os canais oficiais quando precisar registrar uma ocorrência.'),
    step(Scale, 'Responsabilidade legal', 'Ações de segurança também produzem histórico e auditoria.'),
    step(Users, 'Carreira policial', 'Acompanhe requisitos e processos seletivos quando disponíveis.'),
  ],
  communication: [
    step(LayoutDashboard, 'Dashboard', 'Veja sua situação e as recomendações iniciais.'),
    step(MessageSquare, 'Rede X', 'Publique, converse e construa sua presença pública.', 'from-sky-500 to-blue-600'),
    step(Newspaper, 'Notícias e imprensa', 'Acompanhe acontecimentos e participe do ecossistema de informação.'),
    step(Landmark, 'Política', 'Entenda as pautas que movimentam o debate nacional.'),
    step(Sparkles, 'Reputação e influência', 'Esses valores nascem das suas ações e relações no GOVRP.'),
  ],
  knowledge: [
    step(LayoutDashboard, 'Dashboard', 'Organize seus próximos passos e acompanhe seu progresso.'),
    step(GraduationCap, 'Educação', 'Desenvolva formação e qualificação dentro do sistema.'),
    step(BriefcaseBusiness, 'Carreira', 'Construa experiência profissional por meio do gameplay.'),
    step(Landmark, 'Serviços públicos', 'Explore os recursos disponíveis para todos os cidadãos.'),
    step(Users, 'Comunidade', 'Crie relações e descubra novas possibilidades.'),
  ],
  civil_life: [
    step(LayoutDashboard, 'Dashboard', 'Este é o centro da sua vida no GOVRP.'),
    step(Landmark, 'Banco Nacional', 'Conheça sua conta e organize sua vida financeira.', 'from-green-500 to-emerald-600'),
    step(MessageSquare, 'Rede X', 'Converse com outros cidadãos e acompanhe a comunidade.', 'from-sky-500 to-blue-600'),
    step(Scale, 'Serviços e Justiça', 'Use os serviços públicos disponíveis quando precisar.'),
    step(Users, 'Explore livremente', 'Você pode mudar de objetivo e seguir qualquer trajetória.'),
  ],
};

const WelcomeTutorial = () => {
  const { user, session, refreshUser, triggerTutorial, setTriggerTutorial } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [highlightedElement, setHighlightedElement] = useState(null);
  const [hasFinishedInitialTutorial, setHasFinishedInitialTutorial] = useState(false);
  const steps = useMemo(
    () => [introductionStep, ...(tutorialPaths[user?.initial_aspiration] || tutorialPaths.civil_life)],
    [user?.initial_aspiration]
  );

  const startTutorial = useCallback((manual = false) => {
    setIsOpen(true);
    setStep(0);
    setDontShowAgain(false);
    if (manual && setTriggerTutorial) {
      setTriggerTutorial(false);
    }
  }, [setTriggerTutorial]);

  useEffect(() => {
    if (triggerTutorial) {
      startTutorial(true);
    }
  }, [triggerTutorial, startTutorial]);

  useEffect(() => {
    if (
      user &&
      session &&
      user.onboarding_completed === true &&
      user.has_seen_tutorial === false &&
      !isOpen &&
      !hasFinishedInitialTutorial
    ) {
      startTutorial(false);
    }
  }, [user, session, startTutorial, isOpen, hasFinishedInitialTutorial]);

  useEffect(() => {
    if (isOpen) {
      const currentStep = steps[step];
      if (currentStep.target) {
        const element = document.querySelector(currentStep.target);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setHighlightedElement(element);
          element.style.transition = 'all 0.3s ease-in-out';
          element.style.boxShadow = '0 0 0 4px hsl(var(--primary)), 0 0 20px 10px hsla(var(--primary), 0.5)';
          element.style.borderRadius = '8px';
          element.style.zIndex = '10001';
          element.style.position = 'relative';
        }
      }
      return () => {
        if (highlightedElement) {
          highlightedElement.style.boxShadow = '';
          highlightedElement.style.zIndex = '';
          highlightedElement.style.position = '';
        }
      };
    }
  }, [step, isOpen, highlightedElement]);

  const cleanHighlight = () => {
    if (highlightedElement) {
      highlightedElement.style.boxShadow = '';
      highlightedElement.style.zIndex = '';
      highlightedElement.style.position = '';
    }
    setHighlightedElement(null);
  };

  const handleNext = () => {
    cleanHighlight();
    setStep(prev => Math.min(prev + 1, steps.length - 1));
  };
  const handlePrev = () => {
    cleanHighlight();
    setStep(prev => Math.max(prev - 1, 0));
  };

  const handleFinish = async () => {
    cleanHighlight();
    setIsOpen(false);
    if (user?.has_seen_tutorial === false) {
      setHasFinishedInitialTutorial(true);
        try {
        const { error } = await supabase.rpc('mark_tutorial_seen', { p_dont_show_again: dontShowAgain });
            if (error) throw error;
            await refreshUser();
        } catch (error) {
            console.error('Failed to update tutorial preference:', error);
        }
    }
  };

  const handleSkip = () => {
    handleFinish();
  };

  if (!isOpen) return null;

  const currentStepData = steps[step];

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-[10000]" onClick={handleSkip} />
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleFinish()}>
        <AnimatePresence>
          <DialogContent className="p-0 overflow-hidden glass-effect border-border max-w-md z-[10001]" onInteractOutside={(e) => e.preventDefault()}>
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="p-8 text-center"
            >
              <div className={`w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center bg-gradient-to-br ${currentStepData.gradient}`}>
                <currentStepData.icon className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-3xl font-bold text-foreground mb-3">{currentStepData.title}</h2>
              <p className="text-muted-foreground text-base">{currentStepData.description}</p>
            </motion.div>

            <div className="p-6 bg-background/50 flex flex-col sm:flex-row items-center justify-between gap-4">
              {user?.has_seen_tutorial === false && (
                <div className="flex items-center space-x-2">
                  <Checkbox id="dont-show-again" checked={dontShowAgain} onCheckedChange={setDontShowAgain} />
                  <Label htmlFor="dont-show-again" className="text-sm text-muted-foreground">Não mostrar novamente</Label>
                </div>
              )}
              <div className="flex items-center gap-2 ml-auto">
                <Button variant="ghost" onClick={handleSkip} className="text-muted-foreground">Pular</Button>
                <Button variant="outline" onClick={handlePrev} disabled={step === 0}><ArrowLeft className="w-4 h-4" /></Button>
                {step < steps.length - 1 ? (
                  <Button onClick={handleNext}><ArrowRight className="w-4 h-4" /></Button>
                ) : (
                  <Button onClick={handleFinish} className="bg-green-600 hover:bg-green-700">Concluir <Check className="w-4 h-4 ml-2" /></Button>
                )}
              </div>
            </div>
             <div className="w-full h-1 bg-background/50">
                <motion.div
                    className="h-1 bg-primary"
                    initial={{ width: `${(step / steps.length) * 100}%` }}
                    animate={{ width: `${((step + 1) / steps.length) * 100}%`}}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                />
            </div>
          </DialogContent>
        </AnimatePresence>
      </Dialog>
    </>
  );
};

export default WelcomeTutorial;
