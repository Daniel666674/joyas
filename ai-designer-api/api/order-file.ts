import { handleOrderFile } from "../lib/handlers";

// GET /api/order-file?id&kind=model|photo&offset: one piece of an order's file, for the admin panel.
export default {
  fetch(request: Request) {
    return handleOrderFile(request);
  },
};
