import React, { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, PlusCircle } from 'lucide-react';
import ImageUploader from '@/components/ImageUploader';

const politicalOrientations = ['Extrema Esquerda', 'Esquerda', 'Centro-Esquerda', 'Centro', 'Centro-Direita', 'Direita', 'Extrema-Direita'];

const CreatePartyDialog = ({ onPartyCreated, userAffiliation }) => {
    const { toast } = useToast();
    const [isOpen, setIsOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({ name: '', acronym: '', ideology: '', statute: '', description: '', orientation: '' });
    const [logoUrl, setLogoUrl] = useState('');
    const [logoFile, setLogoFile] = useState(null);

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
        
        if (!formData.name || !formData.acronym || !formData.ideology || !formData.statute || !formData.description || !formData.orientation || (!logoFile && !logoUrl)) {
            toast({ title: 'Erro de Validação', description: 'Todos os campos, incluindo o logo, são obrigatórios.', variant: 'destructive' });
            return;
        }
        
        setLoading(true);
        try {
            let finalLogoUrl = logoUrl;
            if (logoFile) {
                const { data: uploadData, error: uploadError } = await supabase.storage.from('public-assets').upload(`party-logos/${Date.now()}-${logoFile.name}`, logoFile);
                if (uploadError) {
                    throw new Error(`Erro no upload do logo: ${uploadError.message}`);
                }
                finalLogoUrl = supabase.storage.from('public-assets').getPublicUrl(uploadData.path).data.publicUrl;
            }

            const { data, error } = await supabase.rpc('create_political_party', {
                p_name: formData.name, p_acronym: formData.acronym, p_ideology: formData.ideology, p_logo_url: finalLogoUrl,
                p_statute: formData.statute, p_description: formData.description, p_orientation: formData.orientation
            });

            if (error || !data.success) {
                throw new Error(error?.message || data?.message || "Ocorreu um erro desconhecido.");
            }
            
            toast({ title: 'Sucesso!', description: 'Partido criado com sucesso.' });
            onPartyCreated(); 
            setIsOpen(false);
            setFormData({ name: '', acronym: '', ideology: '', statute: '', description: '', orientation: '' });
            setLogoUrl(''); 
            setLogoFile(null);
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
                <DialogHeader><DialogTitle>Fundar um Novo Partido Político</DialogTitle><DialogDescription>Preencha os dados para registrar seu partido na nação.</DialogDescription></DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                    <div className="grid gap-2"><Label htmlFor="name">Nome do Partido</Label><Input id="name" value={formData.name} onChange={(e) => setFormData(p=>({...p, name: e.target.value}))} required /></div>
                    <div className="grid gap-2"><Label htmlFor="acronym">Sigla</Label><Input id="acronym" value={formData.acronym} onChange={(e) => setFormData(p=>({...p, acronym: e.target.value}))} required maxLength="5" /></div>
                    <div className="grid gap-2"><Label htmlFor="orientation">Orientação Política</Label><Select onValueChange={(v) => setFormData(p => ({...p, orientation: v}))} value={formData.orientation} required><SelectTrigger><SelectValue placeholder="Selecione a orientação" /></SelectTrigger><SelectContent>{politicalOrientations.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></div>
                    <div className="grid gap-2"><Label htmlFor="description">Descrição Curta</Label><Input id="description" value={formData.description} onChange={(e) => setFormData(p=>({...p, description: e.target.value}))} required /></div>
                    <div className="grid gap-2"><Label htmlFor="ideology">Ideologia</Label><Textarea id="ideology" value={formData.ideology} onChange={(e) => setFormData(p=>({...p, ideology: e.target.value}))} placeholder="Descreva os princípios do seu partido..." required /></div>
                    <div className="grid gap-2"><Label htmlFor="statute">Estatuto do Partido</Label><Textarea id="statute" value={formData.statute} onChange={(e) => setFormData(p=>({...p, statute: e.target.value}))} rows={5} placeholder="Cole aqui as regras internas do partido." required /></div>
                    <ImageUploader onUrlChange={setLogoUrl} onFileChange={setLogoFile} initialUrl={logoUrl} label="Logo do Partido (Obrigatório)" />
                    <DialogFooter><Button type="submit" disabled={loading}>{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fundar Partido</Button></DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

export default CreatePartyDialog;