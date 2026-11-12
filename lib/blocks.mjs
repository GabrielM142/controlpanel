// Stable widget catalog of the 13 report pages: `<page>-<NN>` in document
// order over the block kinds below (same rule as the audited 166-block annex).
export const BLOCK_KINDS = new Set(['kpi', 'table', 'panel', 'list', 'ise', 'toggle', 'geo', 'matrix', 'metric', 'bars']);

export function enumerateBlocks(page) {
  const out = [];
  let i = 0;
  const walk = nodes => {
    for (const node of nodes) {
      if (BLOCK_KINDS.has(node.kind)) {
        i += 1;
        out.push({id: `${page.id}-${String(i).padStart(2, '0')}`, kind: node.kind, label: node.label || node.title || '', node});
      }
      if (node.kind === 'element' || node.kind === 'panel') walk(node.children || []);
    }
  };
  walk(page.nodes);
  return out;
}
