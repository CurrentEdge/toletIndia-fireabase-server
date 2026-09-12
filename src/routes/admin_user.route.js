import { Router } from "express";
import { authMiddleWare, requireAdmin } from "../middleware/auth.middleware.js";
import {
    searchCustomerUserByPhoneController,
    createCustomerUserController,
    createTechnicianUserController,
} from "../controllers/admin_user.controller.js";

const router = Router();

// Protect all admin user endpoints
router.use(authMiddleWare);
router.use(requireAdmin);

// Search customer by phone number
router.get("/search", searchCustomerUserByPhoneController);

// Create new customer
router.post("/", createCustomerUserController);

// Create or upgrade technician
router.post("/technician", createTechnicianUserController);

export default router;
