import { handleOrders } from "../lib/handlers";

// GET /api/orders: the saved orders, for the admin panel (admin code).
export default {
  fetch(request: Request) {
    return handleOrders(request);
  },
};
