# Open Watch Party

Open-source watch party stack built as a pnpm workspace:

- `apps/extension`: WXT + Svelte browser extension
- `apps/server`: Socket.IO realtime backend with in-memory room state
- `packages/shared`: shared protocol types and room logic

## Supported services

| Service | Watch URL pattern                                                                          |
| ------- | ------------------------------------------------------------------------------------------ |
| Netflix | `netflix.com/watch/...`                                                                    |
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

## Self-Hosting The Server

The realtime backend is a plain Node + Socket.IO service with in-memory room state. That keeps self-hosting simple, but it also means:

- run a single instance only
- rooms are cleared when the server restarts or redeploys
- horizontal scaling is not supported without changing the architecture

### Docker

Build and run the server:

```bash
docker build -t open-watch-party-server .
docker run --rm -p 8787:8787 open-watch-party-server
```

Or use Docker Compose:

```bash
docker compose up --build
```

Server environment variables:

- `PORT`: HTTP and WebSocket port inside the container. Defaults to `8787`.
- `ROOM_IDLE_TTL_MS`: idle room expiry window. Defaults to `21600000` (6 hours).
- `ROOM_SWEEP_INTERVAL_MS`: room cleanup interval. Defaults to `300000` (5 minutes).
- `MAX_ROOMS`: in-memory room cap. Defaults to `1000`.

Health check:

```bash
curl http://localhost:8787/health
```

Point the extension at your deployed server by setting `WATCH_PARTY_SERVER_URL` in `apps/extension/.env`.
