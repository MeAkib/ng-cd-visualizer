import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Directive, computed } from '@angular/core';
import { boxStyle } from './flow-layout';
import { NativeClick } from './native-click';
import { TreeNodeBase } from './tree-node';

/**
 * Same component tree as the Tree view (so change detection is the same),
 * but every box is absolutely positioned on the canvas. Host elements are not
 * positioned, so all boxes are placed relative to the canvas, not to their parent.
 */
const FLOW_TEMPLATE = `
  <button type="button" class="fnode" [attr.data-name]="node().name" [nativeClick]="runSelected"
          [style.left.%]="box().left" [style.top.%]="box().top"
          aria-label="Run the selected action in {{ node().name }}">
    <span class="probe" (cdevent)="onEvent()">{{ trackCheck() }}</span>
    <span class="port port-in"></span>
    <span class="port port-out"></span>
    <span class="fn-head">
      <strong>{{ node().name }}</strong>
      <span class="badge badge-{{ strategy }}">{{ strategy }}</span>
    </span>
    <span class="fn-vals">signal <b>{{ count() }}</b> · field <b class="field-value">{{ field }}</b></span>
    <span class="fn-foot">
      <span class="fn-status"></span>
      <span class="stale" hidden>⚠ real <b class="stale-real"></b></span>
    </span>
  </button>

  @for (child of node().children; track child.name) {
    <ng-container *ngComponentOutlet="childType; inputs: { node: child }" />
  }
`;

@Directive()
abstract class FlowNodeBase extends TreeNodeBase {
  protected override readonly cardSelector = ':scope > .fnode';
  protected readonly box = computed(() => boxStyle(this.node().name));
}

@Component({
  selector: 'cd-flow-eager',
  template: FLOW_TEMPLATE,
  imports: [NgComponentOutlet, NativeClick],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class FlowEagerNode extends FlowNodeBase {
  readonly strategy = 'Eager';
}

@Component({
  selector: 'cd-flow-onpush',
  template: FLOW_TEMPLATE,
  imports: [NgComponentOutlet, NativeClick],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FlowOnPushNode extends FlowNodeBase {
  readonly strategy = 'OnPush';
}

@Component({
  selector: 'cd-flow-default',
  template: FLOW_TEMPLATE,
  imports: [NgComponentOutlet, NativeClick],
  // Deprecated in v22: same enum value (1) as Eager.
  changeDetection: ChangeDetectionStrategy.Default,
})
export class FlowDefaultNode extends FlowNodeBase {
  readonly strategy = 'Default';
}
