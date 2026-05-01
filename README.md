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

Adding a service starts in `packages/shared/src/services.ts`, which owns the
service ID, display metadata, URL parsing, canonical watch URL builder, and
extension match patterns. Then add the extension-only DOM integration under
`apps/extension/src/utils/services/<id>.ts`, add a one-line
`runServiceContentScript(MY_SERVICE)` entrypoint, and register the plugin in
`SERVICE_PLUGINS`.

## Commands

```bash
pnpm install
pnpm dev:server
pnpm dev:extension
pnpm check
pnpm build
pnpm build:firefox
pnpm build:safari
make safari
```

Chrome and Firefox releases are submitted by `.github/workflows/release.yml` when an
`extension-v*` tag is pushed, or when the workflow is run manually. The workflow
packages the committed version from `apps/extension/package.json`; bump and
commit that file before creating the release tag. Safari packaging is still
manual; `make safari` creates the Safari zip, then Apple's native
conversion/wrapper flow is still required.

## Extension Environment

Copy [apps/extension/.env.example](apps/extension/.env.example) to `apps/extension/.env` and set:

- `SERVER_URL`: default backend URL used by the extension

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
- `LOG_LEVEL`: server log level. Defaults to `info`.

Health check:

```bash
curl http://localhost:8787/health
```

Point the extension at your deployed server by setting `SERVER_URL` in `apps/extension/.env`.
