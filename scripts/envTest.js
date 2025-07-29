// require("dotenv").config();
require("@chainlink/env-enc").config();
console.log("ENV_ENC_PASSWORD=" + process.env.ENV_ENC_PASSWORD)
console.log("SEPOLIA_RPC_URL=" + process.env.SEPOLIA_RPC_URL)