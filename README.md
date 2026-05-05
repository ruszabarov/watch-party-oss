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

## Releases

Extension and server versions are released independently with release-it:

```bash
pnpm release:extension patch
pnpm release:server patch
```

Replace `patch` with `minor`, `major`, or an explicit semver version when needed.
Dry-run commands are also available:

```bash
pnpm release:extension:dry-run patch
pnpm release:server:dry-run patch
```

The extension release command bumps `apps/extension/package.json`, commits the
change, creates an `extension-v*` tag, and pushes it. The extension release
workflow packages Chrome, Firefox, Firefox sources, and Safari zips, uploads all
zips to the GitHub Release page, and submits Chrome and Firefox through WXT.
Safari publishing remains manual; download the Safari zip from the GitHub
Release and use Apple's conversion/wrapper flow.

The server release command bumps `apps/server/package.json`, commits the change,
creates a `server-v*` tag, and pushes it. The server release workflow builds the
Docker image and publishes it to GitHub Container Registry:

```bash
docker pull ghcr.io/<owner>/<repo>-server:latest
docker pull ghcr.io/<owner>/<repo>-server:<version>
```

For this repository, the image name is:

```bash
ghcr.io/ruszabarov/open-watch-party-server
```

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
