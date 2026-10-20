// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// this local token acts only as pretend collateral for the ctf exercise.
contract MockCollateral is ERC20 {
    uint256 public constant INITIAL_SUPPLY = 100 * 10 ** 18;

    // give all mock collateral to the account running the exercise.
    constructor() ERC20("Mock Collateral", "MOCK") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }
}
