export interface TreeNodeData {
  name: string;
  children: TreeNodeData[];
}

export const TREE: TreeNodeData = {
  name: 'Root',
  children: [
    { name: 'A', children: [{ name: 'A1', children: [] }, { name: 'A2', children: [] }] },
    { name: 'B', children: [{ name: 'B1', children: [] }, { name: 'B2', children: [] }] },
  ],
};

/** Tree nodes in reading order (App is not part of the tree). */
export const TREE_ORDER = ['Root', 'A', 'A1', 'A2', 'B', 'B1', 'B2'];

/** Ancestors of a node, from the top: ancestorsOf('B1') → ['App', 'Root', 'B']. */
export function ancestorsOf(name: string): string[] {
  const walk = (node: TreeNodeData, path: string[]): string[] | null =>
    node.name === name
      ? path
      : (node.children.map((c) => walk(c, [...path, node.name])).find(Boolean) ?? null);
  return walk(TREE, ['App']) ?? [];
}

/** Direct children of a node: childrenOf('B') → ['B1', 'B2']. */
export function childrenOf(name: string): string[] {
  const find = (node: TreeNodeData): TreeNodeData | undefined =>
    node.name === name ? node : node.children.map(find).find(Boolean);
  return find(TREE)?.children.map((c) => c.name) ?? [];
}
