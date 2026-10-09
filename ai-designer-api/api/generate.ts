import { handleGenerate } from "../lib/handlers";

// POST /api/generate: validates the photo, starts a 3D job, returns { jobId }.
export default {
  fetch(request: Request) {
    return handleGenerate(request);
  },
};
