const { DECIMAL, INITIAL_ANSWER, developmentChains } = require("../helper-hardhat-config")

module.exports = async () => {
    if (developmentChains.includes(network.name)) {
        const {firstAccount} = await getNamedAccounts()
        // 部署合约
        await deployments.deploy("MockV3Aggregator", {
            from: firstAccount,
            args: [DECIMAL, INITIAL_ANSWER],
            log: true
        })
    } else {
        console.log("environment is not local, mock contract deploypment is skipped ..")
    }
}

// 为了区分执行不同的部署脚本
module.exports.tags = ["all", "mock"]