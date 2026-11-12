import React, { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Copy, Loader2, MessageCircle, RefreshCw, Send, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const blank = { enabled: false, commands_enabled: true, command_prefix: '!' };
const categoryLabels = [
  ['notify_news', 'Notícias'],
  ['notify_elections', 'Eleições'],
  ['notify_votings', 'Votações'],
  ['notify_government', 'Atos do governo'],
];
const commands = [
  ['!ajuda', 'Lista de comandos'],
  ['!noticias', 'Últimas notícias'],
  ['!economia', 'Indicadores da economia'],
  ['!governo', 'Presidente e ministros'],
  ['!partidos', 'Partidos ativos'],
  ['!eleicoes', 'Eleições'],
  ['!votacoes', 'Votações em andamento'],
  ['!leis', 'Projetos recentes'],
  ['!perfil', 'Perfil público vinculado'],
];
const patchGroup = (groups, jid, patch) =>
  groups.map((g) => g.jid === jid ? { ...g, ...patch } : g);

export default function WhatsAppBotManagement() {
  const { toast } = useToast();
  const [config, setConfig] = useState(blank);
  const [runtime, setRuntime] = useState(null);
  const [groups, setGroups] = useState([]);
  const [events, setEvents] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [newGroup, setNewGroup] = useState('');
  const [announcement, setAnnouncement] = useState({ title: '', message: '', group: 'all' });
  const [clock, setClock] = useState(Date.now());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [s, r, g, e, d] = await Promise.all([
      supabase.from('whatsapp_bot_settings').select('*').eq('id', true).maybeSingle(),
      supabase.from('whatsapp_bot_runtime').select('*').eq('id', true).maybeSingle(),
      supabase.from('whatsapp_bot_groups').select('*').order('display_name').limit(250),
      supabase.from('whatsapp_bot_events').select('id,event_kind,title,created_at').order('id', { ascending: false }).limit(12),
      supabase.from('whatsapp_bot_deliveries').select('event_id,group_jid,status,last_error,updated_at').order('updated_at', { ascending: false }).limit(20),
    ]);
    const failure = [s,r,g,e,d].find((item) => item.error)?.error;
    if (failure && !silent) toast({ title: 'Não foi possível carregar o bot', description: failure.message, variant: 'destructive' });
    if (!s.error && s.data) setConfig(s.data);
    if (!r.error) setRuntime(r.data);
    if (!g.error) setGroups(g.data || []);
    if (!e.error) setEvents(e.data || []);
    if (!d.error) setDeliveries(d.data || []);
    setClock(Date.now());
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(true), 15000);
    return () => clearInterval(interval);
  }, [load]);

  const saveConfig = async () => {
    setBusy('settings');
    const { error } = await supabase.rpc('admin_save_whatsapp_bot_settings', {
      p_enabled: config.enabled,
      p_commands_enabled: config.commands_enabled,
      p_prefix: config.command_prefix,
    });
    setBusy('');
    if (error) toast({ title: 'Erro ao salvar configurações', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Configurações salvas' }); await load(true); }
  };

  const saveGroup = async (group) => {
    setBusy(group.jid);
    const { error } = await supabase.rpc('admin_save_whatsapp_bot_group', {
      p_jid: group.jid,
      p_enabled: group.enabled,
      p_news: group.notify_news,
      p_elections: group.notify_elections,
      p_votings: group.notify_votings,
      p_government: group.notify_government,
    });
    setBusy('');
    if (error) toast({ title: 'Erro ao configurar grupo', description: error.message, variant: 'destructive' });
    else { toast({ title: 'Grupo atualizado', description: group.display_name || group.jid }); await load(true); }
  };

  const addGroup = async () => {
    const jid = newGroup.trim();
    if (!/^[A-Za-z0-9_.:-]+@g\.us$/.test(jid)) {
      toast({ title: 'JID de grupo inválido', description: 'Exemplo: 120363XXXXXXXXX@g.us', variant: 'destructive' }); return;
    }
    const group = { jid, display_name: 'Grupo cadastrado manualmente', enabled: false, notify_news: true, notify_elections: true, notify_votings: true, notify_government: true };
    setBusy('add');
    const { error } = await supabase.rpc('admin_save_whatsapp_bot_group', {
      p_jid: jid, p_enabled: false, p_news: true, p_elections: true, p_votings: true, p_government: true,
    });
    setBusy('');
    if (error) toast({ title: 'Erro ao adicionar grupo', description: error.message, variant: 'destructive' });
    else { setNewGroup(''); setGroups((previous) => [...previous, group]); await load(true); }
  };

  const sendAnnouncement = async () => {
    if (!announcement.title.trim() || !announcement.message.trim()) {
      toast({ title: 'Preencha o título e a mensagem', variant: 'destructive' }); return;
    }
    setBusy('message');
    const { error } = await supabase.rpc('admin_enqueue_whatsapp_bot_announcement', {
      p_title: announcement.title.trim(), p_message: announcement.message.trim(),
      p_target_group: announcement.group === 'all' ? null : announcement.group,
    });
    setBusy('');
    if (error) toast({ title: 'Não foi possível agendar o envio', description: error.message, variant: 'destructive' });
    else {
      setAnnouncement({ title: '', message: '', group: 'all' });
      toast({ title: 'Mensagem colocada na fila', description: 'O bot enviará somente aos grupos autorizados quando estiver online e ativado.' });
      await load(true);
    }
  };

  const online = Boolean(runtime?.connected && runtime?.paired && runtime?.last_seen_at &&
    clock - new Date(runtime.last_seen_at).getTime() < 75000);
  const validQR = Boolean(runtime?.qr_image && runtime?.qr_expires_at &&
    new Date(runtime.qr_expires_at).getTime() > clock && !online);
  const activeGroups = groups.filter((g) => g.enabled);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold"><Bot className="h-6 w-6 text-emerald-400" /> GOVRP Bot — WhatsApp</h2>
          <p className="mt-1 text-sm text-muted-foreground">Notícias, votações e consultas nos grupos da comunidade. Site: govrp.vercel.app.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="mr-2 h-4 w-4" /> Atualizar</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {online ? <Wifi className="h-5 w-5 text-emerald-400" /> : <WifiOff className="h-5 w-5 text-amber-400" />}
            {online ? 'Bot conectado' : 'Bot desconectado / aguardando VPS'}
          </CardTitle>
          <CardDescription>
            {runtime?.phone_jid ? 'Conta: ' + runtime.phone_jid : 'Nenhum número vinculado nesta instalação.'}
            {runtime?.last_seen_at ? ' • Último sinal: ' + new Date(runtime.last_seen_at).toLocaleString('pt-BR') : ' • Sem sinal de execução'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {validQR && (
            <div className="max-w-sm rounded-xl border p-4">
              <p className="mb-3 text-sm font-medium">Vincule seu número dedicado em WhatsApp → Dispositivos conectados → Conectar dispositivo.</p>
              <img src={runtime.qr_image} alt="QR temporário para conectar o bot ao WhatsApp" className="mx-auto w-full max-w-[300px] rounded bg-white p-2" />
              <p className="mt-2 text-xs text-muted-foreground">O QR expira rapidamente. Esta imagem só pode ser consultada pelo administrador.</p>
            </div>
          )}
          {runtime?.last_error && <p role="alert" className="text-sm text-red-400">{runtime.last_error}</p>}
          <p className="flex items-start gap-2 text-sm text-muted-foreground"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /> Whatsmeow não é uma API oficial. Utilize número próprio, respeite o consentimento dos grupos e evite disparos excessivos.</p>
          <p className="text-xs text-muted-foreground">A VPS Oracle e o serviço Go precisam estar ligados. A sessão e as credenciais não ficam armazenadas no site.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Configuração geral</CardTitle><CardDescription>Nenhum envio automático ocorre enquanto o bot ou o grupo estiver desativado.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4"><Label htmlFor="whats-enable">Ativar bot e notificações</Label><Switch id="whats-enable" checked={config.enabled} onCheckedChange={(enabled) => setConfig((c) => ({ ...c, enabled }))} /></div>
          <div className="flex items-center justify-between gap-4"><Label htmlFor="whats-commands">Permitir comandos dos participantes</Label><Switch id="whats-commands" checked={config.commands_enabled} onCheckedChange={(commands_enabled) => setConfig((c) => ({ ...c, commands_enabled }))} /></div>
          <div className="max-w-xs"><Label htmlFor="whats-prefix">Prefixo dos comandos</Label><Select value={config.command_prefix || '!'} onValueChange={(command_prefix) => setConfig((c) => ({ ...c, command_prefix }))}><SelectTrigger id="whats-prefix"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="!">! (ex.: !noticias)</SelectItem><SelectItem value="/">/ (ex.: /noticias)</SelectItem></SelectContent></Select></div>
          <Button onClick={saveConfig} disabled={busy === 'settings'}>{busy === 'settings' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar configurações</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Grupos autorizados ({activeGroups.length}/{groups.length})</CardTitle><CardDescription>Os grupos associados ao número aparecem automaticamente. Você decide em quais o bot pode responder ou publicar.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2"><Input className="min-w-0 flex-1" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Opcional: ID do grupo, como 120363…@g.us" /><Button variant="outline" onClick={addGroup} disabled={busy === 'add'}>Adicionar grupo</Button></div>
          {groups.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Nenhum grupo descoberto. Conecte o bot à VPS e adicione o número a um grupo; o serviço detectará os grupos existentes.</p>}
          {groups.map((group) => (
            <div key={group.jid} className="space-y-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0"><p className="font-semibold">{group.display_name || 'Grupo sem nome'}</p><p className="break-all text-xs text-muted-foreground">{group.jid}</p></div>
                <div className="flex items-center gap-2"><Label htmlFor={'group-' + group.jid}>Autorizado</Label><Switch id={'group-' + group.jid} checked={group.enabled} onCheckedChange={(enabled) => setGroups((all) => patchGroup(all, group.jid, { enabled }))} /></div>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                {categoryLabels.map(([key,label]) => <div className="flex items-center gap-2" key={key}><Switch id={key + '-' + group.jid} checked={group[key]} onCheckedChange={(v) => setGroups((all) => patchGroup(all,group.jid,{ [key]: v }))} /><Label htmlFor={key + '-' + group.jid}>{label}</Label></div>)}
              </div>
              <Button size="sm" disabled={busy === group.jid} onClick={() => saveGroup(group)}>Salvar grupo</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Send className="h-5 w-5" /> Comunicado manual</CardTitle><CardDescription>Envio pela fila, respeitando a autorização dos grupos. Não será enviado se o bot estiver desativado.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="bot-title">Título</Label><Input id="bot-title" maxLength={120} value={announcement.title} onChange={(e) => setAnnouncement((a) => ({ ...a, title: e.target.value }))} placeholder="Comunicado do GOVRP" />
          <Label htmlFor="bot-message">Mensagem</Label><Textarea id="bot-message" rows={4} maxLength={1500} value={announcement.message} onChange={(e) => setAnnouncement((a) => ({ ...a, message: e.target.value }))} placeholder="Digite o comunicado..." />
          <Label>Destino</Label><Select value={announcement.group} onValueChange={(group) => setAnnouncement((a) => ({ ...a, group }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos os grupos autorizados</SelectItem>{activeGroups.map((g) => <SelectItem value={g.jid} key={g.jid}>{g.display_name || g.jid}</SelectItem>)}</SelectContent></Select>
          <Button disabled={busy === 'message' || !config.enabled || activeGroups.length === 0} onClick={sendAnnouncement}>{busy === 'message' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />} Enfileirar mensagem</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Comandos disponíveis</CardTitle><CardDescription>Consultas somente leitura, com limite contra repetições. O participante vincula a conta com um código temporário em suas Configurações.</CardDescription></CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {commands.map(([command,description]) => <div className="flex justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm" key={command}><code>{config.command_prefix}{command.slice(1)}</code><span className="text-muted-foreground">{description}</span></div>)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Eventos e entregas</CardTitle><CardDescription>Registro das últimas atividades, sem expor mensagens privadas.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <div><p className="mb-2 text-sm font-medium">Eventos recentes</p>{events.length ? events.map((e) => <div key={e.id} className="border-b py-2 text-xs"><p className="font-medium">{e.title}</p><p className="text-muted-foreground">{e.event_kind} • {new Date(e.created_at).toLocaleString('pt-BR')}</p></div>) : <p className="text-sm text-muted-foreground">Nenhum evento na fila.</p>}</div>
            <div><p className="mb-2 text-sm font-medium">Últimas entregas</p>{deliveries.length ? deliveries.map((d) => <div key={d.event_id + d.group_jid} className="border-b py-2 text-xs"><p>{d.status === 'sent' ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5 text-emerald-400" /> : <MessageCircle className="mr-1 inline h-3.5 w-3.5" />}{d.status} — {d.group_jid}</p>{d.last_error && <p className="text-red-400">{d.last_error}</p>}</div>) : <p className="text-sm text-muted-foreground">Nenhum envio registrado.</p>}</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
