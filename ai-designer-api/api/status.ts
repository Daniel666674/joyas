import { handleStatus } from "../lib/handlers";

// GET /api/status?id=<jobId>: progress, and the model link once it is ready.
export default {
  fetch(request: Request) {
    return handleStatus(request);
  },
};
