import { Router } from "express";
import {
    placesAutocompleteController,
    placeDetailsController,
} from "../controllers/location.controller.js";

const router = Router();

// Autocomplete suggestions (Input query -> Array of { placeId, primaryText, secondaryText, fullText })
router.get("/places-autocomplete", placesAutocompleteController);

// Place Details (placeId -> { latitude, longitude, formattedAddress, name })
router.get("/place-details/:placeId", placeDetailsController);

export default router;
