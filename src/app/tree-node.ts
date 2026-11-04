import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Directive,
  ElementRef,
  OnDestroy,
  OnInit,
  Type,
  inject,
  input,
  signal,
} from '@angular/core';
import { ActionId, CdTracker, NodeHandle } from './cd-tracker';
import { NativeClick } from './native-click';
import { TreeNodeData } from './tree-data';

const NODE_TEMPLATE = `
  <button type="button" class="card" [nativeClick]="runSelected"
          aria-label="Run the selected action in {{ node().name }}">
    <!-- The probe: Angular evaluates this binding only when it checks this template. -->
    <!-- The (cdevent) listener is a normal template event, used by the "Event" action. -->
    <span class="probe" (cdevent)="onEvent()">{{ trackCheck() }}</span>

    <span class="card-head">
      <strong class="name">{{ node().name }}</strong>
      <span class="badge badge-{{ strategy }}">{{ strategy }}</span>
    </span>

    <span class="values">
      <span class="val"><span class="k">signal</span><b>{{ count() }}</b></span>
      <span class="val"><span class="k">field</span><b class="field-value">{{ field }}</b></span>
    </span>

    <span class="stale" hidden>⚠ stale · real value is <b class="stale-real"></b></span>
    <span class="status">—</span>
  </button>

  @if (node().children.length) {
    <div class="children">
      @for (child of node().children; track child.name) {
        <!-- Children use the same component class (same strategy) as this node. -->
        <ng-container *ngComponentOutlet="childType; inputs: { node: child }" />
      }
    </div>
  }
`;

/** Shared logic. The three subclasses below differ ONLY in `changeDetection`. */
@Directive()
export abstract class TreeNodeBase implements OnInit, OnDestroy {
  abstract readonly strategy: string;
  /** Where this node's box is, relative to the host element. */
  protected readonly cardSelector: string = ':scope > .card';

  readonly node = input.required<TreeNodeData>();

  /** Reactive state: Angular knows when it changes. */
  protected readonly count = signal(0);
  /** Plain state: Angular has no idea when it changes. */
  protected field = 0;

  protected readonly childType = this.constructor as Type<TreeNodeBase>;

  private readonly tracker = inject(CdTracker);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private handle!: NodeHandle;

  ngOnInit(): void {
    this.handle = {
      name: this.node().name,
      card: () => this.host.querySelector(this.cardSelector),
      field: () => this.field,
      run: (action) => this.run(action),
    };
    this.tracker.register(this.handle);
  }

  ngOnDestroy(): void {
    this.tracker.unregister(this.handle);
  }

  /** Runs during change detection of THIS component. Must not change Angular state. */
  protected trackCheck(): string {
    this.tracker.recordCheck(this.node().name);
    return '';
  }

  /** Empty on purpose: a template listener firing is enough to mark this view dirty. */
  protected onEvent(): void {}

  protected readonly runSelected = () => this.tracker.runOn(this.node().name);

  private run(action: ActionId): void {
    switch (action) {
      case 'event':
        this.host.querySelector(`${this.cardSelector} .probe`)!.dispatchEvent(new CustomEvent('cdevent'));
        break;
      case 'signal':
        this.count.update((v) => v + 1);
        break;
      case 'field':
        this.field++;
        break;
      case 'markForCheck':
        this.cdr.markForCheck();
        break;
    }
  }
}

@Component({
  selector: 'cd-node-eager',
  template: NODE_TEMPLATE,
  imports: [NgComponentOutlet, NativeClick],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class EagerNode extends TreeNodeBase {
  readonly strategy = 'Eager';
}

@Component({
  selector: 'cd-node-onpush',
  template: NODE_TEMPLATE,
  imports: [NgComponentOutlet, NativeClick],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnPushNode extends TreeNodeBase {
  readonly strategy = 'OnPush';
}

@Component({
  selector: 'cd-node-default',
  template: NODE_TEMPLATE,
  imports: [NgComponentOutlet, NativeClick],
  // Deprecated in v22: same enum value (1) as Eager.
  changeDetection: ChangeDetectionStrategy.Default,
})
export class DefaultNode extends TreeNodeBase {
  readonly strategy = 'Default';
}
