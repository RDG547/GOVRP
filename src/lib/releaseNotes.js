// Append new releases; published history must remain available.
export const releaseNotes = [{
 id: '2026-11-19-general-update',
 date: '2026-11-19',
 title: '26 melhorias para o dia a dia do GOVRP',
 categories: [
  { title: 'Notificações e convites', items: [
   'Convites institucionais abrem diretamente Meus Convites na Central do Cidadão, inclusive para quem já ocupa um cargo.',
   'Mudanças de limite notificam o titular com o valor anterior, o novo valor, a diferença e a data. O aviso abre o cartão correspondente.',
  ]},
  { title: 'Cartões e finanças', items: [
   'Titulares podem pedir aumento de limite, justificar o pedido e acompanhar a análise na fila do Banco Nacional.',
   'A aprovação aplica o limite ao cartão existente. Pedidos simultâneos, decisões repetidas e aprovação do próprio pedido são protegidos no servidor.',
   'Juros aparecem nos lançamentos da fatura, com a taxa e a base de cálculo registradas, sem reaplicar encargos ao abrir a página.',
   'A administração consulta e ajusta saldos originais em BRL e nas moedas estrangeiras já disponíveis. Cada ajuste exige motivo, revisão e confirmação, sem realizar câmbio.',
  ]},
  { title: 'Interface e acessibilidade', items: [
   'O globo mantém o carregamento enquanto consulta o país selecionado e impede que uma resposta anterior troque os dados da seleção atual.',
   'Fotos do Mercado Nacional e da Imobiliária mantêm o conteúdo completo, com preenchimento discreto do espaço ao redor.',
   'O seletor de dashboards distribui as opções em um grid responsivo, preservando nomes longos e permissões.',
   'Modais compartilham ícones de função, campos identificados, ações coerentes, navegação por teclado e rolagem para conteúdos extensos.',
   'Os botões do SNS receberam ícones de atendimento, gravação e planejamento de infraestrutura.',
  ]},
  { title: 'Plataforma e administração', items: [
   'As páginas Em Breve e Em Manutenção foram redesenhadas e acompanham a liberação automaticamente.',
   'Administradores podem conceder e revogar acesso excepcional por conta durante restrições. A liberação não concede poderes administrativos.',
   'A ordem das seções administrativas pode ser personalizada com a alça de arraste ou com as setas do teclado e fica salva por administrador.',
   'O painel do WhatsApp mostra o grupo oficial e os grupos autorizados. Novos grupos são cadastrados pelo convite e só podem receber notificações após a confirmação de participação do bot.',
  ]},
  { title: 'Eleições e urna', items: [
   'Votar abre uma sequência automática: Deputado, Senador e Presidente, conforme as eleições disponíveis para cada eleitor.',
   'Votos só avançam após confirmação do servidor. Uma sessão interrompida pode continuar nos cargos ainda pendentes.',
   'A urna possui sons locais para digitação, correção e confirmação, com opção de silenciar. A conclusão da sequência apresenta FIM.',
   'Consultar candidatos é uma ação separada, com seleção da eleição e acesso ao histórico permitido.',
   'A gestão eleitoral agrupa as candidaturas atuais por eleição. Listas históricas são consultadas ao abrir o card correspondente.',
   'Eleições arquivadas deixam de ocupar designações de juízes para as janelas eleitorais atuais.',
  ]},
  { title: 'Partidos, Parlamento e STF', items: [
   'O nome do partido também abre sua página de detalhes.',
   'Sessões de votação oferecem Ver detalhes para consultar o texto oficial do projeto sem registrar voto.',
   'Diretrizes e orientações parlamentares estão na seção Informações, ao lado de Membros.',
   'Cards de membros centralizam foto, nome, cargo, usuário, partido e término do mandato.',
   'Os mandatos senatoriais em exercício da legislatura atual foram alinhados a 09/12/2026, preservando inícios e encerramentos históricos.',
   'STF e Nomeações Institucionais tem seção própria. Indicações, perguntas, manifestações e votações usam o mesmo fluxo existente, com pendências da sabatina explícitas e abertura reservada à autoridade competente.',
  ]},
 ],
}];
