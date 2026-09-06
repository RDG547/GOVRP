export function brazilEditionDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function validEditionDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function articleText(content) {
  // Public articles are text, but older publications may contain editor HTML.
  return String(content || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildNewspaperPages(articles) {
  const fragments = articles.flatMap(article => {
    const words = articleText(article.content).split(' ').filter(Boolean);
    const parts = Math.max(1, Math.ceil(words.length / 230));
    return Array.from({ length: parts }, (_, index) => ({
      ...article, key: `${article.id}:${index}`, text: words.slice(index * 230, (index + 1) * 230).join(' '),
      part: index + 1, parts, image_url: index === 0 ? article.image_url : null,
    }));
  });
  if (!fragments.length) return [];
  const pages = [[fragments[0]]];
  for (let index = 1; index < fragments.length; index += 2) pages.push(fragments.slice(index, index + 2));
  return pages;
}
