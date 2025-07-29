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



    /// 操作合约：调用 fund 函数 并验证结果
    // 获取两个账户
    const [firstAccount, secondAccount] = await ethers.getSigners();
    console.log("first account address is " + firstAccount.address);
    console.log("second account address is " + secondAccount.address);

    // 第一个账户调用fundMe的fund方法
    const fundTx = await fundMe.fund({ value: ethers.parseEther("0.03") });
    await fundTx.wait();
    // 检查合约余额
    const balanceOfContract = await ethers.provider.getBalance(fundMe.target);
    console.log(`balance of the contract is ${balanceOfContract}`)

    // 第二账户调用fundMe的fund方法
    const fundTxWithSecondAccount = await fundMe.connect(secondAccount).fund({ value: ethers.parseEther("0.0299") });
    await fundTxWithSecondAccount.wait();
    // 检查合约余额
    const balanceOfContractAfterSecondFund = await ethers.provider.getBalance(fundMe.target);
    console.log(`balance of the contract is ${balanceOfContractAfterSecondFund}`);

    // 检查合约中两个账户的 mapping数据
    console.log(`balance of first account ${firstAccount.address} is ${await fundMe.funderToAmount(firstAccount.address)}`);
    console.log(`balance of second account ${secondAccount.address} is ${await fundMe.funderToAmount(secondAccount.address)}`);

}

// 验证合约
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