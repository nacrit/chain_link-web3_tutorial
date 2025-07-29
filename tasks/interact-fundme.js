const { task } = require("hardhat/config")

task("interact-fundme")
    .addParam("addr", "fundme contract address")
    .setAction(async(taskArgs, hre) => {
        // 加载合约，合约地址从参数中获取
        const fundMeFactory = await ethers.getContractFactory("FundMe")
        const fundMe = fundMeFactory.attach(taskArgs.addr)

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

})


module.exports = {}