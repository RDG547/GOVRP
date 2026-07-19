import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { OfficialDocument } from '@/components/dic/OfficialDocument';
import { Sparkles, Check, Loader2, FileText, Briefcase, Vote, Eye, X, CheckCircle2 } from 'lucide-react';

const BRAZILIAN_STATES = [
  { code: 'AC', name: 'Acre' },
  { code: 'AL', name: 'Alagoas' },
  { code: 'AP', name: 'Amapá' },
  { code: 'AM', name: 'Amazonas' },
  { code: 'BA', name: 'Bahia' },
  { code: 'CE', name: 'Ceará' },
  { code: 'DF', name: 'Distrito Federal' },
  { code: 'ES', name: 'Espírito Santo' },
  { code: 'GO', name: 'Goiás' },
  { code: 'MA', name: 'Maranhão' },
  { code: 'MT', name: 'Mato Grosso' },
  { code: 'MS', name: 'Mato Grosso do Sul' },
  { code: 'MG', name: 'Minas Gerais' },
  { code: 'PA', name: 'Pará' },
  { code: 'PB', name: 'Paraíba' },
  { code: 'PR', name: 'Paraná' },
  { code: 'PE', name: 'Pernambuco' },
  { code: 'PI', name: 'Piauí' },
  { code: 'RJ', name: 'Rio de Janeiro' },
  { code: 'RN', name: 'Rio Grande do Norte' },
  { code: 'RS', name: 'Rio Grande do Sul' },
  { code: 'RO', name: 'Rondônia' },
  { code: 'RR', name: 'Roraima' },
  { code: 'SC', name: 'Santa Catarina' },
  { code: 'SP', name: 'São Paulo' },
  { code: 'SE', name: 'Sergipe' },
  { code: 'TO', name: 'Tocantins' },
];

const BrazilFlag = () => (
  <svg
    viewBox="0 0 72 52"
    className="w-full h-full rounded-md shadow-sm"
    role="img"
    aria-label="Bandeira do Brasil"
  >
    <rect width="72" height="52" fill="#168148" rx="3" />
    <path d="M36 5 L66 26 L36 47 L6 26 Z" fill="#F0C943" />
    <circle cx="36" cy="26" r="11" fill="#174A8B" />
  </svg>
);

const ResidencyOnboarding = () => {
  const { user, refreshUser, setTriggerTutorial } = useAuth();
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedState, setSelectedState] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [issuingDocument, setIssuingDocument] = useState('');
  const [phase, setPhase] = useState('residency');
  const [issuedDocuments, setIssuedDocuments] = useState({});
  const [previewDocument, setPreviewDocument] = useState(null);
  const [onboardingFinished, setOnboardingFinished] = useState(false);

  useEffect(() => {
    if (user?.onboarding_completed === false && !onboardingFinished) {
      setIsOpen(true);
    }
  }, [user?.id, user?.onboarding_completed, onboardingFinished]);

  const handleConfirmResidency = async () => {
    if (!selectedState) {
      toast({
        title: 'Estado obrigatório',
        description: 'Selecione seu estado de residência para continuar.',
        variant: 'destructive',
      });
      return;
    }

    setIsConfirming(true);
    try {
      const state = BRAZILIAN_STATES.find((s) => s.code === selectedState);

      const { error } = await supabase.rpc('complete_residency_onboarding', {
        p_country_code: 'BR',
        p_country_name: 'Brasil',
        p_state_code: state.code,
        p_state_name: state.name,
      });

      if (error) throw error;
      await refreshUser();
      setPhase('documents');
      toast({
        title: 'Residência confirmada',
        description: `Agora emita seus documentos de cidadão para concluir o cadastro.`,
      });
    } catch (error) {
      console.error('Erro ao confirmar residência:', error);
      toast({
        title: 'Erro ao salvar',
        description: error.message || 'Não foi possível registrar sua residência. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIsConfirming(false);
    }
  };

  const handleIssueDocument = async (documentType) => {
    setIssuingDocument(documentType);
    try {
      const { data, error } = await supabase.rpc('issue_onboarding_document', {
        p_document_type: documentType,
      });

      if (error) throw error;
      if (!data?.document) throw new Error('Não foi possível obter o documento emitido.');

      setIssuedDocuments((documents) => ({
        ...documents,
        [documentType]: data.document,
      }));

      if (data.onboarding_completed) {
        setOnboardingFinished(true);
      }

      await refreshUser();
      toast({
        title: 'Documento emitido',
        description: `${documentType === 'CTD' ? 'Carteira de Trabalho' : 'Título de Eleitor'} emitido com sucesso.`,
      });
    } catch (error) {
      console.error('Erro ao emitir documento:', error);
      toast({
        title: 'Erro na emissão',
        description: error.message || 'Não foi possível emitir o documento. Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setIssuingDocument('');
    }
  };

  const handleStartJourney = () => {
    setIsOpen(false);
    if (setTriggerTutorial) {
      setTimeout(() => setTriggerTutorial(true), 300);
    }
  };

  const allDocumentsIssued = Boolean(issuedDocuments['CTD'] && issuedDocuments['Título de Eleitor']);

  if (!user || (user.onboarding_completed !== false && !onboardingFinished)) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent
        className="p-0 overflow-hidden bg-[#0B1220] border border-white/10 max-w-2xl z-[10001] shadow-2xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <DialogHeader className="p-6 pb-0 text-center">
              <DialogTitle className="text-2xl font-bold text-white flex items-center justify-center gap-2">
                <Sparkles className="w-6 h-6 text-yellow-400" />
                {phase === 'residency' ? 'Bem-vindo(a) ao GOV.RP!' : 'Seus Documentos de Cidadão'}
              </DialogTitle>
              <DialogDescription className="text-gray-300">
                {phase === 'residency'
                  ? 'Antes de começar sua jornada, confirme sua residência.'
                  : 'Emita seus documentos oficiais para concluir sua cidadania digital.'}
              </DialogDescription>
            </DialogHeader>

            <div className="p-6 space-y-6">
              {phase === 'residency' ? (
                <>
                  <div className="space-y-3">
                    <Label className="text-white">País de residência (Natalidade)</Label>
                    <div className="relative flex items-center gap-4 p-4 rounded-xl border border-green-500/30 bg-green-500/10">
                      <div className="w-20 h-14 flex-shrink-0">
                        <BrazilFlag />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-white">Brasil</p>
                        <p className="text-sm text-gray-300">
                          Atualmente só é possível selecionar o Brasil como país de residência.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="state" className="text-white">Estado ou Província</Label>
                    <Select value={selectedState} onValueChange={setSelectedState}>
                      <SelectTrigger id="state" className="w-full bg-white/10 border-white/20 text-white">
                        <SelectValue placeholder="Selecione seu estado" />
                      </SelectTrigger>
                      <SelectContent className="bg-[#0B1220] border-white/20 z-[10002] max-h-[min(24rem,60vh)] overflow-y-auto rounded-md shadow-xl">
                        {BRAZILIAN_STATES.map((state) => (
                          <SelectItem
                            key={state.code}
                            value={state.code}
                            className="text-white focus:bg-white/10 focus:text-white"
                          >
                            {state.name} ({state.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={handleConfirmResidency}
                    disabled={isConfirming || !selectedState}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 py-3 text-lg font-medium text-white"
                  >
                    {isConfirming ? <Loader2 className="animate-spin w-5 h-5" /> : <><Check className="w-5 h-5 mr-2" />Confirmar</>}
                  </Button>
                </>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {[
                      {
                        type: 'Título de Eleitor',
                        label: 'Título de Eleitor',
                        icon: Vote,
                        cardClass: 'border-teal-500/30 bg-teal-500/10',
                        iconBackgroundClass: 'bg-teal-500/20',
                        iconClass: 'text-teal-300',
                      },
                      {
                        type: 'CTD',
                        label: 'Carteira de Trabalho',
                        icon: Briefcase,
                        cardClass: 'border-indigo-500/30 bg-indigo-500/10',
                        iconBackgroundClass: 'bg-indigo-500/20',
                        iconClass: 'text-indigo-300',
                      },
                    ].map(({ type, label, icon: Icon, cardClass, iconBackgroundClass, iconClass }) => {
                      const document = issuedDocuments[type];
                      const isIssuing = issuingDocument === type;

                      return (
                        <motion.div
                          key={type}
                          layout
                          className={`rounded-xl border p-4 ${document ? 'border-green-500/40 bg-green-500/10' : cardClass}`}
                        >
                          <div className="flex items-start gap-3">
                            <div className={`rounded-lg p-2 ${iconBackgroundClass}`}>
                              <Icon className={`w-5 h-5 ${iconClass} ${isIssuing ? 'animate-pulse' : ''}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-white">{label}</p>
                              {document ? (
                                <p className="mt-1 text-sm font-mono text-green-200 break-all">{document.document_number}</p>
                              ) : (
                                <p className="mt-1 text-sm text-gray-300">Documento oficial digital</p>
                              )}
                            </div>
                          </div>

                          <div className="mt-4">
                            {document ? (
                              <Button type="button" variant="outline" size="sm" onClick={() => setPreviewDocument(document)} className="w-full border-white/20 text-white hover:bg-white/10">
                                <Eye className="w-4 h-4 mr-2" />Visualizar documento
                              </Button>
                            ) : (
                              <Button type="button" onClick={() => handleIssueDocument(type)} disabled={Boolean(issuingDocument)} className="w-full bg-white/10 text-white hover:bg-white/20">
                                {isIssuing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Emitindo...</> : <><FileText className="w-4 h-4 mr-2" />Emitir {label}</>}
                              </Button>
                            )}
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  {allDocumentsIssued && (
                    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-center">
                      <CheckCircle2 className="mx-auto mb-2 w-7 h-7 text-green-400" />
                      <p className="font-semibold text-white">Documentos emitidos com sucesso</p>
                      <p className="mt-1 text-sm text-gray-300">Sua cidadania digital está pronta.</p>
                    </motion.div>
                  )}

                  <Button
                    onClick={handleStartJourney}
                    disabled={!allDocumentsIssued}
                    className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 py-3 text-lg font-medium text-white"
                  >
                    <Check className="w-5 h-5 mr-2" />
                    Começar minha Jornada
                  </Button>
                </>
              )}
            </div>

            <AnimatePresence>
              {previewDocument && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 overflow-y-auto bg-[#0B1220] p-5"
                >
                  <div className="mb-4 flex items-center justify-between gap-4">
                    <p className="font-semibold text-white">Visualização do documento</p>
                    <Button type="button" size="icon" variant="ghost" onClick={() => setPreviewDocument(null)} className="text-white hover:bg-white/10" aria-label="Fechar visualização">
                      <X className="w-5 h-5" />
                    </Button>
                  </div>
                  <OfficialDocument user={user} doc={previewDocument} onBack={() => setPreviewDocument(null)} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
};

export default ResidencyOnboarding;
