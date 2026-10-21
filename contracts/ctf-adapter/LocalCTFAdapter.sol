// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC1155Holder} from "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IConditionalTokens} from "./IConditionalTokens.sol";

// this local learning adapter supports one collateral and root binary conditions.
contract LocalCTFAdapter is ERC1155Holder, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum IncomingOperation {
        None,
        Split,
        Merge,
        Redeem
    }

    bytes32 public constant ROOT_COLLECTION = bytes32(0);
    uint256 public constant YES_INDEX_SET = 1;
    uint256 public constant NO_INDEX_SET = 2;

    IConditionalTokens public immutable ctf;
    IERC20 public immutable collateral;

    IncomingOperation private _incomingOperation;
    address private _incomingFrom;
    uint256 private _incomingYesPositionId;
    uint256 private _incomingNoPositionId;
    uint256 private _incomingYesAmount;
    uint256 private _incomingNoAmount;
    bool private _incomingReceiptConsumed;

    error ZeroAddress();
    error AddressHasNoCode(address account);
    error ZeroAmount();
    error InvalidBinaryCondition(bytes32 conditionId, uint256 outcomeSlotCount);
    error AdapterAlreadyHoldsPosition(uint256 positionId, uint256 balance);
    error NoPositionsToRedeem();
    error UnexpectedERC1155Receipt();
    error ExpectedERC1155ReceiptMissing();

    event BinaryPositionSplit(
        address indexed user,
        bytes32 indexed conditionId,
        uint256 amount,
        uint256 yesPositionId,
        uint256 noPositionId
    );
    event BinaryPositionsMerged(
        address indexed user,
        bytes32 indexed conditionId,
        uint256 amount
    );
    event BinaryPositionsRedeemed(
        address indexed user,
        bytes32 indexed conditionId,
        uint256 collateralPayout
    );

    // save the actual ctf and collateral addresses after basic safety checks.
    constructor(address ctfAddress, address collateralAddress) {
        if (ctfAddress == address(0) || collateralAddress == address(0)) {
            revert ZeroAddress();
        }
        if (ctfAddress.code.length == 0) revert AddressHasNoCode(ctfAddress);
        if (collateralAddress.code.length == 0) revert AddressHasNoCode(collateralAddress);

        ctf = IConditionalTokens(ctfAddress);
        collateral = IERC20(collateralAddress);
    }

    // ask the actual ctf contract to calculate the verified official condition id.
    function getBinaryConditionId(
        address oracle,
        bytes32 questionId
    ) public view returns (bytes32) {
        return ctf.getConditionId(oracle, questionId, 2);
    }

    // return the official yes/no collection and collateral-backed position ids.
    function getBinaryPositionIds(
        address oracle,
        bytes32 questionId
    ) public view returns (
        bytes32 conditionId,
        bytes32 yesCollectionId,
        bytes32 noCollectionId,
        uint256 yesPositionId,
        uint256 noPositionId
    ) {
        conditionId = getBinaryConditionId(oracle, questionId);
        yesCollectionId = ctf.getCollectionId(ROOT_COLLECTION, conditionId, YES_INDEX_SET);
        noCollectionId = ctf.getCollectionId(ROOT_COLLECTION, conditionId, NO_INDEX_SET);
        yesPositionId = ctf.getPositionId(collateral, yesCollectionId);
        noPositionId = ctf.getPositionId(collateral, noCollectionId);
    }

    // reject single-token receipts; adapter operations only receive CTF batches.
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public pure override returns (bytes4) {
        revert UnexpectedERC1155Receipt();
    }

    // accept one exact CTF batch only while its matching adapter operation is running.
    function onERC1155BatchReceived(
        address operator,
        address from,
        uint256[] memory ids,
        uint256[] memory amounts,
        bytes memory data
    ) public override returns (bytes4) {
        if (
            msg.sender != address(ctf) ||
            _incomingOperation == IncomingOperation.None ||
            _incomingReceiptConsumed ||
            operator != address(this) ||
            from != _incomingFrom ||
            ids.length != 2 ||
            amounts.length != 2 ||
            ids[0] != _incomingYesPositionId ||
            ids[1] != _incomingNoPositionId ||
            amounts[0] != _incomingYesAmount ||
            amounts[1] != _incomingNoAmount ||
            data.length != 0
        ) {
            revert UnexpectedERC1155Receipt();
        }

        if (
            (_incomingOperation == IncomingOperation.Split && from != address(0)) ||
            (_incomingOperation != IncomingOperation.Split && from == address(0))
        ) {
            revert UnexpectedERC1155Receipt();
        }

        // consume the permission before returning so a repeated callback cannot reuse it.
        _incomingReceiptConsumed = true;
        _incomingOperation = IncomingOperation.None;
        return this.onERC1155BatchReceived.selector;
    }

    // pull approved collateral, split it in ctf, then send both outcomes to the user.
    function splitBinary(
        address oracle,
        bytes32 questionId,
        uint256 amount
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        (
            bytes32 conditionId,
            ,
            ,
            uint256 yesPositionId,
            uint256 noPositionId
        ) = getBinaryPositionIds(oracle, questionId);
        _requireBinaryCondition(conditionId);
        _requireEmptyAdapterBalances(yesPositionId, noPositionId);

        collateral.safeTransferFrom(msg.sender, address(this), amount);
        collateral.forceApprove(address(ctf), amount);

        uint256[] memory partition = _binaryIndexSets();
        uint256[] memory positionIds = _positionIds(yesPositionId, noPositionId);
        uint256[] memory amounts = _equalAmounts(amount);

        _expectPositionBatch(
            IncomingOperation.Split,
            address(0),
            yesPositionId,
            noPositionId,
            amount,
            amount
        );
        ctf.splitPosition(collateral, ROOT_COLLECTION, conditionId, partition, amount);
        _finishExpectedPositionBatch();
        collateral.forceApprove(address(ctf), 0);

        ctf.safeBatchTransferFrom(
            address(this),
            msg.sender,
            positionIds,
            amounts,
            ""
        );

        emit BinaryPositionSplit(
            msg.sender,
            conditionId,
            amount,
            yesPositionId,
            noPositionId
        );
    }

    // pull one matching yes/no pair, merge it, and send collateral to the user.
    function mergeBinary(
        address oracle,
        bytes32 questionId,
        uint256 amount
    ) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        (
            bytes32 conditionId,
            ,
            ,
            uint256 yesPositionId,
            uint256 noPositionId
        ) = getBinaryPositionIds(oracle, questionId);
        _requireBinaryCondition(conditionId);
        _requireEmptyAdapterBalances(yesPositionId, noPositionId);

        uint256[] memory partition = _binaryIndexSets();
        uint256[] memory positionIds = _positionIds(yesPositionId, noPositionId);
        uint256[] memory amounts = _equalAmounts(amount);

        _expectPositionBatch(
            IncomingOperation.Merge,
            msg.sender,
            yesPositionId,
            noPositionId,
            amount,
            amount
        );
        ctf.safeBatchTransferFrom(msg.sender, address(this), positionIds, amounts, "");
        _finishExpectedPositionBatch();

        ctf.mergePositions(collateral, ROOT_COLLECTION, conditionId, partition, amount);
        collateral.safeTransfer(msg.sender, amount);

        emit BinaryPositionsMerged(msg.sender, conditionId, amount);
    }

    // pull all yes/no balances, redeem through ctf, and send the payout to the user.
    function redeemBinary(
        address oracle,
        bytes32 questionId
    ) external nonReentrant returns (uint256 payout) {
        (
            bytes32 conditionId,
            ,
            ,
            uint256 yesPositionId,
            uint256 noPositionId
        ) = getBinaryPositionIds(oracle, questionId);
        _requireBinaryCondition(conditionId);
        _requireEmptyAdapterBalances(yesPositionId, noPositionId);

        uint256 yesBalance = ctf.balanceOf(msg.sender, yesPositionId);
        uint256 noBalance = ctf.balanceOf(msg.sender, noPositionId);
        if (yesBalance == 0 && noBalance == 0) revert NoPositionsToRedeem();

        uint256[] memory indexSets = _binaryIndexSets();
        uint256[] memory positionIds = _positionIds(yesPositionId, noPositionId);
        uint256[] memory balances = new uint256[](2);
        balances[0] = yesBalance;
        balances[1] = noBalance;

        _expectPositionBatch(
            IncomingOperation.Redeem,
            msg.sender,
            yesPositionId,
            noPositionId,
            yesBalance,
            noBalance
        );
        ctf.safeBatchTransferFrom(msg.sender, address(this), positionIds, balances, "");
        _finishExpectedPositionBatch();

        uint256 collateralBefore = collateral.balanceOf(address(this));
        ctf.redeemPositions(collateral, ROOT_COLLECTION, conditionId, indexSets);
        payout = collateral.balanceOf(address(this)) - collateralBefore;

        if (payout > 0) collateral.safeTransfer(msg.sender, payout);

        emit BinaryPositionsRedeemed(msg.sender, conditionId, payout);
    }

    function _requireBinaryCondition(bytes32 conditionId) private view {
        uint256 count = ctf.getOutcomeSlotCount(conditionId);
        if (count != 2) revert InvalidBinaryCondition(conditionId, count);
    }

    function _expectPositionBatch(
        IncomingOperation operation,
        address from,
        uint256 yesPositionId,
        uint256 noPositionId,
        uint256 yesAmount,
        uint256 noAmount
    ) private {
        if (_incomingOperation != IncomingOperation.None || _incomingReceiptConsumed) {
            revert UnexpectedERC1155Receipt();
        }

        _incomingOperation = operation;
        _incomingFrom = from;
        _incomingYesPositionId = yesPositionId;
        _incomingNoPositionId = noPositionId;
        _incomingYesAmount = yesAmount;
        _incomingNoAmount = noAmount;
    }

    function _finishExpectedPositionBatch() private {
        if (!_incomingReceiptConsumed || _incomingOperation != IncomingOperation.None) {
            revert ExpectedERC1155ReceiptMissing();
        }

        _incomingFrom = address(0);
        _incomingYesPositionId = 0;
        _incomingNoPositionId = 0;
        _incomingYesAmount = 0;
        _incomingNoAmount = 0;
        _incomingReceiptConsumed = false;
    }

    function _requireEmptyAdapterBalances(
        uint256 yesPositionId,
        uint256 noPositionId
    ) private view {
        uint256 yesBalance = ctf.balanceOf(address(this), yesPositionId);
        if (yesBalance != 0) {
            revert AdapterAlreadyHoldsPosition(yesPositionId, yesBalance);
        }

        uint256 noBalance = ctf.balanceOf(address(this), noPositionId);
        if (noBalance != 0) {
            revert AdapterAlreadyHoldsPosition(noPositionId, noBalance);
        }
    }

    function _binaryIndexSets() private pure returns (uint256[] memory values) {
        values = new uint256[](2);
        values[0] = YES_INDEX_SET;
        values[1] = NO_INDEX_SET;
    }

    function _equalAmounts(
        uint256 amount
    ) private pure returns (uint256[] memory values) {
        values = new uint256[](2);
        values[0] = amount;
        values[1] = amount;
    }

    function _positionIds(
        uint256 yesPositionId,
        uint256 noPositionId
    ) private pure returns (uint256[] memory values) {
        values = new uint256[](2);
        values[0] = yesPositionId;
        values[1] = noPositionId;
    }
}
