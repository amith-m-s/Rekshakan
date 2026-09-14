import { beforeEach, describe, expect, it } from "vitest";
import {
  clearProviderCache,
  resilientFetch,
} from "../src/integrations/providers/index.js";
import { emitOperational, setIo } from "../src/services/runtime.js";

beforeEach(() => clearProviderCache());
describe("provider resilience and socket privacy", () => {
  it("returns marked-stale last valid data after provider failure", async () => {
    const fresh = await resilientFetch(
      "test",
      "test-provider",
      "OFFICIAL",
      async () => ({ value: 42 }),
    );
    expect(fresh.stale).toBe(false);
    const stale = await resilientFetch(
      "test",
      "test-provider",
      "OFFICIAL",
      async () => {
        throw new Error("offline");
      },
    );
    expect(stale.data).toEqual({ value: 42 });
    expect(stale.stale).toBe(true);
  });
  it("fails clearly when provider has no cached value", async () => {
    await expect(
      resilientFetch("empty", "test-provider", "OFFICIAL", async () => {
        throw new Error("offline");
      }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", status: 503 });
  });
  it("sends operational events only to privileged roles and named users", () => {
    const calls: string[] = [];
    setIo({ to: (room: string) => ({ emit: () => calls.push(room) }) } as any);
    emitOperational("help_request.created", { latitude: 1, longitude: 2 }, [
      "resident-1",
    ]);
    expect(calls.sort()).toEqual([
      "role:ADMIN",
      "role:COORDINATOR",
      "user:resident-1",
    ]);
    expect(calls).not.toContain("role:RESPONDER");
  });
});
