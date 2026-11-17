export type HistoryState = {
  content?: string;
  scrollY?: number;
};

export interface NavigateInfo {
  /** The browser already animated this step (e.g. a swipe-back gesture). */
  browserAnimated: boolean;
}

type NavigateHandler = (path: string, state: HistoryState | undefined, info: NavigateInfo) => void;

/** Safari proper (not Chrome, Edge or Firefox on iOS, which also say "Safari"). */
export function isSafari(userAgent: string): boolean {
  return (
    /Safari\//.test(userAgent) &&
    !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|EdgiOS\/|Edg\//.test(userAgent)
  );
}

/**
 * Whether the browser already animated this history step, e.g. Safari's
 * swipe-back: our own page transition would then play a second animation
 * after the browser's. Browsers that report it set `hasUAVisualTransition`.
 * Safari without the flag gets no transition on any back/forward step, since
 * a swipe cannot be told apart from a button press there.
 */
export function browserAnimatedHistoryStep(evt: Event, userAgent: string): boolean {
  if ('hasUAVisualTransition' in evt) {
    return (evt as Event & { hasUAVisualTransition: unknown }).hasUAVisualTransition === true;
  }
  return isSafari(userAgent);
}

export class NavigationState {
  private handler: NavigateHandler | null = null;
  private lastPathname: string = window.location.pathname;

  constructor() {
    window.addEventListener('popstate', (e) => {
      const pathname = window.location.pathname;
      if (pathname === this.lastPathname) return;
      this.lastPathname = pathname;
      this.handler?.(pathname, this.read(e.state), {
        browserAnimated: browserAnimatedHistoryStep(e, navigator.userAgent),
      });
    });
  }

  onNavigate(handler: NavigateHandler): void {
    this.handler = handler;
    this.lastPathname = window.location.pathname;
  }

  resolve(): void {
    this.handler?.(window.location.pathname, this.read(window.history.state), {
      browserAnimated: false,
    });
  }

  pushPath(path: string, state?: HistoryState): void {
    window.history.pushState(state ?? null, '', path);
    this.lastPathname = window.location.pathname;
  }

  /** Replace the current entry; `path` may carry a #hash. */
  replacePath(path: string, state?: HistoryState): void {
    window.history.replaceState(state ?? null, '', path);
    this.lastPathname = window.location.pathname;
  }

  replaceDraft(path: string, content: string, scrollY: number): void {
    this.replacePath(path, { content, scrollY });
  }

  captureScroll(path: string): void {
    const existing = this.currentState();
    this.replacePath(path, { ...existing, scrollY: window.scrollY });
  }

  currentState(): HistoryState {
    return this.read(window.history.state) ?? {};
  }

  private read(state: unknown): HistoryState | undefined {
    if (!state || typeof state !== 'object') return undefined;

    const candidate = state as { content?: unknown; scrollY?: unknown };
    return {
      content: typeof candidate.content === 'string' ? candidate.content : undefined,
      scrollY: typeof candidate.scrollY === 'number' ? candidate.scrollY : undefined,
    };
  }
}
