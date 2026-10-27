// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.34;

// small ABI views for the pinned provider's public configuration.
interface IUmaConfiguration {
    function finder() external view returns (address);
}

interface IUmaFinder {
    function getImplementationAddress(bytes32 name) external view returns (address);
}

interface IUmaCurrencyWhitelist {
    function isOnWhitelist(address currency) external view returns (bool);
}

interface IUmaIdentifierWhitelist {
    function isIdentifierSupported(bytes32 identifier) external view returns (bool);
}

interface ICTFResolution {
    function prepareCondition(address oracle, bytes32 questionId, uint256 slots) external;
    function getConditionId(address oracle, bytes32 questionId, uint256 slots) external pure returns (bytes32);
    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint256);
    function payoutDenominator(bytes32 conditionId) external view returns (uint256);
    function payoutNumerators(bytes32 conditionId, uint256 index) external view returns (uint256);
    function reportPayouts(bytes32 questionId, uint256[] calldata payouts) external;
}
