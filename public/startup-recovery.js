/* Initial load recovery. Runs independently of React and respects CSP. */
(() => {
  let failed = false;
  const root = () => document.getElementById('root');
  function showRecovery() {
    if (document.getElementById('govrp-startup-recovery')) return;
    const mount = root();
    if (!mount || mount.textContent.trim() || mount.childElementCount) return;
    const box = document.createElement('section');
    box.id = 'govrp-startup-recovery';
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#020713;color:#f8fafc;display:flex;align-items:center;justify-content:center;padding:24px;font:16px system-ui,sans-serif;text-align:center';
    const inner = document.createElement('div');
    inner.style.cssText = 'max-width:430px;width:100%;';
    const heading = document.createElement('h1');
    heading.textContent = 'Não foi possível carregar o GOVRP';
    heading.style.cssText = 'font-size:23px;font-weight:700;margin-bottom:12px';
    const message = document.createElement('p');
    message.textContent = 'Pode haver uma versão antiga em cache ou uma falha temporária de conexão. Seus dados e sua conta serão preservados.';
    message.style.cssText = 'line-height:1.5;color:#cbd5e1;margin-bottom:22px';
    const button = document.createElement('button');
    button.textContent = 'Atualizar arquivos do aplicativo';
    button.style.cssText = 'padding:13px 20px;background:#6366f1;color:#fff;font-weight:650;border:0;border-radius:10px;cursor:pointer';
    button.onclick = async () => {
      button.disabled = true; button.textContent = 'Atualizando…';
      try {
        if ('serviceWorker' in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.filter(r => new URL(r.scope).origin === location.origin).map(r => r.unregister()));
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.filter(k => k.startsWith('workbox-') || k.startsWith('govrp-')).map(k => caches.delete(k)));
        }
      } catch (error) { console.error('Erro ao atualizar cache do GOVRP:', error); }
      const url = new URL(location.href);
      url.searchParams.set('govrp_reload', Date.now().toString());
      location.replace(url.toString());
    };
    inner.append(heading, message, button);box.append(inner);
    document.body.append(box);
  }
  window.addEventListener('error', (event) => {
    if (event.target === window || event.target?.tagName === 'SCRIPT') failed = true;
  }, true);
  window.addEventListener('unhandledrejection', () => { failed = true; });
  window.addEventListener('DOMContentLoaded', () => {
    window.setTimeout(showRecovery, 10000);
    window.setTimeout(() => { if (failed) showRecovery(); }, 1500);
  });
})();