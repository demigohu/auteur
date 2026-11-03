import { describe, expect, it } from "vitest";
import { clock, greeting, timeAgo } from "./format";

describe("format", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  const ago = (s: number) => new Date(now - s * 1000).toISOString();

  it("says how long ago a project was edited", () => {
    expect(timeAgo(ago(30), now)).toBe("Just now");
    expect(timeAgo(ago(5 * 60), now)).toBe("5m ago");
    expect(timeAgo(ago(3 * 3600), now)).toBe("3h ago");
    expect(timeAgo(ago(30 * 3600), now)).toBe("Yesterday");
    expect(timeAgo(ago(3 * 86400), now)).toBe("3d ago");
    expect(timeAgo(ago(-60), now)).toBe("Just now"); // a clock slightly ahead of the server
  });

  it("falls back to a date after a week", () => {
    expect(timeAgo("2026-10-01T12:00:00Z", now)).toBe("Oct 1");
  });

  it("formats durations as m:ss", () => {
    expect(clock(75.4)).toBe("1:15");
    expect(clock(59.6)).toBe("1:00");
    expect(clock(0)).toBe("0:00");
  });

  it("greets by hour", () => {
    expect(greeting(3)).toBe("Up late");
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(21)).toBe("Good evening");
  });
});
