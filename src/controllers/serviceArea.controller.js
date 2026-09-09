import {
    getServiceAreaConfig,
    updateServiceAreaConfig,
    validateLocationServiceability,
} from "../services/serviceArea.service.js";

/**
 * Get active service areas and configuration
 */
export const getServiceAreaConfigController = async (req, res) => {
    const config = await getServiceAreaConfig();
    return res.status(200).json({
        success: true,
        data: config,
    });
};

/**
 * Update service areas configuration (Admin only)
 */
export const updateServiceAreaConfigController = async (req, res) => {
    const { isEnabled, unserviceableMessage, zones } = req.body;
    const updated = await updateServiceAreaConfig({
        isEnabled,
        unserviceableMessage,
        zones,
    });
    return res.status(200).json({
        success: true,
        message: "Service area configuration updated successfully",
        data: updated,
    });
};

/**
 * Check if a location (lat, lng) is serviceable
 */
export const checkLocationServiceabilityController = async (req, res) => {
    const { latitude, longitude } = req.query;
    if (latitude == null || longitude == null) {
        return res.status(400).json({
            success: false,
            message: "latitude and longitude query parameters are required",
        });
    }

    const result = await validateLocationServiceability(
        Number(latitude),
        Number(longitude)
    );

    return res.status(200).json({
        success: true,
        data: result,
    });
};
