/**
 * Turns a GIF, video, or image into ordered PNG frames on disk, then loads them
 * as data URIs the TUI can draw.
 *
 * Frames are cached per source and setting combination so a restart reuses the
 * previous extraction instead of paying for it again.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { frameFile, framePattern } from "./names";
import { type MediaOptions, pixelsWide } from "./options";

export interface FrameSource {
  /** Ordered `data:image/png;base64,...` URIs. */
  readonly frames: readonly string[];
  /** Frame width in pixels. */
  readonly width: number;
  /** Frame height in pixels. */
  readonly height: number;
  /** True when the frames came from an existing cache directory. */
  readonly cached: boolean;
  /** Directory holding the PNG files. */
  readonly directory: string;
  /** True when the frame list was cut short to stay inside the memory budget. */
  readonly truncated: boolean;
}

export class FrameError extends Error {
  override name = "FrameError";
}

export const DEFAULT_CACHE_ROOT = "opencode-media-panel";

/**
 * Ceiling on the bytes held in memory. Counted as the stored base64 string, not
 * the PNG on disk, because the base64 form is what stays resident. 64 MB is
 * roughly 1400 frames of the size these clips produce.
 */
export const FRAME_BUDGET_BYTES = 64 * 1024 * 1024;

const DATA_URI_PREFIX = "data:image/png;base64,";

/** A staging directory this old belongs to a run that died without cleaning up. */
const STAGING_TTL_MS = 60 * 60 * 1000;

/** Remote reads stop after 30 s instead of blocking the TUI forever. */
const REMOTE_TIMEOUT_SECONDS = 30;

/** Protocols ffmpeg may use for a remote source. Local files are not remote. */
const REMOTE_PROTOCOLS = "http,https,tcp,tls,crypto";

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const FILE_URL = /^file:\/\//i;

const isRemote = (source: string): boolean => SCHEME.test(source) && !FILE_URL.test(source);

/** Drops credentials and query strings from a URL before it reaches a message. */
export function redact(source: string): string {
  if (!isRemote(source)) return source;
  try {
    const url = new URL(source);
    url.username = "";
    url.password = "";
    url.search = "";
    return url.toString();
  } catch {
    return "(remote source)";
  }
}

/** Local paths are resolved; `file://` URLs are converted, not treated as remote. */
function localPath(source: string): string {
  if (!FILE_URL.test(source)) return resolve(source);
  try {
    return fileURLToPath(source);
  } catch {
    throw new FrameError(`Not a usable file URL: ${redact(source)}`);
  }
}

const ownerOnly = (directory: string): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
};

/**
 * A predictable cache path in a shared temp directory could be pre-created by
 * another local user. Refuse a directory this process does not own.
 */
function assertOwned(directory: string): void {
  const getuid = process.getuid;
  if (typeof getuid !== "function") return;
  const info = statSync(directory);
  if (info.uid !== getuid.call(process)) {
    throw new FrameError(`${directory} is owned by another user; set a private cacheDirectory`);
  }
}

/**
 * Removes staging directories left by a run that was killed mid-extraction. A
 * live extraction is younger than the TTL and is left alone.
 */
function sweepStaging(root: string): void {
  for (const entry of readdirSync(root)) {
    if (!entry.includes(".partial-")) continue;
    const path = join(root, entry);
    try {
      if (Date.now() - statSync(path).mtimeMs < STAGING_TTL_MS) continue;
      rmSync(path, { recursive: true, force: true });
    } catch {
      // Another process is using it. Leave it for the next sweep.
    }
  }
}

/**
 * Local files are identified by path, size, and modification time, so editing a
 * clip produces new frames. A remote source is identified by its URL alone and
 * is never refreshed; clear the cache directory to fetch it again.
 */
function sourceStamp(source: string): string {
  if (isRemote(source)) return source;
  const path = localPath(source);
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(path);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new FrameError(`Cannot read ${path}: ${reason}`);
  }
  if (info.isDirectory()) throw new FrameError(`${path} is a directory, not a media file`);
  return `${path}:${info.size}:${Math.round(info.mtimeMs)}`;
}

export function cacheRoot(
  options: MediaOptions,
  fallback = join(tmpdir(), DEFAULT_CACHE_ROOT),
): string {
  return options.cacheDirectory ?? fallback;
}

export function cacheDirectory(source: string, options: MediaOptions, root?: string): string {
  const key = [sourceStamp(source), options.fps, pixelsWide(options.width), options.maxFrames].join(
    "|",
  );
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);
  return join(cacheRoot(options, root), hash);
}

function listFrames(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => frameFile(entry))
    .sort()
    .map((entry) => join(directory, entry));
}

function pngSize(buffer: Buffer, path: string): { width: number; height: number } {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") {
    throw new FrameError(`ffmpeg wrote ${path} but it is not a PNG`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * Reads frames until the byte budget is reached. The first frame always loads,
 * so a single oversized frame still renders.
 */
function load(directory: string, paths: string[], cached: boolean, source: string): FrameSource {
  const first = paths[0];
  if (first === undefined) throw new FrameError(`No frames extracted from ${redact(source)}`);

  const frames: string[] = [];
  let size: { width: number; height: number } | undefined;
  let bytes = 0;
  let truncated = false;

  for (const path of paths) {
    const buffer = readFileSync(path);
    const stored = DATA_URI_PREFIX.length + Math.ceil(buffer.byteLength / 3) * 4;
    if (size !== undefined && bytes + stored > FRAME_BUDGET_BYTES) {
      truncated = true;
      break;
    }
    bytes += stored;
    size ??= pngSize(buffer, path);
    frames.push(`${DATA_URI_PREFIX}${buffer.toString("base64")}`);
  }

  if (size === undefined) throw new FrameError(`No frames extracted from ${redact(source)}`);

  return { frames, width: size.width, height: size.height, cached, directory, truncated };
}

const discard = (directory: string) => rmSync(directory, { recursive: true, force: true });

/**
 * Moves the staging directory into place. Losing a race against another
 * process is not an error: whoever published a complete set wins.
 */
function publish(staging: string, directory: string, source: string): FrameSource {
  const published = listFrames(directory);
  if (published.length > 0) {
    discard(staging);
    return load(directory, published, true, source);
  }

  try {
    renameSync(staging, directory);
  } catch {
    const winner = listFrames(directory);
    discard(staging);
    if (winner.length === 0) {
      throw new FrameError(`Could not store the extracted frames for ${redact(source)}`);
    }
    return load(directory, winner, true, source);
  }

  return load(directory, listFrames(directory), false, source);
}

/**
 * Extracts frames with ffmpeg, or reuses a completed cache directory.
 *
 * ffmpeg writes into a staging directory that is renamed into place only on a
 * clean exit with at least one frame, so no reader sees a half-written frame
 * set. Staging directories from a killed run are swept once they are old
 * enough to be unowned.
 *
 * `-nostdin` keeps ffmpeg away from the terminal's input stream. The `fps`
 * filter normalizes variable-delay GIFs and constant-rate video alike, so one
 * playback timer drives both.
 */
export function extractFrames(source: string, options: MediaOptions): FrameSource {
  const directory = cacheDirectory(source, options);
  const root = cacheRoot(options);

  ownerOnly(root);
  assertOwned(root);
  sweepStaging(root);

  const cachedFrames = listFrames(directory);
  if (cachedFrames.length > 0) {
    assertOwned(directory);
    try {
      return load(directory, cachedFrames, true, source);
    } catch (error) {
      // A cache entry that cannot be read would fail forever. Drop it and
      // extract again.
      if (!(error instanceof FrameError)) throw error;
      discard(directory);
    }
  }

  const staging = `${directory}.partial-${process.pid}-${Date.now()}`;
  ownerOnly(staging);

  const remote = isRemote(source);
  const inputFlags = remote
    ? [
        "-rw_timeout",
        String(REMOTE_TIMEOUT_SECONDS * 1_000_000),
        "-protocol_whitelist",
        REMOTE_PROTOCOLS,
      ]
    : [];

  const result = spawnSync(
    options.ffmpeg,
    [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      ...inputFlags,
      "-i",
      remote ? source : localPath(source),
      "-an",
      "-vf",
      `fps=${options.fps},scale=${pixelsWide(options.width)}:-2:flags=lanczos`,
      "-frames:v",
      String(options.maxFrames),
      "-y",
      join(staging, framePattern()),
    ],
    { encoding: "utf8" },
  );

  if (result.error) {
    discard(staging);
    throw new FrameError(
      `Could not run ${options.ffmpeg}: ${result.error.message}. Install ffmpeg and make sure it is on PATH.`,
    );
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "")
      .trim()
      .split("\n")
      .slice(-3)
      .join(" ");
    discard(staging);
    throw new FrameError(
      `ffmpeg failed on ${redact(source)}: ${detail || `exit code ${result.status}`}`,
    );
  }

  const extracted = listFrames(staging);
  const first = extracted[0];
  if (first === undefined) {
    discard(staging);
    throw new FrameError(`ffmpeg produced no frames for ${redact(source)}`);
  }

  // Validate the output before it can become a cache entry, so a bad extraction
  // is never published.
  try {
    pngSize(readFileSync(first), first);
  } catch (error) {
    discard(staging);
    throw error;
  }

  return publish(staging, directory, source);
}
