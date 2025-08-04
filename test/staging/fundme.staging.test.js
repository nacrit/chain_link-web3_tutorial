const { ethers, deployments, getNamedAccounts } = require("hardhat")
const { expect } = require("chai");
const { developmentChains, LOCK_TIME } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name) && 
describe("staging test fundme contract", async function() {
    let fundMe, firstAccount;
    beforeEach(async() => {
        await deployments.fixture(["all"]) // 相当于 npx hardhat deploy --tags all
        firstAccount = (await getNamedAccounts()).firstAccount
        const fundMeDeployment = await deployments.get("FundMe")
        fundMe = await ethers.getContractAt("FundMe", fundMeDeployment.address)
    })

    // test fund and getFund successfully
    it("fund and getFund successfully", async function() {
        // 1. 调用fund
        await fundMe.fund({value: ethers.parseEther("0.1")})
        // 2. 等待窗口期
        await new Promise(resolve => setTimeout(resolve, (LOCK_TIME + 5) * 1000))
        // 3. 调用getFund
        // 确保交易写入链上
        const getFundTx = await fundMe.getFund()
        const getFundReceipt = await getFundTx.wait();
        expect(getFundReceipt)
            .to.be.emit(fundMe, "FundWithdrawByOwner")
            .withArgs(ethers.parseEther("0.1"))

    })

    // test fund and refund successfully
    it("fund and refund successfully", async () => {
        await fundMe.fund({value: ethers.parseEther("0.03")})
        await new Promise(resolve => setTimeout(resolve, (LOCK_TIME + 5) * 1000))
        
        // 确保交易写入链上
        const refundReceipt = await (await fundMe.refund()).wait();
        expect(refundReceipt)
            .to.be.emit(fundMe, "RefundByFunder")
            .withArgs(firstAccount, ethers.parseEther("0.03"))
    })

})
