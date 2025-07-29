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