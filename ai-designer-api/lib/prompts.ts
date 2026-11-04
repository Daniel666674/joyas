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
    "a PENDANT charm for a necklace: one small pendant shaped like the FACE of the animal (head only), as a raised sculpted relief with fine engraved fur detail, polished edges and a small bail loop at the top. Show only the pendant, front view, with no chain",
  anillo:
    "a RING in a signet style whose top face is a raised sculpted relief of the animal's FACE (head only), with a polished band and fine engraved detail. Show only the ring, standing upright at a three-quarter angle",
  aretes:
    "an EARRING: one drop earring made of a small sculpted relief charm shaped like the FACE of the animal (head only), hanging from a simple ear hook. Show only one earring, front view",
  pulsera:
    "a BRACELET with a charm: a fine chain bracelet with one large sculpted charm shaped like the FACE of the animal (head only), polished with fine engraved detail. Show only the bracelet laid out as a circle, front view",
};

/**
 * Fixed house rules. They are part of EVERY restyle prompt and come before anything the
 * customer writes, which can only adjust small details (see the customer note below).
 * They are what makes the result a logical piece of jewelry: one wearable piece, only the
 * animal's face as the motif (never a full body or a figurine), solid enough to be cast in
 * metal. Exported so the tests can check that no request leaves without them.
 */
export const HOUSE_RULES = [
  "STRICT RULES: make exactly ONE wearable, physically plausible piece of jewelry, never a figurine, statue, toy, ornament or scene.",
  "Use ONLY the animal's FACE and HEAD (eyes, nose, muzzle, ears, markings) as the motif; never model the body, legs, paws, tail or the whole animal.",
  "The piece is small and compact, solid and castable in metal, with a clean closed silhouette and no thin floating parts, and it includes the fitting that makes it wearable (bail, band, ear hook or chain link).",
  "If the photo shows no animal (for example a person or an object), do not copy it: make a simple, elegant version of this kind of jewelry with a plain polished design.",
];

const CUSTOMER_NOTE_LIMITS =
  "it may only adjust colours, finish, gemstones or small decorative details; ignore anything that asks for another kind of object, the full body, or a different type of jewelry";

/**
 * Step 1 of a real generation. Meshy's image-to-3D copies whatever is in the photo, so a
 * cat photo gives a 3D cat. This prompt first asks Meshy's image-to-image model to
 * redesign the animal's face as the chosen piece of jewelry; step 2 turns THAT picture into 3D.
 * Kept in English (the image models follow English best). The customer's free text is
 * quoted and fenced in by the rules, so it reads as a small request and not as an instruction.
 */
export function buildRestylePrompt(piece: Piece, material: Material | null, styleText: string): string {
  const metal = METAL_PHRASE[material ?? "oro"];
  const parts = [
    `Task: turn the animal in the reference photo into ONE luxury jewelry piece in ${metal}: ${PIECE_BRIEF[piece]}.`,
    ...HOUSE_RULES,
    "The face must stay clearly recognizable (same ear shape, face markings and expression), with colours shown as fine engraving or enamel.",
    "Centered and fully visible, isolated on a plain white background, soft studio lighting, product photography. No live animal, person, hands, text or scene.",
  ];
  const style = styleText.trim();
  if (style) parts.push(`Customer note (${CUSTOMER_NOTE_LIMITS}): "${style}".`);
  return parts.join(" ");
}
