import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "../lib/errors";
import { buildTexturePrompt, MAX_TEXTURE_PROMPT_CHARS } from "../lib/prompts";
import { cleanStyleText, MAX_STYLE_CHARS, parseGenerateBody } from "../lib/validate";
import { fakeJpegDataUri, fakePngDataUri } from "./helpers";

const MAX = 3_000_000;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof ApiError ? err.code : "non-api-error";
  }
  return undefined;
}

test("accepts a JPEG and a PNG photo-only request", () => {
  const jpeg = parseGenerateBody({ image: fakeJpegDataUri() }, MAX);
  assert.equal(jpeg.material, null);
  assert.equal(jpeg.styleText, "");
  assert.ok(parseGenerateBody({ image: fakePngDataUri() }, MAX).imageDataUri.startsWith("data:image/png"));
});

test("accepts a known material and cleans the style text", () => {
  const out = parseGenerateBody({ image: fakeJpegDataUri(), material: "oro-rosa", style: "  brillante\n\n  pulido\u0007 " }, MAX);
  assert.equal(out.material, "oro-rosa");
  assert.equal(out.styleText, "brillante pulido");
});

test("rejects things that are not a JPEG/PNG photo", () => {
  assert.equal(codeOf(() => parseGenerateBody({ image: "data:image/gif;base64,AAAA" }, MAX)), "invalid_input");
  assert.equal(codeOf(() => parseGenerateBody({ image: "data:application/pdf;base64,AAAA" }, MAX)), "invalid_input");
  assert.equal(codeOf(() => parseGenerateBody({ image: "https://example.com/cat.jpg" }, MAX)), "invalid_input");
  assert.equal(codeOf(() => parseGenerateBody({ image: "not even close" }, MAX)), "invalid_input");
});

test("rejects bytes that lie about their type", () => {
  const liar = `data:image/jpeg;base64,${Buffer.alloc(4096, 1).toString("base64")}`;
  assert.equal(codeOf(() => parseGenerateBody({ image: liar }, MAX)), "invalid_input");
});

test("rejects tiny and oversized images with different codes", () => {
  assert.equal(codeOf(() => parseGenerateBody({ image: fakeJpegDataUri(100) }, MAX)), "invalid_input");
  assert.equal(codeOf(() => parseGenerateBody({ image: fakeJpegDataUri(10_000) }, 5_000)), "image_too_large");
});

test("rejects malformed bodies and unknown materials", () => {
  assert.equal(codeOf(() => parseGenerateBody(null, MAX)), "bad_request");
  assert.equal(codeOf(() => parseGenerateBody([], MAX)), "bad_request");
  assert.equal(codeOf(() => parseGenerateBody({}, MAX)), "bad_request");
  assert.equal(codeOf(() => parseGenerateBody({ image: fakeJpegDataUri(), material: "platino" }, MAX)), "bad_request");
  assert.equal(codeOf(() => parseGenerateBody({ image: fakeJpegDataUri(), style: 42 }, MAX)), "bad_request");
});

test("style text is capped", () => {
  assert.equal(cleanStyleText("a".repeat(500)).length, MAX_STYLE_CHARS);
});

test("texture prompt: empty for photo-only, material first, hard cap", () => {
  assert.equal(buildTexturePrompt(null, ""), "");
  assert.match(buildTexturePrompt("plata", "mate"), /^polished sterling silver.*, mate$/);
  assert.equal(buildTexturePrompt("oro", "x".repeat(2000)).length, MAX_TEXTURE_PROMPT_CHARS);
});
