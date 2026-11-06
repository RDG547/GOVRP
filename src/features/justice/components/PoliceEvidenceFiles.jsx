import React, { useState } from 'react';
import { Download, FileText, Loader2, Paperclip, X } from 'lucide-react';
import { fetchWithSessionAuth } from '@/lib/apiAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';

export function PoliceEvidenceUploader({ value = [], onChange, onBusyChange }) {
  const [busy, setBusy] = useState(false), { toast } = useToast();
  const upload = async event => {
    const files = [...(event.target.files || [])]; event.target.value = '';
    if (!files.length) return;
    if (files.length + value.length > 10) { toast({ title: 'Inclua até dez arquivos por boletim', variant: 'destructive' }); return; }
    setBusy(true); onBusyChange?.(true); const uploaded = [];
    try {
      for (const file of files) {
        if (!file.size || file.size > 4 * 1024 * 1024) throw new Error('Cada arquivo deve ter até 4 MB.');
        const response = await fetchWithSessionAuth('/api/justice/evidence', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Evidence-Filename': encodeURIComponent(file.name) }, body: file });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        uploaded.push({ upload_id: result.id, name: result.name, bytes: result.bytes, mime: result.mime });
      }
    } catch (failure) { toast({ title: 'Anexo não enviado', description: failure.message, variant: 'destructive' }); }
    finally { if (uploaded.length) onChange([...value, ...uploaded]); setBusy(false); onBusyChange?.(false); }
  };
  return <div className="space-y-2"><label className="block space-y-1 text-sm"><span className="flex items-center gap-2"><Paperclip className="h-4 w-4" />Arquivos da ocorrência</span><Input type="file" multiple disabled={busy || value.length >= 10} accept=".jpg,.jpeg,.png,.gif,.webp,.avif,.mp4,.mov,.webm,.mp3,.wav,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.txt,.csv" onChange={upload} /></label><p className="text-xs text-muted-foreground">Até dez anexos, de no máximo 4 MB cada. Imagens, vídeo, áudio, PDF, documentos, planilhas e texto. Acesso restrito às pessoas autorizadas. Em denúncias anônimas, confira se o conteúdo e as propriedades do arquivo revelam sua identidade.</p>{busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Validando e enviando arquivos…</p>}<ul className="space-y-1">{value.map(file => <li key={file.upload_id} className="flex min-w-0 items-center gap-2 rounded border p-2 text-sm"><FileText className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 break-words">{file.name} · {Math.ceil(file.bytes / 1024)} KB</span><Button type="button" size="icon" variant="ghost" disabled={busy} aria-label={`Remover anexo ${file.name}`} onClick={() => onChange(value.filter(item => item.upload_id !== file.upload_id))}><X className="h-4 w-4" /></Button></li>)}</ul></div>;
}

export function PoliceEvidenceFile({ id, name }) {
  const [file, setFile] = useState(null), [busy, setBusy] = useState(false), [text, setText] = useState('');
  const { toast } = useToast();
  const open = async () => {
    setBusy(true); setText('');
    try {
      const response = await fetchWithSessionAuth(`/api/justice/evidence?id=${encodeURIComponent(id)}`);
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      if (result.mime.startsWith('text/')) {
        const preview = await fetch(result.preview_url); if (!preview.ok) throw new Error('O link de acesso expirou. Abra o arquivo novamente.');
        setText((await preview.text()).slice(0, 64000));
      }
      setFile(result);
    } catch (failure) { toast({ title: 'Arquivo indisponível', description: failure.message, variant: 'destructive' }); }
    finally { setBusy(false); }
  };
  return <><Button type="button" variant="outline" size="sm" disabled={busy} onClick={open} className="h-auto min-h-10 max-w-full whitespace-normal break-words">{busy ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : <FileText className="mr-2 h-4 w-4 shrink-0" />}{name || 'Consultar arquivo'}</Button><Dialog open={Boolean(file)} onOpenChange={value => { if (!value) setFile(null); }}><DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="break-words pr-6">{file?.name}</DialogTitle><DialogDescription>Arquivo de acesso restrito · {Math.ceil(Number(file?.bytes || 0) / 1024)} KB · link válido por dois minutos.</DialogDescription></DialogHeader>{file?.mime.startsWith('image/') ? <img src={file.preview_url} alt={file.name} className="max-h-[65dvh] w-full object-contain" /> : file?.mime.startsWith('video/') ? <video controls src={file.preview_url} className="max-h-[65dvh] w-full" /> : file?.mime.startsWith('audio/') ? <audio controls src={file.preview_url} className="w-full" /> : file?.mime === 'application/pdf' ? <iframe title={`Prévia de ${file.name}`} src={file.preview_url} sandbox="" className="h-[60dvh] w-full rounded border" /> : file?.mime.startsWith('text/') ? <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words rounded bg-secondary p-3 text-xs">{text}{Number(file.bytes) > 64000 ? '\n[Prévia limitada a 64 mil caracteres. Baixe o arquivo para ler o conteúdo completo.]' : ''}</pre> : <p className="text-sm text-muted-foreground">Baixe o documento ou planilha para abrir no aplicativo compatível.</p>}<Button asChild className="w-full"><a href={file?.url} target="_blank" rel="noopener noreferrer"><Download className="mr-2 h-4 w-4" />Baixar arquivo</a></Button></DialogContent></Dialog></>;
}
