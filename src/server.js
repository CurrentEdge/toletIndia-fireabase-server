import app from "./app.js";
import logger from "./config/logger.js";

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Server is running on http://0.0.0.0:${PORT}`);
});