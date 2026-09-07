// Coalesce repeated invalidations, serialize reads and ignore responses after
// unmount/account change. A change received during a read is fetched afterwards.
export function createSectionLoader(load, apply, reportError = () => {}) {
  let active = true;
  let running = false;
  const pending = new Set();
  const waiters = [];
  const settle = () => waiters.splice(0).forEach(resolve => resolve());
  const flush = async () => {
    while (active && pending.size) {
      const sections = [...pending];
      pending.clear();
      try {
        const result = await load(sections);
        if (active) apply(result, sections);
      } catch (error) { if (active) reportError(error); }
    }
    running = false;
    settle();
  };
  return {
    refresh(sections) {
      if (!active || !sections.length) return Promise.resolve();
      sections.forEach(section => pending.add(section));
      const finished = new Promise(resolve => waiters.push(resolve));
      if (!running) { running = true; queueMicrotask(flush); }
      return finished;
    },
    dispose() { active = false; pending.clear(); settle(); },
  };
}

export async function querySections(queries, sections) {
  const entries = await Promise.all([...new Set(sections)].filter(key => queries[key]).map(async key => {
    try { return [key, await queries[key]()]; }
    catch (error) { return [key, { error }]; }
  }));
  return {
    values: Object.fromEntries(entries.filter(([, result]) => !result.error).map(([key, result]) => [key, result.data])),
    errors: entries.filter(([, result]) => result.error).map(([key]) => key),
  };
}
