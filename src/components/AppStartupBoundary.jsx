import React from 'react';

export default class AppStartupBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[GOVRP] Falha de inicialização:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main role="alert" style={{ minHeight: '100vh', background: '#020919', color: '#fff', display: 'grid', placeItems: 'center', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
        <section style={{ maxWidth: 480, textAlign: 'center' }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>Não foi possível abrir o GOVRP</h1>
          <p style={{ opacity: 0.8, lineHeight: 1.6 }}>O aplicativo encontrou um erro ao iniciar. Atualize a página para carregar a versão mais recente.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '13px 24px', marginTop: 18, background: '#4f46e5', borderRadius: 12, color: '#fff', cursor: 'pointer' }}>
            Tentar novamente
          </button>
        </section>
      </main>
    );
  }
}
