// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {LocalCTFAdapter} from "../ctf-adapter/LocalCTFAdapter.sol";

// test-only receiver; never deploy this unrestricted helper to a public network.
contract AdapterReentrancyProbe is ERC1155Holder {
    LocalCTFAdapter public immutable adapter;
    address private oracle;
    bytes32 private questionId;
    uint256 public blockedCalls;

    constructor(LocalCTFAdapter adapterAddress) {
        adapter = adapterAddress;
    }

    // fund this helper first, then split as a contract caller.
    function split(address oracleAddress, bytes32 id, uint256 amount) external {
        oracle = oracleAddress;
        questionId = id;
        require(adapter.collateral().approve(address(adapter), amount));
        adapter.splitBinary(oracleAddress, id, amount);
    }

    // prove later operations still work after the failed nested calls.
    function merge(uint256 amount) external {
        adapter.ctf().setApprovalForAll(address(adapter), true);
        adapter.mergeBinary(oracle, questionId, amount);
    }

    // try all three entry points during the official ctf's outgoing callback.
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public override returns (bytes4) {
        require(msg.sender == address(adapter.ctf()), "unexpected test sender");
        _expectGuard(abi.encodeCall(adapter.splitBinary, (oracle, questionId, 1)));
        _expectGuard(abi.encodeCall(adapter.mergeBinary, (oracle, questionId, 1)));
        _expectGuard(abi.encodeCall(adapter.redeemBinary, (oracle, questionId)));
        return this.onERC1155BatchReceived.selector;
    }

    // check the exact guard error rather than accepting an unrelated revert.
    function _expectGuard(bytes memory callData) private {
        (bool success, bytes memory result) = address(adapter).call(callData);
        require(!success && result.length == 4, "nested call was not guarded");
        require(
            bytes4(result) == bytes4(keccak256("ReentrancyGuardReentrantCall()")),
            "wrong nested failure"
        );
        blockedCalls++;
    }
}
