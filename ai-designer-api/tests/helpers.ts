/** A tiny but structurally valid JPEG/PNG-looking payload for validation tests. */
export function fakeJpegDataUri(bytes = 4096): string {
  const buf = Buffer.alloc(bytes, 7);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

export function fakePngDataUri(bytes = 4096): string {
  const buf = Buffer.alloc(bytes, 7);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export function jsonRequest(
  url: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Request {
  const { method = "GET", body, headers = {} } = options;
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
