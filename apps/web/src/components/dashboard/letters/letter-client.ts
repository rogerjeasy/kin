"use client";

/** The letter routes, from the browser. The server decides everything; these only carry words and a picture. */
export type LetterError = { readonly ok: false; readonly reason: string };

export async function postLetterJson<T extends { readonly ok: true }>(url: string, body: unknown): Promise<T | LetterError> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const payload = (await response.json()) as unknown;
    if (payload !== null && typeof payload === "object" && "ok" in payload) return payload as T | LetterError;
  } catch {
    // Not JSON, or no network: said the same way as any other outage.
  }
  return { ok: false, reason: "unavailable" };
}

/** The longest side a photograph is sent at: a letter stays readable and the upload stays small. */
const LONGEST_SIDE = 1600;
const JPEG_QUALITY = 0.85;

/**
 * A photograph as a JPEG of bounded size, read in the browser so a phone's
 * several-megabyte camera picture is never uploaded whole. `null` when the
 * browser cannot read the file as a picture.
 */
export async function photoForKin(file: File): Promise<{ mediaType: "image/jpeg"; base64: string } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, LONGEST_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (blob === null) return null;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return { mediaType: "image/jpeg", base64: btoa(binary) };
  } catch {
    return null;
  }
}
