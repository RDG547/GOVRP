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
    import { Loader2, Vote } from 'lucide-react';
    import ImageUploader from '@/components/ImageUploader';

    const candidacySchema = z.object({
      election_id: z.string().uuid("Selecione uma eleição válida."),
      party_id: z.string().uuid("Selecione um partido válido.").optional().nullable(),
      political_name: z.string().min(3, "O nome político deve ter pelo menos 3 caracteres."),
      campaign_photo_url: z.string().optional().nullable(),
      bio: z.string(),
      proposals: z.string(),
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

      const form = useForm({
        resolver: zodResolver(candidacySchema),
        defaultValues: {
          election_id: '',
          party_id: null,
          political_name: '',
          campaign_photo_url: null,
          bio: '',
          proposals: '',
        },
      });

      useEffect(() => {
        const fetchData = async () => {
          setLoading(true);
          try {
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
                const { data: memberData, error: memberError } = await supabase
                    .from('party_members')
                    .select('party_id')
                    .eq('user_id', user.id)
                    .single();
                if (memberData) {
                    setUserAffiliation(memberData.party_id);
                    form.setValue('party_id', memberData.party_id);
                }
            }

          } catch (error) {
            if (error.code !== 'PGRST116') { // Ignore "No rows found" for party members
                toast({ title: "Erro ao carregar dados", description: error.message, variant: "destructive" });
            }
          } finally {
            setLoading(false);
          }
        };
        fetchData();
      }, [toast, user, form]);

      const onSubmit = async (values) => {
        setIsSubmitting(true);
        try {
          let finalImageUrl = values.campaign_photo_url;
          if (imageFile) {
            const { data: uploadData, error: uploadError } = await supabase.storage
              .from('public-assets')
              .upload(`campaign-photos/${user.id}/${Date.now()}-${imageFile.name}`, imageFile);
            if (uploadError) throw uploadError;
            finalImageUrl = supabase.storage.from('public-assets').getPublicUrl(uploadData.path).data.publicUrl;
          }

          if (!finalImageUrl) {
            throw new Error("A foto de campanha é obrigatória.");
          }

          const { data, error } = await supabase.rpc('submit_candidacy', {
            p_election_id: values.election_id,
            p_party_id: values.party_id,
            p_vice_candidate_id: null, // Simplificado por enquanto
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
        return <div className="flex justify-center items-center h-full"><Loader2 className="w-12 h-12 animate-spin text-primary" /></div>;
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
                      <Select onValueChange={field.onChange} value={field.value || ''} disabled={!!userAffiliation}>
                        <FormControl>
                          <SelectTrigger>
                              <SelectValue placeholder={userAffiliation ? (parties.find(p => p.id === userAffiliation)?.name || "Seu partido") : "Selecione seu partido ou deixe em branco para avulsa"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {!userAffiliation && <SelectItem value="">Candidatura Avulsa</SelectItem>}
                          {parties.map(p => <SelectItem key={p.id} value={p.id} disabled={userAffiliation && userAffiliation !== p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
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
                <FormField
                  control={form.control}
                  name="campaign_photo_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Foto de Campanha</FormLabel>
                       <ImageUploader 
                          onUrlChange={field.onChange} 
                          onFileChange={setImageFile} 
                          initialUrl={field.value || ''}
                       />
                      <FormMessage />
                    </FormItem>
                  )}
                />
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