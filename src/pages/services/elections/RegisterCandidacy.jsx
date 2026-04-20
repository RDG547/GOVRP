import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Vote, AlertTriangle, Upload, X, Clock } from 'lucide-react';
import {
  buildStoragePath,
  ACCEPTED_IMAGE_EXTENSIONS,
  ACCEPTED_IMAGE_MIME_TYPES,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_STANDARD_IMAGE_UPLOAD_BYTES,
  validateSelectedFile,
} from '@/lib/security';
import {
  fetchPotentialRunningMates,
  fetchPresidentialElectionHistory,
  getConsecutivePresidentialWins,
} from '@/lib/executiveGovernance';
import { fetchWithSessionAuth } from '@/lib/apiAuth';

const candidacySchema = z.object({
  election_id: z.string().uuid('Selecione uma eleição válida.'),
  party_id: z.string().uuid('Selecione um partido válido.').optional().nullable(),
  vice_candidate_id: z.string().uuid('Selecione um vice válido.').optional().nullable(),
  political_name: z.string().min(3, 'O nome político deve ter pelo menos 3 caracteres.'),
  bio: z.string().min(1, 'A biografia é obrigatória.'),
  proposals: z.string().min(1, 'As propostas são obrigatórias.'),
});

const RegisterCandidacy = ({ onFinished }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [elections, setElections] = useState([]);
  const [parties, setParties] = useState([]);
  const [userAffiliation, setUserAffiliation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageError, setImageError] = useState('');
  const [existingCandidacy, setExistingCandidacy] = useState(null);
  const [pendingViceInvitation, setPendingViceInvitation] = useState(null);
  const [viceCandidates, setViceCandidates] = useState([]);
  const [loadingViceCandidates, setLoadingViceCandidates] = useState(false);
  const [presidentialElections, setPresidentialElections] = useState([]);

  const form = useForm({
    resolver: zodResolver(candidacySchema),
    defaultValues: {
      election_id: '',
      party_id: null,
      vice_candidate_id: null,
      political_name: '',
      bio: '',
      proposals: '',
    },
  });

  const selectedElectionId = form.watch('election_id');
  const selectedElection = elections.find((election) => election.id === selectedElectionId) || null;
  const requiresViceCandidate = Boolean(selectedElection?.election_types?.requires_vice_candidate);
  const consecutivePresidentialWins = getConsecutivePresidentialWins(presidentialElections, user?.id);
  const presidentialRunBlocked = requiresViceCandidate && consecutivePresidentialWins >= 2;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);

      try {
        const [
          existingResponse,
          pendingViceResponse,
          electionsResponse,
          partiesResponse,
          partyMemberResponse,
          presidentialHistoryResponse,
        ] = await Promise.all([
          supabase
            .from('candidates')
            .select('*, elections(name), vice:profiles!candidates_vice_candidate_id_fkey(full_name)')
            .eq('user_id', user.id)
            .in('status', ['Pendente', 'Approved']),
          user?.id
            ? supabase
                .from('notifications')
                .select('id, content, created_at, metadata')
                .eq('user_id', user.id)
                .eq('type', 'vice_candidacy_request_sent')
                .order('created_at', { ascending: false })
                .limit(10)
            : Promise.resolve({ data: [], error: null }),
          supabase
            .from('elections')
            .select('id, name, election_type_id, election_types(name, requires_vice_candidate, voting_system)')
            .eq('status', 'Candidacy')
            .order('voting_start_date', { ascending: true }),
          supabase.from('political_parties').select('id, name').eq('is_active', true),
          user?.id
            ? supabase.from('party_members').select('party_id').eq('user_id', user.id).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          fetchPresidentialElectionHistory(supabase),
        ]);

        if (existingResponse.error) {
          throw existingResponse.error;
        }
        if (electionsResponse.error) {
          throw electionsResponse.error;
        }
        if (partiesResponse.error) {
          throw partiesResponse.error;
        }
        if (pendingViceResponse.error) {
          throw pendingViceResponse.error;
        }
        if (partyMemberResponse.error && partyMemberResponse.error.code !== 'PGRST116') {
          throw partyMemberResponse.error;
        }

        const existingData = existingResponse.data || [];
        const pendingInvitation =
          (pendingViceResponse.data || []).find(
            (notification) => `${notification?.metadata?.status || ''}`.toLowerCase() === 'pending'
          ) || null;

        setExistingCandidacy(existingData[0] || null);
        setPendingViceInvitation(existingData.length ? null : pendingInvitation);
        setElections(electionsResponse.data || []);
        setParties(partiesResponse.data || []);
        setPresidentialElections(presidentialHistoryResponse.elections || []);

        if (partyMemberResponse.data?.party_id) {
          setUserAffiliation(partyMemberResponse.data.party_id);
          form.setValue('party_id', partyMemberResponse.data.party_id);
        }
      } catch (error) {
        if (error.code !== 'PGRST116') {
          toast({ title: 'Erro ao carregar dados', description: error.message, variant: 'destructive' });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [form, toast, user]);

  useEffect(() => {
    const fetchViceCandidates = async () => {
      if (!requiresViceCandidate || !selectedElectionId) {
        setViceCandidates([]);
        form.setValue('vice_candidate_id', null);
        return;
      }

      setLoadingViceCandidates(true);
      try {
        const options = await fetchPotentialRunningMates(supabase, {
          electionId: selectedElectionId,
          excludeUserId: user?.id,
        });
        setViceCandidates(options);
      } catch (error) {
        toast({
          title: 'Erro ao buscar candidatos a vice',
          description: error.message,
          variant: 'destructive',
        });
      } finally {
        setLoadingViceCandidates(false);
      }
    };

    fetchViceCandidates();
  }, [form, requiresViceCandidate, selectedElectionId, toast, user?.id]);

  const handleCancelCandidacy = async () => {
    if (!existingCandidacy) {
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.from('candidates').delete().eq('id', existingCandidacy.id);
      if (error) {
        throw error;
      }

      toast({
        title: 'Candidatura cancelada!',
        description: 'Agora você pode registrar uma nova candidatura.',
      });

      setExistingCandidacy(null);
      setLoading(true);
      const { data, error: electionsError } = await supabase
        .from('elections')
        .select('id, name, election_type_id, election_types(name, requires_vice_candidate, voting_system)')
        .eq('status', 'Candidacy')
        .order('voting_start_date', { ascending: true });

      if (electionsError) {
        throw electionsError;
      }

      setElections(data || []);
    } catch (error) {
      toast({ title: 'Erro ao cancelar', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
      setLoading(false);
    }
  };

  const handleFileSelect = (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    const validation = validateSelectedFile(selectedFile, {
      allowedMimeTypes: ACCEPTED_IMAGE_MIME_TYPES,
      allowedExtensions: ACCEPTED_IMAGE_EXTENSIONS,
      maxBytes: MAX_STANDARD_IMAGE_UPLOAD_BYTES,
      label: 'imagem',
    });

    if (!validation.ok) {
      setImageError(validation.error);
      setImageFile(null);
      setImagePreview(null);
      return;
    }

    setImageError('');
    setImageFile(selectedFile);

    const reader = new FileReader();
    reader.onload = (loadEvent) => setImagePreview(loadEvent.target?.result);
    reader.readAsDataURL(selectedFile);
  };

  const handleClearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageError('');
  };

  const onSubmit = async (values) => {
    if (!imageFile) {
      setImageError('A foto de campanha é obrigatória. Faça upload de uma imagem.');
      return;
    }

    if (requiresViceCandidate && !values.vice_candidate_id) {
      form.setError('vice_candidate_id', {
        type: 'manual',
        message: 'A candidatura presidencial exige a indicação simultânea de um vice-presidente.',
      });
      return;
    }

    if (presidentialRunBlocked) {
      toast({
        title: 'Limite constitucional atingido',
        description:
          'Você já venceu as duas últimas eleições presidenciais consecutivas e precisa aguardar uma alternância antes de disputar novamente.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('public-assets')
        .upload(buildStoragePath({ prefix: 'campaign-photos', entityId: user.id, fileName: imageFile.name }), imageFile);

      if (uploadError) {
        throw uploadError;
      }

      const finalImageUrl = supabase.storage.from('public-assets').getPublicUrl(uploadData.path).data.publicUrl;

      if (requiresViceCandidate) {
        const response = await fetchWithSessionAuth('/api/elections/submit-candidacy', {
          method: 'POST',
          body: JSON.stringify({
            electionId: values.election_id,
            viceCandidateId: values.vice_candidate_id,
            politicalName: values.political_name,
            bio: values.bio,
            proposals: values.proposals,
            campaignPhotoUrl: finalImageUrl,
          }),
        });
        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(payload?.error || 'Não foi possível registrar a candidatura presidencial.');
        }

        toast({ title: 'Convite enviado!', description: payload.message });
        onFinished?.();
        return;
      }

      const { data, error } = await supabase.rpc('submit_candidacy', {
        p_election_id: values.election_id,
        p_party_id: values.party_id === 'none' ? null : values.party_id,
        p_vice_candidate_id: null,
        p_political_name: values.political_name,
        p_bio: values.bio,
        p_proposals: values.proposals,
        p_campaign_photo_url: finalImageUrl,
      });

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.message || 'Não foi possível registrar a candidatura.');
      }

      toast({ title: 'Sucesso!', description: data.message });
      onFinished?.();
    } catch (error) {
      toast({ title: 'Erro ao registrar candidatura', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-full py-16">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
      </div>
    );
  }

  if (existingCandidacy) {
    return (
      <Card className="glass-effect border-none shadow-none">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-4 rounded-full bg-yellow-500/20">
            <AlertTriangle className="w-12 h-12 text-yellow-400" />
          </div>
          <CardTitle className="text-xl">Candidatura Ativa</CardTitle>
          <CardDescription className="text-base">
            Você já possui uma candidatura registrada. Para disputar outro cargo, primeiro cancele a candidatura atual.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-xl border border-white/10 bg-white/5">
            <div className="flex items-center gap-3">
              <Vote className="w-5 h-5 text-teal-400 shrink-0" />
              <div>
                <p className="font-semibold text-foreground">{existingCandidacy.political_name}</p>
                <p className="text-sm text-muted-foreground">Eleição: {existingCandidacy.elections?.name}</p>
                {existingCandidacy.vice?.full_name ? (
                  <p className="text-sm text-muted-foreground">Vice na chapa: {existingCandidacy.vice.full_name}</p>
                ) : null}
                <p className="text-xs text-muted-foreground mt-1">
                  Status:{' '}
                  <span className={existingCandidacy.status === 'Approved' ? 'text-green-400' : 'text-yellow-400'}>
                    {existingCandidacy.status === 'Approved' ? 'Aprovada' : 'Pendente'}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-center gap-3">
          <Button variant="outline" onClick={() => onFinished?.()}>
            Voltar
          </Button>
          <Button variant="destructive" onClick={handleCancelCandidacy} disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancelar Candidatura Atual
          </Button>
        </CardFooter>
      </Card>
    );
  }

  if (pendingViceInvitation) {
    const pendingMetadata = pendingViceInvitation.metadata || {};

    return (
      <Card className="glass-effect border-none shadow-none">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 p-4 rounded-full bg-blue-500/20">
            <Clock className="w-12 h-12 text-blue-300" />
          </div>
          <CardTitle className="text-xl">Chapa Aguardando Aceite do Vice</CardTitle>
          <CardDescription className="text-base">
            O vice indicado ainda precisa aceitar a composição da chapa antes que a candidatura siga para análise.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-xl border border-white/10 bg-white/5 space-y-2">
            <p className="font-semibold text-foreground">{pendingMetadata.political_name || 'Candidatura presidencial'}</p>
            <p className="text-sm text-muted-foreground">
              Eleição: {pendingMetadata.election_name || 'Eleição presidencial'}
            </p>
            <p className="text-sm text-muted-foreground">
              Vice indicado: {pendingMetadata.vice_candidate_name || 'Aguardando resposta'}
            </p>
            <p className="text-xs text-muted-foreground">
              Enviado em: {new Date(pendingViceInvitation.created_at).toLocaleString('pt-BR')}
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex justify-center">
          <Button variant="outline" onClick={() => onFinished?.()}>
            Fechar
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="glass-effect border-none shadow-none">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardHeader>
            <CardTitle>Formulário de Candidatura</CardTitle>
            <CardDescription>Preencha todos os campos obrigatórios para registrar sua candidatura.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="election_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Eleição</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a eleição" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {elections.map((election) => (
                        <SelectItem key={election.id} value={election.id}>
                          {election.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {requiresViceCandidate ? (
              <div className={`rounded-xl border p-4 ${presidentialRunBlocked ? 'border-red-500/30 bg-red-500/10' : 'border-blue-500/20 bg-blue-500/10'}`}>
                <p className="font-semibold text-foreground">Regra constitucional da chapa presidencial</p>
                <p className="text-sm text-muted-foreground mt-1">
                  A eleição presidencial ocorre por voto direto em chapa conjunta para Presidente e Vice-Presidente.
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Mandato: 1 mês. Limite: apenas 1 reeleição consecutiva.
                </p>
                {presidentialRunBlocked ? (
                  <p className="text-sm text-red-300 mt-3">
                    Você já venceu as duas últimas eleições presidenciais consecutivas e não pode registrar nova candidatura presidencial agora.
                  </p>
                ) : null}
              </div>
            ) : null}

            <FormField
              control={form.control}
              name="party_id"
              render={() => (
                <FormItem>
                  <FormLabel>Partido Político</FormLabel>
                  <FormControl>
                    <Input
                      value={userAffiliation ? parties.find((party) => party.id === userAffiliation)?.name || 'Carregando...' : 'Candidatura Avulsa'}
                      disabled
                      className="opacity-70 cursor-not-allowed"
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    {userAffiliation
                      ? 'Sua candidatura será vinculada automaticamente ao seu partido atual.'
                      : 'Você não possui filiação partidária. Sua candidatura será registrada como avulsa.'}
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            {requiresViceCandidate ? (
              <FormField
                control={form.control}
                name="vice_candidate_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vice-Presidente da Chapa</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined} disabled={loadingViceCandidates || presidentialRunBlocked}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={loadingViceCandidates ? 'Carregando opções...' : 'Selecione o vice-presidente'} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {viceCandidates.map((candidate) => (
                          <SelectItem key={candidate.id} value={candidate.id}>
                            {candidate.full_name || candidate.username}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      A candidatura presidencial só será registrada com a indicação simultânea do vice.
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <FormField
              control={form.control}
              name="political_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome Político</FormLabel>
                  <FormControl>
                    <Input placeholder="Seu nome na urna" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>Foto de Campanha</FormLabel>
              {imagePreview ? (
                <div className="relative inline-block">
                  <img
                    src={imagePreview}
                    alt="Preview da foto de campanha"
                    className="w-32 h-32 object-cover rounded-xl border-2 border-white/10"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                    onClick={handleClearImage}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed border-white/20 bg-white/5 hover:bg-white/10 cursor-pointer transition-colors">
                  <div className="p-3 rounded-full bg-teal-500/20">
                    <Upload className="w-6 h-6 text-teal-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">Clique para fazer upload</p>
                    <p className="text-xs text-muted-foreground">PNG, JPG, WEBP (máx. 5MB)</p>
                  </div>
                  <input
                    type="file"
                    className="hidden"
                    accept={IMAGE_ACCEPT_ATTRIBUTE}
                    onChange={handleFileSelect}
                  />
                </label>
              )}
              {imageError ? <p className="text-sm text-destructive">{imageError}</p> : null}
            </div>

            <FormField
              control={form.control}
              name="bio"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Biografia</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Conte sua história e qualificações..." {...field} rows={5} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="proposals"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Propostas</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Detalhe suas principais propostas de governo..." {...field} rows={10} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={isSubmitting || presidentialRunBlocked}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Vote className="mr-2 h-4 w-4" />}
              Enviar Candidatura
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
};

export default RegisterCandidacy;
