import React, { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useCitizenNeeds } from '@/contexts/CitizenNeedsContext';
import { Button } from '@/components/ui/button';
export default function CitizenSleepPanel() {
  const { sleeping, remainingSleep, needs, act } = useCitizenNeeds();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!sleeping) return null;
  const wake = async () => { setBusy(true); setError(''); try { await act('wake', null, crypto.randomUUID()); } catch { setError('Não foi possível acordar. Tente novamente.'); } finally { setBusy(false); } };
  return <section className="space-y-4 rounded-2xl border border-indigo-400/30 bg-indigo-500/10 p-6 text-center" aria-label="Descanso em andamento"><Moon className="mx-auto h-10 w-10 text-indigo-300" /><h2 className="text-xl font-semibold">Seu cidadão está dormindo</h2><p className="text-sm">O descanso continua enquanto você está ausente.</p><div className="h-3 rounded-full bg-secondary overflow-hidden" role="progressbar" aria-label="Recuperação do sono" aria-valuenow={Math.round(needs.sleep)} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-indigo-400 transition-[width]" style={{ width: `${needs.sleep}%` }} /></div><p className="text-sm">{Math.round(needs.sleep)}% · Restam {Math.floor(remainingSleep / 60)} min {remainingSleep % 60} s</p><Button disabled={busy} onClick={wake}><Sun className="mr-2 h-4 w-4" />{busy ? 'Acordando…' : 'Acordar agora'}</Button>{error && <p role="alert">{error}</p>}</section>;
}
