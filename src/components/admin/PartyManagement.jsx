import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Edit, Loader2, Search, Trash2, Users } from 'lucide-react';

const politicalOrientations = [
  'Extrema Esquerda',
  'Esquerda',
  'Centro-Esquerda',
  'Centro',
  'Centro-Direita',
  'Direita',
  'Extrema-Direita',
];

const ACTIVE_PARTY_MEMBER_THRESHOLD = 5;

const EMPTY_PARTY_FORM = {
  name: '',
  acronym: '',
  description: '',
  ideology: '',
  statute: '',
  orientation: '',
  logo_url: '',
  owner_id: '',
  president_id: '',
  vice_president_id: '',
  affiliation_mode: 'automatic',
};

const normalizePartyForm = (party) => ({
  name: party?.name || '',
  acronym: party?.acronym || '',
  description: party?.description || '',
  ideology: party?.ideology || '',
  statute: party?.statute || '',
  orientation: party?.orientation || '',
  logo_url: party?.logo_url || '',
  owner_id: party?.owner_id || '',
  president_id: party?.president_id || '',
  vice_president_id: party?.vice_president_id || '',
  affiliation_mode: party?.affiliation_mode || 'automatic',
});

const PartyManagement = () => {
  const { toast } = useToast();
  const [parties, setParties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingParty, setEditingParty] = useState(null);
  const [partyToDelete, setPartyToDelete] = useState(null);
  const [formData, setFormData] = useState(EMPTY_PARTY_FORM);

  const fetchParties = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('political_parties')
      .select(`
        *,
        members:party_members(user_id, role, profile:profiles(id, full_name)),
        owner:profiles!political_parties_owner_id_fkey(full_name),
        president:profiles!political_parties_president_id_fkey(full_name),
        vice_president:profiles!political_parties_vice_president_id_fkey(full_name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      toast({ title: 'Erro ao buscar partidos', description: error.message, variant: 'destructive' });
    } else {
      setParties(data || []);
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchParties();
  }, [fetchParties]);

  const filteredParties = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return parties;
    }

    return parties.filter((party) =>
      [party.name, party.acronym, party.description, party.orientation]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [parties, searchTerm]);

  const openEdit = (party) => {
    setEditingParty(party);
    setFormData(normalizePartyForm(party));
  };

  const closeEdit = () => {
    setEditingParty(null);
    setFormData(EMPTY_PARTY_FORM);
  };

  const updateForm = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const handleSave = async () => {
    if (!editingParty?.id) {
      return;
    }

    const leaderIds = [formData.owner_id, formData.president_id, formData.vice_president_id].filter(Boolean);
    if (new Set(leaderIds).size !== leaderIds.length) {
      toast({
        title: 'Liderança inválida',
        description: 'A mesma pessoa não pode ocupar mais de um cargo de liderança no partido.',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.name.trim() || !formData.acronym.trim()) {
      toast({ title: 'Preencha nome e sigla', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('political_parties')
      .update({
        name: formData.name.trim(),
        acronym: formData.acronym.trim(),
        description: formData.description.trim(),
        ideology: formData.ideology.trim(),
        statute: formData.statute.trim(),
        orientation: formData.orientation || null,
        logo_url: formData.logo_url.trim() || null,
        owner_id: formData.owner_id || null,
        president_id: formData.president_id || null,
        vice_president_id: formData.vice_president_id || null,
        affiliation_mode: formData.affiliation_mode,
      })
      .eq('id', editingParty.id);

    if (error) {
      toast({ title: 'Erro ao atualizar partido', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Partido atualizado com sucesso' });
      closeEdit();
      fetchParties();
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!partyToDelete?.id) {
      return;
    }

    setSaving(true);
    const partyId = partyToDelete.id;
    const operations = [
      () => supabase.from('party_affiliation_requests').delete().eq('party_id', partyId),
      () => supabase.from('party_members').delete().eq('party_id', partyId),
      () => supabase.from('candidates').update({ party_id: null }).eq('party_id', partyId),
      () => supabase.from('political_parties').delete().eq('id', partyId),
    ];
    let failedError = null;

    for (const operation of operations) {
      const { error } = await operation();

      if (error) {
        failedError = error;
        break;
      }
    }

    if (failedError) {
      toast({ title: 'Erro ao excluir partido', description: failedError.message, variant: 'destructive' });
    } else {
      toast({ title: 'Partido excluído' });
      setPartyToDelete(null);
      fetchParties();
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const leaderOptions = editingParty?.members || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Gerenciamento de Partidos</h2>
          <p className="text-sm text-muted-foreground">Edite dados partidários ou remova partidos existentes.</p>
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar partido..."
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {filteredParties.map((party) => {
          const memberCount = party.members?.length || 0;
          const isActive = memberCount >= ACTIVE_PARTY_MEMBER_THRESHOLD;

          return (
            <Card key={party.id} className={`glass-effect border-white/10 ${!isActive ? 'border-dashed border-amber-500/60' : ''}`}>
              <CardHeader>
                <div className="flex items-start gap-4">
                  <img
                    src={party.logo_url || `https://api.dicebear.com/7.x/initials/svg?seed=${party.acronym}`}
                    alt={party.name}
                    className="h-14 w-14 rounded-lg bg-secondary object-cover p-1"
                  />
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate">{party.name} ({party.acronym})</CardTitle>
                    <CardDescription className="line-clamp-2">{party.description || 'Sem descrição.'}</CardDescription>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="secondary">{party.orientation || 'Sem orientação'}</Badge>
                      <Badge variant="outline" className="gap-1">
                        <Users className="h-3 w-3" />
                        {memberCount} membros
                      </Badge>
                      <Badge className={`gap-1 border ${isActive ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300' : 'border-amber-500/30 bg-amber-500/15 text-amber-300'}`}>
                        {isActive ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                        {isActive ? 'Ativo' : 'Em formação'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p>Dono: {party.owner?.full_name || 'Não definido'}</p>
                <p>Presidente: {party.president?.full_name || 'Não definido'}</p>
                <p>Vice: {party.vice_president?.full_name || 'Não definido'}</p>
                {!isActive ? (
                  <p className="text-amber-300">
                    Faltam {Math.max(0, ACTIVE_PARTY_MEMBER_THRESHOLD - memberCount)} membro(s) para ativação eleitoral.
                  </p>
                ) : null}
              </CardContent>
              <CardFooter className="gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(party)}>
                  <Edit className="mr-2 h-4 w-4" />
                  Editar
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setPartyToDelete(party)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Excluir
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {!filteredParties.length ? (
        <Card className="glass-effect p-8 text-center text-muted-foreground">
          Nenhum partido encontrado.
        </Card>
      ) : null}

      <Dialog open={Boolean(editingParty)} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto glass-effect">
          <DialogHeader>
            <DialogTitle>Editar Partido</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Nome</Label>
                <Input value={formData.name} onChange={(event) => updateForm('name', event.target.value)} />
              </div>
              <div>
                <Label>Sigla</Label>
                <Input value={formData.acronym} onChange={(event) => updateForm('acronym', event.target.value)} maxLength={8} />
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={formData.description} onChange={(event) => updateForm('description', event.target.value)} />
            </div>
            <div>
              <Label>Orientação</Label>
              <Select value={formData.orientation} onValueChange={(value) => updateForm('orientation', value)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {politicalOrientations.map((orientation) => (
                    <SelectItem key={orientation} value={orientation}>{orientation}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label>Dono</Label>
                <Select value={formData.owner_id} onValueChange={(value) => updateForm('owner_id', value)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {leaderOptions.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>{member.profile?.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Presidente</Label>
                <Select value={formData.president_id} onValueChange={(value) => updateForm('president_id', value)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {leaderOptions.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>{member.profile?.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vice-Presidente</Label>
                <Select value={formData.vice_president_id} onValueChange={(value) => updateForm('vice_president_id', value)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {leaderOptions.map((member) => (
                      <SelectItem key={member.user_id} value={member.user_id}>{member.profile?.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Modo de Filiação</Label>
              <Select value={formData.affiliation_mode} onValueChange={(value) => updateForm('affiliation_mode', value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automática</SelectItem>
                  <SelectItem value="manual">Manual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>URL do Logo</Label>
              <Input value={formData.logo_url} onChange={(event) => updateForm('logo_url', event.target.value)} />
            </div>
            <div>
              <Label>Ideologia</Label>
              <Textarea value={formData.ideology} onChange={(event) => updateForm('ideology', event.target.value)} />
            </div>
            <div>
              <Label>Estatuto</Label>
              <Textarea value={formData.statute} onChange={(event) => updateForm('statute', event.target.value)} rows={5} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(partyToDelete)} onOpenChange={(open) => !open && setPartyToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir partido?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove {partyToDelete?.name} e desfaz vínculos partidários associados. Candidaturas antigas ficam sem partido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PartyManagement;
