import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

const LOCAL_SERVER_URL = 'http://localhost:8787';

const defaultServerUrl = process.env.WATCH_PARTY_SERVER_URL ?? LOCAL_SERVER_URL;
const showServerSettings = process.env.WATCH_PARTY_SHOW_SERVER_SETTINGS === 'true';

const connectSrc = [
  "'self'",
  'http://localhost:8787',
  'ws://localhost:8787',
  'http://127.0.0.1:8787',
  'ws://127.0.0.1:8787',
  'https://*',
  'wss://*',
];

const hostPermissions = [
  '*://*.netflix.com/*',
  '*://*.youtube.com/*',
  '*://youtu.be/*',
  '*://*.youtube-nocookie.com/*',
];

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
    define: {
      __WATCH_PARTY_DEFAULT_SERVER_URL__: JSON.stringify(defaultServerUrl),
      __WATCH_PARTY_SHOW_SERVER_SETTINGS__: JSON.stringify(showServerSettings),
    },
  }),
  manifest: {
    name: 'Watch Party',
    description: 'Cross-platform watch parties for Netflix and YouTube with realtime sync.',
    permissions: ['storage', 'tabs'],
    host_permissions: hostPermissions,
    content_security_policy: {
      extension_pages: `script-src 'self'; object-src 'self'; connect-src ${connectSrc.join(' ')}`,
    },
    action: {
      default_title: 'Watch Party',
    },
  },
});
