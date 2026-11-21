/** @jsxImportSource @opentui/solid */
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { extractFrames } from "./frames";
import { cellsFor, normalizeOptions } from "./options";
import { Media } from "./rpc";

/** Opening name for this plugin's panel. Shared selection value, not a registry key. */
const PANEL = "media.panel";
const STORAGE = "media";

// File names and ffmpeg messages reach the renderer as text. Replace control
// characters so neither can inject a terminal escape sequence.
const clean = (text: string): string => {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
  }
  return out;
};

interface Clip {
  readonly id: number;
  readonly source: string;
  readonly frames: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly truncated: boolean;
}

function MediaPanel(props: {
  readonly panel: PanelInput;
  readonly clip: Clip;
  readonly index: number;
  readonly paused: boolean;
  readonly togglePause: () => void;
  readonly onDispose?: (id: number) => void;
}) {
  const context = usePlugin();

  // The host disposes panel contributions when the panel closes, so this is
  // where playback stops: a closed panel must not keep a timer alive. The clip
  // id keeps a late cleanup from stopping the timer of the clip that replaced
  // it.
  onCleanup(() => props.onDispose?.(props.clip.id));

  // Keymap layers are routed to the focused renderable, so a panel opened from
  // the prompt owns no keys until something focuses it: `escape` and `space`
  // silently do nothing and the panel has to be clicked first. Mounting a
  // panel means the user asked for it, so take focus on the way in.
  onMount(() => props.panel.focus());

  context.keymap.layer(() => ({
    commands: [
      { id: "media.panel.close", bind: "escape", run: () => props.panel.close() },
      { id: "media.panel.fullscreen", bind: "f", run: () => props.panel.toggleFullscreen() },
      { id: "media.panel.pause", bind: "space", run: () => props.togglePause() },
    ],
  }));

  const cells = () => cellsFor({ width: props.clip.width, height: props.clip.height });
  const total = () => props.clip.frames.length;
  const position = () => Math.min(props.index + 1, total());
  const name = () => clean(props.clip.source.split("/").pop() ?? props.clip.source);
  const frame = () => props.clip.frames[props.index] ?? props.clip.frames[0] ?? "";
  const count = () =>
    props.clip.truncated ? `${position()}/${total()} capped` : `${position()}/${total()}`;

  return (
    <box flexDirection="column" alignItems="center">
      <text>
        {name()} · {props.paused ? "paused" : `${props.clip.fps} fps`} · {count()} · space pause · f
        fullscreen · esc close
      </text>
      <image
        source={frame()}
        fit="fit"
        protocol="auto"
        width={cells().width}
        height={cells().height}
      />
    </box>
  );
}

export default Plugin.define({
  id: PANEL,
  setup(context) {
    const options = normalizeOptions(context.options);
    const [saved, save] = context.storage.store(STORAGE, { initial: { source: "" } });
    const [clip, setClip] = createSignal<Clip>();
    const [index, setIndex] = createSignal(0);
    const [paused, setPaused] = createSignal(false);
    const togglePause = () => setPaused((value) => !value);

    let ticker: ReturnType<typeof setInterval> | undefined;
    let generation = 0;

    function stopTicker() {
      if (ticker) clearInterval(ticker);
      ticker = undefined;
    }

    /** Stops playback only if the clip that asked for it is still the current one. */
    function stopClip(id: number) {
      if (id === generation) stopTicker();
    }

    function play(next: Clip) {
      stopTicker();
      generation = next.id;
      setClip(next);
      setIndex(0);
      setPaused(false);
      ticker = setInterval(() => {
        if (paused()) return;
        setIndex((current) => {
          const following = current + 1;
          if (following < next.frames.length) return following;
          return next.loop ? 0 : current;
        });
      }, 1000 / next.fps);
    }

    function show(source: string): boolean {
      let extracted: ReturnType<typeof extractFrames>;
      try {
        extracted = extractFrames(source, options);
      } catch (error) {
        context.ui.toast.show({
          variant: "error",
          title: "Media panel",
          message: clean(error instanceof Error ? error.message : String(error)),
          duration: 8000,
        });
        return false;
      }

      play({
        id: generation + 1,
        source,
        frames: extracted.frames,
        width: extracted.width,
        height: extracted.height,
        fps: options.fps,
        loop: options.loop,
        truncated: extracted.truncated,
      });

      const opened = context.ui.panel.open(PANEL, { presentation: options.presentation });
      if (!opened) {
        stopTicker();
        context.ui.toast.show({
          variant: "warning",
          title: "Media panel",
          message: "Open a session first: the panel only exists inside one.",
        });
        return false;
      }

      if (options.remember) {
        void save((draft) => {
          draft.source = source;
        }).catch(() => {
          context.ui.toast.show({
            variant: "warning",
            title: "Media panel",
            message: "Could not save the last clip.",
          });
        });
      }
      return true;
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "media.open",
          title: "Play a GIF or video in a panel",
          description: "Extracts frames with ffmpeg and loops them in the session panel.",
          group: "Media",
          palette: true,
          slash: { name: "media", aliases: ["anim"], arguments: true },
          run: (input) => {
            const given = input?.trim() ?? "";
            const source = given === "" ? options.source : given;
            if (source === undefined) {
              void context.ui.dialog.alert({
                title: "Media panel",
                message: "Pass a file path or URL, for example: /media /home/user/clip.mp4",
              });
              return;
            }
            open(source);
          },
        },
        {
          id: "media.close",
          title: "Close the media panel",
          group: "Media",
          palette: true,
          run: () => context.ui.panel.close(),
        },
      ],
    }));

    const unregister = context.ui.slot({
      append: "session.panel",
      render: (panel) => (
        <Show when={panel.name === PANEL ? clip() : undefined} keyed>
          {(active: Clip) => (
            <MediaPanel
              panel={panel}
              clip={active}
              index={index()}
              paused={paused()}
              togglePause={togglePause}
              onDispose={stopClip}
            />
          )}
        </Show>
      ),
    });

    // Remote control: the server part exposes `POST /api/rpc/media/open`, which
    // a client (script, agent, another plugin) can call. The panel itself is
    // unreachable from outside the TUI process, so the call arrives as an event
    // and this subscriber is what opens it.
    // Every open goes through the server: `open` below calls the RPC, the
    // server emits, and this subscriber renders. One path for the slash
    // command, autoplay and any external caller, and no shell or CLI in it.
    // If the server part is not loaded the call rejects and the local opener
    // runs instead, so a TUI-only install keeps working.
    const remote = context.client.rpc(Media);
    const stopOpen = remote.events.on("open", (event) => {
      const data = event.data as { source?: unknown };
      if (typeof data.source === "string") show(data.source);
    });

    function open(source: string): void {
      const call = remote.open;
      if (typeof call !== "function") {
        show(source);
        return;
      }
      Promise.resolve(call({ source })).catch(() => show(source));
    }
    const stopClose = remote.events.on("close", () => {
      context.ui.panel.close();
    });

    // A marker in a finished message opens a clip without any shell command:
    // the client already receives session text, so the plugin is the one that
    // raises the request. `media-panel: /path/to/clip.mp4` on its own line.
    const marker = /(?:^|\n)[ \t]*media-panel:[ \t]*(\S+)[ \t]*(?=\n|$)/;
    const stopMarker = context.data.on("session.text.ended", (event) => {
      // The event carries its payload under `data`.
      const text = (event as { data?: { text?: unknown } }).data?.text;
      if (typeof text !== "string") return;
      const match = marker.exec(text);
      if (match?.[1]) open(match[1]);
    });

    const remembered = options.remember ? saved.source.trim() : "";
    const initial = options.source ?? (remembered === "" ? undefined : remembered);
    let autoplay: ReturnType<typeof setInterval> | undefined;

    if (options.autoplay && initial !== undefined) {
      let attempts = 0;
      autoplay = setInterval(() => {
        attempts += 1;
        if (context.ui.router.current().type === "session") {
          if (autoplay) clearInterval(autoplay);
          autoplay = undefined;
          open(initial);
          return;
        }
        // Give up after two minutes: no session was opened.
        if (attempts > 240 && autoplay) {
          clearInterval(autoplay);
          autoplay = undefined;
        }
      }, 500);
    }

    return () => {
      stopTicker();
      stopOpen();
      stopClose();
      stopMarker();
      if (autoplay) clearInterval(autoplay);
      unregister();
    };
  },
});
