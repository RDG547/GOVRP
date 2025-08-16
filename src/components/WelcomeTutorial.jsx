import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { ArrowRight, ArrowLeft, Check, Sparkles, LayoutDashboard, Landmark, Users, MessageSquare, Scale } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

const steps = [
  {
    icon: Sparkles,
    title: 'Bem-vindo(a) ao GOV.RP!',
    description: 'Vamos fazer um tour rápido para você conhecer os cantos mais importantes da nossa nação digital. Preparado?',
    target: null,
    gradient: 'from-purple-500 to-indigo-600',
  },
  {
    icon: LayoutDashboard,
    title: 'Seu Dashboard',
    description: 'Este é o seu centro de comando. Aqui você acessa todos os serviços e acompanha suas informações principais.',
    target: '#dashboard-link',
    gradient: 'from-blue-500 to-cyan-600',
  },
  {
    icon: Landmark,
    title: 'Banco Nacional',
    description: 'Gerencie suas finanças aqui. Faça transferências, solicite cartões e veja seu extrato. O poder econômico começa aqui!',
    target: '#bank-service-link',
    gradient: 'from-green-500 to-emerald-600',
  },
  {
    icon: MessageSquare,
    title: 'Rede Social X',
    description: 'Conecte-se com outros cidadãos, compartilhe suas ideias e fique por dentro de tudo que acontece na nossa rede social exclusiva.',
    target: '#x-service-link',
    gradient: 'from-sky-500 to-blue-600',
  },
  {
    icon: Scale,
    title: 'Vida Política',
    description: 'Participe da política! Acompanhe o parlamento, filie-se a um partido e vote nas eleições. O futuro da nação está em suas mãos.',
    target: '#parliament-service-link',
    gradient: 'from-yellow-500 to-amber-600',
  },
  {
    icon: Users,
    title: 'Sua Jornada Começa Agora',
    description: 'Explore, interaja e construa sua história. As possibilidades são infinitas. Divirta-se!',
    target: null,
    gradient: 'from-rose-500 to-red-600',
  },
];

const WelcomeTutorial = () => {
  const { user, session, refreshUser, triggerTutorial, setTriggerTutorial } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [highlightedElement, setHighlightedElement] = useState(null);
  const [isManualTrigger, setIsManualTrigger] = useState(false);

  const startTutorial = useCallback((manual = false) => {
    setIsManualTrigger(manual);
    setIsOpen(true);
    setStep(0);
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
    if (user && session && user.has_seen_tutorial === false && !isOpen) {
      startTutorial(false);
    }
  }, [user, session, startTutorial, isOpen]);

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
    if (!isManualTrigger) {
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
              {!isManualTrigger && (
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