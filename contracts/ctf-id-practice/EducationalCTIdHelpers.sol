// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// this learning library matches official root-level ctf id calculations.
// it is not an audited replacement for the official gnosis ctf helper library.
library EducationalCTIdHelpers {
    uint256 private constant P =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;
    uint256 private constant B = 3;
    uint256 private constant SQRT_EXPONENT = (P + 1) / 4;

    error UnsupportedParentCollection();
    error ModExpFailed();

    // hash the oracle, question id, and outcome count with official packed types.
    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint256 outcomeSlotCount
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    // map a root outcome collection onto the same compressed bn254 curve point.
    function getCollectionId(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256 indexSet
    ) internal view returns (bytes32) {
        if (parentCollectionId != bytes32(0)) revert UnsupportedParentCollection();

        uint256 x = uint256(keccak256(abi.encodePacked(conditionId, indexSet)));
        bool odd = x >> 255 != 0;
        uint256 y;
        uint256 yy;

        do {
            x = addmod(x, 1, P);
            yy = addmod(mulmod(x, mulmod(x, x, P), P), B, P);
            y = _sqrt(yy);
        } while (mulmod(y, y, P) != yy);

        if ((odd && y % 2 == 0) || (!odd && y % 2 == 1)) {
            y = P - y;
        }

        if (y % 2 == 1) {
            x ^= uint256(1) << 254;
        }

        return bytes32(x);
    }

    // hash the collateral address with the collection id to make an erc-1155 id.
    function getPositionId(
        IERC20 collateralToken,
        bytes32 collectionId
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collateralToken, collectionId)));
    }

    // use the evm modular-exponentiation precompile to find a field square root.
    function _sqrt(uint256 value) private view returns (uint256 result) {
        bytes memory input = abi.encode(
            uint256(32),
            uint256(32),
            uint256(32),
            value,
            SQRT_EXPONENT,
            P
        );

        (bool success, bytes memory output) = address(5).staticcall(input);
        if (!success || output.length != 32) revert ModExpFailed();

        result = abi.decode(output, (uint256));
    }
}
