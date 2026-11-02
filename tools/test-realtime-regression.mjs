import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
let checks = 0;
const check = (label, condition) => {
  assert.ok(condition, label);
  checks++;
  console.log('✓', label);
};

const realtime = source('src/lib/realtime.js');
check('Assinaturas reutilizadas por domínio e destinatário',
  realtime.includes('const channels = new Map()') && realtime.includes('entry.listeners.add(listener)'));
check('Mudanças em canais voltam a sincronizar ao reconectar',
  realtime.includes("status === 'SUBSCRIBED'") && realtime.includes('entry.sync()'));
check('Pop-ups têm processamento prioritário sem polling',
  realtime.includes("'role-notifications', 'my-invitations', 'notification-feed'")
    && realtime.includes('PRIORITY_BATCH_MS'));

const xFeed = source('src/components/social-x/XFeed.jsx');
const xPostTables = source('src/lib/xPosts.js');
check('Posts, curtidas e comentários atualizam o feed sem F5',
  xFeed.includes("useDomainRealtime('x-posts'")
  && xPostTables.includes("['posts', 'likes', 'comments']")
  && xFeed.includes('changedPostIds(events)'));
check('Feed reconcilia publicações não recebidas durante a queda',
  xFeed.includes("event.eventType === 'SYNC'") && xFeed.includes('get_x_posts'));

const popup = source('src/components/ElectionOfficeAwardPopup.jsx');
check('Pop-up eleitoral usa notificações próprias em vez de assinar todas as eleições',
  popup.includes("useDomainRealtime('role-notifications'")
  && popup.includes("table: 'notifications'")
  && !popup.includes("'election_settlements', 'elections'"));
check('Expiração de convites não provoca requisição ao servidor a cada segundo',
  popup.includes('setTimeout(() => void fetchPending(), delay)')
  && !popup.includes('if (Date.parse(notification.invitation.expires_at) <= Date.now()+clockOffset.current) void fetchPending()'));

const salary = source('src/components/SalaryPaymentPopup.jsx');
const migration = source('supabase/migrations/20261102121500_salary_payment_private_realtime.sql');
check('Popup salarial utiliza canal compartilhado e aviso de sucesso',
  salary.includes("useDomainRealtime(") && salary.includes("'notification-feed'")
  && salary.includes('salary_payment_received') && salary.includes('salary_payment_failed'));
check('Salário não transmite tabela sensível por postgres_changes',
  !salary.includes("table: 'salary_payments'")
  && !migration.includes('ADD TABLE public.salary_payments'));
check('Evento do salário é privado, idempotente e sem valor financeiro',
  migration.includes('NEW.user_id')
  && migration.includes('salary_payment_received_notice_once')
  && migration.includes("jsonb_build_object('salary_payment_id', NEW.id)")
  && !migration.includes('NEW.amount')
  && !migration.includes('NEW.salary_snapshot'));

const needs = source('src/contexts/CitizenNeedsContext.jsx');
check('Necessidades têm atualização por linha e reconciliação ao reconectar',
  needs.includes("useDomainRealtime('citizen-needs'")
  && needs.includes("change.eventType === 'SYNC'")
  && needs.includes('void refresh()'));

const fx = source('src/hooks/use-rp-exchange-rates.js');
const stock = source('src/pages/services/StockExchange.jsx');
check('Câmbio e bolsa continuam assinando alterações reais',
  fx.includes("useDomainRealtime('bank-exchange'")
  && stock.includes("useDomainRealtime('stock-market'")
  && stock.includes("'stock_price_history'"));

console.log(`\n${checks} verificações estáticas de regressão do Realtime aprovadas.`);
console.log('Entrega entre dois WebSockets autenticados requer testes de integração separados.');
