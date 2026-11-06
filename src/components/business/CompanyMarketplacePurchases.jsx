import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ShoppingCart, Loader2, PackageCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { purchaseErrorMessage } from '@/lib/commerce';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { useToast } from '@/components/ui/use-toast';
import { companyMoney } from '@/lib/companyEconomy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export default function CompanyMarketplacePurchases({ companyId, inventory = [], onChanged }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false), [rows, setRows] = useState([]), [query, setQuery] = useState(''), [error, setError] = useState('');
  const [selection, setSelection] = useState(null), [busy, setBusy] = useState(false), [reason, setReason] = useState('');
  const intent = useRef(null), sequence = useRef(0);
  const load = useCallback(async () => {
    if (!open) return;
    const current = ++sequence.current;
    const result = await supabase.rpc('get_products_with_final_price');
    if (current !== sequence.current) return;
    if (result.error) { setError('Não foi possível consultar as ofertas.'); return; }
    setRows((result.data || []).filter(item => item.product_type === 'one-time' && item.stock > 0 && item.seller?.business_id && item.seller.business_id !== companyId)); setError('');
  }, [open, companyId]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  useDomainRealtime('company-marketplace-purchases', companyId, ['products', 'government_rules', 'state_enterprises', 'businesses'], load, open);
  const choose = (kind, item) => { setSelection({ kind, item }); setReason(''); intent.current = crypto.randomUUID(); };
  const confirm = async () => {
    if (busy) return; setBusy(true);
    try {
      const result = selection.kind === 'buy' ? await supabase.rpc('buy_company_product', { p_business_id: companyId, p_product_id: selection.item.id, p_max_total: Number(selection.item.final_price), p_idempotency_key: intent.current }) : await supabase.rpc('consume_company_product', { p_business_id: companyId, p_inventory_id: selection.item.id, p_quantity: 1, p_reason: reason, p_idempotency_key: intent.current });
      if (result.error) throw result.error;
      setSelection(null); intent.current = null; await Promise.all([load(), onChanged?.()]);
      toast({ title: selection.kind === 'buy' ? 'Compra empresarial entregue' : 'Uso do estoque registrado', description: selection.kind === 'buy' ? 'O caixa foi debitado e o produto ou recurso foi entregue ao estoque da empresa.' : 'O custo histórico foi apropriado sem um novo débito bancário.' });
    } catch (failure) { console.error('Compra/consumo empresarial', failure); toast({ title: 'Operação não concluída', description: failure.message === 'INSUFFICIENT_BALANCE' ? 'O caixa empresarial não cobre esta compra.' : purchaseErrorMessage(failure), variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  const visible = rows.filter(item => `${item.name} ${item.seller?.business_name}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
  return <section className="space-y-4"><h3 className="flex items-center gap-2 font-semibold"><ShoppingCart className="h-5 w-5 text-emerald-400" />Compras no Negócios Livre</h3><p className="text-sm text-muted-foreground">As compras usam o caixa empresarial e os tributos vigentes. Insumos vão para o estoque de produção; os demais produtos ficam no inventário empresarial até o registro de uso.</p><details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">Consultar ofertas para a empresa</summary><div className="mt-3 space-y-3"><Input aria-label="Buscar produto para a empresa" placeholder="Produto ou fornecedor" value={query} onChange={event => setQuery(event.target.value)} />{error && <p role="alert">{error}<Button variant="link" onClick={load}>Tentar novamente</Button></p>}<div className="grid max-h-96 gap-3 overflow-y-auto sm:grid-cols-2">{visible.slice(0, 30).map(item => <article key={item.id} className="space-y-2 rounded-lg bg-secondary/40 p-3"><h4 className="break-words font-medium">{item.name}</h4><p className="break-words text-xs text-muted-foreground">{item.seller.business_name} · {item.stock} unidades</p><p className="text-sm">Total por unidade: {companyMoney(item.final_price)}</p><Button size="sm" disabled={busy || item.seller.activity_restricted} className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => choose('buy', item)}><ShoppingCart className="mr-2 h-4 w-4" />Comprar uma unidade</Button></article>)}</div>{!visible.length && !error && <p className="text-sm text-muted-foreground">Nenhuma oferta disponível para esta busca.</p>}{visible.length > 30 && <p className="text-xs text-muted-foreground">Exibindo as primeiras 30 ofertas. Use a busca para refinar.</p>}</div></details><section className="space-y-3"><h4 className="font-medium">Produtos adquiridos pela empresa</h4>{inventory.length ? inventory.map(item => <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3"><div className="min-w-0 text-sm"><p className="break-words font-medium">{item.name}</p><p>{item.quantity} unidade(s) · custo unitário histórico: {companyMoney(item.metadata?.unit_cost_snapshot)}</p></div><Button size="sm" variant="outline" disabled={busy} onClick={() => choose('use', item)}><PackageCheck className="mr-2 h-4 w-4" />Registrar uso de uma unidade</Button></article>) : <p className="text-sm text-muted-foreground">Nenhum produto de consumo em estoque. Recursos de produção aparecem no estoque de insumos.</p>}</section><Dialog open={Boolean(selection)} onOpenChange={value => { if (!value && !busy) setSelection(null); }}><DialogContent><DialogHeader><DialogTitle>{selection?.kind === 'buy' ? 'Confirmar compra empresarial' : 'Registrar uso empresarial'}</DialogTitle><DialogDescription>{selection?.item.name} · uma unidade</DialogDescription></DialogHeader>{selection?.kind === 'buy' ? <dl className="space-y-2 text-sm">{[['Valor da operação', selection.item.metadata?.quote?.gross_amount ?? selection.item.price], ['Tributos cobrados do comprador', selection.item.metadata?.quote?.buyer_tax || 0], ['Total debitado do caixa', selection.item.final_price]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd>{companyMoney(value)}</dd></div>)}</dl> : <><p className="text-sm">Custo a apropriar: {companyMoney(selection?.item.metadata?.unit_cost_snapshot)}. O caixa já foi debitado na compra.</p><label className="block text-sm">Finalidade do uso<Input disabled={busy} value={reason} minLength={5} maxLength={500} onChange={event => { setReason(event.target.value); intent.current = crypto.randomUUID(); }} /></label></>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => setSelection(null)}>Cancelar</Button><Button disabled={busy || (selection?.kind === 'use' && reason.trim().length < 5)} onClick={confirm}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar</Button></DialogFooter></DialogContent></Dialog></section>;
}
