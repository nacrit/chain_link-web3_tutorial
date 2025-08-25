# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.

Try running some of the following tasks:

```shell
npm i
npx env-enc set-pw # 或者 ENV_ENC_PASSWORD=your_password npx hardhat test
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.js
```


> 学习文档：[https://github.com/smartcontractkit/Web3_tutorial_Chinese](https://github.com/smartcontractkit/Web3_tutorial_Chinese)

# 一、编写众筹合约和erc20合约
## 1. 编写众筹合约 FundMe.sol
```solidity
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
```

## 2. 编写代币合约(FundToken.sol)，配合众筹合约使用
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./FundMe.sol";

/** 
 * 代币功能:
 * 1. mint: 让 FundMe 的参与者基于 mapping 来领取相应数量的通证
 * 2. transfer: 让 FundMe 的参与者 transfer 通证
 * 3. claim: 用token兑换现实商品，兑换完成以后，需要 burn 通证
 */

contract FundToken is ERC20 {

    FundMe fundMe;

    constructor(address _fundMeAddr) ERC20("Fund Token", "FT") {
        fundMe = FundMe(_fundMeAddr);
    }

    modifier fundmeCompleted() {
        require(fundMe.getFundSuccess(), "This fundme is not completed yet");
        _;
    }

    // 1. mint代币，需要在fundMe中投资后才能操作
    function mint(uint256 _amountToMint) public fundmeCompleted {
        require(fundMe.funderToAmount(msg.sender) >= _amountToMint, "You cannot mint this many tokens");
        _mint(msg.sender, _amountToMint);
        fundMe.setFunderToAmount(msg.sender, fundMe.funderToAmount(msg.sender) - _amountToMint);
    }

    // 3. 用token兑换现实的东西
    function claim(uint256 amountToClaim) external fundmeCompleted {
        require(balanceOf(msg.sender) >= amountToClaim, "You don't have enough ERC20 tokens");
        /** todo add */
        _burn(msg.sender, amountToClaim);
    }
}
```

# 二、使用hardhat框架开发
> 使用remix的问题：
> 1. 难以进行批量部署和测试
> 2. 难以统一版本，看不到版本

## mac 安装 nvm node vscode
```bash
brew update

## 安装nvm
brew install nvm # 安装后 配置环境变量
nvm --version
# 安装 node
nvm install 22 # 安装 node 22.xx 版本
nvm install 18 # 安装 node 18.xx 版本
nvm use 22 # 使用 22 版本
nvm list # 查看安装的版本
node --version # 查看node版本

## 安装 vscode
brew install --cask visual-studio-code
# 安装常用插件
# Solidity and Hardhat support by the Hardhat team
# JavaScript (ES6)

```

## 创建项目、编译和部署合约
### 1. 创建项目
```bash
## 初始化node项目
npm init # 后续一直回车
## 安装hardhat 
npm i hardhat --save-dev

## 初始化hardhat项目
npx hardhat # 后续一直回车
```

### 2. 安装依赖并编译合约
```bash
## 把之前写的 FundMe.sol 和 FundToken.sol 拷贝到 contracts 目录下
# 安装依赖
npm i @chainlink/contracts @openzeppelin/contracts --save-dev
# 编译项目
npx hardhat compile
```

### 3. 部署合约
```js
// 创建部署脚本 scripts/deployFundMe.js
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
}

main().catch((error) => {
    console.error(error);
    process.exitCode(1);
});
```

```bash
## 运行部署合约脚本
npx hardhat run scripts/deployFundMe.js
# 与上面等价：npx hardhat run scripts/deployFundMe.js --network hardhat
```
```js
// 在 hardhat.config.js 文件中 defaultNetwork 默认指定的是 hardhat
module.exports = {
  defaultNetwork: "hardhat", // 这里是默认值，不指定就是 hardhat
  solidity: "0.8.28",
};
```

### 4. 使用 dotenv 写配置文件，在.env文件中添加配置的键值对
```bash
## 安装依赖
npm i -D dotenv
# 配置 .env 文件
SEPOLIA_RPC_URL=sepolia的链接
# 读取配置方式：
require("dotenv").config();
console.log("SEPOLIA_RPC_URL=" + process.env.SEPOLIA_RPC_URL)
```

### 5. 使用 @chainlink/env-enc 对配置信息加密

```bash
## 安装
npm i -D @chainlink/env-enc
# 添加配置，会生成 .env.nec 的加密内容的配置文件，后续.env的文件可以不用了
npx env-enc set-pw # 设置密码，密码存储在当前回话中，可通过 `echo $ENV_ENC_PASSWORD` 查看
npx env-enc set # 设置配置的值
# 生成如下.env.nec的配置
SEPOLIA_RPC_URL: ENCRYPTED|5mX03qRoVRfBl9wdlqS9dnP5yXxPOrcZh1dAtxQSluAlSXGCdqQ8Fst4q8BHXnSlEAgyE1VEDlpNyo5nWx8rI/GJ4eDOZ2OUdGYK60lUsCMrZ7+lf1dTF1TQyXR0+kVqTCVhmgXlC7TrZKbyaN+uGsjdWzMW
PRIVATE_KEY: ENCRYPTED|PPMArMYld15x24r6CdZOSSrIu2aK20dwzZqEJmpEPirl44c4FOQhOTzmVpNYX7PUZQGI93c3jzfoPRz5LFw6uATxG38pL2TiTklsQwa3E/yjmeWm2+erU46w+4uhnrCGFVpCfNWUxM47m6U8PCPB8g==

# 使用方式，创建 scripts/envTest.js
require("@chainlink/env-enc").config();
console.log("ENV_ENC_PASSWORD=" + process.env.ENV_ENC_PASSWORD) // 这里也能查看回话设置的密码，切勿在生产使用
console.log("SEPOLIA_RPC_URL=" + process.env.SEPOLIA_RPC_URL)
# 验证
npx hardhat run scripts/envTest.js
ENV_ENC_PASSWORD=your_password npx hardhat run scripts/envTest.js # 新开回话或者放容器中执行时，可以指定环境变量或添加环境变量执行
```
#### 完整配置文件
```js
require("@nomicfoundation/hardhat-toolbox");
require("@chainlink/env-enc").config();

module.exports = {
  defaultNetwork: "hardhat",
  solidity: "0.8.28",
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      chainId: 11155111,
    },
  },
};
```


## 6. 验证合约
使用hardhat插件: [https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify](https://hardhat.org/hardhat-runner/plugins/nomicfoundation-hardhat-verify)
申请apiKey链接: [https://etherscan.io/apidashboard](https://etherscan.io/apidashboard)
### 1. 配置浏览器 apiKey，hardhat.config.js
```js
module.exports = {
  solidity: "0.8.28",
  networks: ...,
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY
    }
  }
};
```
### 2. 验证合约，将源码发布到浏览器
```bash
npx hardhat verify --network sepolia 0x959A4F755f3a3Fc527D4b0Ba164B4B0f3Ab11090 "300"
```

### 3. 修改之前的部署代码，实现部署并验证合约
```js
...
async function main() {
    ...
       // 如果是测试网，执行验证合约
    if (hre.network.config.chainId == 11155111 && process.env.ETHERSCAN_API_KEY) {
        console.log("Waiting for 5 confirmations ..");
        await fundMe.deploymentTransaction().wait(5);
        await verifyContract(fundMe.target, [300])
    } else {
        console.log("verification skipped ..")
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
...
```

## 7. 操作合约：调用 fund 函数 并验证结果
### 1. 修改配置，再添加一个账户
```js
...
module.exports = {
  ...
  networks: {
    sepolia: {
      ...
      accounts: [process.env.PRIVATE_KEY, process.env.PRIVATE_KEY_1],
      ...
    },
  },
  ...
};

```

### 2. 修改 deployFundMe.js 脚本，添加操作合约代码
```js
async function main() {
    ...

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
```

## 8. 封装task
> 每个 task 可以理解是一个js脚本，通过 `npx hardhat help` 可以查到harthat默认可用的 tasks
### 1. 将部署合约封装一个task，创建 tasks/deploy-fundme.js
```js
const { task } = require("hardhat/config")


task("deploy-fundme", "deploy and verify fundme contract").setAction(async(taskArgs, hre) => {
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
})


// 验证合约
async function verifyContract(contractAddr, args) {
    console.log("Verifying contract ..");
    await hre.run("verify:verify", {
        address: contractAddr,
        constructorArguments: args,
    });
}

module.exports = {}
```

### 2. 在 hardhat.config.js 配置文件引入 task
```js
...
require("./tasks/deploy-fundme")

module.exports = {
	...
};

```

### 3. 使用task
```bash
npx hardhat help # 可以看到 tasks 中有deploy-fundme了
# 使用task部署合约
npx hardhat deploy-fundme --network sepolia
```

### 4. 同样的添加 interact-fundme 的task, tasks/interact-fundme.js
```js
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
```

### 4. 优化task的导出，创建 tasks/index.js
```js
module.deployFundme = require("./deploy-fundme")
module.interactFundme = require("./interact-fundme")
```
#### 调整 hardhat.config.js
```js
require("@nomicfoundation/hardhat-toolbox");
require("@chainlink/env-enc").config();
require("./tasks")

module.exports = {
  defaultNetwork: "hardhat",
  solidity: "0.8.28",
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY, process.env.PRIVATE_KEY_1],
      chainId: 11155111,
    },
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY
    }
  }
};
```

### 5. 执行 interact-fundme
```bash
npx hardhat interact-fundme --addr 0x80b90F1c367aC54770BE5B0996709ea27dbb7B59 --network sepolia
```


## 9. 将代码部署到github上
### 1. 登录github，创建远程仓库

### 2. 初始化本地代码
```bash
# 初始化项目
git init
```
### 3. 将本地代码添加到远程仓库
```bash
# 关联远程仓库
git remote add origin https://github.com/nacrit/chain_link-web3_tutorial.git
# 添加并提交
git add .
git commit -m "lesson4"
git push -u origin master
```

# 三、合约测试
## 1. 测试框架
### mocha、chai介绍
1. [mocha测试框架](https://mochajs.org/)：测试流程组织者
2. [chai断言库](https://www.chaijs.com/)：验证逻辑正确性

> 默认hardhat项目中@nomicfoundation/hardhat-toolbox依赖集成了mocha和chai

## 2. 编写测试用例，test/fundme.test.js
```js
const { ethers } = require("hardhat")
const { assert } = require("chai")

describe("test fundme contract", async function() {
    it("test if the owner is msg.sender", async function() {
        const [firstAccount] = await ethers.getSigners();
        const fundMeFactory = await ethers.getContractFactory("FundMe")
        const fundMe = await fundMeFactory.deploy(300)
        await fundMe.waitForDeployment()
        assert.equal((await fundMe.owner()), firstAccount.address)
    })

    it("test if the datafeed is assigned correctly", async function() {
        const fundMeFactory = await ethers.getContractFactory("FundMe")
        const fundMe = await fundMeFactory.deploy(300)
        await fundMe.waitForDeployment()
        assert.equal((await fundMe.dataFeed()), "0x694AA1769357215DE4FAC081bf1f309aDC325306")
    })
})
```

## 3. 使用 hardhat-deploy 插件
> hardhat-deploy 提供一套工具来管理部署任务，使得部署流程更清晰、可重用且易于维护。
> 解决智能合约部署的复杂性问题
#### 3.1 安装插件
```bash
npm install -D hardhat-deploy

# 配置文件hardhat.config.js加入
require("hardhat-deploy")

# task新增了 deploy
npx hardhat help
```

### 3.2 编写部署脚本，deploy/01-deploy- fundme.js
```js
module.exports = async ({deployments}) => {
    console.log("this is a deploy function ..")
    console.log("getNamedAccounts", await getNamedAccounts())
    console.log("deployments.deploy", deployments.deploy)

    // 获取账户信息
    const {firstAccount, secondAccount} = await getNamedAccounts()
    console.log(`firstAccount is ${firstAccount}`)
    console.log(`secondAccount is ${secondAccount}`)

    // 部署合约
    await deployments.deploy("FundMe", {
        from: firstAccount,
        args: [300],
        log: true
    })
}

// 为了区分执行不同的部署脚本
module.exports.tags = ["all", "fundme"]
```
### 3.3 调整配置文件, 自定义账户名和对应的索引
```js
...

module.exports = {
  ...
  
  namedAccounts: {
    firstAccount: {
      default: 0
    },
    secondAccount: {
      default: 1
    },
  }
};
```
### 3.4 执行部署合约
```bash
$ npx hardhat deploy

$ npx hardhat deploy --tags hello
Nothing to compile

$ npx hardhat deploy --tags all # 或 npx hardhat deploy --tags fundme
Nothing to compile
this is a deploy function ..
getNamedAccounts {
  firstAccount: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  secondAccount: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
}
deployments.deploy [AsyncFunction: deploy]
firstAccount is 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
secondAccount is 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
deploying "FundMe" (tx: 0x03af227e8fe4815af4cbe76c2cc7bce1d45a26fead64b442c07264d434de0326)...: deployed at 0x5FbDB2315678afecb367f032d93F642f64180aa3 with 1313799 gas
```

## 4. 优化单元测试代码， test/fundme.test.js
```js
// const { ethers, deployments, getNamedAccounts } = require("hardhat")
const { assert } = require("chai")

describe("test fundme contract", async function() {
    let fundMe, firstAccount;
    this.beforeEach(async() => {
        await deployments.fixture(["all"]) // 相当于 npx hardhat deploy --tags all
        firstAccount = (await getNamedAccounts()).firstAccount
        const fundMeDeployment = await deployments.get("FundMe")
        fundMe = await ethers.getContractAt("FundMe", fundMeDeployment.address)
    })

    it("test if the owner is msg.sender", async function() {
        await fundMe.waitForDeployment()
        assert.equal((await fundMe.owner()), firstAccount)
    })

    it("test if the datafeed is assigned correctly", async function() {
        await fundMe.waitForDeployment()
        assert.equal((await fundMe.dataFeed()), "0x694AA1769357215DE4FAC081bf1f309aDC325306")
    })
})
```


## 5. 使用mock合约 模拟合约
> 模拟合约：[https://ethereum.org/zh/developers/tutorials/how-to-mock-solidity-contracts-for-testing/](https://ethereum.org/zh/developers/tutorials/how-to-mock-solidity-contracts-for-testing/)

### 1. 添加mock合约  contracts/mocks/MockV3Aggregator.sol
```js
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@chainlink/contracts/src/v0.8/shared/mocks/MockV3Aggregator.sol";
```
### 2. 编写部署mock合约脚本 deploy/00-deploy-mock.js
```js
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
```
#### 添加配置文件 helper-hardhat-config.js
```js
const DECIMAL = 8
const INITIAL_ANSWER = 3800 * 10 ** DECIMAL
const developmentChains = ["hardhat", "local"]
const networkConfig = {
    11155111: {
        ethUsdDataFeed: "0x694AA1769357215DE4FAC081bf1f309aDC325306"
    },
    
}
const LOCK_TIME = 300
const CONFIRMATIONS = 5

module.exports = {
    DECIMAL, INITIAL_ANSWER,
    developmentChains,
    networkConfig,
    LOCK_TIME,
    CONFIRMATIONS,
}
```
### 3. 修改FundMe合约， contracts/FundMe.sol
```js
// contracts/FundMe.sol
...
contract FundMe {
    ...
    constructor(uint256 _lockTime, address _dataFeedAddr) {
        ...
        dataFeed = AggregatorV3Interface(_dataFeedAddr);
        ...
    }
    ...
}
```
### 4. 修改部署脚本 deploy/01-deploy-fundme.js
```js
const { deployments, network } = require("hardhat")
const { LOCK_TIME, developmentChains, networkConfig, CONFIRMATIONS } = require("../helper-hardhat-config")

module.exports = async () => {
   
    // // 获取账户信息
    const {firstAccount, secondAccount} = await getNamedAccounts()
    
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
    // remove deployment directory or add --reset flag if you redeploy contract

    // 如果是测试网，执行验证合约
    if (hre.network.config.chainId == 11155111 && process.env.ETHERSCAN_API_KEY) {
        await verifyContract(fundMe.address, [LOCK_TIME, dataFeedAddr])
    } else {
        console.log("verification skipped ..")
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
```

### 5. 执行部署脚本
```bash
# 本地部署
npx hardhat deploy

# 部署到sepolia测试网
npx hardhat deploy --network sepolia
# 值得注意的是，部署后本地会有缓存(deployments/sepolia)，再次部署还会用之前的合约，如果想重新部署 可以删除文件夹 或者 加上 --rest 参数
npx hardhat deploy --network sepolia --reset
```


### 6. 完善测试脚本 test/fundme.test.js
```js
const { ethers, deployments, getNamedAccounts } = require("hardhat")
const { assert, expect } = require("chai");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");
const helpers = require("@nomicfoundation/hardhat-network-helpers")

developmentChains.includes(network.name) && describe("test fundme contract", async function() {
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
```

#### 安装ethers.getContract锁缺失依赖
```bash
# https://github.com/wighawag/hardhat-deploy-ethers#readme
npm install --save-dev @nomicfoundation/hardhat-ethers ethers hardhat-deploy hardhat-deploy-ethers
# 如果上面有兼容性问题，可以卸载重新安装
npm uninstall @nomicfoundation/hardhat-ethers ethers hardhat-deploy hardhat-deploy-ethers
# 替代方案：使用 `--legacy-peer-deps` 标志
npm install -D --legacy-peer-deps @nomicfoundation/hardhat-ethers ethers hardhat-deploy hardhat-deploy-ethers
```
#### hardhat.config.js中引入依赖
```js
...
require("@nomicfoundation/hardhat-ethers");
require("hardhat-deploy");
require("hardhat-deploy-ethers");
...
```
#### 调整 contracts/FundMe.sol 代码
```js
...
contract FundMe {
    ...

    event FundWithdrawByOwner(uint256);
    event RefundByFunder(address, uint256);

    ...

    // 提款
    function getFund() public onlyOwner windowClosed {
        uint256 val = address(this).balance;
        require(convertEthToUsd(val) >= TARGET_VALUE, "Target is not reached");
        (bool success, ) = payable(msg.sender).call{value: val}("");
        require(success, "transaction fail");
        getFundSuccess = true;
        emit FundWithdrawByOwner(val);
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
        emit RefundByFunder(msg.sender, sendVal);
    }

    ...
}
```


### 7. 集成测试
#### 7.1 编写集成测试代码  test/staging/fundme.staging.test.js
```js
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

```

#### 7.2 修改配置文件中测试超时时间 hardhat.config.js
```js
...
module.exports = {
  defaultNetwork: "hardhat",
  solidity: "0.8.28",
  mocha: {
    timeout: 300 * 1000
  },
  ...
};
```

### 8. 测试工具 gas消耗预估、代码覆盖率
#### 8.1 gas消耗预估 hardhat-gas-reporter
```bash
# 安装
npm i -D hardhat-gas-reporter

# 测试会显示gas消耗的表格
npx hardhat test

# 开关配置 hardhat.config.js
...
module.exports = {
  ...
  gasReporter: {
    enabled: false
  }
};
```

#### 8.2 代码覆盖率 tasks --> coverage
```bash
## 执行 coverage 任务会进行测试，并检查合约的覆盖率
npx hardhat coverage
```