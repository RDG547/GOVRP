// Same-origin read-only fallback when a mobile network cannot reach the
// Supabase RPC directly. No service-role key or user data is involved.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    return res.status(503).json({ error: 'Serviço de estado não configurado.' });
  }
  try {
    const upstream = await fetch(`${url.replace(/\/+$/, '')}/rest/v1/rpc/get_world_runtime`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) return res.status(503).json({ error: 'Estado do universo indisponível.' });
    const state = await upstream.json();
    if (!state?.generation_id || typeof state.maintenance !== 'boolean') {
      return res.status(503).json({ error: 'Resposta inválida do universo.' });
    }
    // Only include the non-sensitive fields already exposed by the public RPC.
    return res.status(200).json({
      generation_id: state.generation_id,
      maintenance: state.maintenance,
      changed_at: state.changed_at,
      generation_started_at: state.generation_started_at,
      enforce_generation: state.enforce_generation,
    });
  } catch {
    return res.status(503).json({ error: 'Não foi possível consultar o universo.' });
  }
}
