const { deployments, network } = require("hardhat")
const { LOCK_TIME, developmentChains, networkConfig, CONFIRMATIONS } = require("../helper-hardhat-config")

module.exports = async () => {
    // console.log("this is a deploy function ..")
    // console.log("getNamedAccounts", await getNamedAccounts())
    // console.log("deployments.deploy", deployments.deploy)

    // // 获取账户信息
    const {firstAccount, secondAccount} = await getNamedAccounts()
    // console.log(`firstAccount is ${firstAccount}`)
    // console.log(`secondAccount is ${secondAccount}`)

    let dataFeedAddr;
    if (developmentChains.includes(network.name)) {
        dataFeedAddr = (await deployments.get("MockV3Aggregator")).address
    } else {
        dataFeedAddr = networkConfig[network.config.chainId].ethUsdDataFeed;
    }

    // 部署合约
    const fundMe = await deployments.deploy("FundMe", {
        from: firstAccount,
        args: [LOCK_TIME, dataFeedAddr],
        log: true,
        waitConfirmations: developmentChains.includes(network.name) ? 0 : CONFIRMATIONS
    })
    // remove deployments/sepolia directory or add --reset flag if you redeploy contract

    // 如果是测试网，执行验证合约
    if (hre.network.config.chainId == 11155111 && process.env.ETHERSCAN_API_KEY) {
        await verifyContract(fundMe.address, [LOCK_TIME, dataFeedAddr])
    } else {
        console.log("local network verification skipped ..")
    }
}

// 验证合约
async function verifyContract(contractAddr, args) {
    console.log("Verifying contract ..");
    await hre.run("verify:verify", {
        address: contractAddr,
        constructorArguments: args,
    });
}

// 为了区分执行不同的部署脚本
module.exports.tags = ["all", "fundme"]