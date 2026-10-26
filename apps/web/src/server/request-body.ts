/**
 * A request's body as text, read no further than `maxBytes`: `null` when it is
 * larger. A caller nobody signed in can send a body of any size, so it is
 * never buffered whole before its size is known.
 */
export async function readCappedText(request: Request, maxBytes: number): Promise<string | null> {
  const bytes = await readCappedBytes(request, maxBytes);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/** A request's body as bytes, read no further than `maxBytes`: `null` when it is larger. */
export async function readCappedBytes(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  if (request.body === null) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
