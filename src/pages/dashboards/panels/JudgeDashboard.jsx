import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Gavel, FileText } from 'lucide-react';

const JudgeDashboard = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Casos Pendentes</CardTitle>
          <Gavel className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">5</div>
          <p className="text-xs text-muted-foreground">Processos aguardando julgamento.</p>
        </CardContent>
      </Card>
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Sentenças Emitidas</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">128</div>
          <p className="text-xs text-muted-foreground">Total de sentenças proferidas.</p>
        </CardContent>
      </Card>
       <div className="col-span-1 md:col-span-2 text-center p-8">
        <h3 className="text-xl font-semibold">Gestão de Casos</h3>
        <p className="text-muted-foreground">Funcionalidades de gestão de casos e sentenças em desenvolvimento.</p>
      </div>
    </div>
  );
};

export default JudgeDashboard;