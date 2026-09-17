import React, { useEffect, useState } from 'react';
import { FileText, Download } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';

export const MESSAGE_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
export const MESSAGE_FILE_LIMIT = 10 * 1024 * 1024;
export default function MessageAttachment({ attachment }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const sign = async () => {
      const result = await supabase.storage.from('x-message-attachments').createSignedUrl(attachment.path, 120);
      if (active) { setUrl(result.data?.signedUrl || ''); setError(Boolean(result.error)); }
    };
    void sign();
    const timer = setInterval(sign, 90000);
    return () => { active = false; clearInterval(timer); };
  }, [attachment.path]);
  return <div className="mb-2 space-y-2">{url && attachment.type.startsWith('image/') ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={attachment.name} className="max-h-64 max-w-full rounded-lg object-contain"/></a> : <div className="flex items-center gap-2"><FileText className="h-7 w-7 shrink-0"/><span className="break-all text-sm">{attachment.name}</span></div>}<p className="text-xs opacity-70">{(Number(attachment.size) / 1024).toFixed(0)} KB</p>{url && <Button asChild size="sm" variant="secondary"><a href={url} download={attachment.name} target="_blank" rel="noopener noreferrer"><Download className="mr-2 h-4 w-4"/>Abrir arquivo</a></Button>}{error && <p className="text-xs">Arquivo indisponível ou acesso encerrado.</p>}</div>;
}
