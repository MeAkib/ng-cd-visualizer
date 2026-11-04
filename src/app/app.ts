import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

/** App shell: page tabs + the routed page. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <nav class="pages" aria-label="Pages">
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Tree view</a>
      <a routerLink="/flow" routerLinkActive="active">Flow view</a>
    </nav>
    <router-outlet />
  `,
})
export class App {}
