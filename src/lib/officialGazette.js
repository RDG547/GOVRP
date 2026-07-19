const OFFICIAL_GAZETTE_TYPE_ORDER = [
  'Lei',
  'Lei Complementar',
  'Emenda Constitucional',
  'Decreto',
  'Medida Provisoria',
  'Veto Presidencial',
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
  'Veto Presidencial': {
    label: 'Vetos Presidenciais',
    description: 'Atos presidenciais de veto total ou parcial a projetos aprovados.',
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

const isUuid = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    `${value || ''}`.trim()
  );

const cyrb128 = (value = '') => {
  let hashA = 1779033703;
  let hashB = 3144134277;
  let hashC = 1013904242;
  let hashD = 2773480762;

  for (let index = 0; index < value.length; index += 1) {
    const char = value.charCodeAt(index);
    hashA = hashB ^ Math.imul(hashA ^ char, 597399067);
    hashB = hashC ^ Math.imul(hashB ^ char, 2869860233);
    hashC = hashD ^ Math.imul(hashC ^ char, 951274213);
    hashD = hashA ^ Math.imul(hashD ^ char, 2716044179);
  }

  hashA = Math.imul(hashC ^ (hashA >>> 18), 597399067);
  hashB = Math.imul(hashD ^ (hashB >>> 22), 2869860233);
  hashC = Math.imul(hashA ^ (hashC >>> 17), 951274213);
  hashD = Math.imul(hashB ^ (hashD >>> 19), 2716044179);

  return [hashA ^ hashB ^ hashC ^ hashD, hashB ^ hashA, hashC ^ hashA, hashD ^ hashA].map(
    (part) => (part >>> 0).toString(16).padStart(8, '0')
  );
};

export const normalizeOfficialGazetteSourceId = (value) => {
  if (!value) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }

    throw new Error('Nao foi possivel gerar um identificador para o Diario Oficial.');
  }

  if (isUuid(value)) {
    return `${value}`.trim().toLowerCase();
  }

  const [partA, partB, partC, partD] = cyrb128(`${value}`);
  const hex = `${partA}${partB}${partC}${partD}`.slice(0, 32);
  const versionNibble = '4';
  const variantNibble = 'a';

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `${versionNibble}${hex.slice(13, 16)}`,
    `${variantNibble}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
};

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

  if (normalized.includes('veto')) {
    return 'Veto Presidencial';
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

export const isOfficialGazetteDecreeType = (rawType = '') =>
  normalizeGazetteType(rawType) === 'Decreto';

export const formatOfficialGazettePublicationDate = (
  dateString,
  { includeTime = false, timeZone = 'America/Sao_Paulo' } = {}
) => {
  if (!dateString) {
    return 'Data não disponível';
  }

  const formattedDate = new Date(dateString);

  if (Number.isNaN(formattedDate.getTime())) {
    return 'Data não disponível';
  }

  const options = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  };

  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
    options.second = '2-digit';
  }

  return new Intl.DateTimeFormat('pt-BR', options).format(formattedDate);
};

export const mapBillTypeToGazetteType = (billType = '') => {
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

const PRESIDENTIAL_DECIDED_BILL_STATUSES = [
  'Aprovado',
  'Sancionado',
  'Promulgado',
  'Vetado integralmente',
  'Vetado parcialmente',
];

const buildBillGazetteEntry = (bill) => {
  const isVeto = `${bill.status || ''}`.toLowerCase().includes('vetado');
  const gazetteType = isVeto ? 'Veto Presidencial' : mapBillTypeToGazetteType(bill.type);
  const statusSummary = {
    Aprovado: `${gazetteType} aprovada${bill.house?.name ? ` em ${bill.house.name}` : ''}.`,
    Sancionado: 'Lei sancionada e publicada pela Presidência da República.',
    Promulgado: 'Texto promulgado e publicado pela Presidência da República.',
    'Vetado integralmente': 'Projeto vetado integralmente pela Presidência da República.',
    'Vetado parcialmente': 'Projeto vetado parcialmente pela Presidência da República.',
  };

  return buildEntry({
    id: `${bill.id}-${bill.status || 'publicado'}`,
    title: isVeto ? `${bill.status}: ${bill.title}` : bill.title,
    summary: bill.summary || statusSummary[bill.status] || 'Publicação legislativa oficial.',
    content: bill.full_text || bill.summary || statusSummary[bill.status] || 'Publicação legislativa oficial.',
    publishedAt: bill.updated_at,
    createdAt: bill.created_at,
    type: gazetteType,
    source: 'approved_bill',
    author: bill.author,
    house: bill.house,
  });
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
  const resolvedSourceId = normalizeOfficialGazetteSourceId(sourceId);

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
        .in('status', PRESIDENTIAL_DECIDED_BILL_STATUSES)
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

  const billEntries = approvedBills.map(buildBillGazetteEntry);

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
