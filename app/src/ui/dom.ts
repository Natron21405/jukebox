/** A tiny element builder, so screens read as plain functions without a UI framework. */
export type Child = Node | string | number | null | false | undefined;
export type Props = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === false || c === undefined) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

/** Swap everything inside `root` for the given nodes. */
export function show(root: HTMLElement, ...nodes: Node[]): void {
  root.replaceChildren(...nodes);
}
