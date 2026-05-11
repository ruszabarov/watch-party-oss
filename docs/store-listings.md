# Store Listings

Reusable listing copy for Chrome Web Store, Firefox Add-ons, Safari, GitHub
releases, and screenshots.

## Product Name

Open Watch Party

## Short Description

Free, open source, lightweight watch parties with realtime playback sync.

## One-Line Summary

Create lightweight watch parties, share a room code, and keep playback synced
with friends.

## Long Description

Open Watch Party is a free, open source, lightweight browser extension for
watch parties on your favorite streaming services.

Create a room, share the invite code with friends, and watch together while the
extension keeps playback state in sync. When someone plays, pauses, or seeks,
the room follows along in realtime.

Current supported streaming services:

- YouTube
- Netflix

What you get:

- Realtime playback sync for watch parties
- Simple room creation and joining
- Shareable invite codes
- Support for current watch pages, with more streaming services welcome
- Open source code and public development on GitHub
- Self-hostable backend for people who want to run their own server

Open Watch Party is intentionally small and focused. More streaming services can
be added over time, and contributions are welcome. If you want support for
another streaming service, open an issue or pull request on GitHub:

https://github.com/ruszabarov/open-watch-party

## Notes For Store Reviewers

Open Watch Party injects content scripts only on supported watch pages so it can
read and control the page's video player for playback sync. The extension uses
storage for local settings and room state, and tabs permission to detect the
active supported watch page.

The extension currently supports YouTube and Netflix only. It does not provide
streaming content, bypass subscriptions, bypass DRM, or grant access to paid
streaming services. Each participant must have their own access to the streaming
service they are watching.

## Suggested Category

Entertainment

## Suggested Tags / Keywords

watch party, synchronized playback, video sync, remote movie night, open source
extension, browser extension, lightweight extension

## Screenshot Captions

- Create a room from a supported watch page.
- Share the room code with friends.
- Playback stays in sync when the room plays, pauses, or seeks.
- Lightweight controls keep the watch party focused on the video.

## Privacy Summary

Open Watch Party uses the minimum data needed to create and sync a watch party.
The extension reads supported watch-page URLs and playback state so it can keep
rooms synchronized. Room state is sent to the configured realtime server. The
project is open source, and users can inspect the code or self-host the backend.

## Support URL

https://github.com/ruszabarov/open-watch-party/issues

## Source Code URL

https://github.com/ruszabarov/open-watch-party
