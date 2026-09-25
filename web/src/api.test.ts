// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { apiUrl } from "./api";
afterEach(() => vi.unstubAllEnvs());
it("allows the explicit loopback service for SSH-backed access", () => {
  vi.stubEnv("VITE_API_BASE_URL", "http://127.0.0.1:18782");
  expect(apiUrl("subjects")).toBe("http://127.0.0.1:18782/api/subjects");
});
it("uses the configured HTTPS data service without proxying images through Vercel", () => {
  vi.stubEnv("VITE_API_BASE_URL", "https://data.example.edu");
  expect(apiUrl("artifacts/abc/content")).toBe(
    "https://data.example.edu/api/artifacts/abc/content",
  );
});
it("defaults to the local API and rejects non-HTTPS remote endpoints", () => {
  vi.stubEnv("VITE_API_BASE_URL", "");
  expect(apiUrl("subjects")).toBe("/api/subjects");
  vi.stubEnv("VITE_API_BASE_URL", "http://example.org");
  expect(() => apiUrl("subjects")).toThrow("HTTPS");
});
