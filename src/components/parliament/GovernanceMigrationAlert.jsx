import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { DatabaseZap } from 'lucide-react';

const GovernanceMigrationAlert = ({ compact = false }) => (
  <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-50">
    <DatabaseZap className="h-4 w-4 text-amber-300" />
    <AlertTitle>{compact ? 'Migração pendente' : 'Camada de governança aguardando migração'}</AlertTitle>
    <AlertDescription className="text-amber-100/90">
      As telas de comissões e mesa diretora já estão prontas no frontend, mas dependem da aplicação da migration do banco para carregar dados reais.
    </AlertDescription>
  </Alert>
);

export default GovernanceMigrationAlert;
