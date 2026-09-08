const destinations = {
 Deputado: ['/services/parliament', 'Ir para o Parlamento', 'Você pode apresentar projetos e participar das votações da Câmara.'],
 Senador: ['/services/parliament', 'Ir para o Parlamento', 'Você pode participar das deliberações e votações do Senado.'],
 Presidente: ['/dashboard', 'Conhecer minhas novas funções', 'Acesse as atribuições do Executivo e acompanhe as medidas do governo.'],
 'Vice-Presidente': ['/dashboard', 'Conhecer minhas novas funções', 'Acesse seu painel institucional e as atribuições da Vice-Presidência.'],
 Juiz: ['/services/justice', 'Ir para a Justiça', 'Você pode analisar os processos atribuídos a você e proferir decisões fundamentadas.'],
 Promotor: ['/services/justice', 'Ir para o Ministério Público', 'Acompanhe investigações remetidas e a atuação do Ministério Público.'],
 Delegado: ['/services/justice', 'Ir para Segurança e Justiça', 'Você pode conduzir investigações e encaminhar relatórios ao Ministério Público.'],
 Policial: ['/services/justice', 'Ir para Segurança e Justiça', 'Acompanhe as ocorrências e os mandados disponíveis para cumprimento.'],
 Advogado: ['/services/justice', 'Ir para a Justiça', 'Acompanhe os processos em que você representa uma das partes.'],
};
export function roleEventPresentation(notification) {
 const metadata = notification?.metadata || {};
 const role = metadata.new_role || metadata.office_role || 'Cidadão';
 const loss = metadata.loss || ['Cidadão','Preso','Prisioneiro'].includes(role);
 const [to, action, description] = destinations[role] || ['/dashboard', 'Ir para meu painel', 'Seu painel e suas permissões acompanham o novo cargo.'];
 return { role, loss, to, action, description: loss ? 'Suas permissões foram atualizadas conforme a nova situação institucional.' : description,
  title: loss ? 'Seu cargo foi encerrado ou alterado' : 'Você assumiu um novo cargo!' };
}
