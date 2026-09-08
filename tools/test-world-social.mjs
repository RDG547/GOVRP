import assert from 'node:assert/strict';
import { service, actor, request, rpc, subscribe, waitFor, cleanup } from './lib/world-test.mjs';
let checks = 0;
const check = (value, label) => { assert(value, label); console.log(`✓ ${label}`); checks++; };
try {
  const [a, b, c, admin] = await Promise.all([actor('autor'), actor('leitor'), actor('terceiro'), actor('admin', 'Admin')]);
  const bEvents = [], cEvents = [], roles = [];
  await Promise.all([
    subscribe(b.client.channel(`stories-b-${b.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, e => bEvents.push(e))),
    subscribe(c.client.channel(`stories-c-${c.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, e => cEvents.push(e))),
    subscribe(a.client.channel(`roles-${a.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${a.id}` }, e => roles.push(e.new))),
  ]);
  await new Promise(resolve => setTimeout(resolve, 1500));
  const story = await request(a.client.from('stories').insert({ user_id: a.id, media_type: 'text', media_url: '#2456ab', content: 'Story público entre três sessões' }).select('id').single());
  await waitFor(() => bEvents.some(e => e.new?.id === story.id) && cEvents.some(e => e.new?.id === story.id), 'Story nas sessões B/C').catch(async error => { console.error('Eventos recebidos:', bEvents, cEvents); console.error('SELECT sessão B:', await b.client.from('stories').select('id').eq('id', story.id)); throw error; });
  for (const viewer of [a, b, c]) {
    const data = await rpc(viewer.client, 'get_stories_by_user_ids', { p_user_ids: [a.id] });
    check(data[0]?.stories.some(item => item.id === story.id), 'Story público visível pela consulta da sessão');
  }
  const forbidden = await c.client.rpc('delete_story', { p_story_id: story.id });
  check(Boolean(forbidden.error), 'usuário comum não apaga Story de outro autor');
  await rpc(a.client, 'delete_story', { p_story_id: story.id });
  await waitFor(() => bEvents.some(e => e.eventType === 'DELETE' && e.old.id === story.id) && cEvents.some(e => e.eventType === 'DELETE' && e.old.id === story.id), 'DELETE nas sessões B/C');
  check(true, 'exclusão do autor chega a duas sessões pelo Realtime');
  const moderated = await request(a.client.from('stories').insert({ user_id: a.id, media_type: 'text', media_url: '#2456ab', content: 'Story para moderação' }).select('id').single());
  await rpc(admin.client, 'delete_story', { p_story_id: moderated.id });
  await waitFor(() => bEvents.some(e => e.old.id === moderated.id) && cEvents.some(e => e.old.id === moderated.id), 'moderação nas sessões B/C');
  check((await request(service.from('notifications').select('id').eq('user_id', a.id).eq('type', 'story_moderated'))).length === 1, 'moderação notifica o autor');
  check((await request(service.from('domain_events').select('id').eq('source_id', moderated.id).eq('event_type', 'story_removed'))).length === 1, 'moderação registra auditoria única');
  const expired = await request(service.from('stories').insert({ user_id: a.id, media_type: 'text', media_url: '#2456ab', content: 'Expirado', created_at: new Date(Date.now() - 25 * 3600000).toISOString() }).select('id').single());
  check(!(await rpc(b.client, 'get_stories_by_user_ids', { p_user_ids: [a.id] })).length, 'Story expirado não aparece na RPC');
  check(!(await request(b.client.from('stories').select('id').eq('id', expired.id))).length, 'RLS também oculta Story expirado');
  await rpc(a.client, 'save_tutorial_progress', { p_completed: true, p_dont_show_again: false });
  let profile = await request(a.client.from('profiles').select('tutorial_completed,tutorial_dont_show_again').eq('id', a.id).single());
  check(profile.tutorial_completed && !profile.tutorial_dont_show_again, 'conclusão do tutorial não equivale a recusa permanente');
  await rpc(a.client, 'save_tutorial_progress', { p_completed: false, p_dont_show_again: true });
  profile = await request(a.client.from('profiles').select('tutorial_completed,tutorial_dont_show_again').eq('id', a.id).single());
  check(profile.tutorial_completed && profile.tutorial_dont_show_again, 'preferência permanente persiste sem apagar conclusão');
  await request(service.from('profiles').update({ role: 'Juiz' }).eq('id', a.id));
  await waitFor(() => roles.some(n => n.type === 'role_changed' && n.metadata.new_role === 'Juiz'), 'evento de cargo online');
  const notice = roles.find(n => n.type === 'role_changed' && n.metadata.new_role === 'Juiz');
  check(notice.metadata.previous_role === 'Cidadão' && notice.metadata.popup_pending, 'cargo publica evento com papel anterior e modal pendente');
  check(!await rpc(b.client, 'acknowledge_role_change', { p_notification_id: notice.id }), 'terceiro não confirma evento de cargo alheio');
  check(await rpc(a.client, 'acknowledge_role_change', { p_notification_id: notice.id }), 'titular confirma ciência do cargo');
  check(!await rpc(a.client, 'acknowledge_role_change', { p_notification_id: notice.id }), 'confirmação não se repete');
  await a.client.removeAllChannels();
  await request(service.from('profiles').update({ role: 'Cidadão' }).eq('id', a.id));
  const pending = await request(a.client.from('notifications').select('*').eq('user_id', a.id).eq('type', 'role_changed').is('metadata->>popup_shown_at', null));
  check(pending.some(n => n.metadata.new_role === 'Cidadão' && n.metadata.loss), 'mudança offline fica pendente e perda de cargo é institucional');
  console.log(`\n${checks} verificações reais de Stories, tutorial e cargos aprovadas.`);
} finally { await cleanup(); }
