import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Sparkles } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { releaseNotes } from '@/lib/releaseNotes';

export default function Updates() {
 return <main className="mx-auto min-w-0 max-w-5xl space-y-8 px-4 py-10 sm:px-6"><Helmet><title>Novidades · GOV.RP</title></Helmet><PageHeader centered icon={Sparkles} iconColor="text-cyan-400" title="Novidades do GOV.RP" description="Melhorias e correções publicadas para a comunidade."/>{releaseNotes.map(release=><article key={release.id} className="space-y-6"><header><p className="text-sm text-muted-foreground">{new Date(`${release.date}T12:00:00-03:00`).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'})}</p><h2 className="mt-2 text-2xl font-bold">{release.title}</h2></header><div className="grid gap-4 md:grid-cols-2">{release.categories.map(category=><section key={category.title} className="min-w-0 rounded-2xl border bg-card p-4 sm:p-6"><h3 className="text-lg font-semibold">{category.title}</h3><ul className="mt-3 list-disc space-y-3 pl-5 text-sm leading-relaxed text-muted-foreground">{category.items.map(item=><li key={item}>{item}</li>)}</ul></section>)}</div></article>)}</main>;
}
