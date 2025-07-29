// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/*
 * 使用 Chainlink 预言机 数据服务 获取价格
 * 大致原理：Data Source --> Data Providers --transmit--> DON聚合 -->  Data Feed Contract --> User Smart Contract
 * 调用过程：Consumer(#sendRequest) <--> Proxy(AggregatorProxy#latestRouddata) <--> Aggregator(OffChainAggregator#Mapping transmission / latestRounddatal)  <-- DON
 */
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";


/** 
 * 众筹需求：
 * 1. 收款：在锁定期内，投资人可以调用收款函数进行筹款, 收款金额折合为USD，不能小于100USD
 * 2. 记录数据：记录投资人和投资金额并且可查看
 * 3. 生产商提款：在锁定期内到达目标值，锁定期之后生产商可以提款
 * 4. 投资人退款：在锁定期内没有达到目标值，在锁定期以后投资人可以退款
 */

contract FundMe {
    // 记录投资人
    mapping (address => uint256) public funderToAmount;
    uint256 constant MINIMUM_VALUE = 100 * 10 ** 18; // 最小限制100U（约为 0.026），按eth价格为3780
    uint256 constant TARGET_VALUE = 200 * 10 ** 18; // 目标值300U（约为 0.053），按eth价格为3780
    AggregatorV3Interface internal dataFeed;
    address public owner; // 管理员
    uint256 public deploymentTimestamp; // 部署时间戳，秒
    uint256 public lockTime; // 锁定时间
    address fundTokenAddr; // erc20 token 地址
    bool public getFundSuccess; // 是否完成提款

    constructor(uint256 _lockTime) {
        // 指定 Sepolia 测试网略
        dataFeed = AggregatorV3Interface(0x694AA1769357215DE4FAC081bf1f309aDC325306);
        owner = msg.sender;
        deploymentTimestamp = blockTime();
        lockTime = _lockTime;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "this function can only be called by owner");
        _;
    }

    modifier windowClosed() {
        require(blockTime() >= deploymentTimestamp + lockTime, "windown is not closed");
        _;
    }

    // 收款函数
    function fund() external payable {
        require(convertEthToUsd(msg.value) >= MINIMUM_VALUE, "Send more ETH");
        require(blockTime() < deploymentTimestamp + lockTime, "windown is closed");

        funderToAmount[msg.sender] += msg.value;
    }

    // 获取 eth/usd 的价格
    function getChainlinkDataFeedLatestAnswer() public view returns (int) {
        // prettier-ignore
        (
            /* uint80 roundId */,
            int256 answer,
            /*uint256 startedAt*/,
            /*uint256 updatedAt*/,
            /*uint80 answeredInRound*/
        ) = dataFeed.latestRoundData();
        return answer;
        // return 374488943145;
    }

    // 指定数量的 eth 转 usd
    function convertEthToUsd(uint256 ethAmount) internal view returns (uint256) {
        // eth 价格 374488943145
        uint256 ethPrice = uint256(getChainlinkDataFeedLatestAnswer());
        return ethAmount * ethPrice / (10 ** 8); // USD的精度为8
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    // 提款
    function getFund() public onlyOwner windowClosed {
        require(convertEthToUsd(address(this).balance) >= TARGET_VALUE, "Target is not reached");
        (bool success, ) = payable(msg.sender).call{value: address(this).balance}("");
        require(success, "transaction fail");
        getFundSuccess = true;
    }

    // 退款
    function refund() public windowClosed {
        require(convertEthToUsd(address(this).balance) < TARGET_VALUE, "Target is reached");
        uint256 sendVal = funderToAmount[msg.sender];
        require(sendVal > 0, "There is no fund for you");
        funderToAmount[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: sendVal}("");
        if (!success) {
            funderToAmount[msg.sender] = sendVal;
        }
        require(success, "transaction fail");
    }

    // 设置 fundToken 合约地址
    function setFundTokenAddr(address _fundTokenAddr) external onlyOwner {
        fundTokenAddr = _fundTokenAddr;
    }
    
    // 设置投资人的金额
    function setFunderToAmount(address _funder, uint256 _amountToUpdater) external {
        require(msg.sender == fundTokenAddr, "you do not have permission to call this function");
        funderToAmount[_funder] = _amountToUpdater;
    }

    function blockTime() view public returns(uint256) {
        return block.timestamp;
    }

    // // 提现
    // function withdraw() external onlyOwner {
    //     (bool success, ) = payable(msg.sender).call{value: address(this).balance}("");
    //     require(success, "transaction fail");
    // }
}