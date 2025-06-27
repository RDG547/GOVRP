import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { TabsContent } from "@/components/ui/tabs";
import { Loader2, CreditCard, RotateCw, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";
import { supabase } from '@/lib/supabaseClient';
import Cards from 'react-credit-cards-2';
import { FaCcVisa, FaCcMastercard } from 'react-icons/fa';
import 'react-credit-cards-2/dist/es/styles-compiled.css';

const CardsTab = ({ cards, onUpdate }) => {
    const [activeCardIndex, setActiveCardIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);
    const [isRequestingCard, setIsRequestingCard] = useState(false);
    const [selectedBrand, setSelectedBrand] = useState('visa');
    const [isCardRequestModalOpen, setIsCardRequestModalOpen] = useState(false);

    const { toast } = useToast();

    const activeCard = cards.length > 0 ? cards[activeCardIndex] : null;

    const hasVisa = cards.some(c => c.brand === 'visa');
    const hasMastercard = cards.some(c => c.brand === 'mastercard');

    const cardBrands = {
        visa: { name: 'Visa', icon: FaCcVisa, benefits: ['Pontos em dobro', 'Seguro Viagem', 'Aceitação Global'] },
        mastercard: { name: 'Mastercard', icon: FaCcMastercard, benefits: ['Mastercard Surpreenda', 'Concierge', 'Proteção de Compra'] },
    };

    const handleCardRequest = async () => {
        setIsRequestingCard(true);
        const { data, error } = await supabase.rpc('request_credit_card', { p_card_brand: selectedBrand });
        if (error) {
            toast({ title: "Erro", description: error.message, variant: "destructive" });
        } else {
            toast({ title: data.success ? "Sucesso" : "Aviso", description: data.message, variant: data.success ? "default" : "destructive" });
            if (data.success) {
                setIsCardRequestModalOpen(false);
                onUpdate();
            }
        }
        setIsRequestingCard(false);
    };

    const handleCancelCard = async (cardId) => {
        const { data, error } = await supabase.rpc('cancel_credit_card', { p_card_id: cardId });
        if (error) {
            toast({ title: "Erro", description: error.message, variant: "destructive" });
        } else {
            toast({ title: data.success ? "Sucesso" : "Erro", description: data.message, variant: data.success ? "default" : "destructive" });
            if (data.success) {
                onUpdate();
            }
        }
    };

    return (
        <TabsContent value="cartoes" className="bg-black/20 rounded-2xl p-6 mt-4 text-center">
            <h3 className="text-xl font-bold text-white mb-4">Meus Cartões</h3>
            {activeCard ? (
                <div className="flex flex-col items-center">
                    <div className="w-[300px] h-[188px]" style={{ perspective: '1000px' }}>
                        <motion.div className="relative w-full h-full" style={{ transformStyle: 'preserve-3d' }} animate={{ rotateY: isFlipped ? 180 : 0 }} transition={{ duration: 0.6 }}>
                            <div className="absolute w-full h-full" style={{ backfaceVisibility: 'hidden' }}>
                                <Cards number={activeCard.card_number} expiry={activeCard.expiry_date} cvc="" name={activeCard.card_holder_name} focused="" preview={true} />
                            </div>
                            <div className="absolute w-full h-full rounded-xl" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                                <div className={`w-full h-full rounded-xl bg-gradient-to-br from-gray-700 to-gray-900 p-4 flex flex-col justify-between`}>
                                    <div className="w-full h-10 bg-black mt-2"></div>
                                    <div className="text-right flex items-center gap-4 bg-white/80 p-2 rounded">
                                        <p className="text-black font-mono text-lg flex-grow text-left italic">ASSINATURA AUTORIZADA</p>
                                        <p className="text-black font-mono text-lg">{activeCard.cvv}</p>
                                    </div>
                                    <div className="text-xs text-gray-300 text-left">
                                        <p>Se encontrado, favor entrar em contato: (11) 4002-8922</p>
                                        <p>www.bancogov.rp</p>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                    <div className="flex items-center justify-center gap-4 mt-4">
                        <Button variant="outline" size="icon" onClick={() => setActiveCardIndex(i => (i - 1 + cards.length) % cards.length)} disabled={cards.length <= 1}><ChevronLeft /></Button>
                        <span className="text-white font-semibold">{activeCardIndex + 1} / {cards.length}</span>
                        <Button variant="outline" size="icon" onClick={() => setActiveCardIndex(i => (i + 1) % cards.length)} disabled={cards.length <= 1}><ChevronRight /></Button>
                        <Button variant="outline" size="icon" onClick={() => setIsFlipped(f => !f)}><RotateCw className="w-4 h-4"/></Button>
                        <Dialog><DialogTrigger asChild><Button variant="destructive" size="icon"><Trash2 className="w-4 h-4" /></Button></DialogTrigger>
                            <DialogContent><DialogHeader><DialogTitle>Cancelar Cartão</DialogTitle><DialogDescription>Tem certeza que deseja cancelar este cartão? Esta ação é irreversível.</DialogDescription></DialogHeader>
                                <DialogFooter><DialogClose asChild><Button variant="outline">Voltar</Button></DialogClose><DialogClose asChild><Button variant="destructive" onClick={() => handleCancelCard(activeCard.id)}>Confirmar Cancelamento</Button></DialogClose></DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                    <div className="w-full max-w-[300px] mt-4 text-left">
                        <div className="flex justify-between text-sm text-gray-300">
                            <span>Limite Utilizado</span>
                            <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(activeCard.used_limit || 0)}</span>
                        </div>
                        <div className="w-full bg-gray-600 rounded-full h-2.5 mt-1">
                            <div className="bg-gradient-to-r from-blue-500 to-purple-500 h-2.5 rounded-full" style={{ width: `${Math.min(((activeCard.used_limit || 0) / activeCard.card_limit) * 100, 100)}%` }}></div>
                        </div>
                        <div className="flex justify-between text-xs text-gray-400 mt-1">
                            <span>Disponível: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(activeCard.card_limit - (activeCard.used_limit || 0))}</span>
                            <span>Total: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(activeCard.card_limit)}</span>
                        </div>
                    </div>
                </div>
            ) : (<div className="text-center py-8"><CreditCard className="w-16 h-16 mx-auto text-gray-500 mb-4" /><p className="text-gray-400">Nenhum cartão encontrado.</p></div>)}
            <div className="mt-6 flex justify-center gap-4">
                <Dialog open={isCardRequestModalOpen} onOpenChange={setIsCardRequestModalOpen}>
                    <DialogTrigger asChild><Button disabled={cards.length >= 2}><CreditCard className="mr-2 h-4 w-4" /> Solicitar Cartão</Button></DialogTrigger>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Solicitar Novo Cartão</DialogTitle><DialogDescription>Escolha a bandeira e aproveite os benefícios exclusivos. Limite de um cartão por bandeira.</DialogDescription></DialogHeader>
                        <div className="grid grid-cols-2 gap-4 py-4">
                            {Object.entries(cardBrands).map(([key, { name, icon: Icon, benefits }]) => {
                                const hasBrand = key === 'visa' ? hasVisa : hasMastercard;
                                return (
                                    <div key={key} onClick={() => !hasBrand && setSelectedBrand(key)} className={`p-4 rounded-lg cursor-pointer border-2 text-center transition-all ${selectedBrand === key ? 'border-blue-500 bg-blue-500/10' : 'border-white/10'} ${hasBrand ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-500/50'}`}>
                                        <Icon className="w-12 h-12 mx-auto mb-2" />
                                        <h4 className="font-bold text-white">{name}</h4>
                                        {hasBrand && <p className="text-xs text-yellow-400 mt-2">Você já possui este cartão</p>}
                                        <ul className="text-xs text-gray-400 mt-2 list-disc list-inside text-left">
                                            {benefits.map(b => <li key={b}>{b}</li>)}
                                        </ul>
                                    </div>
                                )
                            })}
                        </div>
                        <DialogFooter>
                            <Button onClick={handleCardRequest} disabled={isRequestingCard || (selectedBrand === 'visa' && hasVisa) || (selectedBrand === 'mastercard' && hasMastercard)} className="w-full">
                                {isRequestingCard ? <Loader2 className="animate-spin" /> : `Solicitar Cartão ${cardBrands[selectedBrand].name}`}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>
        </TabsContent>
    );
};

export default CardsTab;