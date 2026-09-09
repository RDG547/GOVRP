const links = {
 economy: { label: 'Economia Nacional', to: '/services/economy' }, careers: { label: 'Carreiras e emprego', to: '/dashboard' }, cases: { label: 'Processos e defesa', to: '/services/justice?view=citizen' }, education: { label: 'Ensino Superior', to: '/services/education' }, investigations: { label: 'Ocorrências e investigações', to: '/services/justice' }, dashboard: { label: 'Meu painel', to: '/dashboard' }, bank: { label: 'Banco Nacional', to: '/services/bank' },
 parties: { label: 'Partidos', to: '/services/political-parties' }, elections: { label: 'Eleições', to: '/services/elections' }, parliament: { label: 'Parlamento', to: '/services/parliament' },
 business: { label: 'Portal do Empreendedor', to: '/services/entrepreneur-portal' }, market: { label: 'Negócios Livres', to: '/services/business' },
 justice: { label: 'Segurança e Justiça', to: '/services/justice' }, laws: { label: 'Diário Oficial e leis', to: '/news' },
 x: { label: 'Rede X', to: '/services/x' }, news: { label: 'Notícias e jornal', to: '/news' },
};
const paths = {
 politics: ['Como você demonstrou interesse pela política, um bom primeiro passo é conhecer os partidos e acompanhar as próximas eleições.', ['parties','elections','parliament','x']],
 entrepreneurship: ['Sua aspiração é empreender: conheça o Portal do Empreendedor, organize sua conta e publique seus produtos.', ['bank','business','market','economy']],
 justice: ['Sua aspiração é a Justiça: conheça as leis, acompanhe os processos e explore as carreiras jurídicas no seu painel.', ['justice','cases','careers','parliament']],
 security: ['Seu interesse é a Segurança Pública: conheça o CSJ e acompanhe as oportunidades da carreira policial.', ['justice','careers','investigations']],
 communication: ['Sua aspiração é a Comunicação: participe da Rede X, acompanhe o jornal e conheça os acontecimentos do país.', ['x','news']],
 knowledge: ['Seu interesse é conhecimento e carreira: acompanhe oportunidades de trabalho e progressão no painel do cidadão.', ['careers','education','economy']],
 civil_life: ['Conheça os serviços com calma. Sua trajetória pode mudar a qualquer momento.', ['dashboard','bank','x']],
};
export function tutorialPath(aspiration) {
 const [description, keys] = paths[aspiration] || paths.civil_life;
 return { description, links: keys.map(key => ({ ...links[key], key })) };
}
export const shouldShowTutorial = (user, finishedFor, sessionDismissed) => Boolean(user?.id && user.onboarding_completed && !user.tutorial_dont_show_again && finishedFor !== user.id && !sessionDismissed);
