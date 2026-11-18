/** ffmpeg output naming. Kept apart so tests and the extractor share one rule. */

const PATTERN = "f%05d.png";
const FILE = /^f\d{5}\.png$/;

export const framePattern = (): string => PATTERN;

export const frameFile = (entry: string): boolean => FILE.test(entry);
