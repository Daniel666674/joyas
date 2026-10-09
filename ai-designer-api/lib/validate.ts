import { ApiError } from "./errors";
import { MATERIALS, type Material } from "./prompts";

export const MAX_STYLE_CHARS = 200;
const MIN_IMAGE_BYTES = 2048;

export interface GenerateRequest {
  imageDataUri: string;
  material: Material | null;
  styleText: string;
}

// Only JPEG/PNG are accepted: those are the formats Meshy documents. The page
// converts every upload (including WebP) to JPEG in the browser before sending.
const DATA_URI = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;

const MAGIC: Record<string, number[]> = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

function hasMagicBytes(bytes: Buffer, kind: string): boolean {
  const signature = MAGIC[kind];
  if (!signature) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

/** Strips control characters and collapses whitespace in the free-text style box. */
export function cleanStyleText(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_STYLE_CHARS);
}

export function parseGenerateBody(body: unknown, maxImageBytes: number): GenerateRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("bad_request", "body is not a JSON object");
  }
  const { image, material, style } = body as Record<string, unknown>;

  if (typeof image !== "string") throw new ApiError("bad_request", "image is missing");
  const match = DATA_URI.exec(image);
  if (!match) throw new ApiError("invalid_input", "image is not a JPEG/PNG data URI");

  const kind = match[1] ?? "";
  const bytes = Buffer.from(match[2] ?? "", "base64");
  if (bytes.length > maxImageBytes) throw new ApiError("image_too_large", `image is ${bytes.length} bytes`);
  if (bytes.length < MIN_IMAGE_BYTES) throw new ApiError("invalid_input", "image is too small to be a photo");
  if (!hasMagicBytes(bytes, kind)) {
    throw new ApiError("invalid_input", "image bytes do not match the declared type");
  }

  let chosenMaterial: Material | null = null;
  if (material !== undefined && material !== null && material !== "") {
    if (typeof material !== "string" || !(MATERIALS as readonly string[]).includes(material)) {
      throw new ApiError("bad_request", "unknown material");
    }
    chosenMaterial = material as Material;
  }

  let styleText = "";
  if (style !== undefined && style !== null) {
    if (typeof style !== "string") throw new ApiError("bad_request", "style must be text");
    styleText = cleanStyleText(style);
  }

  return { imageDataUri: image, material: chosenMaterial, styleText };
}
