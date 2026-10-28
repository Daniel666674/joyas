/*
 * AI designer: the one place that knows where the backend lives.
 *
 *   apiBase: ""  -> built-in SIMULATION. No server, no credits: the page runs
 *                   a fake progress bar and shows a pre-made sample model. The
 *                   page says so on screen.
 *   apiBase: "https://<your-project>.vercel.app"
 *                -> real backend (see ai-designer-api/README.md). Whether that
 *                   backend uses fake or real 3D generation is decided there
 *                   (PROVIDER setting), and the page shows a notice if fake.
 *
 * Only a public web address belongs here. NEVER put an API key in this file.
 *
 * OWNER DECISION: the demo must not use credits of any kind, so keep apiBase
 * EMPTY. Setting it is the single switch that makes the page talk to a server.
 */
window.HJE_AI_DESIGNER = {
  apiBase: "",
  sampleBase: "/joyas/models/samples"
};
