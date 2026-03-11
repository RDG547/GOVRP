import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import PageHeader from '@/components/layout/PageHeader';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, User, Landmark, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CandidateCard = ({ candidate }) => (
  <Card className="glass-effect hover:border-primary transition-all duration-300 flex flex-col">
    <CardHeader className="flex-row gap-4 items-start">
      <Avatar className="w-16 h-16 border-2 border-primary">
        <AvatarImage src={candidate.campaign_photo_url} alt={candidate.political_name} />
        <AvatarFallback>{candidate.political_name.charAt(0)}</AvatarFallback>
      </Avatar>
      <div>
        <CardTitle>{candidate.political_name}</CardTitle>
        <p className="text-sm text-muted-foreground">{candidate.elections.name}</p>
        {candidate.political_parties && (
          <Badge variant="secondary" className="mt-2 flex items-center gap-1 w-fit">
            <Landmark className="w-3 h-3" /> {candidate.political_parties.acronym}
          </Badge>
        )}
      </div>
    </CardHeader>
    <CardContent className="flex-grow">
      <p className="text-sm text-muted-foreground line-clamp-3">{candidate.bio}</p>
    </CardContent>
    <CardFooter>
      <Button className="w-full" variant="outline">Ver Propostas</Button>
    </CardFooter>
  </Card>
);

const ConsultCandidates = () => {
  const [elections, setElections] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [filteredCandidates, setFilteredCandidates] = useState([]);
  const [selectedElection, setSelectedElection] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

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

        const { data: candidatesData, error: candidatesError } = await supabase
          .from('candidates')
          .select('*, elections(name), political_parties(acronym)')
          .eq('status', 'Approved');

        if (candidatesError) throw candidatesError;
        setCandidates(candidatesData);
        setFilteredCandidates(candidatesData);
      } catch (error) {
        toast({ title: 'Erro ao carregar dados', description: error.message, variant: 'destructive' });
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [toast]);

  useEffect(() => {
    let result = candidates;
    if (selectedElection !== 'all') {
      result = result.filter(c => c.election_id === selectedElection);
    }
    if (searchTerm) {
      result = result.filter(c => 
        c.political_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.political_parties?.acronym.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    setFilteredCandidates(result);
  }, [selectedElection, searchTerm, candidates]);

  return (
    <div className="container mx-auto p-4 md:p-8">
      <Helmet>
        <title>Consultar Candidatos - Portal Eleitoral</title>
        <meta name="description" content="Conheça os candidatos aprovados para as próximas eleições." />
      </Helmet>

      <PageHeader
        title="Consultar Candidatos"
        description="Conheça quem está concorrendo nas eleições e suas propostas."
      />

      <div className="my-8 p-4 glass-effect rounded-lg flex flex-col md:flex-row gap-4 items-center">
        <div className="relative w-full md:w-1/2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input 
            placeholder="Buscar por nome ou partido..." 
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={selectedElection} onValueChange={setSelectedElection}>
          <SelectTrigger className="w-full md:w-1/2">
            <SelectValue placeholder="Filtrar por eleição" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as Eleições</SelectItem>
            {elections.map(election => (
              <SelectItem key={election.id} value={election.id}>{election.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-16">
          <Loader2 className="w-12 h-12 animate-spin text-primary" />
        </div>
      ) : (
        filteredCandidates.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredCandidates.map(candidate => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 text-muted-foreground glass-effect rounded-lg">
            <User className="w-16 h-16 mx-auto mb-4 text-primary" />
            <h3 className="text-xl font-semibold">Nenhum candidato encontrado</h3>
            <p>Ajuste os filtros ou verifique mais tarde.</p>
          </div>
        )
      )}
    </div>
  );
};

export default ConsultCandidates;