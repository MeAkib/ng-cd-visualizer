import { Injectable } from '@angular/core';
import { TREE_ORDER, ancestorsOf, childrenOf } from './tree-data';

export type ActionId = 'event' | 'signal' | 'field' | 'markForCheck';
export type StrategyLabel = 'Eager' | 'OnPush' | 'Default';

export const ACTIONS: Record<ActionId, { label: string; code: string }> = {
  event: { label: 'Event', code: '<span (cdevent)="onEvent()">  // a template listener fires' },
  signal: { label: 'Signal', code: 'this.count.update(v => v + 1)' },
  field: { label: 'Plain field', code: 'this.field++  // Angular is not told' },
  markForCheck: { label: 'markForCheck', code: 'this.cdr.markForCheck()' },
};

/** What a tree node (or App) exposes to the tracker. */
export interface NodeHandle {
  name: string;
  card(): HTMLElement | null;
  /** The real value of the plain field (may differ from what is on screen). */
  field(): number;
  run(action: ActionId): void;
}

interface Cause {
  kind: ActionId | 'setup' | 'other';
  target?: string;
}

interface Tick {
  id: number;
  cause: Cause;
  checked: Set<string>;
}

/** The measured result of one tick (or of an action that caused no tick). */
export interface TickResult {
  id: number | null;
  title: string;
  target?: string;
  checked: Set<string>;
  ticked: boolean;
  explanation: string;
}

/** DOM elements owned by the page that the tracker writes into. All optional. */
export interface TrackerUi {
  result?: HTMLElement;
  history?: HTMLElement;
  actionPicker?: HTMLElement;
  actionCode?: HTMLElement;
  /** Mark cards checked/skipped right away (tree page). The flow page animates them itself. */
  paintCards?: boolean;
  /** Called with every result. */
  onResult?: (result: TickResult) => void;
}

/**
 * Records which component templates Angular checks in each tick, and shows the result.
 *
 * IMPORTANT: everything here writes to the DOM directly. No signals, no template bindings.
 * If showing the result used Angular state, it would start another change detection run,
 * which would be recorded, which would start another run... The visualizer must stay
 * outside of the thing it measures.
 */
@Injectable({ providedIn: 'root' })
export class CdTracker {
  private action: ActionId = 'event';
  private strategy: StrategyLabel = 'Eager';
  private readonly nodes = new Map<string, NodeHandle>();
  private readonly stale = new Set<string>();
  private tickCount = 0;
  private current: Tick | null = null;
  private pending: Cause = { kind: 'setup' };
  private ui: TrackerUi | null = null;
  private readonly queued: (() => void)[] = [];
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- wiring ----------

  attach(ui: TrackerUi): void {
    this.ui = ui;
    this.renderActionPicker();
    this.queued.splice(0).forEach((fn) => fn());
  }

  /** The page is going away: stop writing into its DOM. */
  detach(): void {
    this.ui = null;
  }

  register(node: NodeHandle): void {
    this.nodes.set(node.name, node);
  }

  unregister(node: NodeHandle): void {
    if (this.nodes.get(node.name) === node) this.nodes.delete(node.name);
  }

  // ---------- user input ----------

  /** The tree is about to be (re)created. */
  setup(strategy: StrategyLabel): void {
    this.strategy = strategy;
    this.pending = { kind: 'setup' };
    this.stale.clear();
  }

  selectAction(action: ActionId): void {
    this.action = action;
    this.renderActionPicker();
  }

  /** Run an action inside one component. Uses the selected action if none is given. */
  runOn(name: string, action?: ActionId): void {
    if (action) this.selectAction(action);
    const node = this.nodes.get(name);
    if (!node) return;
    const cause: Cause = { kind: this.action, target: name };
    this.pending = cause;
    const before = this.tickCount;
    node.run(this.action);
    // If Angular was not notified, no tick happens. Detect that and show it.
    setTimeout(() => {
      if (this.tickCount !== before) return;
      this.pending = { kind: 'other' };
      if (!this.ui) return;
      this.refreshStale();
      this.paintNodes(null, cause.target);
      this.renderResult(null, cause, []);
      this.renderHistory(null, cause);
      this.ui?.onResult?.(this.toResult(null, cause, []));
    }, 150);
  }

  // ---------- measuring ----------

  /**
   * Called from a template binding, so it runs only when Angular checks that template.
   * Dev mode runs a second "checkNoChanges" pass in the same tick, so we group every
   * check that happens in one synchronous run (until the next microtask) as one tick.
   */
  recordCheck(name: string): void {
    if (!this.current) {
      this.current = { id: ++this.tickCount, cause: this.pending, checked: new Set() };
      this.pending = { kind: 'other' };
      queueMicrotask(() => this.closeTick());
    }
    this.current.checked.add(name);
  }

  private closeTick(): void {
    const tick = this.current!;
    this.current = null;
    const render = () => {
      const staleBefore = new Set(this.stale);
      this.refreshStale();
      const fixed = [...staleBefore].filter((n) => !this.stale.has(n));
      this.paintNodes(tick.checked, tick.cause.target);
      this.renderResult(tick, tick.cause, fixed);
      this.renderHistory(tick, tick.cause);
      this.ui?.onResult?.(this.toResult(tick, tick.cause, fixed));
    };
    if (this.ui) render();
    else this.queued.push(render);
  }

  private toResult(tick: Tick | null, cause: Cause, fixed: string[]): TickResult {
    return {
      id: tick?.id ?? null,
      title: causeTitle(cause),
      target: cause.target,
      checked: tick?.checked ?? new Set(),
      ticked: tick !== null,
      explanation: explain(cause, this.strategy, tick !== null, fixed),
    };
  }

  // ---------- drawing (direct DOM, on purpose) ----------

  private renderActionPicker(): void {
    if (!this.ui?.actionPicker || !this.ui.actionCode) return;
    this.ui.actionPicker.querySelectorAll<HTMLElement>('[data-action]').forEach((btn) => {
      const on = btn.dataset['action'] === this.action;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    this.ui.actionCode.textContent = ACTIONS[this.action].code;
  }

  /** checked = null means "no tick ran". */
  private paintNodes(checked: Set<string> | null, target?: string): void {
    if (this.ui?.paintCards === false) return;
    for (const [name, node] of this.nodes) {
      const card = node.card();
      if (!card) continue;
      const status = card.querySelector<HTMLElement>('.status');
      card.classList.remove('is-checked', 'is-skipped', 'is-idle', 'is-target');
      if (name === target) card.classList.add('is-target');
      if (!checked) {
        card.classList.add('is-idle');
        if (status) status.textContent = 'not checked · no tick';
      } else if (checked.has(name)) {
        card.classList.add('is-checked');
        if (status) status.textContent = '✓ checked';
        if (!this.reducedMotion) {
          card.animate(
            [{ boxShadow: '0 0 0 6px var(--checked-ring)' }, { boxShadow: '0 0 0 0 transparent' }],
            { duration: 700, easing: 'ease-out' },
          );
        }
      } else {
        card.classList.add('is-skipped');
        if (status) status.textContent = 'skipped';
      }
    }
  }

  /** Compare the field value on screen with the real value. */
  private refreshStale(): void {
    for (const [name, node] of this.nodes) {
      const card = node.card();
      const shown = card?.querySelector('.field-value')?.textContent?.trim();
      const badge = card?.querySelector<HTMLElement>('.stale');
      if (shown === undefined || !badge) continue;
      const real = String(node.field());
      const isStale = shown !== real;
      badge.hidden = !isStale;
      badge.querySelector('.stale-real')!.textContent = real;
      if (isStale) this.stale.add(name);
      else this.stale.delete(name);
    }
  }

  private renderResult(tick: Tick | null, cause: Cause, fixed: string[]): void {
    if (!this.ui?.result) return;
    const box = this.ui.result;
    box.textContent = '';
    const checkedCount = tick ? TREE_ORDER.filter((n) => tick.checked.has(n)).length : 0;

    box.append(
      el('div', 'result-kicker', tick ? `Tick #${tick.id}` : 'No tick'),
      el('div', 'result-title', causeTitle(cause)),
      meter(checkedCount),
      chips(tick?.checked ?? null, cause.target),
      el('p', 'result-why', explain(cause, this.strategy, tick !== null, fixed)),
    );
  }

  private renderHistory(tick: Tick | null, cause: Cause): void {
    if (!this.ui?.history) return;
    const li = el('li', tick ? 'h-row' : 'h-row h-none');
    li.append(
      el('span', 'h-id', tick ? `#${tick.id}` : '—'),
      el('span', 'h-cause', causeTitle(cause)),
      dots(tick?.checked ?? null),
    );
    this.ui.history.prepend(li);
    while (this.ui.history.children.length > 30) this.ui.history.lastElementChild!.remove();
  }
}

// ---------- small DOM helpers ----------

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function meter(checked: number): HTMLElement {
  const wrap = el('div', 'result-meter');
  wrap.append(el('b', '', String(checked)), document.createTextNode(` of ${TREE_ORDER.length} tree components checked`));
  return wrap;
}

function chips(checked: Set<string> | null, target?: string): HTMLElement {
  const wrap = el('div', 'chips');
  for (const name of ['App', ...TREE_ORDER]) {
    const on = checked?.has(name) ?? false;
    const chip = el('span', `chip ${on ? 'chip-on' : 'chip-off'}${name === target ? ' chip-target' : ''}`, name);
    chip.title = `${name}: ${on ? 'checked' : 'not checked'}`;
    wrap.append(chip);
  }
  return wrap;
}

function dots(checked: Set<string> | null): HTMLElement {
  const wrap = el('span', 'dots');
  const count = checked ? TREE_ORDER.filter((n) => checked.has(n)).length : 0;
  for (const name of TREE_ORDER) {
    const dot = el('span', checked?.has(name) ? 'dot dot-on' : 'dot');
    dot.title = name;
    wrap.append(dot);
  }
  wrap.append(el('span', 'dots-count', `${count}/${TREE_ORDER.length}`));
  return wrap;
}

function causeTitle(cause: Cause): string {
  if (cause.kind === 'setup') return 'Tree created';
  if (cause.kind === 'other') return 'Other tick';
  return `${ACTIONS[cause.kind].label} in ${cause.target}`;
}

/** One-paragraph explanation. Based on the rules; the measured result is shown above it. */
function explain(cause: Cause, strategy: StrategyLabel, ticked: boolean, fixed: string[]): string {
  const t = cause.target ?? '';
  const ancestors = ancestorsOf(t).join(', ');
  const eagerLike = strategy !== 'OnPush';
  const alias = strategy === 'Default' ? ' (Default is a deprecated alias of Eager.)' : '';
  let text: string;

  switch (cause.kind) {
    case 'setup':
      text = `First render: Angular checks every component once, whatever the strategy.`;
      break;
    case 'event':
      text = eagerLike
        ? `The event listener in ${t} started a global pass. ${strategy} components are checked on every global pass, so all of them were checked.${alias}`
        : `The event listener marked ${t} and its ancestors (${ancestors}) dirty. In a global pass, OnPush components are checked only when dirty, so the rest were skipped.`;
      break;
    case 'signal':
      text = `${t}'s template reads the count() signal. A signal change starts a targeted pass: Angular refreshes only the components that read it. Ancestors are skipped${eagerLike ? `, even ${strategy} ones` : ''}.`;
      if (eagerLike && childrenOf(t).length) {
        text += ` But refreshing ${t} is a normal check of its subtree, so its ${strategy} children (${childrenOf(t).join(', ')}) were checked too.`;
      }
      break;
    case 'field':
      text = `Angular was not told about this change, and without zone.js nothing starts a tick. ${t} now shows an old value (see the "stale" label). It updates the next time ${t} is checked.`;
      break;
    case 'markForCheck':
      text = eagerLike
        ? `markForCheck() marked ${t} and its ancestors dirty and started a global pass. ${strategy} components are checked on every global pass, so all were checked.${alias}`
        : `markForCheck() marked ${t} and its ancestors (${ancestors}) dirty. Only those dirty OnPush components were checked.`;
      break;
    default:
      text = 'A tick started by something else.';
  }
  if (!ticked && cause.kind !== 'field') text += ' No tick ran.';
  if (fixed.length) text += ` ${fixed.join(', ')} was checked, so its stale value is now up to date.`;
  return text;
}
