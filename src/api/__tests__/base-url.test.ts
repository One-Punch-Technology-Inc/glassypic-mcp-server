import { describe, it, expect } from "vitest";
import { resolveApiBaseUrl } from "../client.js";

describe("resolveApiBaseUrl", () => {
  it("accepts the production https URL", () => {
    const result = resolveApiBaseUrl({ GLASSYPIC_API_URL: "https://api.glassypic.com" });
    expect(result.baseUrl).toBe("https://api.glassypic.com");
    expect(result.isLoopback).toBe(false);
  });

  it("accepts http for localhost", () => {
    const result = resolveApiBaseUrl({ GLASSYPIC_API_URL: "http://localhost:8000" });
    expect(result.baseUrl).toBe("http://localhost:8000");
    expect(result.isLoopback).toBe(true);
  });

  it("accepts http for 127.0.0.1", () => {
    expect(resolveApiBaseUrl({ GLASSYPIC_API_URL: "http://127.0.0.1:8000" }).isLoopback).toBe(true);
  });

  it("rejects plaintext http for a remote host", () => {
    expect(() => resolveApiBaseUrl({ GLASSYPIC_API_URL: "http://api.example.com" })).toThrow(
      /GLASSYPIC_API_URL/,
    );
  });

  it("rejects a malformed value and names the variable", () => {
    expect(() => resolveApiBaseUrl({ GLASSYPIC_API_URL: "not-a-url" })).toThrow(
      /GLASSYPIC_API_URL/,
    );
  });

  it("falls back to the default when GLASSYPIC_API_URL is unset", () => {
    expect(resolveApiBaseUrl({}).baseUrl).toBe("https://api.glassypic.com");
  });

  it("strips a trailing slash so path joins stay well-formed", () => {
    expect(resolveApiBaseUrl({ GLASSYPIC_API_URL: "https://api.glassypic.com/" }).baseUrl).toBe(
      "https://api.glassypic.com",
    );
  });
});
