# Watch Party OSS

Open-source watch party stack built as a pnpm workspace:

- `apps/extension`: WXT + Svelte browser extension
- `apps/server`: Socket.IO realtime backend with in-memory room state
- `packages/shared`: shared protocol types and room logic

## Supported services

| Service | Watch URL pattern |
| --- | --- |
| Netflix | `netflix.com/watch/...` |
| YouTube | `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/embed/...`, `youtube.com/live/...` |

Adding a service is a self-contained change: drop a `ServicePlugin` under
`apps/extension/src/lib/services/<id>.ts`, add a one-line
`createServiceContentScript(MY_SERVICE)` entrypoint, register the plugin in
`SERVICE_PLUGINS`, and append its origin to `host_permissions` in
`apps/extension/wxt.config.ts`.

## Commands

```bash
pnpm install
pnpm dev:server
pnpm dev:extension
pnpm check
pnpm build
pnpm build:firefox
pnpm build:safari
```

Safari packaging still requires Apple's native conversion/wrapper flow after `pnpm build:safari`.

## Extension Environment

Copy [apps/extension/.env.example](/Users/ruszabarov/projects/watch-party-oss/apps/extension/.env.example) to `apps/extension/.env` and set:

- `WATCH_PARTY_SERVER_URL`: default backend URL used by the extension
- `WATCH_PARTY_SHOW_SERVER_SETTINGS=true`: show the popup server override input for local dev or self-hosted builds
