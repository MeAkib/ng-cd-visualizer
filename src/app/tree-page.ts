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
import { ACTIONS, ActionId, CdTracker, NodeHandle, StrategyLabel } from './cd-tracker';
import { NativeClick } from './native-click';
import { TREE } from './tree-data';
import { DefaultNode, EagerNode, OnPushNode } from './tree-node';

interface Mode {
  label: StrategyLabel;
  component: Type<unknown>;
  code: string;
  summary: string;
}

const MODES: Mode[] = [
  {
    label: 'Eager',
    component: EagerNode,
    code: 'changeDetection: ChangeDetectionStrategy.Eager',
    summary: 'Checked on every global pass, even when nothing in it changed. The old "Default" behavior.',
  },
  {
    label: 'OnPush',
    component: OnPushNode,
    code: 'changeDetection: ChangeDetectionStrategy.OnPush\n// same as leaving it out in v22',
    summary: 'Checked only when marked dirty: an event in it or a child, an input change, markForCheck(), or a signal it reads.',
  },
  {
    label: 'Default',
    component: DefaultNode,
    code: 'changeDetection: ChangeDetectionStrategy.Default\n// deprecated, = Eager',
    summary: 'Deprecated alias of Eager (same enum value). Not the same as leaving changeDetection out, which gives OnPush in v22.',
  },
];

interface Step {
  label: string;
  run: () => void;
}

/**
 * The "Tree view" page. Its own box is labelled "App" in the UI: it is the top
 * component of what this page measures.
 */
@Component({
  selector: 'cd-tree-page',
  imports: [NgComponentOutlet, NativeClick],
  // No `changeDetection` here: in Angular v22 that means OnPush.
  template: `
    <header class="top">
      <h1>Change Detection Visualizer</h1>
      <p class="sub">Angular v22 · zoneless · see which components Angular checks, and why</p>
    </header>

    <section class="controls" aria-label="Controls">
      <div class="control">
        <span class="step-no">1</span>
        <div class="control-body">
          <h2>Pick a strategy</h2>
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
          <code class="code">{{ mode().code }}</code>
          <p class="hint">{{ mode().summary }}</p>
        </div>
      </div>

      <div class="control">
        <span class="step-no">2</span>
        <div class="control-body">
          <h2>Pick an action</h2>
          <div class="segmented" #actionPicker>
            @for (a of actions; track a.id) {
              <button type="button" [attr.data-action]="a.id" [nativeClick]="a.pick">{{ a.label }}</button>
            }
          </div>
          <code class="code" #actionCode></code>
        </div>
      </div>

      <div class="control">
        <span class="step-no">3</span>
        <div class="control-body">
          <h2>Click a component</h2>
          <p class="hint">Any card in the tree. Or run a guided step:</p>
          <div class="tour">
            @for (s of steps; track s.label; let i = $index) {
              <button type="button" [nativeClick]="s.run"><span>{{ i + 1 }}</span>{{ s.label }}</button>
            }
          </div>
        </div>
      </div>
    </section>

    <div class="layout">
      <main class="stage" aria-label="Component tree">
        <div class="legend">
          <span class="lg lg-checked" aria-hidden="true">✓ checked</span>
          <span class="lg lg-skipped" aria-hidden="true">skipped</span>
          <span class="lg lg-target" aria-hidden="true">⚡ you acted here</span>
          <span class="lg lg-stale" aria-hidden="true">⚠ stale value</span>
          <button type="button" class="ghost reset" (click)="reset()">Reset values</button>
        </div>

        <div class="tree-scroll">
          <div class="tree-inner">
          <div class="card app-card">
            <span class="probe">{{ trackApp() }}</span>
            <span class="card-head">
              <strong class="name">App</strong>
              <span class="badge badge-OnPush">OnPush · v22 default</span>
            </span>
            <span class="status">—</span>
          </div>
          <div class="tree">
            <!-- A new generation (or strategy) recreates the whole tree. -->
            @for (g of [generation()]; track g) {
              <ng-container *ngComponentOutlet="mode().component; inputs: { node: tree }" />
            }
          </div>
          </div>
        </div>

      </main>

      <aside class="side">
        <section class="panel result" #result aria-live="polite" aria-label="Last tick"></section>
        <section class="panel">
          <h2>History</h2>
          <ol class="history" #history></ol>
        </section>
      </aside>
    </div>

    <p class="footnote">
      The controls above use plain DOM listeners, so pressing them does not start change detection.
      Only the action you run inside a component does.
    </p>
  `,
})
export class TreePage implements OnDestroy {
  protected readonly modes = MODES;
  protected readonly tree = TREE;
  protected readonly mode = signal<Mode>(MODES[0]);
  protected readonly generation = signal(0);

  private readonly tracker = inject(CdTracker);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected readonly actions = (Object.keys(ACTIONS) as ActionId[]).map((id) => ({
    id,
    label: ACTIONS[id].label,
    pick: () => this.tracker.selectAction(id),
  }));

  protected readonly steps: Step[] = [
    { label: 'Event in B1', run: () => this.tracker.runOn('B1', 'event') },
    { label: 'Signal in A2', run: () => this.tracker.runOn('A2', 'signal') },
    { label: 'Plain field in A2', run: () => this.tracker.runOn('A2', 'field') },
    { label: 'Event in B2', run: () => this.tracker.runOn('B2', 'event') },
    { label: 'markForCheck in A2', run: () => this.tracker.runOn('A2', 'markForCheck') },
  ];

  private readonly result = viewChild.required<ElementRef<HTMLElement>>('result');
  private readonly history = viewChild.required<ElementRef<HTMLElement>>('history');
  private readonly actionPicker = viewChild.required<ElementRef<HTMLElement>>('actionPicker');
  private readonly actionCode = viewChild.required<ElementRef<HTMLElement>>('actionCode');

  private readonly handle: NodeHandle = {
    name: 'App',
    card: () => this.host.querySelector('.app-card'),
    field: () => 0,
    run: () => {},
  };

  constructor() {
    this.tracker.setup(this.mode().label);
    this.tracker.register(this.handle);
    afterNextRender(() =>
      this.tracker.attach({
        result: this.result().nativeElement,
        history: this.history().nativeElement,
        actionPicker: this.actionPicker().nativeElement,
        actionCode: this.actionCode().nativeElement,
      }),
    );
  }

  ngOnDestroy(): void {
    this.tracker.detach();
    this.tracker.unregister(this.handle);
  }

  protected select(m: Mode): void {
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
}
