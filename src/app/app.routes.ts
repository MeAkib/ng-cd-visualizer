import { Routes } from '@angular/router';
import { TreePage } from './tree-page';

export const routes: Routes = [
  { path: '', component: TreePage, title: 'CD Visualizer · Tree' },
  {
    path: 'flow',
    // Lazy loaded: this page's code is downloaded only when you open it.
    loadComponent: () => import('./flow-page').then((m) => m.FlowPage),
    title: 'CD Visualizer · Flow',
  },
  { path: '**', redirectTo: '' },
];
