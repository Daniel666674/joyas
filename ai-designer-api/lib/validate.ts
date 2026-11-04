import { ApiError } from "./errors";
import { MATERIALS, PIECES, type Material, type Piece } from "./prompts";

export const MAX_STYLE_CHARS = 200;
const MIN_IMAGE_BYTES = 2048;

export interface GenerateRequest {
  imageDataUri: string;
  material: Material | null;
  /** Which kind of jewelry to make (null = just turn the photo into 3D as it is). */
  piece: Piece | null;
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

/** Checks a `data:image/jpeg|png;base64,...` string and returns the decoded bytes. */
export function decodeImageDataUri(image: string, maxImageBytes: number): { kind: "jpeg" | "png"; bytes: Buffer } {
  const match = DATA_URI.exec(image);
  if (!match) throw new ApiError("invalid_input", "image is not a JPEG/PNG data URI");
  const kind = (match[1] ?? "") as "jpeg" | "png";
  const bytes = Buffer.from(match[2] ?? "", "base64");
  if (bytes.length > maxImageBytes) throw new ApiError("image_too_large", `image is ${bytes.length} bytes`);
  if (bytes.length < MIN_IMAGE_BYTES) throw new ApiError("invalid_input", "image is too small to be a photo");
  if (!hasMagicBytes(bytes, kind)) {
    throw new ApiError("invalid_input", "image bytes do not match the declared type");
  }
  return { kind, bytes };
}

/** Short free text from the customer: control characters out, spaces collapsed, length capped. */
export function cleanText(raw: unknown, max: number, field: string): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") throw new ApiError("bad_request", `${field} must be text`);
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function parseGenerateBody(body: unknown, maxImageBytes: number): GenerateRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("bad_request", "body is not a JSON object");
  }
  const { image, material, style, piece } = body as Record<string, unknown>;

  if (typeof image !== "string") throw new ApiError("bad_request", "image is missing");
  decodeImageDataUri(image, maxImageBytes);

  let chosenMaterial: Material | null = null;
  if (material !== undefined && material !== null && material !== "") {
    if (typeof material !== "string" || !(MATERIALS as readonly string[]).includes(material)) {
      throw new ApiError("bad_request", "unknown material");
    }
    chosenMaterial = material as Material;
  }

  let chosenPiece: Piece | null = null;
  if (piece !== undefined && piece !== null && piece !== "") {
    if (typeof piece !== "string" || !(PIECES as readonly string[]).includes(piece)) {
      throw new ApiError("bad_request", "unknown piece");
    }
    chosenPiece = piece as Piece;
  }

  let styleText = "";
  if (style !== undefined && style !== null) {
    if (typeof style !== "string") throw new ApiError("bad_request", "style must be text");
    styleText = cleanStyleText(style);
  }

  return { imageDataUri: image, material: chosenMaterial, piece: chosenPiece, styleText };
}

export interface OrderRequest {
  jobId: string;
  piece: Piece | null;
  material: Material | null;
  style: string;
  name: string;
  notes: string;
  photo: { kind: "jpeg" | "png"; bytes: Buffer } | null;
}

const JOB_ID_FORMAT = /^[A-Za-z0-9_-]{6,80}$/;

/** The body of POST /api/order. `consent: true` is required: saving the customer's photo is only done with their OK. */
export function parseOrderBody(body: unknown, maxImageBytes: number): OrderRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("bad_request", "body is not a JSON object");
  }
  const { jobId, piece, material, style, name, notes, photo, consent } = body as Record<string, unknown>;
  if (consent !== true) throw new ApiError("bad_request", "consent is required to save an order");
  // "ii_" ids are step-1 (picture) tasks: asking the provider about one would start a new 3D task.
  if (typeof jobId !== "string" || !JOB_ID_FORMAT.test(jobId) || jobId.startsWith("ii_")) {
    throw new ApiError("bad_request", "bad job id");
  }
  let chosenPiece: Piece | null = null;
  if (piece !== undefined && piece !== null && piece !== "") {
    if (typeof piece !== "string" || !(PIECES as readonly string[]).includes(piece)) throw new ApiError("bad_request", "unknown piece");
    chosenPiece = piece as Piece;
  }
  let chosenMaterial: Material | null = null;
  if (material !== undefined && material !== null && material !== "") {
    if (typeof material !== "string" || !(MATERIALS as readonly string[]).includes(material)) throw new ApiError("bad_request", "unknown material");
    chosenMaterial = material as Material;
  }
  let decoded: OrderRequest["photo"] = null;
  if (photo !== undefined && photo !== null && photo !== "") {
    if (typeof photo !== "string") throw new ApiError("bad_request", "photo must be a data URI");
    decoded = decodeImageDataUri(photo, maxImageBytes);
  }
  return {
    jobId,
    piece: chosenPiece,
    material: chosenMaterial,
    style: cleanText(style, MAX_STYLE_CHARS, "style"),
    name: cleanText(name, 60, "name"),
    notes: cleanText(notes, 400, "notes"),
    photo: decoded,
  };
}
