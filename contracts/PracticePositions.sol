// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

// this is a basic erc-1155 exercise, not a gnosis ctf implementation.
contract PracticePositions is ERC1155 {
    uint256 public constant YES = 0;
    uint256 public constant NO = 1;
    uint256 public constant INITIAL_POSITION_SUPPLY = 100;

    // give the deployer an equal learning supply of both position ids.
    constructor() ERC1155("https://example.com/practice-positions/{id}.json") {
        uint256[] memory ids = new uint256[](2);
        ids[0] = YES;
        ids[1] = NO;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = INITIAL_POSITION_SUPPLY;
        amounts[1] = INITIAL_POSITION_SUPPLY;

        _mintBatch(msg.sender, ids, amounts, "");
    }
}
