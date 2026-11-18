import { describe, expect, it } from "vitest";
import { cellsFor, DEFAULT_MEDIA_OPTIONS, normalizeOptions, pixelsWide } from "../src/options";

describe("normalizeOptions", () => {
  it("returns the defaults for missing input", () => {
    expect(normalizeOptions(undefined)).toEqual(DEFAULT_MEDIA_OPTIONS);
  });

  it("keeps a trimmed source and ignores an empty one", () => {
    expect(normalizeOptions({ source: "  /home/user/clip.mp4 " }).source).toBe(
      "/home/user/clip.mp4",
    );
    expect(normalizeOptions({ source: "   " }).source).toBeUndefined();
    expect(normalizeOptions({ source: 7 }).source).toBeUndefined();
  });

  it("clamps numbers into the renderable range", () => {
    expect(normalizeOptions({ fps: 0 }).fps).toBe(1);
    expect(normalizeOptions({ fps: 999 }).fps).toBe(30);
    expect(normalizeOptions({ width: 2 }).width).toBe(8);
    expect(normalizeOptions({ width: 4000 }).width).toBe(120);
    expect(normalizeOptions({ maxFrames: 0 }).maxFrames).toBe(1);
    expect(normalizeOptions({ maxFrames: 10_000 }).maxFrames).toBe(2000);
    expect(normalizeOptions({ fps: 7.6 }).fps).toBe(8);
  });

  it("falls back to the default for values of the wrong type", () => {
    expect(normalizeOptions({ fps: "15" }).fps).toBe(DEFAULT_MEDIA_OPTIONS.fps);
    expect(normalizeOptions({ fps: Number.NaN }).fps).toBe(DEFAULT_MEDIA_OPTIONS.fps);
    expect(normalizeOptions({ loop: "no" }).loop).toBe(true);
  });

  it("only accepts the known presentation", () => {
    expect(normalizeOptions({ presentation: "fullscreen" }).presentation).toBe("fullscreen");
    expect(normalizeOptions({ presentation: "window" }).presentation).toBe("panel");
  });

  it("treats autoplay and remember as opt-out and opt-in respectively", () => {
    expect(normalizeOptions({ autoplay: false }).autoplay).toBe(false);
    expect(normalizeOptions({ autoplay: "yes" }).autoplay).toBe(true);
    expect(normalizeOptions({ remember: true }).remember).toBe(true);
    expect(normalizeOptions({}).remember).toBe(false);
  });

  it("keeps a custom ffmpeg path and cache directory", () => {
    const options = normalizeOptions({
      ffmpeg: "/opt/homebrew/bin/ffmpeg",
      cacheDirectory: "/tmp/frames",
    });
    expect(options.ffmpeg).toBe("/opt/homebrew/bin/ffmpeg");
    expect(options.cacheDirectory).toBe("/tmp/frames");
  });
});

describe("cell geometry", () => {
  it("scales pixels to cells at four by eight", () => {
    expect(pixelsWide(44)).toBe(176);
    expect(cellsFor({ width: 176, height: 176 })).toEqual({ width: 44, height: 22 });
    expect(cellsFor({ width: 160, height: 90 })).toEqual({ width: 40, height: 11 });
  });

  it("never reports a zero-cell frame", () => {
    expect(cellsFor({ width: 1, height: 1 })).toEqual({ width: 1, height: 1 });
  });
});
