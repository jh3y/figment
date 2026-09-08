import { describe, expect, it } from "vitest";
import { extensionFor, extensionFromUrl } from "@figment/core";

// Every unrecognised response used to be saved as a .png, which quietly
// mislabelled meshes and audio as images.
describe("extensionFor", () => {
  it("prefers a recognised content type", () => {
    expect(extensionFor("image/jpeg", "https://krea.test/a.png")).toBe("jpg");
    expect(extensionFor("model/gltf-binary")).toBe("glb");
    expect(extensionFor("video/mp4")).toBe("mp4");
  });

  it("ignores charset parameters and casing on the content type", () => {
    expect(extensionFor("Model/GLTF-Binary; charset=utf-8")).toBe("glb");
  });

  it("falls back to the extension the URL carries", () => {
    expect(extensionFor(undefined, "https://krea.test/public/1079c0d0.glb")).toBe("glb");
    expect(extensionFor("application/octet-stream", "https://krea.test/a/b.usdz")).toBe("usdz");
  });

  it("ignores a query string when reading the URL", () => {
    expect(extensionFor(undefined, "https://krea.test/mesh.glb?token=abc.png")).toBe("glb");
  });

  it("falls back to png only when neither says anything", () => {
    expect(extensionFor()).toBe("png");
    expect(extensionFor(undefined, "https://krea.test/no-extension")).toBe("png");
  });
});

describe("extensionFromUrl", () => {
  it("reads a plain path as written when it is not a URL", () => {
    expect(extensionFromUrl("some/local/file.webm")).toBe("webm");
  });
  it("returns nothing when there is no extension", () => {
    expect(extensionFromUrl("https://krea.test/plain")).toBeUndefined();
    expect(extensionFromUrl()).toBeUndefined();
  });
});
