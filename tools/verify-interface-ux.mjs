import { readFileSync } from 'node:fs';
import process from 'node:process';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const checks = [];
const verify = (label, condition) => {
  if (!condition) throw new Error(`Falha: ${label}`);
  checks.push(label);
};

const main = read('src/main.jsx');
const app = read('src/App.jsx');
const auth = read('src/contexts/AuthContext.jsx');
const dialog = read('src/components/ui/dialog.jsx');
const alertDialog = read('src/components/ui/alert-dialog.jsx');
const admin = read('src/pages/admin/AdminDashboard.jsx');
const parliament = read('src/pages/services/Parliament.jsx');
const historyMigration = read('supabase/migrations/20260817140039_bill_status_history.sql');
const dic = read('src/pages/services/DIC.jsx');
const officialDocument = read('src/components/dic/OfficialDocument.jsx');
const homeNews = read('src/components/home/NewsSection.jsx');
const bank = read('src/components/bank/BankManagementPanel.jsx');
const economy = read('src/features/economy/pages/PublicEconomyPanel.jsx');
const economyLibrary = read('src/lib/countryRpEconomy.js');
const dateTime = read('src/lib/dateTime.js');
const documentation = read('src/pages/Documentation.jsx');
const digitalArchive = read('src/pages/services/DigitalArchive.jsx');

verify('existe apenas um renderizador global de Toast', (main.match(/<Toaster\b/g) || []).length === 1 && !app.includes('<Toaster'));
verify('StrictMode permanece ativo para revelar efeitos sem cleanup', main.includes('<React.StrictMode>'));
verify('callback do Auth não aguarda consultas do Supabase', auth.includes('onAuthStateChange((event, newSession) =>') && !auth.includes('onAuthStateChange(async'));
verify('hidratação possui timeout, erro recuperável e nova tentativa', auth.includes('AUTH_HYDRATION_TIMEOUT_MS') && auth.includes('authError') && auth.includes('Tentar novamente'));
verify('Admin troca conteúdo sem remontar o cabeçalho', app.includes("location.pathname.startsWith('/admin-dashboard')") && app.includes("? '/admin-dashboard'"));
verify('Dialogs têm margem lateral e rolagem segura no celular', [dialog, alertDialog].every((source) => source.includes('calc(100%_-_2rem)') && source.includes('calc(100dvh_-_2rem)') && source.includes('overflow-y-auto')));
verify('tabs do Admin preservam nomes completos', admin.includes('flex-nowrap') && admin.includes('shrink-0') && !admin.includes('substring(0, 6)'));
verify('Parlamento exibe proposta e cronologia com segundos', parliament.includes('Proposto em') && parliament.includes('Histórico de tramitação') && parliament.includes('formatDateTimeBR(event.occurred_at)'));
verify('tabs do Parlamento rolam localmente no celular', parliament.includes('overflow-x-auto scroll-smooth') && parliament.includes('min-w-max flex-nowrap'));
verify('eventos parlamentares futuros usam hora do servidor', historyMigration.includes('clock_timestamp()') && historyMigration.includes('new.status is distinct from old.status'));
verify('datas históricas não são inventadas', historyMigration.includes('bill.updated_at > bill.created_at') && historyMigration.includes('historical_updated_at'));
verify('PDF aguarda fontes e captura o documento real', dic.includes('document.fonts.ready') && dic.includes("querySelector('[data-official-document]')") && officialDocument.includes('data-official-document'));
verify('PDF corrige linha e escala sem esconder o renderizador', dic.includes('fontSize * 1.3') && dic.includes('scale: 3') && !dic.includes("left: '-9999px'"));
verify('Home consulta exatamente as três notícias recentes', homeNews.includes("order('created_at', { ascending: false })") && homeNews.includes('.limit(3)'));
verify('carrossel possui loop de cinco segundos, navegação e swipe', homeNews.includes('5000') && homeNews.includes('% news.length') && homeNews.includes('handleTouchStart') && homeNews.includes('Notícia anterior'));
verify('notícias acompanham publicações em tempo real com cleanup', homeNews.includes("channel('home-latest-news')") && homeNews.includes('removeChannel(channel)'));
verify('câmbio usa histórico persistido dos indicadores', economyLibrary.includes('exchange_usd') && economyLibrary.includes('exchange_eur') && economy.includes('Evolução do câmbio'));
verify('Banco separa cartões e empréstimos em tabs', bank.includes('Solicitações de Cartão') && bank.includes('Solicitações de Empréstimo') && bank.includes('<TabsContent value="cards">') && bank.includes('<TabsContent value="loans">'));
verify('paginação bancária consulta no máximo dez registros', bank.includes('REQUESTS_PAGE_SIZE = 10') && bank.includes('.range(from, to)') && bank.includes("count: 'exact'"));
verify('ações bancárias atualizam localmente sem reload completo', bank.includes('setCreditApplications((current)') && bank.includes('setLoanApplications((current)') && !bank.includes('window.location.reload'));
verify('Realtime bancário remove os dois canais', bank.includes("channel('bank-management-core-live')") && bank.includes("channel('bank-management-requests-live')") && (bank.match(/removeChannel\(channel\)/g) || []).length >= 2);
verify('helper oficial fixa timezone e segundos em PT-BR', dateTime.includes("America/Sao_Paulo") && dateTime.includes("second: '2-digit'") && dateTime.includes(" às "));
verify('Diário Oficial exibe horário completo para todos os atos', (digitalArchive.match(/includeTime: true/g) || []).length >= 4 && !digitalArchive.includes('isOfficialGazetteDecreeType'));
verify('documentação cidadã não expõe Painel Admin', !documentation.includes("id: 'admin'") && !documentation.includes('Painel de Administração'));

process.stdout.write(`✓ ${checks.length} verificações de interface e UX concluídas.\n`);
