import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cacheDirectory, extractFrames, FrameError, redact } from "../src/frames";
import { normalizeOptions } from "../src/options";

const scratch = mkdtempSync(join(tmpdir(), "media-panel-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0;

// cacheDirectory hashes a local file's size and mtime, so the file must exist.
const source = join(scratch, "clip.mp4");
writeFileSync(source, "placeholder");

const options = (overrides: Record<string, unknown> = {}) =>
  normalizeOptions({ cacheDirectory: scratch, ...overrides });

describe("cacheDirectory", () => {
  it("is stable for the same source and settings", () => {
    const source = join(scratch, "clip.mp4");
    expect(cacheDirectory(source, options())).toBe(cacheDirectory(source, options()));
  });

  it("changes with the settings that affect the extracted pixels", () => {
    const source = join(scratch, "clip.mp4");
    const base = cacheDirectory(source, options());
    expect(cacheDirectory(source, options({ fps: 20 }))).not.toBe(base);
    expect(cacheDirectory(source, options({ width: 60 }))).not.toBe(base);
    expect(cacheDirectory(source, options({ maxFrames: 10 }))).not.toBe(base);
  });

  it("ignores loop, which only affects playback", () => {
    const source = join(scratch, "clip.mp4");
    expect(cacheDirectory(source, options({ loop: false }))).toBe(
      cacheDirectory(source, options()),
    );
  });

  it("reports a missing file instead of running ffmpeg", () => {
    expect(() => cacheDirectory(join(scratch, "missing.mp4"), options())).toThrow(FrameError);
  });

  it("treats a file URL as the local path it points at", () => {
    expect(cacheDirectory(`file://${source}`, options())).toBe(cacheDirectory(source, options()));
  });

  it("rejects a malformed file URL as a FrameError", () => {
    expect(() => cacheDirectory("file:///tmp/100%.mp4", options())).toThrow(FrameError);
  });
});

describe("redact", () => {
  it("drops credentials and the query string from a remote source", () => {
    expect(redact("https://user:secret@example.com/clip.mp4?sig=abc")).toBe(
      "https://example.com/clip.mp4",
    );
  });

  it("leaves a local path alone", () => {
    expect(redact("/home/user/clip.mp4")).toBe("/home/user/clip.mp4");
  });
});

describe.skipIf(!hasFfmpeg)("extractFrames", () => {
  const clip = join(scratch, "clip.mp4");

  beforeAll(() => {
    const result = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=64x48:rate=8:duration=1",
        "-pix_fmt",
        "yuv420p",
        "-y",
        clip,
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`could not build the test clip: ${result.stderr}`);
    writeFileSync(join(scratch, "broken.mp4"), "not a video");
  });

  it("extracts PNG frames and caches them", () => {
    const first = extractFrames(clip, options({ fps: 8, width: 16 }));
    expect(first.cached).toBe(false);
    expect(first.frames.length).toBeGreaterThan(0);
    expect(first.width).toBe(64);
    expect(first.height).toBe(48);
    expect(first.frames[0]?.startsWith("data:image/png;base64,")).toBe(true);

    const second = extractFrames(clip, options({ fps: 8, width: 16 }));
    expect(second.cached).toBe(true);
    expect(second.frames.length).toBe(first.frames.length);
  });

  it("honours maxFrames", () => {
    const limited = extractFrames(clip, options({ fps: 8, width: 16, maxFrames: 3 }));
    expect(limited.frames.length).toBe(3);
  });

  it("raises FrameError when ffmpeg cannot decode the file", () => {
    expect(() => extractFrames(join(scratch, "broken.mp4"), options())).toThrow(FrameError);
  });

  it("leaves no cache entry or staging directory when extraction fails", () => {
    const broken = join(scratch, "broken.mp4");
    const selected = options();
    expect(() => extractFrames(broken, selected)).toThrow(FrameError);
    expect(existsSync(cacheDirectory(broken, selected))).toBe(false);
    expect(readdirSync(scratch).filter((entry) => entry.includes(".partial-"))).toHaveLength(0);
  });

  it("leaves no staging directory after a successful extraction", () => {
    extractFrames(clip, options({ fps: 10, width: 16 }));
    expect(readdirSync(scratch).filter((entry) => entry.includes(".partial-"))).toHaveLength(0);
  });

  it("publishes the cache directory only once the frame set is complete", () => {
    const first = extractFrames(clip, options({ fps: 12, width: 16 }));
    expect(first.cached).toBe(false);
    expect(first.truncated).toBe(false);
    expect(existsSync(first.directory)).toBe(true);
  });

  it("sweeps a staging directory left by a killed run", () => {
    const root = mkdtempSync(join(scratch, "sweep-"));
    const stale = join(root, "oldhash.partial-999-1");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "f00001.png"), "x");
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(stale, old, old);

    extractFrames(clip, options({ fps: 14, width: 16, cacheDirectory: root }));

    expect(existsSync(stale)).toBe(false);
  });
});
