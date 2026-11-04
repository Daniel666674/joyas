/*
 * AI designer: the one place that knows where the backend lives.
 *
 *   apiBase: ""  -> built-in SIMULATION. No server, no credits: the page runs
 *                   a fake progress bar and shows a pre-made example piece. The
 *                   page says so on screen.
 *   apiBase: "https://<your-project>.vercel.app"
 *                -> real backend (see ai-designer-api/README.md). Whether that
 *                   backend uses fake or real 3D generation is decided there
 *                   (PROVIDER setting), and the page shows a notice if fake.
 *
 * Only a public web address belongs here. NEVER put an API key in this file.
 *
 * apiBase is the single switch that makes the page talk to a server (and, with
 * Meshy, spend the owner's credits). Connected on 2026-11-04 to the Vercel
 * project habibi-ai-designer-api, which then ran PROVIDER=meshy behind a demo
 * code. To go back to the free built-in simulation, set it to "" again. The
 * history and the order of work are in CLAUDE.md ("Going live").
 */
window.HJE_AI_DESIGNER = {
  apiBase: "https://habibi-ai-designer-api-agency6.vercel.app",
  // WhatsApp number that receives the "Cotizar" messages (country code + number, digits only). This is the
  // same number the rest of the storefront uses (assets/store.js); confirm it is the real one before the demo.
  whatsapp: "573001234567",
  sampleBase: "/joyas/models/samples"
};
