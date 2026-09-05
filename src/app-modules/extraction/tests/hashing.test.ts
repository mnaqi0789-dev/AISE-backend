import { describe, it, expect } from "vitest";
import {
  normalizeText,
  computeContentHash,
  computeSimhash,
  hammingDistance,
} from "../hashing";

describe("normalizeText", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeText("Hello   World\n\tFoo")).toBe("hello world foo");
  });
});

describe("computeContentHash", () => {
  it("is deterministic for identical text", () => {
    const a = computeContentHash("The quick brown fox");
    const b = computeContentHash("The quick brown fox");
    expect(a).toBe(b);
  });

  it("is insensitive to whitespace/case differences via normalization", () => {
    const a = computeContentHash("The Quick Brown Fox");
    const b = computeContentHash("the   quick brown   fox");
    expect(a).toBe(b);
  });

  it("differs for genuinely different text", () => {
    const a = computeContentHash("The quick brown fox");
    const b = computeContentHash("A completely different sentence");
    expect(a).not.toBe(b);
  });
});

describe("computeSimhash", () => {
  it("is deterministic for identical text", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    expect(computeSimhash(text)).toBe(computeSimhash(text));
  });

  it("produces a 16-character hex string", () => {
    const result = computeSimhash(
      "Some article content here for testing purposes",
    );
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives near-identical fingerprints for near-identical realistic-length text", () => {
    const base =
      "The quick brown fox jumps over the lazy dog near the riverbank today. ".repeat(
        8,
      );
    const a = computeSimhash(base + "It happened today.");
    const b = computeSimhash(base + "It happened yesterday.");
    expect(hammingDistance(a, b)).toBeLessThanOrEqual(3);
  });

  it("gives a large distance for unrelated text", () => {
    const a = computeSimhash(
      "The quick brown fox jumps over the lazy dog near the riverbank",
    );
    const b = computeSimhash(
      "Quantum entanglement describes correlated particle states across distance",
    );
    expect(hammingDistance(a, b)).toBeGreaterThan(3);
  });
});

describe("hammingDistance", () => {
  it("returns 0 for identical hex strings", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
  });

  it("counts differing bits correctly", () => {
    expect(hammingDistance("0000000000000000", "0000000000000001")).toBe(1);
    expect(hammingDistance("0000000000000000", "0000000000000007")).toBe(3);
    expect(hammingDistance("0000000000000000", "000000000000000f")).toBe(4);
  });

  it("is symmetric", () => {
    const a = "abcdef0123456789";
    const b = "0123456789abcdef";
    expect(hammingDistance(a, b)).toBe(hammingDistance(b, a));
  });
});
