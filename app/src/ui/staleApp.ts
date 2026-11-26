/** The hashed script file name inside a page's HTML, e.g. "assets/index-aPYN8yu8.js". */
export const scriptOf = (html: string): string | null => /assets\/index-[\w-]+\.js/.exec(html)?.[0] ?? null;

/**
 * A tab left open for days keeps running old code. Every so often (and whenever the tab comes back), look at the
 * live page: if it names a different script than the one running, reload. Host and phone both restore themselves
 * from saved storage, so a reload loses nothing. Does nothing in dev (no hashed script) or when offline.
 */
export function watchForNewVersion(opts: { everySeconds: number; reload?: () => void; fetchHtml?: () => Promise<string>; running?: () => string | null }) {
  const running = opts.running ?? (() => scriptOf([...document.scripts].map((s) => s.src).join(' ')));
  const fetchHtml = opts.fetchHtml ?? (async () => (await fetch(location.pathname, { cache: 'no-store' })).text());
  const reload = opts.reload ?? (() => location.reload());
  const check = async () => {
    const mine = running();
    if (!mine) return;
    try {
      const live = scriptOf(await fetchHtml());
      if (live && live !== mine) reload();
    } catch { /* offline: try later */ }
  };
  const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => void check(), opts.everySeconds * 1000);
  return { check, stop() { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); } };
}
