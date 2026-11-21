/**
 * Plugin options are untyped on the host side (`Readonly<Record<string, any>>`),
 * so every value is validated here and clamped to a range the panel can render.
 * Invalid values fall back to the default instead of throwing: a bad option
 * must not stop the TUI from starting.
 */

export type PanelPresentation = "panel" | "fullscreen";

export interface MediaOptions {
  /** Frames played per second. */
  readonly fps: number;
  /** Panel width in terminal cells. Pixel width is four times this. */
  readonly width: number;
  /** Restart at the first frame after the last one. */
  readonly loop: boolean;
  /** Upper bound on extracted frames, so a long clip cannot exhaust memory. */
  readonly maxFrames: number;
  /** ffmpeg binary name or absolute path. */
  readonly ffmpeg: string;
  /** Root directory for extracted frames. Defaults to the system temp directory. */
  readonly cacheDirectory: string | undefined;
  /** Initial presentation when the panel opens. */
  readonly presentation: PanelPresentation;
}

export const DEFAULT_MEDIA_OPTIONS: MediaOptions = {
  fps: 12,
  width: 44,
  loop: true,
  maxFrames: 300,
  ffmpeg: "ffmpeg",
  cacheDirectory: undefined,
  presentation: "panel",
};

/** Terminal cell geometry used to size the image. */
export const CELL_WIDTH_PX = 4;
export const CELL_HEIGHT_PX = 8;

export const pixelsWide = (widthCells: number): number => widthCells * CELL_WIDTH_PX;

export const cellsFor = (pixels: { readonly width: number; readonly height: number }) => ({
  width: Math.max(1, Math.round(pixels.width / CELL_WIDTH_PX)),
  height: Math.max(1, Math.round(pixels.height / CELL_HEIGHT_PX)),
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

const numberOr = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;

const textOr = (value: unknown, fallback: string): string => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? fallback : text;
};

const booleanOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

export function normalizeOptions(raw: Readonly<Record<string, unknown>> | undefined): MediaOptions {
  const input = raw ?? {};
  const cacheDirectory =
    typeof input.cacheDirectory === "string" && input.cacheDirectory.trim() !== ""
      ? input.cacheDirectory.trim()
      : undefined;

  return {
    fps: numberOr(input.fps, DEFAULT_MEDIA_OPTIONS.fps, 1, 30),
    width: numberOr(input.width, DEFAULT_MEDIA_OPTIONS.width, 8, 120),
    loop: booleanOr(input.loop, DEFAULT_MEDIA_OPTIONS.loop),
    maxFrames: numberOr(input.maxFrames, DEFAULT_MEDIA_OPTIONS.maxFrames, 1, 2000),
    ffmpeg: textOr(input.ffmpeg, DEFAULT_MEDIA_OPTIONS.ffmpeg),
    cacheDirectory,
    presentation: input.presentation === "fullscreen" ? "fullscreen" : "panel",
  };
}
