import { describe, it, expect } from "vitest";
import { normalizeHost, normalizeSeedUrl, hostMatchesScope } from "../normalize";

describe("normalizeHost", () => {
  it("strips scheme, www, path and case", () => {
    expect(normalizeHost("https://www.Python.org/docs")).toBe("python.org");
  });
  it("accepts a bare host", () => {
    expect(normalizeHost("python.org")).toBe("python.org");
  });
  it("rejects hosts without a dot", () => {
    expect(() => normalizeHost("localhost")).toThrow();
  });
  it("rejects garbage", () => {
    expect(() => normalizeHost("not a url")).toThrow();
  });
});

describe("normalizeSeedUrl", () => {
  it("adds https, drops the hash and the trailing slash", () => {
    expect(normalizeSeedUrl("python.org/docs/#intro")).toBe(
      "https://python.org/docs",
    );
  });
  it("keeps the root slash", () => {
    expect(normalizeSeedUrl("https://Python.org")).toBe("https://python.org/");
  });
  it("rejects non-http protocols", () => {
    expect(() => normalizeSeedUrl("ftp://x.com")).toThrow();
  });
});

describe("hostMatchesScope", () => {
  it("matches subdomains", () => {
    expect(hostMatchesScope("docs.python.org", ["python.org"])).toBe(true);
  });
  it("does not match look-alike hosts", () => {
    expect(hostMatchesScope("notpython.org", ["python.org"])).toBe(false);
    expect(hostMatchesScope("python.org.evil.com", ["python.org"])).toBe(false);
  });
});
