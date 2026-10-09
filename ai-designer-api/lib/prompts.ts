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
