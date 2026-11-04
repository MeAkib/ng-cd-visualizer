import { TREE, TreeNodeData } from './tree-data';

/** Canvas size in "flow units". The SVG viewBox and node boxes use the same units. */
export const FLOW_W = 760;
export const FLOW_H = 520;
export const NODE_W = 150;
export const NODE_H = 84;

/** Center-x and top-y of each node box. */
const POSITIONS: Record<string, { x: number; y: number }> = {
  App: { x: 380, y: 16 },
  Root: { x: 380, y: 150 },
  A: { x: 190, y: 284 },
  B: { x: 570, y: 284 },
  A1: { x: 95, y: 418 },
  A2: { x: 285, y: 418 },
  B1: { x: 475, y: 418 },
  B2: { x: 665, y: 418 },
};

/** Box position as CSS percentages of the canvas. */
export function boxStyle(name: string): { left: number; top: number } {
  const p = POSITIONS[name];
  return { left: ((p.x - NODE_W / 2) / FLOW_W) * 100, top: (p.y / FLOW_H) * 100 };
}

export interface FlowEdge {
  from: string;
  to: string;
  d: string;
}

/** One curved edge per parent → child, from the bottom port to the top port. */
export const EDGES: FlowEdge[] = (() => {
  const edges: FlowEdge[] = [];
  const add = (from: string, to: string) => {
    const a = POSITIONS[from];
    const b = POSITIONS[to];
    const y1 = a.y + NODE_H;
    const mid = (y1 + b.y) / 2;
    edges.push({ from, to, d: `M ${a.x} ${y1} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y}` });
  };
  add('App', TREE.name);
  const walk = (n: TreeNodeData) =>
    n.children.forEach((c) => {
      add(n.name, c.name);
      walk(c);
    });
  walk(TREE);
  return edges;
})();

/** Parent of each node ('App' has none). */
export const PARENT: Record<string, string> = Object.fromEntries(EDGES.map((e) => [e.to, e.from]));

/** Depth-first order: the same order in which Angular checks the templates. */
export const WALK_ORDER = ['App', 'Root', 'A', 'A1', 'A2', 'B', 'B1', 'B2'];

export type WalkStatus = 'checked' | 'passed' | 'skipped' | 'unreached';

/**
 * What happened to each node in one tick, from the set of checked nodes:
 * - checked:   its template was checked.
 * - passed:    not checked, but Angular went through it to reach a checked child.
 * - skipped:   Angular looked at it (its parent was checked or passed) and did not check it.
 * - unreached: its parent was skipped, so Angular never went down this branch.
 */
export function walkStatuses(checked: Set<string>): Map<string, WalkStatus> {
  const children = (n: string) => EDGES.filter((e) => e.from === n).map((e) => e.to);
  const hasCheckedBelow = (n: string): boolean =>
    children(n).some((c) => checked.has(c) || hasCheckedBelow(c));

  const result = new Map<string, WalkStatus>();
  for (const name of WALK_ORDER) {
    const parent = PARENT[name];
    const parentStatus = parent ? result.get(parent) : 'checked';
    if (parentStatus === 'skipped' || parentStatus === 'unreached') result.set(name, 'unreached');
    else if (checked.has(name)) result.set(name, 'checked');
    else if (hasCheckedBelow(name)) result.set(name, 'passed');
    else result.set(name, 'skipped');
  }
  return result;
}
