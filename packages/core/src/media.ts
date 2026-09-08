// Krea serves images, video, meshes, audio and formats Figment has not met yet.
// A recognised content type wins, then the extension the URL already carries, so
// a new output format is saved under its real name instead of being mislabelled.
const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/ogg": "ogv",
  "model/gltf-binary": "glb", "model/gltf+json": "gltf", "model/obj": "obj", "model/vnd.usdz+zip": "usdz",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "oga",
};

export function extensionFor(contentType?: string, url?: string): string {
  const type = contentType?.split(";")[0]?.trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS[type ?? ""] ?? extensionFromUrl(url) ?? "png";
}

export function extensionFromUrl(url?: string): string | undefined {
  if (!url) return undefined;
  let pathname = url;
  try { pathname = new URL(url).pathname; } catch { /* Not absolute; read the string as written. */ }
  const match = /\.([a-z0-9]{2,5})$/i.exec(pathname);
  return match ? match[1].toLowerCase() : undefined;
}
