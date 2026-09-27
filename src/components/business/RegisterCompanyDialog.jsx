import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { buildStoragePath } from '@/lib/security';
import ImageUploader from '@/components/ImageUploader';
import BrandFontPicker from '@/components/BrandFontPicker';
import { Link } from 'react-router-dom';
import React, { useEffect, useRef, useState } from 'react';
import { Building2, Loader2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';

export default function RegisterCompanyDialog({ open, onOpenChange, types, initialType = '', onRegister, loading }) {
  const { user } = useAuth();
  const [cnpjs,setCnpjs]=useState([]),[cnpjId,setCnpjId]=useState(''),[logo,setLogo]=useState(''),[file,setFile]=useState(null),[font,setFont]=useState('default'),[color,setColor]=useState('#64748B'),[submitting,setSubmitting]=useState(false);
  useEffect(()=>{if(open&&user?.id)supabase.from('documents').select('id,document_number,metadata').eq('user_id',user.id).eq('type','CNPJ').eq('is_valid',true).then(r=>setCnpjs(r.data||[]));},[open,user?.id]);
  const [typeId, setTypeId] = useState(initialType);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => {
    if (open) { setTypeId(initialType); setName(''); setDescription(''); setError('');setCnpjId('');setFile(null);setLogo('');setFont('default');setColor('#64748B'); request.current = null; }
  }, [open, initialType]);
  const business = types.find(type => type.id === typeId);
  const submit = async (event) => {
    event.preventDefault();
    if (loading||submitting) return;
    if (!business || name.trim().length < 5 || description.trim().length < 15) {
      setError('Escolha o tipo, informe um nome com pelo menos 5 caracteres e uma descrição com pelo menos 15.');
      return;
    }
    if(business.requiresCnpj!==false&&!cnpjId){setError('Abra ou selecione um CNPJ compatível com esta atividade.');return;}
    const signature = JSON.stringify([business.id, name.trim(), description.trim(), cnpjId, logo, font, color]);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    setError('');setSubmitting(true);
    try {
      let logoUrl=logo;
      if(file){const uploaded=await supabase.storage.from('public-assets').upload(buildStoragePath({prefix:'company-logos',entityId:user.id,fileName:file.name}),file);if(uploaded.error)throw uploaded.error;logoUrl=supabase.storage.from('public-assets').getPublicUrl(uploaded.data.path).data.publicUrl;}
      await onRegister(business, { companyName: name.trim(), description: description.trim(), idempotencyKey: request.current.id, cnpjId, brand:{logo_url:logoUrl,font_key:font,color} });
      onOpenChange(false);
    } catch (failure) { setError(failure.message); } finally {setSubmitting(false);}
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!loading&&!submitting) onOpenChange(next); }}>
    <DialogContent className="grid-cols-1 [&>*]:min-w-0 [&_fieldset]:min-w-0 [&_select]:min-w-0 max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader className="text-center sm:text-center"><DialogTitle className="flex items-center justify-center gap-2"><Building2 className="h-5 w-5" />Criar empresa</DialogTitle><DialogDescription>Dê um nome ao seu negócio e apresente sua atividade.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label>🏢 Tipo de empresa</Label><Select value={typeId} onValueChange={setTypeId} disabled={loading}><SelectTrigger aria-label="Tipo de empresa"><SelectValue placeholder="Escolha o tipo de negócio" /></SelectTrigger><SelectContent>{types.map(type => { const Icon = type.icon || Building2; return <SelectItem key={type.id} value={type.id}><span className="flex items-center gap-2"><Icon className={`h-4 w-4 shrink-0 ${type.color || 'text-primary'}`} />{type.name}</span></SelectItem>; })}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="new-company-name">🏷️ Nome da empresa</Label><Input id="new-company-name" value={name} onChange={event => setName(event.target.value)} minLength={5} maxLength={120} required disabled={loading} /></div>
        <div className="space-y-2"><Label htmlFor="new-company-description">📝 Descrição da Atividade</Label><Textarea id="new-company-description" value={description} onChange={event => setDescription(event.target.value)} minLength={15} maxLength={2000} required disabled={loading} /><p className="text-xs text-muted-foreground">Descreva o que sua empresa faz, em pelo menos 15 caracteres.</p></div>
        <label className="block text-sm">CNPJ da atividade<select aria-label="CNPJ da atividade" className="mt-2 h-11 w-full rounded border bg-background px-2" value={cnpjId} onChange={e=>setCnpjId(e.target.value)}><option value="">Selecione um CNPJ compatível</option>{cnpjs.filter(d=>d.metadata?.business_type_id===typeId&&!d.metadata?.business_id).map(d=><option key={d.id} value={d.id}>{d.document_number}</option>)}</select></label><Link className="block text-sm underline" to="/services/dic">Abrir um CNPJ no DIC</Link>
        <fieldset className="space-y-3 rounded-xl border p-3"><legend>🎨 Personalização</legend><ImageUploader previewOnly label="Logo da empresa" initialUrl={logo} onUrlChange={setLogo} onFileChange={setFile}/><label className="flex items-center gap-3 text-sm">Cor da marca<input aria-label="Cor da marca" type="color" value={color} onChange={e=>setColor(e.target.value)} className="h-11 w-16 rounded border"/></label><BrandFontPicker value={font} onChange={setFont} name={name||'Nome da empresa'}/></fieldset>
        {business && <p className="rounded-lg bg-secondary p-3 text-sm">Taxa de registro: <strong>{formatCurrency(business.registrationFee)}</strong>. O valor será descontado da sua conta ao confirmar.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="justify-center sm:justify-center"><Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}><X className="mr-2 h-4 w-4" />Cancelar</Button><Button type="submit" disabled={loading || submitting || !business}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}{loading ? 'Criando empresa…' : 'Criar empresa'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
