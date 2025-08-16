import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { PenSquare, Users, BarChart2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PresidentDashboard = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Decretos Emitidos</CardTitle>
          <PenSquare className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">15</div>
          <p className="text-xs text-muted-foreground">Ações executivas realizadas.</p>
        </CardContent>
      </Card>
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Aprovação Popular</CardTitle>
          <Users className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">75%</div>
          <p className="text-xs text-muted-foreground">Baseado em enquetes recentes.</p>
        </CardContent>
      </Card>
      <Card className="glass-effect">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Crescimento do PIB</CardTitle>
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">+2.5%</div>
          <p className="text-xs text-muted-foreground">No último trimestre.</p>
        </CardContent>
      </Card>
       <div className="col-span-1 md:col-span-3 text-center p-8">
        <h3 className="text-xl font-semibold">Gabinete Presidencial</h3>
        <p className="text-muted-foreground mb-4">Ferramentas para emitir decretos e gerenciar o governo.</p>
        <Button>Emitir Decreto</Button>
      </div>
    </div>
  );
};

export default PresidentDashboard;