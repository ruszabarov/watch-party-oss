import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import { SUPPORTED_SERVICE_CONTENT_MATCHES } from '@open-watch-party/shared';

const LOCAL_SERVER_URL = 'http://localhost:8787';

const defaultServerUrl = process.env['SERVER_URL'] ?? LOCAL_SERVER_URL;

const connectSrc = [
  "'self'",
  'http://localhost:8787',
  'ws://localhost:8787',
  'http://127.0.0.1:8787',
  'ws://127.0.0.1:8787',
  // WXT dev server (Vite HMR + extension reload). Harmless in production
  // builds since localhost isn't reachable from a packaged extension.
  'http://localhost:3000',
  'ws://localhost:3000',
  'https://*',
  'wss://*',
];

const hostPermissions = [...SUPPORTED_SERVICE_CONTENT_MATCHES];

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __WATCH_PARTY_DEFAULT_SERVER_URL__: JSON.stringify(defaultServerUrl),
    },
  }),
  manifest: {
    name: 'Open Watch Party',
    description: 'Cross-platform watch parties for Netflix and YouTube with realtime sync.',
    icons: {
      16: '/16.png',
      32: '/32.png',
      48: '/48.png',
      96: '/96.png',
      128: '/128.png',
    },
    permissions: ['storage', 'tabs'],
    browser_specific_settings: {
      gecko: {
        id: 'open-watch-party@ruszabarov.com',
        data_collection_permissions: {
          required: ['browsingActivity', 'websiteContent'],
        },
      },
    },
    host_permissions: hostPermissions,
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${connectSrc.join(' ')}`,
    },
    action: {
      default_title: 'Open Watch Party',
    },
  },
});
