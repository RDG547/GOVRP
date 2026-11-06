import { PoliceEvidenceFile } from './PoliceEvidenceFiles';
import React from 'react';
import { FileCheck, FileText, Shield } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatJusticeDate } from '@/lib/justice/time';
export default function CaseEvidence({ evidence = [], onSeal }) {
 return <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Provas vinculadas ({evidence.length})</summary><div className="mt-3 space-y-3">{evidence.map(item=><article key={item.id} className="space-y-2 rounded border p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><FileText className="h-4 w-4 text-cyan-300"/><p className="min-w-0 flex-1 break-words font-medium">{item.title}</p><Badge variant="outline">{item.status==='sealed'?'Lacrada':'Coletada'}</Badge></div><p className="whitespace-pre-wrap break-words">{item.description}</p><p className="text-xs text-muted-foreground">Versão {item.version} · Registro {formatJusticeDate(item.collected_at || item.created_at)}</p>{item.sealed_at&&<p className="flex gap-2 text-xs text-muted-foreground"><FileCheck className="h-4 w-4 shrink-0 text-emerald-400"/>Lacre: {formatJusticeDate(item.sealed_at)}</p>}{item.evidence_hash&&<p className="break-all font-mono text-[10px] text-muted-foreground" title="Identificador de integridade do registro">{item.evidence_hash}</p>}{item.metadata?.private_file&&<PoliceEvidenceFile id={item.id} name={item.title}/>}
{/^https?:\/\//i.test(item.file_url||'')&&<a href={item.file_url} target="_blank" rel="noopener noreferrer" className="inline-block text-primary underline">Abrir arquivo da prova</a>}{onSeal&&item.status!=='sealed'&&<Button size="sm" variant="outline" onClick={()=>onSeal(item)}><Shield className="mr-2 h-4 w-4"/>Lacrar prova</Button>}</article>)}{!evidence.length&&<p className="text-sm text-muted-foreground">Nenhuma prova disponível para seu acesso.</p>}</div></details>;
}
