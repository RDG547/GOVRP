import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Building, ClipboardList } from 'lucide-react';

const MinisterDashboard = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Projetos em Andamento</CardTitle>
          <Building className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">12</div>
          <p className="text-xs text-muted-foreground">Iniciativas da sua pasta.</p>
        </CardContent>
      </Card>
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Políticas Propostas</CardTitle>
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">+3</div>
          <p className="text-xs text-muted-foreground">Novas propostas no último mês.</p>
        </CardContent>
      </Card>
      <div className="col-span-1 md:col-span-2 text-center p-8">
        <h3 className="text-xl font-semibold">Gestão Ministerial</h3>
        <p className="text-muted-foreground">Ferramentas de gestão de projetos e propostas em desenvolvimento.</p>
      </div>
    </div>
  );
};

export default MinisterDashboard;