import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { FileSignature, Vote } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ParliamentarianDashboard = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Projetos de Lei Propostos</CardTitle>
          <FileSignature className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">8</div>
          <p className="text-xs text-muted-foreground">Sua contribuição legislativa.</p>
        </CardContent>
      </Card>
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Votações em Aberto</CardTitle>
          <Vote className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">3</div>
          <p className="text-xs text-muted-foreground">Projetos aguardando seu voto.</p>
        </CardContent>
      </Card>
       <div className="col-span-1 md:col-span-2 text-center p-8">
        <h3 className="text-xl font-semibold">Ação Legislativa</h3>
        <p className="text-muted-foreground mb-4">Acesse as ferramentas para propor e votar em projetos de lei.</p>
        <Button>Ver Votações</Button>
      </div>
    </div>
  );
};

export default ParliamentarianDashboard;