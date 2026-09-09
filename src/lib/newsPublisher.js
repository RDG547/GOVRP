/**
 * News Publisher Utility
 * Handles creating news articles for various events in the platform.
 */

/**
 * Publishes a news article to the news_articles table.
 * @param {object} supabase - Supabase client instance
 * @param {object} params - Article parameters
 * @param {string} params.title - Article title
 * @param {string} params.content - Full article content
 * @param {string} [params.authorId] - Author user ID (optional)
 * @param {string} [params.categorySlug] - Category slug (optional)
 * @param {string} [params.imageUrl] - Image URL (optional)
 */
export const publishNewsArticle = async (supabase, { title, content, authorId, categorySlug, imageUrl }) => {
  let categoryId = null;

  if (categorySlug) {
    const { data: category } = await supabase
      .from('news_categories')
      .select('id')
      .eq('slug', categorySlug)
      .maybeSingle();
    categoryId = category?.id || null;
  }

  // If no specific category found, try to get or create 'parlamento'
  if (!categoryId && !categorySlug) {
    const { data: defaultCategory } = await supabase
      .from('news_categories')
      .select('id')
      .eq('slug', 'parlamento')
      .maybeSingle();
    categoryId = defaultCategory?.id || null;
  }

  const { error } = await supabase.from('news_articles').insert({
    title,
    content,
    author_id: authorId || null,
    category_id: categoryId,
    image_url: imageUrl || null,
  });

  if (error) {
    console.error('Erro ao publicar notícia:', error);
    throw error;
  }
};

/**
 * Publishes a news article for a finalized bill voting result.
 */
export const publishBillResultNews = async (supabase, { bill, approved, houseName }) => {
  const resultText = approved ? 'APROVADO' : 'REJEITADO';
  const emoji = approved ? '✅' : '❌';

  const title = `${emoji} Projeto ${resultText}: ${bill.title}`;

  const content = `O projeto de lei "${bill.title}" foi ${resultText.toLowerCase()} após votação ${houseName ? `na ${houseName}` : 'no Parlamento'}.

${bill.summary || ''}

Este resultado foi oficializado após a conclusão da sessão de votação parlamentar, onde os membros da casa legislativa exerceram seu direito de voto.

${approved
    ? 'O projeto agora segue para publicação no Diário Oficial da União e entrará em vigor conforme os trâmites legais estabelecidos.'
    : 'O projeto foi arquivado após a rejeição pela maioria dos parlamentares presentes na sessão de votação.'}`;

  await publishNewsArticle(supabase, {
    title,
    content,
    authorId: bill.author_id,
    categorySlug: 'parlamento',
  });
};

/**
 * Publishes a news article for a president's X post.
 */
export const publishPresidentPostNews = async (supabase, { post, authorName, authorId }) => {
  const title = `📢 Pronunciamento Oficial do Presidente: ${authorName}`;

  const content = `O Presidente da República, ${authorName}, publicou um novo pronunciamento oficial na rede social X do GOV.RP:

"${post.content}"

${post.created_at ? `Publicado em ${new Date(post.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}.` : ''}

Este pronunciamento é de interesse público e foi automaticamente registrado no Portal de Notícias do GOV.RP.`;

  await publishNewsArticle(supabase, {
    title,
    content,
    authorId,
    categorySlug: 'governo',
    imageUrl: post.image_url || null,
  });
};

/**
 * Publishes a news article when a new bill is proposed.
 */
export const publishBillProposedNews = async (supabase, { bill, authorName, houseName }) => {
  const typeLabel = bill.type === 'PEC' ? 'Proposta de Emenda à Constituição' : 'Projeto de Lei';
  const title = `📋 Novo ${typeLabel} Proposto: ${bill.title}`;

  const content = `Um novo ${typeLabel} foi proposto ${houseName ? `na ${houseName}` : 'no Parlamento'}.

Título: "${bill.title}"
Tipo: ${bill.type}
Autor: ${authorName || 'Parlamentar'}

${bill.summary || ''}

O projeto agora está em tramitação e aguarda análise pelos membros da casa legislativa.`;

  await publishNewsArticle(supabase, {
    title,
    content,
    authorId: bill.author_id,
    categorySlug: 'parlamento',
  });
};

/**
 * Publishes a news article when a bill is put to voting session.
 */
export const publishBillVotingStartedNews = async (supabase, { bill, houseName }) => {
  const typeLabel = bill.type === 'PEC' ? 'PEC' : 'PL';
  const title = `🗳️ ${typeLabel} em Votação: ${bill.title}`;

  const content = `O ${typeLabel === 'PEC' ? 'Proposta de Emenda à Constituição' : 'Projeto de Lei'} "${bill.title}" foi colocado em sessão de votação ${houseName ? `na ${houseName}` : 'no Parlamento'}.

${bill.summary || ''}

Os parlamentares têm 24 horas para registrar seus votos. ${typeLabel === 'PEC' ? 'Uma PEC necessita de 2/3 dos votos de ambas as casas para ser aprovada.' : 'Um PL necessita de maioria simples (50%+1) para ser aprovado.'}

Acompanhe o resultado pelo Portal do Parlamento Cidadão.`;

  await publishNewsArticle(supabase, {
    title,
    content,
    authorId: bill.author_id,
    categorySlug: 'parlamento',
  });
};
