import express from "express";
import {
    getServiceAreaConfigController,
    updateServiceAreaConfigController,
    checkLocationServiceabilityController,
} from "../controllers/serviceArea.controller.js";
import {
    authMiddleWare,
    requireAdmin,
} from "../middleware/auth.middleware.js";

const router = express.Router();

// Public: Get service areas config & check location
router.get("/", getServiceAreaConfigController);
router.get("/check", checkLocationServiceabilityController);

// Admin only: Update service areas config
router.put("/", authMiddleWare, requireAdmin, updateServiceAreaConfigController);

export default router;
