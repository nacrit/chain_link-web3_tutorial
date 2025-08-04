const { ethers, deployments, getNamedAccounts } = require("hardhat")
const { assert, expect } = require("chai");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");
const helpers = require("@nomicfoundation/hardhat-network-helpers")

developmentChains.includes(network.name) && 
describe("unit test fundme contract", async function() {
    let fundMe, fundMeSecondAccount, firstAccount, secondAccount, mockV3AggregatorAddr;
    beforeEach(async() => {
        // console.log("start beforeEach ...........................................")
        await deployments.fixture(["all"]) // 相当于 npx hardhat deploy --tags all
        firstAccount = (await getNamedAccounts()).firstAccount
        secondAccount = (await getNamedAccounts()).secondAccount
        const fundMeDeployment = await deployments.get("FundMe")
        fundMe = await ethers.getContractAt("FundMe", fundMeDeployment.address)
        mockV3AggregatorAddr = (await deployments.get("MockV3Aggregator")).address
        // 第二个账户操作合约的对象 如 fundMeSecondAccount.fund 相当于第二个账户 调用 fundMe 的 fund 函数
        fundMeSecondAccount = await ethers.getContract("FundMe", secondAccount)
    })

    it("test if the owner is msg.sender", async function() {
        await fundMe.waitForDeployment()
        assert.equal(await fundMe.owner(), firstAccount)
    })

    it("test if the datafeed is assigned correctly", async function() {
        await fundMe.waitForDeployment()
        let dataFeedAddr;
        if (developmentChains.includes(network.name)) {
            dataFeedAddr = (await deployments.get("MockV3Aggregator")).address
        } else {
            dataFeedAddr = networkConfig[network.config.chainId].ethUsdDataFeed;
        }
        assert.equal(await fundMe.dataFeed(), mockV3AggregatorAddr)
    })

    // unit test for fund
    it("window closed, value grater than minimum, fund failed", async() => {
        await windowClose()
        await expect(fundMe.fund({value: ethers.parseEther("0.1")}))
            .to.be.revertedWith("windown is closed")
    })

    it("window open, value is less than minimum, fund failed", async() => {
        await expect(fundMe.fund({value: ethers.parseEther("0.01")}))
            .to.be.revertedWith("Send more ETH")
    })

    it("window open, value is greater than minimum, fund success", async() => {
        await fundMe.fund({value: ethers.parseEther("0.1")})
        const fundMeBal = await ethers.provider.getBalance(fundMe.target)
        assert.equal(fundMeBal, ethers.parseEther("0.1"))
        const balance = await fundMe.funderToAmount(firstAccount)
        expect(balance).to.equal(ethers.parseEther("0.1"))
    })

    // unit test for getFund
    // onlyOwner, windowClose, target reached
    it("not owner, window closed, target reached, getFund failed", async() => {
        const secondSigner = (await ethers.getSigners())[1]
        await fundMe.fund({value: ethers.parseEther("1")})

        await windowClose()

        // 以下两个操作是等价的
        await expect(fundMe.connect(secondSigner).getFund())
            .to.revertedWith("this function can only be called by owner")
        await expect(fundMeSecondAccount.getFund())
            .to.revertedWith("this function can only be called by owner")
    })

    it("window open, target reached, getFund failed", async() => {
        await fundMe.fund({value: ethers.parseEther("1")})
        await expect(fundMe.getFund())
            .to.revertedWith("windown is not closed")
    })
    
    it("window closed, target isn't reached, getFund failed", async() => {
        await fundMe.fund({value: ethers.parseEther("0.05")})
        await windowClose()
        await expect(fundMe.getFund())
            .to.revertedWith("Target is not reached")
    })

    it("window closed, target reached, getFund success", async() => {
        await fundMe.fund({value: ethers.parseEther("1")})
        await windowClose()
        await expect(fundMe.getFund())
            .to.emit(fundMe, "FundWithdrawByOwner").withArgs(ethers.parseEther("1"))
    })

    // test for refund
    // window closed, target not reached, funder has balance
    it("window open, target not reached, funder has balance", async() => {
        await fundMe.fund({value: ethers.parseEther("0.05")})
        await expect(fundMe.refund())
            .to.revertedWith("windown is not closed")
    })

    it("window close, target reached, funder has balance", async() => {
        await fundMe.fund({value: ethers.parseEther("1")})
        await windowClose()
        await expect(fundMe.refund())
            .to.revertedWith("Target is reached")
    })
    
    it("window close, target not reached, funder not has balance", async() => {
        await fundMe.fund({value: ethers.parseEther("0.05")})
        await windowClose()
        await expect(fundMeSecondAccount.refund())
            .to.revertedWith("There is no fund for you")
    })

    it("window close, target not reached, funder has balance", async() => {
        await fundMe.fund({value: ethers.parseEther("0.05")})
        await windowClose()
        await expect(fundMe.refund())
            .to.emit(fundMe, "RefundByFunder").withArgs(firstAccount, ethers.parseEther("0.05"))
    })

})

async function windowClose() {
    await helpers.time.increase(500)
    await helpers.mine()
}