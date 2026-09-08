import { describe, expect, it } from "vitest";
import { bareModelId, KreaAdapter } from "@figment/krea";

// Krea publishes model ids as "vendor/model" but generation posts to
// "category/vendor/model". Figment used to assume the category was always
// "image", which made every video, audio and 3d model unreachable.
describe("model identifiers", () => {
  it("keeps a bare vendor/model id untouched", () => {
    expect(bareModelId("google/nano-banana-pro")).toBe("google/nano-banana-pro");
    expect(bareModelId("kling/kling-2.1")).toBe("kling/kling-2.1");
  });

  it("drops the category segment from an endpoint path", () => {
    expect(bareModelId("image/google/nano-banana-pro")).toBe("google/nano-banana-pro");
    expect(bareModelId("video/kling/kling-2.1")).toBe("kling/kling-2.1");
  });

  it("leaves an unqualified id alone", () => {
    expect(bareModelId("nano-banana-pro")).toBe("nano-banana-pro");
  });
});

function adapterWithSchema(schema: unknown, calls: string[] = []) {
  const adapter = new KreaAdapter("test-token");
  (adapter as unknown as { client: unknown }).client = {
    models: {
      getSchema: async (model: string) => {
        calls.push(model);
        return schema;
      },
    },
  };
  return { adapter, calls };
}

describe("KreaAdapter.resolveEndpoint", () => {
  it("discovers the category from the live schema rather than assuming image", async () => {
    const { adapter } = adapterWithSchema({ category: "video", endpointPath: "video/kling/kling-2.1" });
    expect(await adapter.resolveEndpoint("kling/kling-2.1")).toBe("video/kling/kling-2.1");
  });

  it("falls back to the reported category when no endpoint path is given", async () => {
    const { adapter } = adapterWithSchema({ category: "audio" });
    expect(await adapter.resolveEndpoint("vendor/voice")).toBe("audio/vendor/voice");
  });

  it("passes an already qualified endpoint path straight through without a lookup", async () => {
    const { adapter, calls } = adapterWithSchema({ category: "video", endpointPath: "video/kling/kling-2.1" });
    expect(await adapter.resolveEndpoint("video/kling/kling-2.1")).toBe("video/kling/kling-2.1");
    expect(calls).toEqual([]);
  });

  it("resolves each model once and reuses the answer", async () => {
    const { adapter, calls } = adapterWithSchema({ category: "video", endpointPath: "video/kling/kling-2.1" });
    await adapter.resolveEndpoint("kling/kling-2.1");
    await adapter.resolveEndpoint("kling/kling-2.1");
    expect(calls).toEqual(["kling/kling-2.1"]);
  });

  it("explains itself when Krea reports no category at all", async () => {
    const { adapter } = adapterWithSchema({});
    await expect(adapter.resolveEndpoint("vendor/mystery")).rejects.toThrow(/did not report an endpoint for "vendor\/mystery"/);
  });
});

// A 3D job answers with typed entries rather than the bare URL strings image and
// video jobs return, so the mesh URL used to arrive as "[object Object]".
function adapterWithJob(job: unknown) {
  const adapter = new KreaAdapter("test-token");
  (adapter as unknown as { client: unknown }).client = { jobs: { get: async () => job } };
  return adapter;
}

describe("job outputs", () => {
  it("unwraps typed output entries from a 3D job", async () => {
    const adapter = adapterWithJob({
      job_id: "abc", status: "completed",
      result: { urls: [{ type: "model", url: "https://krea.test/mesh.glb" }, { type: "preview", url: "https://krea.test/preview.png" }] },
    });
    const job = await adapter.getJob("abc");
    expect(job.urls).toEqual(["https://krea.test/mesh.glb", "https://krea.test/preview.png"]);
  });

  it("still reads the bare URL strings an image job returns", async () => {
    const adapter = adapterWithJob({ job_id: "abc", status: "completed", result: { urls: ["https://krea.test/one.png"] } });
    expect((await adapter.getJob("abc")).urls).toEqual(["https://krea.test/one.png"]);
  });

  it("drops entries carrying no usable url", async () => {
    const adapter = adapterWithJob({ job_id: "abc", status: "completed", result: { urls: [{ type: "model" }, 7, null, "https://krea.test/ok.glb"] } });
    expect((await adapter.getJob("abc")).urls).toEqual(["https://krea.test/ok.glb"]);
  });
});
