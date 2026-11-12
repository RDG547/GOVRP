import React, { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, ShieldCheck, Unlink } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function WhatsAppAccountLink() {
  const { toast } = useToast();
  const [linked, setLinked] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_my_whatsapp_link_status');
    if (!error) setLinked(data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const generateCode = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('create_my_whatsapp_link_code');
    setBusy(false);
    if (error) toast({ title: 'Não foi possível gerar um código', description: error.message, variant: 'destructive' });
    else setCode(data);
  };

  const unlink = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('unlink_my_whatsapp_account');
    setBusy(false);
    if (error) toast({ title: 'Falha ao desvincular', description: error.message, variant: 'destructive' });
    else { setCode(''); await load(); toast({ title: 'WhatsApp desvinculado' }); }
  };

  const command = code ? '!vincular ' + code : '';

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Vincular WhatsApp</CardTitle>
        <CardDescription>Associe seu WhatsApp à conta do GOVRP para consultar sua ficha pública com o comando !perfil. Nenhum dado bancário ou privado é enviado para grupos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {linked?.linked ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-emerald-400"><ShieldCheck className="h-4 w-4" /> WhatsApp vinculado: {linked.linked_account}</p>
            <Button variant="outline" disabled={busy} onClick={unlink}><Unlink className="mr-2 h-4 w-4" /> Desvincular WhatsApp</Button>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">1. Clique para gerar um código válido por 10 minutos. 2. Abra o chat privado com o número do GOVRP Bot. 3. Envie o comando abaixo. Nunca publique códigos em grupos.</p>
            <Button disabled={busy} onClick={generateCode}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Gerar código temporário</Button>
            {code && <div className="rounded-xl border p-3">
              <p className="mb-2 text-xs text-muted-foreground">Copie e envie no privado do bot:</p>
              <code className="block break-all font-semibold">{command}</code>
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => {
                if (navigator.clipboard?.writeText) {
                  void navigator.clipboard.writeText(command).then(() => toast({ title: 'Comando copiado' })).catch(() => toast({ title: 'Copie o comando exibido acima' }));
                }
              }}>Copiar comando</Button>
            </div>}
          </>
        )}
        <p className="text-xs text-muted-foreground">A vinculação pode ser cancelada a qualquer momento. O bot utiliza uma conexão não oficial ao WhatsApp e depende de funcionamento contínuo na VPS Oracle.</p>
      </CardContent>
    </Card>
  );
}
