const OFFICIAL_GAZETTE_TYPE_ORDER = [
  'Lei',
  'Lei Complementar',
  'Emenda Constitucional',
  'Decreto',
  'Medida Provisoria',
  'Nomeacao e Exoneracao',
  'Licitacao e Contrato',
  'Ato Judicial',
];

const OFFICIAL_GAZETTE_TYPE_META = {
  Lei: {
    label: 'Leis',
    description: 'Leis aprovadas pelo parlamento e sancionadas.',
  },
  'Lei Complementar': {
    label: 'Leis Complementares',
    description: 'Normas complementares com rito legislativo proprio.',
  },
  'Emenda Constitucional': {
    label: 'Emendas Constitucionais',
    description: 'Alteracoes formais no texto constitucional.',
  },
  Decreto: {
    label: 'Decretos',
    description: 'Atos do Poder Executivo para regulamentacao e administracao.',
  },
  'Medida Provisoria': {
    label: 'Medidas Provisorias',
    description: 'Normas com forca de lei em situacoes urgentes.',
  },
  'Nomeacao e Exoneracao': {
    label: 'Nomeacoes e Exoneracoes',
    description: 'Atos de pessoal, posse, nomeacao e desligamento.',
  },
  'Licitacao e Contrato': {
    label: 'Licitacoes e Contratos',
    description: 'Editais, compras publicas e contratos administrativos.',
  },
  'Ato Judicial': {
    label: 'Atos Judiciais',
    description: 'Intimacoes, despachos e sentencas oficiais.',
  },
};

const stripAccents = (value = '') =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const normalizeGazetteType = (rawType = '') => {
  const normalized = stripAccents(rawType).toLowerCase().trim();

  if (!normalized) {
    return 'Decreto';
  }

  if (normalized.includes('emenda')) {
    return 'Emenda Constitucional';
  }

  if (
    normalized.includes('lei complementar') ||
    normalized === 'lc' ||
    normalized === 'plc'
  ) {
    return 'Lei Complementar';
  }

  if (normalized.includes('medida provisoria') || normalized === 'mp') {
    return 'Medida Provisoria';
  }

  if (normalized.includes('nomea') || normalized.includes('exonera')) {
    return 'Nomeacao e Exoneracao';
  }

  if (normalized.includes('licit') || normalized.includes('contrat')) {
    return 'Licitacao e Contrato';
  }

  if (
    normalized.includes('judicial') ||
    normalized.includes('sentenca') ||
    normalized.includes('despacho') ||
    normalized.includes('intimac')
  ) {
    return 'Ato Judicial';
  }

  if (normalized.includes('decreto')) {
    return 'Decreto';
  }

  if (normalized.includes('lei')) {
    return 'Lei';
  }

  return rawType;
};

const mapBillTypeToGazetteType = (billType = '') => {
  const normalized = stripAccents(billType).toUpperCase();

  if (normalized.includes('PEC')) {
    return 'Emenda Constitucional';
  }

  if (normalized.includes('PLC') || normalized === 'LC') {
    return 'Lei Complementar';
  }

  if (normalized.includes('MP')) {
    return 'Medida Provisoria';
  }

  return 'Lei';
};

const sortByPublishedAt = (entries) =>
  [...entries].sort((left, right) => {
    const leftTime = new Date(left.published_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.published_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });

const buildEntry = ({
  id,
  title,
  summary,
  content,
  publishedAt,
  createdAt,
  type,
  source,
  author,
  house,
}) => ({
  id: `${source}-${id}`,
  source_id: id,
  source,
  title,
  summary,
  content,
  published_at: publishedAt || createdAt,
  created_at: createdAt || publishedAt,
  type,
  category: type,
  author,
  house,
});

export const publishOfficialGazetteEntry = async (
  supabase,
  { title, summary, content, type, sourceId }
) => {
  const resolvedSourceId =
    sourceId ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : undefined);

  if (!resolvedSourceId) {
    throw new Error('Nao foi possivel gerar um identificador para o Diario Oficial.');
  }

  const { error } = await supabase.from('dou_entries').insert({
    title,
    summary,
    content,
    type,
    source_id: resolvedSourceId,
    published_at: new Date().toISOString(),
  });

  if (error) {
    throw error;
  }
};

const fetchOptionalRows = async (query) => {
  const { data, error } = await query;

  if (error) {
    return [];
  }

  return data || [];
};

export const fetchOfficialGazetteEntries = async (supabase) => {
  const { data: douEntries, error: douError } = await supabase
    .from('dou_entries')
    .select('*')
    .order('published_at', { ascending: false });

  if (douError) {
    throw douError;
  }

  const [decrees, approvedBills] = await Promise.all([
    fetchOptionalRows(
      supabase
        .from('decrees')
        .select('id, title, content, published_at, created_at')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
    ),
    fetchOptionalRows(
      supabase
        .from('bills')
        .select('id, title, summary, full_text, type, status, created_at, updated_at, author:profiles(full_name, avatar_url), house:parliament_houses(name)')
        .eq('status', 'Aprovado')
        .order('updated_at', { ascending: false })
    ),
  ]);

  const normalizedDouEntries = (douEntries || []).map((entry) =>
    buildEntry({
      id: entry.id,
      title: entry.title,
      summary: entry.summary,
      content: entry.content,
      publishedAt: entry.published_at,
      createdAt: entry.published_at,
      type: normalizeGazetteType(entry.type),
      source: 'dou_entry',
    })
  );

  const decreeEntries = decrees.map((decree) =>
    buildEntry({
      id: decree.id,
      title: decree.title,
      summary: 'Decreto do Poder Executivo.',
      content: decree.content,
      publishedAt: decree.published_at,
      createdAt: decree.created_at,
      type: 'Decreto',
      source: 'decree',
    })
  );

  const billEntries = approvedBills.map((bill) =>
    buildEntry({
      id: bill.id,
      title: bill.title,
      summary:
        bill.summary ||
        `${mapBillTypeToGazetteType(bill.type)} aprovada${bill.house?.name ? ` em ${bill.house.name}` : ''}.`,
      content: bill.full_text || bill.summary || 'Publicacao legislativa oficial.',
      publishedAt: bill.updated_at,
      createdAt: bill.created_at,
      type: mapBillTypeToGazetteType(bill.type),
      source: 'approved_bill',
      author: bill.author,
      house: bill.house,
    })
  );

  return sortByPublishedAt([
    ...normalizedDouEntries,
    ...decreeEntries,
    ...billEntries,
  ]);
};

export const getOfficialGazetteTypeMeta = (type) =>
  OFFICIAL_GAZETTE_TYPE_META[type] || {
    label: type,
    description: 'Publicacao oficial do GOV.RP.',
  };

export const getOfficialGazetteTypes = (entries = []) => {
  const dynamicTypes = Array.from(
    new Set((entries || []).map((entry) => entry.type).filter(Boolean))
  );

  const orderedTypes = OFFICIAL_GAZETTE_TYPE_ORDER.filter((type) =>
    dynamicTypes.includes(type)
  );

  const extraTypes = dynamicTypes.filter(
    (type) => !OFFICIAL_GAZETTE_TYPE_ORDER.includes(type)
  );

  return [...orderedTypes, ...extraTypes];
};
