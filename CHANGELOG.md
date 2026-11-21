# Changelog

## 0.1.15

Removals. The panel now opens only when asked.

- Remove: `source`, `autoplay` and `remember`. The panel no longer opens on
  load, and `/media` requires a path. That path was the only one that could
  surprise a user, and the marker replaced it for the agent case.
- Remove: the `close` RPC method. `escape` closes the panel locally and always
  did; a script that opened a clip can open another one instead.
- Docs: one "Ways to open" description instead of four drifting copies.

## 0.1.14

- Fix: install docs implied both config files were required. They are not:
  `opencode plugin add` (which writes `cli.json`) is enough for `/media` and the
  message marker, because an open falls back to the local opener when the RPC is
  unavailable. `opencode.json` is only for scripts calling
  `POST /api/rpc/media/open`. Verified with a `cli.json`-only config: the marker
  opened the panel at 45/48.

## 0.1.13

- Fix: install instructions said the package belongs only in `cli.json`. Since
  0.1.10 it also has a server part, which `opencode.json` must list for the RPC
  and marker opens to work.
- Docs: "How it works" describes the single open path through the plugin's own
  RPC; troubleshooting covers a dead marker and `rpc.unavailable: media`.

## 0.1.12

- Add: a message marker. A finished message containing a line
  `media-panel: /path/to/clip.mp4` opens that clip. The plugin subscribes to
  `session.text.ended` through the client it already has, so the request is
  raised inside the TUI process and travels the same RPC path as `/media`; no
  shell, no CLI, no second process.
- Fix: session events carry their payload under `data`; the marker reader reads
  `event.data.text`.

## 0.1.11

- Change: every open now travels through the plugin's own server RPC. `/media`
  and autoplay call `context.client.rpc(Media).open(...)`, the server part emits
  `open`, and the TUI subscriber renders. One path for the slash command,
  autoplay and any external caller, all inside the running client. If the
  server part is not loaded the call rejects and the local opener runs, so a
  TUI-only install keeps working.
- Fix: the README's RPC example sent the arguments at the top level. The HTTP
  endpoint expects `{"input": …}`, and it authenticates with HTTP Basic
  (`opencode` plus the service password). Both are now documented.

## 0.1.10

Open the panel from outside the TUI, for the session you are viewing.

- Add: a server part (package root) exposing the RPC methods
  `POST /api/rpc/media/open` and `POST /api/rpc/media/close`; the TUI part
  subscribes to the emitted events and routes them to the same open/close the
  slash command uses. A script or an agent can open a clip without typing and
  without enabling autoplay.
- Scoped to the current session on purpose: `panel.open` only opens the session
  being viewed, so a request has no way to appear in another one. Nothing is
  queued for later.
- Add: `./rpc` export with the contract, for callers using
  `client.rpc(Media).open({ source })`.
- Packaging: exports `.`, `./tui` and `./rpc` from `dist/`, so the server part
  loads beside the TUI part from one entry.
- Note: events are live only. A call made while no TUI is running is missed.

## 0.1.9

- Fix: the panel did not take focus when it opened, so `escape`, `space` and
  `f` did nothing until it was clicked. Keymap layers are routed to the focused
  renderable; `MediaPanel` now focuses the panel on mount.

## 0.1.8

Documentation correction. No code change.

- Fix: 0.1.7's README and changelog claimed OpenCode 2.3.2 renders a
  `session.panel` contribution once, so only the first frame was visible. That
  was wrong, and so was the test behind it. A terminal escape stream carries
  only the cells that changed, so a counter going `1/48` → `2/48` arrives as
  the character `2`, never as a token; counting tokens in the stream reads a
  live panel as frozen. Replaying the same log through a terminal emulator
  shows the counter and the image advancing on 0.1.7 as installed from npm
  (samples at 55/70/85/100% of one session: `2/48`, `9/48`, `14/48`, `20/48`).
- The real failure is a hot-swapped plugin: a config edit that adds or changes
  the entry can leave a mount that never repaints and ignores `escape`. Closing
  and reopening the TUI fixes it. Documented under Troubleshooting.
- Animation works. The frame ticker, the `<image>` swap and the cache are all
  fine; no upstream fix is needed for playback.

## 0.1.7

Packaging, plus a documented limit that makes the feature honest.

- Change: the package ships precompiled `dist/` instead of raw `src/tui.tsx`.
  The build (`scripts/build.mjs`, run by `prepack`) compiles the panel with
  `babel-preset-solid` targeting `@opentui/solid`, so the shipped JSX already
  contains Solid's getter wrapping and no longer depends on which compiler the
  host's plugin loader applies. Babel is a devDependency only; the published
  dependencies and peer dependencies are unchanged.
- Change: `npm run check` now builds before testing, and CI builds in the test
  job.
- Known limit: OpenCode 2.3.2 renders a `session.panel` contribution once and
  never repaints it. Frame caching and the playback timer work, but only the
  first frame is visible. A minimal plugin that increments a number in the same
  slot reproduces it, and re-opening the panel does not help. Documented in the
  README under Limits; animation needs a host fix.

## 0.1.6

First release that loads when installed from npm.

- Fix: the shipped `src/tui.tsx` had no JSX runtime directive, so the loader
  applied the default React transform and failed with
  `Cannot find package 'react'`. It now opens with
  `/** @jsxImportSource @opentui/solid */`, as OpenCode's own TUI source does.
  Every 0.1.x release failed to load from the registry.
- Fix: partial or interrupted ffmpeg runs are no longer cached as complete.
  Extraction writes to a staging directory and is renamed into place only after
  a clean exit with a valid first frame; staging left by a killed run is swept
  after an hour.
- Fix: the frame budget counted PNG bytes while memory holds base64, so the real
  ceiling was about 85 MB. It now counts the stored string, capped at 64 MB.
- Fix: a cache entry that could not be read looped forever; it is dropped and
  re-extracted.
- Fix: losing the publish race between two extractions no longer fails the
  second one.
- Fix: `file://` sources bypassed the local-file checks, remote URLs could carry
  credentials into a toast or the panel title, and remote inputs had no read
  timeout. Messages redact userinfo and query strings, and a stalled connection
  aborts after 30 seconds.
- Fix: a failed panel open left the playback timer running, and a late cleanup
  could stop the timer of the clip that replaced it. Timers are keyed by clip.
- Release guard: non-shipping paths are matched without globbing the checkout,
  the list is read from the base revision, and a tag push sets the version from
  the tag name.
- CI: ffmpeg comes from a static release asset instead of the distro mirror,
  which was slow enough to fail the step.

## 0.1.0

- TUI plugin that plays a GIF, video, or image sequence in a `session.panel`
  slot, with frames extracted by ffmpeg and cached on disk.
- `/media <path>` command, `escape` to close, `space` to pause, `f` for full
  screen.
- Options for source, frame rate, width, looping, frame cap, ffmpeg path, cache
  directory, presentation, autoplay, and remembering the last clip.
