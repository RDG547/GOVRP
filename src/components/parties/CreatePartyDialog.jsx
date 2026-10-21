import {useDomainRealtime} from '@/hooks/use-domain-realtime';
import {formatCurrency} from '@/lib/utils';
import PartyBrandPreview from './PartyBrandPreview';
import BrandFontPicker from '@/components/BrandFontPicker';
import PartyColorPicker from '@/components/parties/PartyColorPicker';
import { politicalOrientations, orientationColors } from '@/lib/partyIdentity';
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, PlusCircle, Flag, Hash, Compass, FileText, Lightbulb, ScrollText } from 'lucide-react';
import ImageUploader from '@/components/ImageUploader';
import { buildStoragePath } from '@/lib/security';


const CreatePartyDialog = ({ onPartyCreated, userAffiliation }) => {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ name: '', acronym: '', ideology: '', statute: '', description: '', orientation: '', color: '#64748B', font_key: 'default' });
    const [quote,setQuote]=useState(null),[quoteError,setQuoteError]=useState('');
    const loadQuote=useCallback(async()=>{if(!isOpen)return;const result=await supabase.rpc('quote_party_registration',{p_ideology:formData.ideology,p_orientation:formData.orientation||null});if(result.error){setQuoteError('Não foi possível conferir as regras e taxas de fundação.');return;}setQuote(result.data);setQuoteError('');},[isOpen,formData.ideology,formData.orientation]);
    useEffect(()=>{if(isOpen){setQuote(null);const timer=setTimeout(()=>void loadQuote(),250);return()=>clearTimeout(timer);}},[isOpen,loadQuote]);
    useDomainRealtime('party-foundation-laws','public',['government_rules','law_effects'],loadQuote,isOpen);
    const [logoUrl, setLogoUrl] = useState('');
    const [logoFile, setLogoFile] = useState(null);
    const [bannerUrl,setBannerUrl]=useState('');
    const [bannerFile,setBannerFile]=useState(null);

    const handleOpenChange = (open) => {
        if (open && userAffiliation) {
            toast({
                title: "Ação não permitida",
                description: "Você já está filiado a um partido. Desfilie-se para poder criar um novo.",
                variant: "destructive",
            });
            return;
        }
        setIsOpen(open);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if(loading||!quote||quoteError)return;
        if(quote.restricted){toast({title:'Fundação restrita por norma vigente',description:quote.restrictions?.join(' '),variant:'destructive'});return;}
        
        if (!formData.name || !formData.acronym || !formData.ideology || !formData.statute || !formData.description || !formData.orientation || (!logoFile && !logoUrl)) {
            toast({ title: 'Erro de Validação', description: 'Todos os campos, incluindo o logo, são obrigatórios.', variant: 'destructive' });
            return;
        }
        
        setLoading(true);
        try {
            let finalLogoUrl = logoUrl;
            if (logoFile) {
                const { data: uploadData, error: uploadError } = await supabase.storage.from('public-assets').upload(buildStoragePath({ prefix: 'party-logos', entityId: 'new-party', fileName: logoFile.name }), logoFile);
                if (uploadError) {
                    throw new Error(`Erro no upload do logo: ${uploadError.message}`);
                }
                finalLogoUrl = supabase.storage.from('public-assets').getPublicUrl(uploadData.path).data.publicUrl;
            }

            let finalBannerUrl=bannerUrl;
            if (bannerFile) {
                const {data:uploaded,error:uploadError}=await supabase.storage.from('public-assets').upload(buildStoragePath({prefix:'party-headers',entityId:'new-party',fileName:bannerFile.name}),bannerFile);
                if(uploadError)throw uploadError;
                finalBannerUrl=supabase.storage.from('public-assets').getPublicUrl(uploaded.path).data.publicUrl;
            }
            const { data, error } = await supabase.rpc('create_political_party', {
                p_name: formData.name, p_acronym: formData.acronym, p_ideology: formData.ideology, p_logo_url: finalLogoUrl,
                p_statute: formData.statute, p_description: formData.description, p_orientation: formData.orientation, p_color: formData.color, p_font_key: formData.font_key, p_header_url: finalBannerUrl
            });

            if (error || !data.success) {
                throw new Error(error?.message || data?.message || "Ocorreu um erro desconhecido.");
            }
            
            toast({ title: 'Sucesso!', description: 'Partido criado com sucesso.' });
            onPartyCreated(); 
            setIsOpen(false);
            setFormData({ name: '', acronym: '', ideology: '', statute: '', description: '', orientation: '', color: '#64748B', font_key: 'default' });
            setLogoUrl(''); 
            setLogoFile(null); setBannerUrl(''); setBannerFile(null);
        } catch (error) {
            console.error("Error creating party:", error);
            toast({ title: 'Erro ao criar partido', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogTrigger asChild><Button><PlusCircle className="mr-2 h-4 w-4" /> Criar Partido</Button></DialogTrigger>
            <DialogContent className="glass-effect max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle className="flex flex-col items-center gap-3 text-center"><PlusCircle className="h-9 w-9 text-blue-400"/>Fundar um Novo Partido Político</DialogTitle><DialogDescription className="text-center">Preencha os dados para registrar seu partido na nação.</DialogDescription></DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2"><Label htmlFor="name" className="flex items-center gap-2"><Flag className="h-4 w-4 text-primary"/>Nome do Partido</Label><Input id="name" value={formData.name} onChange={(e) => setFormData(p=>({...p, name: e.target.value}))} required /></div>
                    <div className="grid gap-2"><Label htmlFor="acronym" className="flex items-center gap-2"><Hash className="h-4 w-4 text-primary"/>Sigla</Label><Input id="acronym" value={formData.acronym} onChange={(e) => setFormData(p=>({...p, acronym: e.target.value}))} required maxLength="5" /></div>
                    <div className="grid gap-2"><Label htmlFor="orientation" className="flex items-center gap-2"><Compass className="h-4 w-4 text-primary"/>Orientação Política</Label><Select onValueChange={(v) => setFormData(p => ({...p, orientation: v}))} value={formData.orientation} required><SelectTrigger><SelectValue placeholder="Selecione a orientação" /></SelectTrigger><SelectContent>{politicalOrientations.map(o => <SelectItem key={o} value={o}><span className={`rounded px-2 py-1 text-xs ${orientationColors[o]}`}>{o}</span></SelectItem>)}</SelectContent></Select></div>
                    <div className="grid gap-2"><Label htmlFor="description" className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary"/>Descrição Curta</Label><Input id="description" value={formData.description} onChange={(e) => setFormData(p=>({...p, description: e.target.value}))} required /></div>
                    <div className="grid gap-2"><Label htmlFor="ideology" className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-primary"/>Ideologia</Label><Textarea id="ideology" value={formData.ideology} onChange={(e) => setFormData(p=>({...p, ideology: e.target.value}))} placeholder="Descreva os princípios do seu partido..." required /></div>
                    <div className="grid gap-2"><Label htmlFor="statute" className="flex items-center gap-2"><ScrollText className="h-4 w-4 text-primary"/>Estatuto do Partido</Label><Textarea id="statute" value={formData.statute} onChange={(e) => setFormData(p=>({...p, statute: e.target.value}))} rows={5} placeholder="Cole aqui as regras internas do partido." required /></div>
            <h3 className="font-semibold">🎨 Personalização</h3><BrandFontPicker value={formData.font_key} onChange={font_key=>setFormData({...formData,font_key})} name={formData.name||"Nome do partido"}/><PartyColorPicker party={{...formData,logo_url:logoUrl}} value={formData.color} onChange={color => setFormData(current => ({...current, color}))}/>
                    <ImageUploader previewOnly onUrlChange={setLogoUrl} onFileChange={setLogoFile} initialUrl={logoUrl} label="Logo do Partido (Obrigatório)" />
                    <ImageUploader previewOnly banner allowRemove label="Banner do partido (opcional)" initialUrl={bannerUrl} onUrlChange={setBannerUrl} onFileChange={setBannerFile}/>
                    <PartyBrandPreview name={formData.name} acronym={formData.acronym} logoUrl={logoUrl} logoFile={logoFile} bannerUrl={bannerUrl} bannerFile={bannerFile} color={formData.color} fontKey={formData.font_key}/>
                    <section className="space-y-2 rounded-lg border p-3 text-sm" aria-live="polite"><h3 className="font-semibold">Regras e taxas de fundação</h3>{quoteError?<p role="alert">{quoteError}</p>:quote?<><p>Taxas vigentes: <strong>{formatCurrency(quote.fee)}</strong></p>{quote.rules.map(rule=><p key={rule.rule_key} className="text-xs text-muted-foreground">{rule.description}: {formatCurrency(rule.numeric_value)}</p>)}{quote.restricted&&<p className="text-red-300">Fundação restrita: {quote.restrictions.join(' ')}</p>}<p className="text-xs text-muted-foreground">O valor será conferido no servidor e debitado uma única vez da conta pessoal do fundador.</p></>:<p>Conferindo as normas vigentes…</p>}</section>
                    <DialogFooter className="gap-2 sm:justify-center"><Button type="submit" disabled={loading||!quote||Boolean(quoteError)||quote?.restricted}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4"/>}Fundar Partido</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default CreatePartyDialog;
