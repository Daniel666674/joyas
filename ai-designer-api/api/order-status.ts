import { handleOrderStatus } from "../lib/handlers";

// POST /api/order-status: changes an order's status (nuevo, cotizado, ...), for the admin panel.
export default {
  fetch(request: Request) {
    return handleOrderStatus(request);
  },
};
