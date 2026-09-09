import { db } from "../config/firebase.js";
import { AppError } from "../error/app.error.js";

const SETTINGS_DOC_REF = db.collection("settings").doc("service_areas");

const DEFAULT_CONFIG = {
    isEnabled: true,
    unserviceableMessage:
        "Service is currently unavailable in this location. We are expanding soon!",
    zones: [
        {
            id: "zone_blr",
            name: "Bengaluru Hub",
            latitude: 12.971599,
            longitude: 77.594563,
            radiusKm: 35.0,
            isActive: true,
        },
        {
            id: "zone_hyd",
            name: "Hyderabad Hub",
            latitude: 17.385044,
            longitude: 78.486671,
            radiusKm: 35.0,
            isActive: true,
        },
        {
            id: "zone_vja",
            name: "Vijayawada Hub",
            latitude: 16.506174,
            longitude: 80.648015,
            radiusKm: 25.0,
            isActive: true,
        },
    ],
};

/**
 * Calculates Great-Circle distance between two geographical points using the Haversine formula.
 * @returns {number} Distance in kilometers
 */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

/**
 * Retrieves the current Service Area configuration. If not found, initializes with default hubs.
 */
export const getServiceAreaConfig = async () => {
    const docSnap = await SETTINGS_DOC_REF.get();
    if (!docSnap.exists) {
        await SETTINGS_DOC_REF.set({
            ...DEFAULT_CONFIG,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        return DEFAULT_CONFIG;
    }
    const data = docSnap.data();
    return {
        isEnabled: data.isEnabled !== false,
        unserviceableMessage:
            data.unserviceableMessage || DEFAULT_CONFIG.unserviceableMessage,
        zones: Array.isArray(data.zones) ? data.zones : DEFAULT_CONFIG.zones,
    };
};

/**
 * Updates the service area configuration.
 */
export const updateServiceAreaConfig = async ({
    isEnabled,
    unserviceableMessage,
    zones,
}) => {
    const current = await getServiceAreaConfig();

    const updatedConfig = {
        isEnabled: typeof isEnabled === "boolean" ? isEnabled : current.isEnabled,
        unserviceableMessage:
            unserviceableMessage?.trim() || current.unserviceableMessage,
        zones: Array.isArray(zones) ? zones : current.zones,
        updatedAt: new Date(),
    };

    await SETTINGS_DOC_REF.set(updatedConfig, { merge: true });
    return updatedConfig;
};

/**
 * Validates if the given latitude and longitude coordinates fall within any active service zone.
 */
export const validateLocationServiceability = async (latitude, longitude) => {
    if (latitude == null || longitude == null) {
        return { isServiceable: true }; // Skip if coordinates are omitted
    }

    const config = await getServiceAreaConfig();
    if (!config.isEnabled) {
        return { isServiceable: true, reason: "Restriction disabled" };
    }

    const activeZones = config.zones.filter((z) => z.isActive !== false);
    if (activeZones.length === 0) {
        return { isServiceable: true, reason: "No active restriction zones configured" };
    }

    let nearestZone = null;
    let minDistance = Infinity;

    for (const zone of activeZones) {
        const dist = calculateDistanceKm(
            Number(latitude),
            Number(longitude),
            Number(zone.latitude),
            Number(zone.longitude)
        );

        if (dist < minDistance) {
            minDistance = dist;
            nearestZone = zone;
        }

        if (dist <= Number(zone.radiusKm)) {
            return {
                isServiceable: true,
                matchedZone: zone,
                distanceKm: Number(dist.toFixed(2)),
            };
        }
    }

    return {
        isServiceable: false,
        nearestZone,
        distanceKm: Number(minDistance.toFixed(2)),
        message: config.unserviceableMessage,
    };
};
