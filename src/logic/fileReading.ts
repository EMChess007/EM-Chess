/**
 * Reads a picked file's bytes as base64, given its uri (a `file://` path on native, a `blob:`
 * URL on web). Deliberately goes through `fetch` + `Blob` + `FileReader` — React Native's own
 * built-in local-file-reading support — rather than expo-file-system: that module's File class
 * gates every read behind a FilePermissionService check, and Expo Go replaces that service with
 * a stricter, per-project-scoped implementation that does not recognize paths written by other
 * native modules (e.g. expo-document-picker's own cache subdirectory) as readable, even though
 * the file is perfectly real and belongs to the same app. `fetch`/`FileReader` never go through
 * that permission service at all, so this works the same in Expo Go and in a custom dev build.
 */
export async function readFileAsBase64(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unexpected FileReader result type'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
  // readAsDataURL always yields "data:<mime>;base64,<data>" — strip the prefix.
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

/** Same as readFileAsBase64, but returns the full data URI (with the "data:<mime>;base64," prefix
 * intact) — what an <Image source={{ uri }} /> needs directly, unlike readFileAsBase64's bare
 * payload (used for the custom-engine .wasm flow, which sends the base64 to a WebView instead). */
export async function readFileAsDataUri(uri: string): Promise<string> {
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Unexpected FileReader result type'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}
