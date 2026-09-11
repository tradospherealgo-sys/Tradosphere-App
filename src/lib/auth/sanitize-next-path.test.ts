import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "./sanitize-next-path";

describe("sanitizeNextPath", () => {
  it("allows a plain relative path", () => {
    expect(sanitizeNextPath("/portfolio")).toBe("/portfolio");
  });

  it("allows a relative path with query and hash", () => {
    expect(sanitizeNextPath("/signals?tab=open#top")).toBe("/signals?tab=open#top");
  });

  it("falls back to /dashboard when next is missing", () => {
    expect(sanitizeNextPath(null)).toBe("/dashboard");
  });

  it("falls back to /dashboard when next is empty", () => {
    expect(sanitizeNextPath("")).toBe("/dashboard");
  });

  it("rejects protocol-relative redirects", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("//evil.com/phish")).toBe("/dashboard");
  });

  it("rejects absolute URLs", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("http://evil.com/login")).toBe("/dashboard");
  });

  it("rejects values not starting with a slash", () => {
    expect(sanitizeNextPath("evil.com")).toBe("/dashboard");
    expect(sanitizeNextPath("dashboard")).toBe("/dashboard");
  });

  it("rejects backslash tricks used to smuggle a host", () => {
    expect(sanitizeNextPath("/\\evil.com")).toBe("/dashboard");
  });

  it("keeps a same-origin path containing a raw percent sign", () => {
    expect(sanitizeNextPath("/%zz")).toBe("/%zz");
  });
});
