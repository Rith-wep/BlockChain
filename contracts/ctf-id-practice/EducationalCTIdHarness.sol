// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EducationalCTIdHelpers} from "./EducationalCTIdHelpers.sol";

// this public harness exposes the learning library to local tests.
contract EducationalCTIdHarness {
    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) external pure returns (bytes32) {
        return EducationalCTIdHelpers.getConditionId(oracle, questionId, outcomeSlotCount);
    }

    function getCollectionId(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256 indexSet
    ) external view returns (bytes32) {
        return EducationalCTIdHelpers.getCollectionId(parentCollectionId, conditionId, indexSet);
    }

    function getPositionId(
        IERC20 collateralToken,
        bytes32 collectionId
    ) external pure returns (uint256) {
        return EducationalCTIdHelpers.getPositionId(collateralToken, collectionId);
    }
}
