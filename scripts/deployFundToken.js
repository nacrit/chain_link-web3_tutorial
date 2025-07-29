// 引入 ethers
const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("deploying contracts with the account " + deployer.address);

    // 获取合约
    const FundMeFactory = await ethers.getContractFactory("FundMe");
    console.log("contract deploying ..")
    // 部署合约
    const fundMe = await FundMeFactory.deploy(300);
    await fundMe.waitForDeployment();

    console.log("FundMe has been deployed successfully, contract address is " + fundMe.target);

    // 如果是测试网，执行验证合约
    if (hre.network.config.chainId == 11155111 && process.env.ETHERSCAN_API_KEY) {
        console.log("Waiting for 5 confirmations ..");
        await fundMe.deploymentTransaction().wait(5);
        await verifyContract(fundMe.target, [300])
    } else {
        console.log("verification skipped ..")
    }
}

async function verifyContract(contractAddr, args) {
    console.log("Verifying contract ..");
    await hre.run("verify:verify", {
        address: contractAddr,
        constructorArguments: args,
    });
}

main().catch((error) => {
    console.error(error);
    process.exitCode(1);
});