// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// this practice token has one fixed supply shared as fungible units
contract PracticeToken is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 18;

    // give the complete fixed supply to the account that deploys the contract
    constructor() ERC20("Practice Token", "PTK") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}
