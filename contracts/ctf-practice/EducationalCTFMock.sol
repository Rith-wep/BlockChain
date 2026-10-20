// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

// this teaching mock copies a small ctf workflow, not the real gnosis ctf
contract EducationalCTFMock is ERC1155 {
    using SafeERC20 for IERC20;

    uint256 public constant YES_POSITION = 0;
    uint256 public constant NO_POSITION = 1;

    IERC20 public immutable collateral;
    address public immutable oracle;

    bool public resolved;
    bool public yesWins;

    error ZeroAmount();
    error OnlyOracle();
    error ConditionAlreadyResolved();
    error ConditionNotResolved();

    // connect one mock collateral token and make the deployer the learning oracle
    constructor(address collateralAddress) ERC1155("") {
        collateral = IERC20(collateralAddress);
        oracle = msg.sender;
    }

    // lock collateral and create equal amounts of yes and no positions
    function splitPosition(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        collateral.safeTransferFrom(msg.sender, address(this), amount);

        uint256[] memory ids = new uint256[](2);
        ids[0] = YES_POSITION;
        ids[1] = NO_POSITION;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount;
        amounts[1] = amount;

        _mintBatch(msg.sender, ids, amounts, "");
    }

    // burn matching yes and no positions and return the same collateral amount
    function mergePositions(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();

        uint256[] memory ids = new uint256[](2);
        ids[0] = YES_POSITION;
        ids[1] = NO_POSITION;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount;
        amounts[1] = amount;

        _burnBatch(msg.sender, ids, amounts);
        collateral.safeTransfer(msg.sender, amount);
    }

    // record which side won; this simplified exercise supports yes or no only
    function reportPayouts(bool didYesWin) external {
        if (msg.sender != oracle) revert OnlyOracle();
        if (resolved) revert ConditionAlreadyResolved();

        resolved = true;
        yesWins = didYesWin;
    }

    // burn both position balances and pay one collateral unit per winning unit
    function redeemPositions() external {
        if (!resolved) revert ConditionNotResolved();

        uint256 yesBalance = balanceOf(msg.sender, YES_POSITION);
        uint256 noBalance = balanceOf(msg.sender, NO_POSITION);
        uint256 payout = yesWins ? yesBalance : noBalance;

        if (yesBalance > 0) _burn(msg.sender, YES_POSITION, yesBalance);
        if (noBalance > 0) _burn(msg.sender, NO_POSITION, noBalance);

        if (payout > 0) collateral.safeTransfer(msg.sender, payout);
    }
}
