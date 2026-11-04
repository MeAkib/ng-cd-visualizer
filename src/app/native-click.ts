import { Directive, ElementRef, inject, input } from '@angular/core';

/**
 * Calls a function on click using a plain DOM listener.
 *
 * A normal `(click)` binding tells Angular "something happened here": it marks the
 * component and all its ancestors dirty and starts change detection. The visualizer's
 * own controls must NOT do that, or every button press would pollute the measurement.
 * So the controls use this directive, and only the action you run triggers Angular.
 */
@Directive({ selector: '[nativeClick]' })
export class NativeClick {
  readonly nativeClick = input.required<() => void>();

  constructor() {
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.addEventListener('click', () =>
      this.nativeClick()(),
    );
  }
}
