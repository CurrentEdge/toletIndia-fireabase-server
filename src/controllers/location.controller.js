import { autocompletePlaces, getPlaceCoordinates } from "../services/location.service.js";

/**
 * Controller: Autocomplete search query for places
 * GET /api/location/places-autocomplete?input=query
 */
export const placesAutocompleteController = async (req, res, next) => {
    try {
        const input = req.query.input || req.query.q || "";
        const predictions = await autocompletePlaces(input);

        return res.status(200).json({
            success: true,
            predictions,
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Controller: Get coordinates (lat, lng) and address for a placeId
 * GET /api/location/place-details/:placeId
 */
export const placeDetailsController = async (req, res, next) => {
    try {
        const { placeId } = req.params;
        const details = await getPlaceCoordinates(placeId);

        return res.status(200).json({
            success: true,
            ...details,
        });
    } catch (err) {
        next(err);
    }
};
