import { describe, expect, it } from "vitest";
import { createPendingMap } from "./protocol";

describe("createPendingMap", () => {
  it("issues increasing ids", () => {
    const map = createPendingMap();
    expect(map.next()).toBe(0);
    expect(map.next()).toBe(1);
  });

  it("resolves a registered request by id", async () => {
    const map = createPendingMap();
    const id = map.next();
    const promise = map.register(id);
    map.resolve(id, "hallo");
    await expect(promise).resolves.toBe("hallo");
  });

  it("rejects a registered request by id", async () => {
    const map = createPendingMap();
    const id = map.next();
    const promise = map.register(id);
    map.reject(id, new Error("boom"));
    await expect(promise).rejects.toThrow("boom");
  });

  it("ignores resolutions for unknown ids", () => {
    const map = createPendingMap();
    expect(() => map.resolve(99, "x")).not.toThrow();
  });

  it("rejectAll rejects every pending request and clears the map", async () => {
    const map = createPendingMap();
    const a = map.register(map.next());
    const b = map.register(map.next());
    map.rejectAll(new Error("disconnected"));
    await expect(a).rejects.toThrow("disconnected");
    await expect(b).rejects.toThrow("disconnected");
    // subsequent resolve is a no-op, not a crash
    expect(() => map.resolve(0, "late")).not.toThrow();
  });
});
