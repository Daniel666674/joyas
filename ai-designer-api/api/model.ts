import { handleModel } from "../lib/handlers";

// GET /api/model?id=<jobId>&offset=<bytes>: one piece of the finished 3D model, relayed
// from the provider (whose own file host does not allow browsers on other sites).
export default {
  fetch(request: Request) {
    return handleModel(request);
  },
};
