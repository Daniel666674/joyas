import { handleOrderCreate } from "../lib/handlers";

// POST /api/order: saves a customer's quote request (3D file + photo with consent) in the private store.
export default {
  fetch(request: Request) {
    return handleOrderCreate(request);
  },
};
