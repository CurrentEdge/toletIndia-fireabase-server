import axios from "axios";
import { AppError } from "../error/app.error.js";
import logger from "../config/logger.js";

const getApiKey = () => process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || "";

/**
 * Autocomplete places using Google Places API (New)
 * Endpoint: POST https://places.googleapis.com/v1/places:autocomplete
 */
export const autocompletePlaces = async (input) => {
    if (!input || input.trim().length < 2) {
        return [];
    }

    const query = input.trim();
    const apiKey = getApiKey();

    if (!apiKey) {
        logger.warn("GOOGLE_PLACES_API_KEY is not configured in .env");
        return [];
    }

    try {
        const response = await axios.post(
            "https://places.googleapis.com/v1/places:autocomplete",
            {
                input: query,
                includedRegionCodes: ["in"],
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "X-Goog-Api-Key": apiKey,
                },
                timeout: 5000,
            }
        );

        if (Array.isArray(response.data?.suggestions)) {
            return response.data.suggestions
                .filter((s) => s.placePrediction)
                .map((s) => {
                    const p = s.placePrediction;
                    const primaryText = p.structuredFormat?.mainText?.text || p.text?.text || "";
                    const secondaryText = p.structuredFormat?.secondaryText?.text || "";
                    const fullText = p.text?.text || `${primaryText}, ${secondaryText}`.trim();
                    const placeId = p.placeId || (p.place ? p.place.replace("places/", "") : "");

                    return {
                        placeId,
                        primaryText,
                        secondaryText,
                        fullText,
                    };
                });
        }

        return [];
    } catch (err) {
        logger.error({ err: err.response?.data || err.message }, "Places API (New) autocomplete error");
        throw new AppError("Failed to fetch place suggestions from Places API (New)", 502);
    }
};

/**
 * Fetches coordinates (lat, lng) and address details for a placeId using Google Places API (New)
 * Endpoint: GET https://places.googleapis.com/v1/places/{placeId}
 */
export const getPlaceCoordinates = async (placeId) => {
    if (!placeId) {
        throw new AppError("placeId parameter is required", 400);
    }

    const cleanPlaceId = placeId.replace("places/", "");
    const apiKey = getApiKey();

    if (!apiKey) {
        throw new AppError("Google Places API Key is not configured on server", 500);
    }

    try {
        const response = await axios.get(
            `https://places.googleapis.com/v1/places/${cleanPlaceId}`,
            {
                headers: {
                    "X-Goog-Api-Key": apiKey,
                    "X-Goog-FieldMask": "id,displayName,formattedAddress,location",
                },
                timeout: 5000,
            }
        );

        if (response.data && response.data.location) {
            const loc = response.data.location;
            return {
                placeId: cleanPlaceId,
                name: response.data.displayName?.text || "",
                formattedAddress: response.data.formattedAddress || "",
                latitude: loc.latitude,
                longitude: loc.longitude,
            };
        }

        throw new AppError("Place details or coordinates not found", 404);
    } catch (err) {
        if (err instanceof AppError) throw err;
        logger.error({ err: err.response?.data || err.message }, "Places API (New) details error");
        throw new AppError("Failed to retrieve place coordinates from Places API (New)", 502);
    }
};
