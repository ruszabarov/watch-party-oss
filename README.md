# Open Watch Party

Open Watch Party is an open source, lightweight, and free browser extension for
watch parties on your favorite streaming services.

Create a room, share the invite code with friends, and keep playback in sync
while everyone watches from their own browser. Contributions for more streaming
services are welcome.

Repository: https://github.com/ruszabarov/open-watch-party

## Features

- Free and open source
- Lightweight browser extension built with WXT and Svelte
- Realtime play, pause, seek, and playback-state sync
- Room-based watch parties with shareable invite codes
- Built for supported watch pages
- Self-hostable Socket.IO backend

## Supported Streaming Services

| Streaming service | Watch URL pattern                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Netflix           | `netflix.com/watch/...`                                                                    |
| YouTube           | `youtube.com/watch?v=...`, `youtu.be/...`, `youtube.com/embed/...`, `youtube.com/live/...` |

Want another streaming service? Please open an issue or pull request with the
streaming service you want to add. Adding support usually requires shared
streaming service metadata plus an extension-side player integration.

## Project Structure

This repository is a pnpm workspace:

- `apps/extension`: WXT + Svelte browser extension
- `apps/server`: Socket.IO realtime backend with in-memory room state
- `packages/shared`: shared protocol types and room logic
- `docs/store-listings.md`: reusable browser-store listing copy

## Development

Install dependencies:

```bash
pnpm install
```

Run the backend:

```bash
pnpm dev:server
```

Run the extension:

```bash
pnpm dev:extension
```

Useful checks:

```bash
pnpm check
pnpm build
pnpm build:firefox
pnpm build:safari
```

Create a Safari Xcode wrapper from the generated extension resources:

```bash
xcrun safari-web-extension-converter apps/extension/.output/safari-mv2 \
  --project-location apps/safari \
  --app-name "Open Watch Party" \
  --bundle-identifier com.ruszabarov.openwatchparty \
  --swift \
  --macos-only \
  --copy-resources \
  --no-open \
  --no-prompt
```

## Extension Environment

Copy [apps/extension/.env.example](apps/extension/.env.example) to
`apps/extension/.env` and set:

- `SERVER_URL`: default backend URL used by the extension

## Adding A Streaming Service

Adding a streaming service starts in `packages/shared/src/streaming-services.ts`,
which owns the streaming service ID, display metadata, URL parsing, canonical
watch URL builder, and extension match patterns.

Then add the extension-only DOM integration under
`apps/extension/src/streaming-services/<id>.ts`, add a one-line
`runStreamingServiceContentScript(MY_STREAMING_SERVICE)` entrypoint, and
register the integration in `STREAMING_SERVICE_INTEGRATION_BY_ID`.

Issues and pull requests for new streaming services, bug fixes, documentation,
and store listing improvements are welcome.

## Backend Notes

The realtime backend is a plain Node + Socket.IO service with in-memory room
state. You can run or deploy it however you prefer.

Keep these constraints in mind:

- run a single instance only
- rooms are cleared when the server restarts or redeploys
- horizontal scaling is not supported without changing the architecture

## Credits

Logo icon attribution:
<a href="https://www.flaticon.com/free-icons/watching" title="watching icons">Watching icons created by Hilmy Abiyyu A. - Flaticon</a>

## Releases

Extension and server versions are released independently with release-it:

```bash
pnpm release:extension patch
pnpm release:server patch
```

Replace `patch` with `minor`, `major`, or an explicit semver version when
needed. Dry-run commands are also available:

```bash
pnpm release:extension:dry-run patch
pnpm release:server:dry-run patch
```

The extension release command bumps `apps/extension/package.json`, commits the
change, creates an `extension-v*` tag, and pushes it. The extension release
workflow packages Chrome, Firefox, Firefox sources, and Safari zips, uploads all
zips to the GitHub Release page, submits Chrome and Firefox through WXT, and
uploads a macOS Safari Xcode project zip. Safari publishing remains manual;
download the Safari Xcode project zip from the GitHub Release, then sign,
archive, and upload it from Xcode.
