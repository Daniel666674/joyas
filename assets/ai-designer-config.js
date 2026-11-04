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
 * Keep apiBase EMPTY until the backend is deployed and tested: setting it is
 * the single switch that makes the page talk to a server (and, with Meshy,
 * spend the owner's credits). The owner lifted the "zero credits" rule on
 * 2026-11-04 and chose Meshy; the order of work is in CLAUDE.md ("Going live").
 */
window.HJE_AI_DESIGNER = {
  apiBase: "",
  sampleBase: "/joyas/models/samples"
};
