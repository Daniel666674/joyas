import { handleHealth } from "../lib/handlers";

// GET /api/health: tells the page whether the demo is on and whether it needs a code.
export default {
  fetch(request: Request) {
    return handleHealth(request);
  },
};
