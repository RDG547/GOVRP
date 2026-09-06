import html2canvas from 'html2canvas';

export async function captureElement(element, { scale = 2, backgroundColor = '#ffffff' } = {}) {
  if (!element) throw new Error('A visualização ainda não está pronta. Tente novamente.');
  if (document.fonts?.ready) {
    let timer;
    try { await Promise.race([document.fonts.ready, new Promise(resolve => { timer = setTimeout(resolve, 8000); })]); }
    finally { clearTimeout(timer); }
  }
  await Promise.all([...element.querySelectorAll('img')].map(async img => {
    if (!img.complete) await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); img.removeEventListener('load', finish); img.removeEventListener('error', finish); resolve(); };
      const timer = setTimeout(finish, 8000);
      img.addEventListener('load', finish); img.addEventListener('error', finish);
    });
    if (img.naturalWidth) await img.decode?.().catch(() => undefined);
  }));
  const marker = `export-${crypto.randomUUID()}`;
  element.dataset.captureId = marker;
  try {
    return await html2canvas(element, {
      scale, backgroundColor, useCORS: true, allowTaint: false, logging: false,
      imageTimeout: 10000, width: element.scrollWidth, height: element.scrollHeight,
      windowWidth: 1280, scrollX: 0, scrollY: 0,
      onclone: (clone) => {
        const target = clone.querySelector(`[data-capture-id="${marker}"]`);
        if (!target) return;
        let parent = target;
        while (parent && parent !== clone.body) {
          parent.style.transform = 'none'; parent.style.perspective = 'none';
          parent.style.opacity = '1'; parent.style.visibility = 'visible';
          if (parent.dataset.exportHost !== undefined) { parent.style.left = '0'; parent.style.top = '0'; }
          parent = parent.parentElement;
        }
        target.querySelectorAll('[data-export-ignore]').forEach(node => node.remove());
        target.querySelectorAll('img').forEach(img => {
          img.loading = 'eager';
        });
      },
    });
  } finally { delete element.dataset.captureId; }
}
