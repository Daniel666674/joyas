export const MATERIALS = ["oro", "plata", "oro-rosa"] as const;
export type Material = (typeof MATERIALS)[number];

/** Meshy documents texture_prompt up to 800 chars (an older guide said 600). 600 is safe for both. */
export const MAX_TEXTURE_PROMPT_CHARS = 600;

/**
 * The prompt only steers colour/finish, never the shape (the photo decides the
 * shape). Kept in English because the 3D models follow English prompts better.
 */
const MATERIAL_PROMPT: Record<Material, string> = {
  oro: "polished yellow gold jewelry, warm reflective metal, fine detail",
  plata: "polished sterling silver jewelry, bright cool reflective metal, fine detail",
  "oro-rosa": "polished rose gold jewelry, soft pink-gold reflective metal, fine detail",
};

/** Returns "" when there is nothing to say (photo-only mode). */
export function buildTexturePrompt(material: Material | null, styleText: string): string {
  const parts: string[] = [];
  if (material) parts.push(MATERIAL_PROMPT[material]);
  const style = styleText.trim();
  if (style) parts.push(style);
  return parts.join(", ").slice(0, MAX_TEXTURE_PROMPT_CHARS);
}

/** The kinds of jewelry the page offers. The photo alone would just be turned into 3D as it is (a cat stays a cat). */
export const PIECES = ["collar", "anillo", "aretes", "pulsera"] as const;
export type Piece = (typeof PIECES)[number];

const METAL_PHRASE: Record<Material, string> = {
  oro: "polished yellow gold",
  plata: "polished sterling silver",
  "oro-rosa": "polished rose gold",
};

const PIECE_BRIEF: Record<Piece, string> = {
  collar:
    "a PENDANT charm for a necklace: a single pendant shaped like the head of this exact animal, as a raised sculpted relief with fine engraved fur detail, polished edges and a small bail loop at the top. Show only the pendant, front view, with no chain",
  anillo:
    "a RING in a signet style whose top face is a raised sculpted relief of this exact animal's face, with a polished band and fine engraved detail. Show only the ring, standing upright at a three-quarter angle",
  aretes:
    "an EARRING: a single drop earring made of a small sculpted relief charm shaped like the head of this exact animal, hanging from a simple ear hook. Show only one earring, front view",
  pulsera:
    "a BRACELET with a charm: a fine chain bracelet with one large sculpted charm shaped like the head of this exact animal, polished with fine engraved detail. Show only the bracelet laid out as a circle, front view",
};

/**
 * Step 1 of a real generation. Meshy's image-to-3D copies whatever is in the photo, so a
 * cat photo gives a 3D cat. This prompt first asks Meshy's image-to-image model to
 * redesign the animal as the chosen piece of jewelry; step 2 turns THAT picture into 3D.
 * Kept in English (the image models follow English best). The customer's free text is
 * quoted, so it reads as a request and not as an instruction.
 */
export function buildRestylePrompt(piece: Piece, material: Material | null, styleText: string): string {
  const metal = METAL_PHRASE[material ?? "oro"];
  const parts = [
    `Redesign the animal in the reference photo as ONE luxury jewelry piece in ${metal}: ${PIECE_BRIEF[piece]}.`,
    "It must look like a real, wearable, handcrafted high-end piece, and the animal must stay clearly recognizable (same ear shape, face markings and expression, with colours shown as fine engraving or enamel).",
    "Centered and fully visible, isolated on a plain white background, soft studio lighting, product photography.",
    "Do not draw the live animal, a person, hands, text or a scene.",
  ];
  const style = styleText.trim();
  if (style) parts.push(`Extra request from the customer: "${style}".`);
  return parts.join(" ");
}
