import { NgComponentOutlet } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  Type,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { ACTIONS, ActionId, CdTracker, NodeHandle, StrategyLabel, TickResult } from './cd-tracker';
import { EDGES, FLOW_H, FLOW_W, WALK_ORDER, WalkStatus, boxStyle, walkStatuses } from './flow-layout';
import { FlowDefaultNode, FlowEagerNode, FlowOnPushNode } from './flow-node';
import { NativeClick } from './native-click';
import { TREE } from './tree-data';

interface FlowMode {
  label: StrategyLabel;
  component: Type<unknown>;
}

const MODES: FlowMode[] = [
  { label: 'Eager', component: FlowEagerNode },
  { label: 'OnPush', component: FlowOnPushNode },
  { label: 'Default', component: FlowDefaultNode },
];

const STEP_MS = 420;

const LABELS: Record<WalkStatus, string> = {
  checked: '✓ checked',
  passed: '↓ passed through',
  skipped: 'skipped',
  unreached: 'not reached',
};

/**
 * The "Flow view" page: the same measurement as the Tree view, drawn as a node graph.
 * After each tick, the pass is replayed step by step along the edges, in the order
 * Angular checks templates (depth first).
 */
@Component({
  selector: 'cd-flow-page',
  imports: [NgComponentOutlet, NativeClick],
  template: `
    <header class="top">
      <h1>Change Detection Flow</h1>
      <p class="sub">Click a node. Then watch one change detection pass walk down the tree, step by step.</p>
    </header>

    <section class="flow-controls">
      <div class="fc-group">
        <h2>Strategy</h2>
        <div class="segmented">
          @for (m of modes; track m.label) {
            <button
              type="button"
              [class.active]="mode() === m"
              [attr.aria-pressed]="mode() === m"
              [disabled]="mode() === m"
              (click)="select(m)"
            >
              {{ m.label }}
            </button>
          }
        </div>
      </div>
      <div class="fc-group">
        <h2>Action</h2>
        <div class="segmented" #actionPicker>
          @for (a of actions; track a.id) {
            <button type="button" [attr.data-action]="a.id" [nativeClick]="a.pick">{{ a.label }}</button>
          }
        </div>
      </div>
      <div class="fc-group fc-code">
        <h2>Runs inside the node you click</h2>
        <code class="code" #actionCode></code>
      </div>
    </section>

    <div class="layout">
      <main class="stage">
        <div class="flow-bar">
          <span class="walk-caption" #caption aria-live="polite">—</span>
          <span class="flow-bar-actions">
            <button type="button" class="ghost" [nativeClick]="replay">↻ Replay</button>
            <button type="button" class="ghost" (click)="reset()">Reset values</button>
          </span>
        </div>

        <div class="canvas-scroll">
          <div class="canvas" #canvas>
            <svg class="edges" [attr.viewBox]="viewBox" preserveAspectRatio="none" aria-hidden="true">
              @for (e of edges; track e.to) {
                <path class="edge" [attr.data-to]="e.to" [attr.d]="e.d" />
              }
            </svg>

            <div class="fnode fnode-app" data-name="App" [style.left.%]="appBox.left" [style.top.%]="appBox.top">
              <span class="probe">{{ trackApp() }}</span>
              <span class="port port-out"></span>
              <span class="fn-head">
                <strong>App</strong>
                <span class="badge badge-OnPush">OnPush</span>
              </span>
              <span class="fn-vals">this page · v22 default</span>
              <span class="fn-foot"><span class="fn-status"></span></span>
            </div>

            @for (g of [generation()]; track g) {
              <ng-container *ngComponentOutlet="mode().component; inputs: { node: tree }" />
            }
          </div>
        </div>

        <div class="legend flow-legend" aria-hidden="true">
          <span class="lg lg-checked">✓ checked</span>
          <span class="lg lg-passed">↓ passed through</span>
          <span class="lg lg-skipped">skipped</span>
          <span class="lg lg-unreached">not reached</span>
          <span class="lg lg-target">⚡ you acted here</span>
        </div>
      </main>

      <aside class="side">
        <section class="panel result" #result aria-live="polite" aria-label="Last tick"></section>
        <section class="panel flow-help">
          <h2>How to read it</h2>
          <p><b>Passed through</b>: Angular went through this node to reach a dirty child, but did not check its template.</p>
          <p><b>Not reached</b>: its parent was skipped, so Angular never went down that branch.</p>
        </section>
      </aside>
    </div>
  `,
})
export class FlowPage implements OnDestroy {
  protected readonly modes = MODES;
  protected readonly tree = TREE;
  protected readonly edges = EDGES;
  protected readonly viewBox = `0 0 ${FLOW_W} ${FLOW_H}`;
  protected readonly appBox = boxStyle('App');
  protected readonly mode = signal<FlowMode>(MODES[0]);
  protected readonly generation = signal(0);

  private readonly tracker = inject(CdTracker);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private readonly caption = viewChild.required<ElementRef<HTMLElement>>('caption');
  private readonly result = viewChild.required<ElementRef<HTMLElement>>('result');
  private readonly actionPicker = viewChild.required<ElementRef<HTMLElement>>('actionPicker');
  private readonly actionCode = viewChild.required<ElementRef<HTMLElement>>('actionCode');
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private last: TickResult | null = null;

  protected readonly actions = (Object.keys(ACTIONS) as ActionId[]).map((id) => ({
    id,
    label: ACTIONS[id].label,
    pick: () => this.tracker.selectAction(id),
  }));

  private readonly handle: NodeHandle = {
    name: 'App',
    card: () => this.host.querySelector('.fnode-app'),
    field: () => 0,
    run: () => {},
  };

  constructor() {
    this.tracker.setup(this.mode().label);
    this.tracker.register(this.handle);
    afterNextRender(() =>
      this.tracker.attach({
        result: this.result().nativeElement,
        actionPicker: this.actionPicker().nativeElement,
        actionCode: this.actionCode().nativeElement,
        paintCards: false,
        onResult: (r) => this.walk(r),
      }),
    );
  }

  ngOnDestroy(): void {
    this.stopWalk();
    this.tracker.detach();
    this.tracker.unregister(this.handle);
  }

  protected select(m: FlowMode): void {
    this.tracker.setup(m.label);
    this.mode.set(m);
  }

  protected reset(): void {
    this.tracker.setup(this.mode().label);
    this.generation.update((g) => g + 1);
  }

  protected trackApp(): string {
    this.tracker.recordCheck('App');
    return '';
  }

  protected readonly replay = () => {
    if (this.last) this.walk(this.last);
  };

  // ---------- the walk animation (direct DOM, so it never triggers change detection) ----------

  private walk(r: TickResult): void {
    this.stopWalk();
    this.last = r;
    const canvas = this.canvas().nativeElement;
    const caption = this.caption().nativeElement;
    const box = (n: string) => canvas.querySelector<HTMLElement>(`.fnode[data-name="${n}"]`);
    const edge = (n: string) => canvas.querySelector<SVGPathElement>(`.edge[data-to="${n}"]`);
    const setStatus = (n: string, text: string) => {
      const s = box(n)?.querySelector('.fn-status');
      if (s) s.textContent = text;
    };

    // Reset every node and edge.
    for (const n of WALK_ORDER) {
      box(n)?.classList.remove('f-checked', 'f-passed', 'f-skipped', 'f-unreached', 'f-idle', 'f-cursor', 'f-target');
      edge(n)?.classList.remove('e-checked', 'e-passed', 'e-skipped', 'e-unreached');
      setStatus(n, '');
    }
    if (r.target) box(r.target)?.classList.add('f-target');

    if (!r.ticked) {
      WALK_ORDER.forEach((n) => box(n)?.classList.add('f-idle'));
      caption.textContent = 'No tick ran. Angular was not notified, so nothing walked the tree.';
      return;
    }

    const statuses = walkStatuses(r.checked);
    const steps = WALK_ORDER.filter((n) => statuses.get(n) !== 'unreached');
    for (const n of WALK_ORDER.filter((n) => statuses.get(n) === 'unreached')) {
      box(n)?.classList.add('f-unreached');
      edge(n)?.classList.add('e-unreached');
      setStatus(n, LABELS.unreached);
    }

    const delay = this.reducedMotion ? 0 : STEP_MS;
    steps.forEach((n, i) => {
      this.timers.push(
        setTimeout(() => {
          canvas.querySelector('.f-cursor')?.classList.remove('f-cursor');
          const status = statuses.get(n)!;
          box(n)?.classList.add(`f-${status}`, 'f-cursor');
          edge(n)?.classList.add(`e-${status}`);
          setStatus(n, LABELS[status]);
          caption.textContent = `Step ${i + 1} of ${steps.length} · ${n}: ${LABELS[status]}`;
        }, i * delay),
      );
    });
    const checked = WALK_ORDER.filter((n) => n !== 'App' && r.checked.has(n)).length;
    this.timers.push(
      setTimeout(() => {
        canvas.querySelector('.f-cursor')?.classList.remove('f-cursor');
        caption.textContent = `Done · ${r.title} · ${checked} of ${WALK_ORDER.length - 1} tree nodes checked`;
      }, steps.length * delay),
    );
  }

  private stopWalk(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}
