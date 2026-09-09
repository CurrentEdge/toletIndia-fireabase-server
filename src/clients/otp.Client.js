import "dotenv/config.js"

import axios from "axios";
export const otpClient=axios.create({
    baseURL:process.env.MESSAGE_CENTRAL_BASE_URL,
    timeout:5000,
});