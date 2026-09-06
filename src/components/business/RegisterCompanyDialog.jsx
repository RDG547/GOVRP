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
  const [typeId, setTypeId] = useState(initialType);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const request = useRef(null);
  useEffect(() => {
    if (open) { setTypeId(initialType); setName(''); setDescription(''); setError(''); request.current = null; }
  }, [open, initialType]);
  const business = types.find(type => type.id === typeId);
  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    if (!business || name.trim().length < 5 || description.trim().length < 15) {
      setError('Escolha o tipo, informe um nome com pelo menos 5 caracteres e uma descrição com pelo menos 15.');
      return;
    }
    const signature = JSON.stringify([business.id, name.trim(), description.trim()]);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    setError('');
    try {
      await onRegister(business, { companyName: name.trim(), description: description.trim(), idempotencyKey: request.current.id });
      onOpenChange(false);
    } catch (failure) { setError(failure.message); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!loading) onOpenChange(next); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />Criar empresa</DialogTitle><DialogDescription>Dê um nome ao seu negócio e apresente sua atividade.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2"><Label>Tipo de empresa</Label><Select value={typeId} onValueChange={setTypeId} disabled={loading}><SelectTrigger><SelectValue placeholder="Escolha o tipo de negócio" /></SelectTrigger><SelectContent>{types.map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-2"><Label htmlFor="new-company-name">Nome da empresa</Label><Input id="new-company-name" value={name} onChange={event => setName(event.target.value)} minLength={5} maxLength={120} required disabled={loading} /></div>
        <div className="space-y-2"><Label htmlFor="new-company-description">Descrição</Label><Textarea id="new-company-description" value={description} onChange={event => setDescription(event.target.value)} minLength={15} maxLength={2000} required disabled={loading} /><p className="text-xs text-muted-foreground">Pelo menos 15 caracteres.</p></div>
        {business && <p className="rounded-lg bg-secondary p-3 text-sm">Taxa de registro: <strong>{formatCurrency(business.registrationFee)}</strong>. O valor será descontado da sua conta ao confirmar.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}><X className="mr-2 h-4 w-4" />Cancelar</Button><Button type="submit" disabled={loading || !business}>{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}{loading ? 'Criando empresa…' : 'Criar empresa'}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
