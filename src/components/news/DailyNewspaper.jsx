import PagedResults from '@/components/ui/paged-results';
import { newsCategory } from '@/lib/newsCategories';
import { formatLocaleBR } from '@/lib/dateTime';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, CalendarDays, Download, FileText, Share2, Loader2, Newspaper } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { captureElement } from '@/lib/captureElement';
import { brazilEditionDate, buildNewspaperPages, validEditionDate } from '@/lib/newspaper';
import './newspaper.css';

const tables = ['news_articles', 'news_categories', 'dou_entries', 'national_media_briefs'];
const formatDate = date => formatLocaleBR(new Date(`${date}T12:00:00-03:00`), 'toLocaleDateString', 'pt-BR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' });
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function NewspaperPage({ articles, date, number, count, teasers, exporting = false }) {
  return <article className={`govrp-newspaper ${number === 1 ? 'newspaper-front' : ''} ${exporting ? 'newspaper-export' : ''}`} aria-label={`Página ${number} da edição de ${formatDate(date)}`}>
    <header className="newspaper-masthead">
      <div className="newspaper-kicker"><span>REPÚBLICA • SOCIEDADE • ECONOMIA</span><span>GOVRP</span></div>
      <p className="newspaper-name">Jornal Nacional</p>
      <div className="newspaper-dateline"><time dateTime={date}>{formatDate(date)}</time><span>Edição diária · {date.replaceAll('-', '')}</span></div>
    </header>
    <div className={`newspaper-stories ${number === 1 ? 'newspaper-lead' : ''}`}>
      {articles.map(article => <section key={article.key} className="newspaper-story">
        <p className="newspaper-category">{article.category || 'Notícias'}{article.part > 1 ? ` · Continuação ${article.part}/${article.parts}` : ''}</p>
        <h2>{article.article_id ? <Link to={`/news/${article.article_id}`}>{article.title}</Link> : article.title}</h2>
        <p className="newspaper-byline">{article.author} · {formatLocaleBR(new Date(article.published_at), 'toLocaleTimeString', 'pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</p>
        {article.image_url && <figure><img src={article.image_url} alt={`Imagem da matéria: ${article.title}`} loading={exporting ? 'eager' : 'lazy'} crossOrigin="anonymous" /></figure>}
        <p className="newspaper-text">{article.text}</p>
        {article.part < article.parts && <p className="newspaper-continued">Esta matéria continua nesta edição.</p>}
      </section>)}
    </div>
    {number === 1 && teasers.length > 0 && <aside className="newspaper-teasers"><p className="newspaper-section-label">TAMBÉM NESTA EDIÇÃO</p><div>{teasers.map(item => <section key={item.id}><p className="newspaper-category">{item.category}</p><h3>{item.title}</h3></section>)}</div></aside>}
    <footer className="newspaper-footer"><span>JORNAL NACIONAL • GOVRP</span><span>{number} / {count}</span><span>govrp.vercel.app/news?edition={date}</span></footer>
  </article>;
}

export default function DailyNewspaper() {
  const [params, setParams] = useSearchParams();
  const date = validEditionDate(params.get('edition')) ? params.get('edition') : brazilEditionDate();
  const [edition, setEdition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('Todas');
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState('');
  const [progress, setProgress] = useState('');
  const exportHost = useRef(null);
  const request = useRef(0);
  const exportingRef = useRef(false);
  const deferredRefresh = useRef(false);
  const { toast } = useToast();
  const load = useCallback(async () => {
    if (exportingRef.current) { deferredRefresh.current = true; return; }
    const sequence = ++request.current;
    try {
      const response = await supabase.rpc('get_daily_news', { p_date: date, p_offset: 0 });
      if (response.error) throw response.error;
      const result = response.data;
      let items = result.items || [];
      while (items.length < result.total) {
        const next = await supabase.rpc('get_daily_news', { p_date: date, p_offset: items.length });
        if (next.error) throw next.error;
        if (!next.data.items.length) break;
        items = [...items, ...next.data.items];
        if (sequence !== request.current) return;
      }
      if (sequence !== request.current) return;
      setEdition({ ...result, items: [...new Map(items.map(item => [item.id, item])).values()] }); setError('');
    } catch { if (sequence === request.current) setError('Não foi possível carregar esta edição. Tente novamente.'); }
    finally { if (sequence === request.current) setLoading(false); }
  }, [date]);
  useEffect(() => { setLoading(true); setPage(0); setCategory('Todas'); void load(); return () => { request.current++; }; }, [load]);
  useDomainRealtime('daily-news', 'public', tables, load);
  const items = edition?.date === date ? edition.items.map(item => ({...item,category:newsCategory(item.category).name})) : [];
  const categories = [...new Set(items.map(item => item.category).filter(Boolean))];
  const filtered = category === 'Todas' ? items : items.filter(item => item.category === category);
  const pages = useMemo(() => buildNewspaperPages(filtered), [filtered]);
  const selectedPage = Math.min(page, Math.max(0, pages.length - 1));
  const chooseDate = next => { const updated = new URLSearchParams(params); updated.set('edition', next); setParams(updated, { replace: false }); };

  const shareEdition = async () => {
    const payload={title:`Jornal Nacional GOVRP — ${formatDate(date)}`,text:`Acompanhe a edição de ${formatDate(date)} do Jornal Nacional.`,url:`${location.origin}/news?edition=${date}`};
    try {
      if(navigator.share){try{await navigator.share(payload);return;}catch(failure){if(failure.name==='AbortError')return;}}
      await navigator.clipboard.writeText(`${payload.title}\n${payload.url}`);
      toast({title:'Link da edição copiado',description:'Cole o link para compartilhar o jornal.'});
    }catch{toast({title:'Não foi possível compartilhar',description:'Copie o endereço da edição na barra do navegador.',variant:'destructive'});}
  };
  const exportEdition = async kind => {
    if (exportingRef.current || !pages.length) return;
    exportingRef.current = true; setExporting(kind);
    try {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const nodes = [...exportHost.current.querySelectorAll('.govrp-newspaper')];
      const { jsPDF } = await import('jspdf');
      const pdf = kind !== 'png' ? new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }) : null;
      for (let index = 0; index < nodes.length; index++) {
        setProgress(`Preparando página ${index + 1} de ${nodes.length}`);
        const canvas = await captureElement(nodes[index], { scale: 2, backgroundColor: '#f4f0e5' });
        if (pdf) {
          if (index) pdf.addPage();
          const ratio = Math.min(210 / canvas.width, 297 / canvas.height);
          pdf.addImage(canvas.toDataURL('image/jpeg', .94), 'JPEG', (210 - canvas.width * ratio) / 2, 0, canvas.width * ratio, canvas.height * ratio);
        } else {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          if (!blob) throw new Error('Não foi possível gerar a imagem.');
          download(blob, `jornal-govrp-${date}-pagina-${index + 1}.png`);
        }
        canvas.width = 1; canvas.height = 1;
      }
      if (pdf) {
        const blob = pdf.output('blob');
        const filename = `jornal-govrp-${date}.pdf`;
        download(blob, filename);
      }
      if (kind !== 'share') toast({ title: 'Jornal pronto', description: kind === 'png' ? 'Cada página foi salva como uma imagem PNG.' : 'A edição foi salva em PDF.' });
    } catch (failure) { toast({ title: 'Não foi possível exportar', description: failure.message || 'Tente novamente.', variant: 'destructive' }); }
    finally {
      exportingRef.current = false; setExporting(''); setProgress('');
      if (deferredRefresh.current) { deferredRefresh.current = false; void load(); }
    }
  };

  return <section className="space-y-5" aria-label="Jornal diário">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" disabled={!edition?.previous_date || Boolean(exporting)} onClick={() => chooseDate(edition.previous_date)}><ChevronLeft className="mr-1 h-4 w-4" />Anterior</Button>
        <label className="flex items-center gap-2 text-sm"><CalendarDays className="h-4 w-4" /><span className="sr-only">Arquivo de edições</span><Input type="date" value={date} max={brazilEditionDate()} disabled={Boolean(exporting)} onChange={event => { if (event.target.value) chooseDate(event.target.value); }} className="w-auto" /></label>
        <Button variant="outline" disabled={!edition?.next_date || Boolean(exporting)} onClick={() => chooseDate(edition.next_date)}>Próxima<ChevronRight className="ml-1 h-4 w-4" /></Button>
        <Button variant="ghost" disabled={Boolean(exporting)} onClick={() => chooseDate(brazilEditionDate())}>Hoje</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!pages.length || Boolean(exporting)} onClick={() => exportEdition('png')}><Download className="mr-2 h-4 w-4" />PNG</Button>
        <Button variant="outline" disabled={!pages.length || Boolean(exporting)} onClick={() => exportEdition('pdf')}><FileText className="mr-2 h-4 w-4" />PDF</Button>
        <Button disabled={!pages.length || Boolean(exporting)} onClick={shareEdition}><Share2 className="mr-2 h-4 w-4" />Compartilhar</Button>
      </div>
    </div>
    {exporting && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{progress || 'Preparando edição…'}</p>}
    {error && <div role="alert" className="rounded-lg border border-destructive/40 p-4">{error} <Button variant="link" onClick={load}>Tentar novamente</Button></div>}
    {categories.length > 1 && <div className="flex flex-wrap gap-2" aria-label="Editorias">{['Todas', ...categories].map(value => <Button key={value} size="sm" variant={category === value ? 'default' : 'outline'} disabled={Boolean(exporting)} onClick={() => { setCategory(value); setPage(0); }}>{React.createElement(newsCategory(value).icon,{className:`mr-2 h-4 w-4 ${category===value?'':newsCategory(value).color}`})}{value}</Button>)}</div>}
    {loading && !items.length ? <div role="status" className="flex justify-center p-16"><Loader2 className="animate-spin" /><span className="sr-only">Carregando edição</span></div> : !pages.length ? <div className="rounded-lg border p-12 text-center"><Newspaper className="mx-auto mb-4 h-10 w-10" /><h2 className="text-xl font-bold">Nenhuma publicação nesta edição</h2><p className="mt-2 text-muted-foreground">Consulte uma edição anterior no arquivo.</p></div> : <>
      <PagedResults page={selectedPage}><NewspaperPage articles={pages[selectedPage]} date={date} number={selectedPage + 1} count={pages.length} teasers={filtered.slice(1, 4)} /></PagedResults>
      <nav className="flex items-center justify-center gap-3" aria-label="Páginas da edição"><Button variant="outline" disabled={selectedPage === 0} onClick={() => setPage(selectedPage - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button><span>Página {selectedPage + 1} de {pages.length}</span><Button variant="outline" disabled={selectedPage >= pages.length - 1} onClick={() => setPage(selectedPage + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></Button></nav>
    </>}
    {exporting && <div ref={exportHost} data-export-host aria-hidden="true" className="pointer-events-none fixed left-[-10000px] top-0 w-[900px]">{pages.map((articles, index) => <NewspaperPage key={index} articles={articles} date={date} number={index + 1} count={pages.length} teasers={filtered.slice(1, 4)} exporting />)}</div>}
  </section>;
}
