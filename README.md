# Change Detection Visualizer (Angular v22)

A tiny app that shows **which components Angular checks, and why**.

1. Pick a strategy (Eager / OnPush / Default).
2. Pick an action (Event / Signal / Plain field / markForCheck).
3. Click a component in the tree, or run a guided step.

After each tick, every card stays marked **✓ checked** or **skipped**. ⚡ marks where you acted,
and **⚠ stale** shows when a card displays an old value. The panel on the right explains the tick in
one paragraph, and the history keeps one row per tick.

Two pages (switch with the tabs at the top):

- **Tree view** (`/`) – the full lab: guided steps, stale values, tick history.
- **Flow view** (`/flow`) – the same tree as a node graph. After each tick, the pass is replayed
  step by step along the edges, in the order Angular checks templates. Each node ends as
  **checked**, **passed through** (Angular went through it to reach a dirty child, but did not check it),
  **skipped**, or **not reached** (its parent was skipped, so Angular never went down that branch).

```bash
npm install
npm start        # http://localhost:4200
```

Requires Node `^22.22.3 || ^24.15.0 || >=26` (Angular CLI 22 requirement).

## Mental model (v22, zoneless)

Change detection is two questions:

1. **When does a tick start?** Only when Angular is notified: a template event (`(click)`),
   a signal read by a template changes, `markForCheck()`, `setInput()`, the `async` pipe, etc.
   No zone.js, so `setTimeout` + a plain field change starts **nothing**.
2. **Which components get checked in that tick?**
   - **Global pass** (events, `markForCheck`): Angular walks the tree from the root.
     `Eager` components are always checked. `OnPush` components only if marked dirty.
   - **Targeted pass** (only a signal changed): Angular refreshes only the component that read the signal.
     Even `Eager` ancestors are skipped.

| Strategy | Enum value | Behaviour |
| --- | --- | --- |
| `ChangeDetectionStrategy.Eager` | `1` | Checked on every global pass. (The old "Default".) |
| `ChangeDetectionStrategy.OnPush` | `0` | Checked only when dirty. **This is what you get when you omit `changeDetection` in v22.** |
| `ChangeDetectionStrategy.Default` | `1` | Deprecated alias of `Eager`. Not the same as "not set"! |

One more detail you can see in the app: a signal change in **B** (not a leaf) in Eager mode also checks B1 and B2.
Refreshing B is a normal check of its subtree, so its Eager children are checked too. In OnPush, only B is checked.

## How the app measures checks

- `trackCheck()` is bound in each template (`{{ trackCheck() }}`). Angular only evaluates bindings when it
  checks that template, so calling it = "this component was checked". (Note: `ngDoCheck` would be wrong here.
  It runs even for OnPush children that Angular then skips.)
- Dev mode runs a second `checkNoChanges` pass in the same tick. The tracker groups all checks in one
  synchronous run, so each tick counts once.
- The tracker writes to the DOM directly. If it updated a signal, showing the result would start another tick.
- All controls (and clicking a card) use a plain `addEventListener` (`native-click.ts`), not `(click)`.
  A `(click)` binding marks the component and its ancestors dirty, which would hide what the action itself does.
- The **Event** action dispatches a DOM event to a real template listener, `(cdevent)="onEvent()"`, inside the
  component. That is exactly what a user click on a `(click)` binding does to change detection.

## Files

- `src/app/tree-node.ts` – the node component, in three versions that differ only in `changeDetection`.
- `src/app/cd-tracker.ts` – records checks per tick and draws the card states, result panel and history.
- `src/app/native-click.ts` – click listener that Angular does not know about.
- `src/app/tree-data.ts` – the tree shape and small helpers.
- `src/app/tree-page.ts` – Tree view: controls, layout and guided steps.
- `src/app/flow-page.ts` – Flow view: canvas, edges and the step-by-step walk animation.
- `src/app/flow-node.ts` – the node component for the Flow view (extends the same base class).
- `src/app/flow-layout.ts` – node positions, edge paths and the checked/passed/skipped/not-reached rules.
- `src/app/app.ts`, `app.routes.ts` – app shell with tabs; the Flow page is lazy loaded with `loadComponent`.
