const DECIMAL = 8
const INITIAL_ANSWER = 3000 * 10 ** DECIMAL
const developmentChains = ["hardhat", "local"]
const networkConfig = {
    11155111: {
        ethUsdDataFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306"
    },
    
}
const LOCK_TIME = 120
const CONFIRMATIONS = 5

module.exports = {
    DECIMAL, INITIAL_ANSWER,
    developmentChains,
    networkConfig,
    LOCK_TIME,
    CONFIRMATIONS,
}