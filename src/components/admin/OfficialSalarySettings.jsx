import { formatLocaleBR } from '@/lib/dateTime';
import React, { useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { useOfficialSalaries, currentSalary } from '@/hooks/use-official-salaries';
import { roleIcon } from '@/lib/roleIcons';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
function SalaryRow({ role, refresh }) {
  const [draft, setDraft] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const Icon = roleIcon(role.role);
  const save = async event => { event.preventDefault(); setBusy(true); const result = await supabase.rpc('configure_official_salary', { p_role: role.role, p_amount: Number(draft.amount), p_expected_version: draft.version }); if (result.error) { console.error('Configuração salarial', result.error); setError('Não foi possível salvar. Confira o valor e se houve outra alteração.'); } else { setDraft(null); setError(''); await refresh(); } setBusy(false); };
  return <form onSubmit={save} className="rounded-xl border p-4 space-y-3"><h3 className="flex items-center gap-2 font-semibold"><Icon className="w-5 h-5 shrink-0 text-primary" />{role.title}</h3><p className="text-sm">Vigente: {formatCurrency(currentSalary(role))} por semana</p>{Date.parse(role.valid_from)>Date.now()&&<p className="text-xs text-amber-300">A partir de {formatLocaleBR(new Date(role.valid_from), 'toLocaleString', 'pt-BR')}: {formatCurrency(role.amount)}</p>}<label className="block text-sm">Próximo ciclo (R$)<Input aria-label={`Salário de ${role.title}`} type="number" min="0" max="1000000" step="0.01" required value={draft?.amount ?? role.amount} onChange={event=>setDraft({ amount:event.target.value,version:draft?.version ?? role.version })} /></label>{draft&&draft.version!==role.version&&<p role="status" className="text-xs">O valor foi alterado em outra sessão. <Button variant="link" size="sm" type="button" onClick={()=>setDraft(null)}>Usar valor atualizado</Button></p>}{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}<Button disabled={!draft||busy||draft.version!==role.version} type="submit">{busy?<Loader2 className="mr-2 h-4 w-4 animate-spin"/>:<Save className="mr-2 h-4 w-4"/>}Salvar remuneração</Button></form>;
}
export default function OfficialSalarySettings() {
  const { roles,error,refresh } = useOfficialSalaries();
  return <section className="space-y-4"><h2 className="text-xl font-semibold">Remuneração dos cargos oficiais</h2><p className="text-sm text-muted-foreground">Pagamento semanal, às segundas-feiras, às 9h de Brasília. Alterações valem no próximo ciclo e preservam os pagamentos anteriores. Cada cidadão recebe pelo cargo oficial vigente, uma vez por ciclo.</p>{error&&<p role="alert">{error}</p>}<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{roles.map(role=><SalaryRow key={role.role} role={role} refresh={refresh}/>)}</div></section>;
}
