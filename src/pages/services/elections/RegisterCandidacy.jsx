import React, { useState, useEffect } from 'react';
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
    import { Loader2, Vote, AlertTriangle, Upload, X, Image as ImageIcon } from 'lucide-react';
    import { buildStoragePath } from '@/lib/security';
    import {
      ACCEPTED_IMAGE_EXTENSIONS,
      ACCEPTED_IMAGE_MIME_TYPES,
      IMAGE_ACCEPT_ATTRIBUTE,
      MAX_STANDARD_IMAGE_UPLOAD_BYTES,
      validateSelectedFile,
    } from '@/lib/security';

    const candidacySchema = z.object({
      election_id: z.string().uuid("Selecione uma eleição válida."),
      party_id: z.string().uuid("Selecione um partido válido.").optional().nullable(),
      political_name: z.string().min(3, "O nome político deve ter pelo menos 3 caracteres."),
      bio: z.string().min(1, "A biografia é obrigatória."),
      proposals: z.string().min(1, "As propostas são obrigatórias."),
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
      
      // Active candidacy blocking
      const [existingCandidacy, setExistingCandidacy] = useState(null);

      const form = useForm({
        resolver: zodResolver(candidacySchema),
        defaultValues: {
          election_id: '',
          party_id: null,
          political_name: '',
          bio: '',
          proposals: '',
        },
      });

      useEffect(() => {
        const fetchData = async () => {
          setLoading(true);
          try {
            // Check if user already has an active candidacy (Pendente or Approved)
            const { data: existingData, error: existingError } = await supabase
              .from('candidates')
              .select('*, elections(name)')
              .eq('user_id', user.id)
              .in('status', ['Pendente', 'Approved']);
            
            if (existingError) throw existingError;
            
            if (existingData && existingData.length > 0) {
              setExistingCandidacy(existingData[0]);
              setLoading(false);
              return; // Don't load the rest of the form data
            }

            const { data: electionsData, error: electionsError } = await supabase
              .from('elections')
              .select('id, name')
              .eq('status', 'Candidacy');
            if (electionsError) throw electionsError;
            setElections(electionsData);

            const { data: partiesData, error: partiesError } = await supabase
              .from('political_parties')
              .select('id, name')
              .eq('is_active', true);
            if (partiesError) throw partiesError;
            setParties(partiesData);

            if (user?.id) {
                const { data: memberData } = await supabase
                    .from('party_members')
                    .select('party_id')
                    .eq('user_id', user.id)
                    .maybeSingle();
                if (memberData) {
                    setUserAffiliation(memberData.party_id);
                    form.setValue('party_id', memberData.party_id);
                }
            }

          } catch (error) {
            if (error.code !== 'PGRST116') {
                toast({ title: "Erro ao carregar dados", description: error.message, variant: "destructive" });
            }
          } finally {
            setLoading(false);
          }
        };
        fetchData();
      }, [toast, user, form]);

      const handleCancelCandidacy = async () => {
        if (!existingCandidacy) return;
        setIsSubmitting(true);
        try {
          const { error } = await supabase
            .from('candidates')
            .delete()
            .eq('id', existingCandidacy.id);
          if (error) throw error;
          toast({ title: "Candidatura cancelada!", description: "Agora você pode se candidatar a outro cargo." });
          setExistingCandidacy(null);
          // Re-fetch data for the form
          const { data: electionsData } = await supabase.from('elections').select('id, name').eq('status', 'Candidacy');
          setElections(electionsData || []);
          const { data: partiesData } = await supabase.from('political_parties').select('id, name').eq('is_active', true);
          setParties(partiesData || []);
        } catch (error) {
          toast({ title: "Erro ao cancelar", description: error.message, variant: "destructive" });
        } finally {
          setIsSubmitting(false);
        }
      };

      const handleFileSelect = (e) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

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
        reader.onload = (ev) => setImagePreview(ev.target.result);
        reader.readAsDataURL(selectedFile);
      };

      const handleClearImage = () => {
        setImageFile(null);
        setImagePreview(null);
        setImageError('');
      };

      const onSubmit = async (values) => {
        if (!imageFile) {
          setImageError("A foto de campanha é obrigatória. Faça upload de uma imagem.");
          return;
        }

        setIsSubmitting(true);
        try {
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('public-assets')
            .upload(buildStoragePath({ prefix: 'campaign-photos', entityId: user.id, fileName: imageFile.name }), imageFile);
          if (uploadError) throw uploadError;
          const finalImageUrl = supabase.storage.from('public-assets').getPublicUrl(uploadData.path).data.publicUrl;

          const { data, error } = await supabase.rpc('submit_candidacy', {
            p_election_id: values.election_id,
            p_party_id: values.party_id === 'none' ? null : values.party_id,
            p_vice_candidate_id: null,
            p_political_name: values.political_name,
            p_bio: values.bio,
            p_proposals: values.proposals,
            p_campaign_photo_url: finalImageUrl,
          });

          if (error) throw error;
          if (!data.success) throw new Error(data.message);

          toast({ title: "Sucesso!", description: data.message });
          if (onFinished) onFinished();
        } catch (error) {
          toast({ title: "Erro ao registrar candidatura", description: error.message, variant: "destructive" });
        } finally {
          setIsSubmitting(false);
        }
      };

      if (loading) {
        return <div className="flex justify-center items-center h-full py-16"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;
      }

      // Show blocking message if user already has an active candidacy
      if (existingCandidacy) {
        return (
          <Card className="glass-effect border-none shadow-none">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 p-4 rounded-full bg-yellow-500/20">
                <AlertTriangle className="w-12 h-12 text-yellow-400" />
              </div>
              <CardTitle className="text-xl">Candidatura Ativa</CardTitle>
              <CardDescription className="text-base">
                Você já possui uma candidatura registrada. Para se candidatar a outro cargo, cancele a candidatura atual primeiro.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-xl border border-white/10 bg-white/5">
                <div className="flex items-center gap-3">
                  <Vote className="w-5 h-5 text-teal-400 shrink-0" />
                  <div>
                    <p className="font-semibold text-foreground">{existingCandidacy.political_name}</p>
                    <p className="text-sm text-muted-foreground">Eleição: {existingCandidacy.elections?.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Status: <span className={existingCandidacy.status === 'Approved' ? 'text-green-400' : 'text-yellow-400'}>
                        {existingCandidacy.status === 'Approved' ? 'Aprovada' : 'Pendente'}
                      </span>
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-center gap-3">
              <Button variant="outline" onClick={() => onFinished?.()}>Voltar</Button>
              <Button variant="destructive" onClick={handleCancelCandidacy} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Cancelar Candidatura Atual
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
                <CardDescription>Todos os campos são obrigatórios.</CardDescription>
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
                          <SelectTrigger><SelectValue placeholder="Selecione a eleição" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {elections.map(e => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="party_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Partido Político</FormLabel>
                      <FormControl>
                        <Input 
                          value={userAffiliation ? (parties.find(p => p.id === userAffiliation)?.name || "Carregando...") : "Candidatura Avulsa"} 
                          disabled 
                          className="opacity-70 cursor-not-allowed"
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground">
                        {userAffiliation 
                          ? "Sua candidatura será vinculada ao seu partido atual." 
                          : "Você não possui filiação partidária. Sua candidatura será avulsa."}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="political_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome Político</FormLabel>
                      <FormControl><Input placeholder="Seu nome na urna" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Image Upload Only (no URL pasting) */}
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
                  {imageError && <p className="text-sm text-destructive">{imageError}</p>}
                </div>

                <FormField
                  control={form.control}
                  name="bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Biografia</FormLabel>
                      <FormControl><Textarea placeholder="Conte sua história e qualificações..." {...field} rows={5} /></FormControl>
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
                      <FormControl><Textarea placeholder="Detalhe suas principais propostas de governo..." {...field} rows={10} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
              <CardFooter>
                <Button type="submit" disabled={isSubmitting}>
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
