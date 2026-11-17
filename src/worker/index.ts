import { Hono } from 'hono';
import type { Env } from './types';
import { api } from './api';
import { createStore } from './storage';
import { installRequestPolicy } from './request-policy';
import { createPageHandler } from './pages';
import appConfig from '../../haste.config';

const app = new Hono<{ Bindings: Env }>();

installRequestPolicy(app);

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: Date.now() });
});

// Document API: /documents, /documents/:id, /raw/:id
app.route('/', api);

// Pages: the SPA shell, server-rendered for paste URLs when SERVER_RENDER is on.
// Files that exist in the build are served by the assets layer before the worker runs.
app.get('*', createPageHandler({ appName: appConfig.appName }));

export default {
  fetch: app.fetch,

  // Cron trigger (see wrangler.toml [triggers]) purges expired documents
  async scheduled(_controller, env, ctx) {
    const store = createStore(env);
    ctx.waitUntil(
      store
        .cleanup()
        .then((deleted) => console.log(`Cleanup: removed ${deleted} expired documents`))
        .catch((err) => console.error('Cleanup failed:', err))
    );
  },
} satisfies ExportedHandler<Env>;
