// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.34;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OptimisticOracleV3Interface as IOO} from "../uma-oracle/vendor/OptimisticOracleV3Interface.sol";
import {OptimisticOracleV3CallbackRecipientInterface as ICallback} from "../uma-oracle/vendor/OptimisticOracleV3CallbackRecipientInterface.sol";

// unrestricted local fixtures, NOT UMA implementations or public deployment targets.
contract TestUmaBondToken is ERC20 {
    address public hookTarget;
    bytes public hookData;
    bool public hookSucceeded;
    bytes public hookResult;
    bool private inHook;
    uint256 public transferFee;

    constructor() ERC20("Test UMA bond", "TUB") { _mint(msg.sender, 10_000_000_000); }
    function decimals() public pure override returns (uint8) { return 6; }
    function setHook(address target, bytes calldata data) external { hookTarget = target; hookData = data; }
    function setTransferFee(uint256 value) external { transferFee = value; }
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (from != address(0) && to != address(0) && transferFee != 0) super._update(to, address(0), transferFee);
        if (hookTarget != address(0) && !inHook) {
            inHook = true;
            (hookSucceeded, hookResult) = hookTarget.call(hookData);
            inHook = false;
        }
    }
}

contract TestUmaOracle {
    mapping(bytes32 => IOO.Assertion) private assertions;
    mapping(bytes32 => bool) public arbitrationReady;
    mapping(bytes32 => bool) public arbitrationResult;
    mapping(address => bool) public currencies;
    bool public identifierSupported = true;
    uint256 public minimumBond = 400_000_000;
    uint256 public nextMinimumBond = 400_000_000;
    uint256 private nonce;
    bytes32 public forcedId;
    bool public earlyCallback;
    bool public wrongRecipient;
    bytes public lastClaim;

    function finder() external view returns (address) { return address(this); }
    function getImplementationAddress(bytes32) external view returns (address) { return address(this); }
    function isOnWhitelist(address currency) external view returns (bool) { return currencies[currency]; }
    function isIdentifierSupported(bytes32 id) external view returns (bool) { return identifierSupported && id == bytes32("ASSERT_TRUTH"); }
    function configure(address token, bool supported, bool identifierOk, uint256 minimum) external {
        currencies[token] = supported; identifierSupported = identifierOk;
        minimumBond = minimum; nextMinimumBond = minimum;
    }
    function setNextMinimum(uint256 value) external { nextMinimumBond = value; }
    function syncUmaParams(bytes32, address) external { minimumBond = nextMinimumBond; }
    function getMinimumBond(address) external view returns (uint256) { return minimumBond; }
    function setFaults(bytes32 id, bool early, bool wrong) external { forcedId = id; earlyCallback = early; wrongRecipient = wrong; }
    function getAssertion(bytes32 id) external view returns (IOO.Assertion memory) { return assertions[id]; }
    function getAssertionResult(bytes32 id) external view returns (bool) {
        require(assertions[id].settled, "not settled"); return assertions[id].settlementResolution;
    }

    function assertTruth(bytes memory claim, address asserter, address recipient, address manager, uint64 liveness, IERC20 currency, uint256 bond, bytes32 identifier, bytes32 domainId) external returns (bytes32 id) {
        require(currencies[address(currency)] && identifierSupported && bond >= minimumBond, "invalid provider inputs");
        id = forcedId == bytes32(0) ? keccak256(abi.encode(address(this), ++nonce)) : forcedId;
        IOO.Assertion storage a = assertions[id];
        a.escalationManagerSettings = IOO.EscalationManagerSettings(false, false, false, msg.sender, manager);
        a.asserter = asserter;
        a.assertionTime = uint64(block.timestamp);
        a.expirationTime = uint64(block.timestamp) + liveness;
        a.currency = currency; a.bond = bond; a.identifier = identifier; a.domainId = domainId;
        a.callbackRecipient = wrongRecipient ? address(0) : recipient;
        lastClaim = claim;
        require(currency.transferFrom(msg.sender, address(this), bond));
        if (earlyCallback) ICallback(recipient).assertionResolvedCallback(id, true);
    }

    function disputeAssertion(bytes32 id, address disputer) external {
        IOO.Assertion storage a = assertions[id];
        require(a.asserter != address(0) && !a.settled && a.disputer == address(0) && block.timestamp < a.expirationTime, "not disputable");
        a.disputer = disputer;
        require(a.currency.transferFrom(msg.sender, address(this), a.bond));
        ICallback(a.callbackRecipient).assertionDisputedCallback(id);
    }

    // local arbitration switch, never evidence of live Sepolia DVM support.
    function setArbitration(bytes32 id, bool result) external { arbitrationReady[id] = true; arbitrationResult[id] = result; }
    function settleAssertion(bytes32 id) external {
        IOO.Assertion storage a = assertions[id];
        require(a.asserter != address(0) && !a.settled, "not pending");
        if (a.disputer == address(0)) require(block.timestamp >= a.expirationTime, "not expired");
        else require(arbitrationReady[id], "dispute unresolved");
        bool truthful = a.disputer == address(0) || arbitrationResult[id];
        a.settled = true; a.settlementResolution = truthful;
        uint256 refund = a.disputer == address(0) ? a.bond : a.bond * 3 / 2;
        require(a.currency.transfer(truthful ? a.asserter : a.disputer, refund));
        // the retained half-bond models a provider fee, not bridge custody.
        ICallback(a.callbackRecipient).assertionResolvedCallback(id, truthful);
    }
    function notifyResolved(address recipient, bytes32 id, bool truthful) external { ICallback(recipient).assertionResolvedCallback(id, truthful); }
    function notifyDisputed(address recipient, bytes32 id) external { ICallback(recipient).assertionDisputedCallback(id); }
    function corruptRecipient(bytes32 id, address recipient) external { assertions[id].callbackRecipient = recipient; }
}

// only for finalization-failure tests; lifecycle tests use the official CTF.
contract TestRetryCTF {
    mapping(bytes32 => uint256) public getOutcomeSlotCount;
    mapping(bytes32 => uint256) public payoutDenominator;
    mapping(bytes32 => mapping(uint256 => uint256)) public payoutNumerators;
    bool public failReport;
    function setFailure(bool value) external { failReport = value; }
    function getConditionId(address oracle, bytes32 id, uint256 slots) public pure returns (bytes32) { return keccak256(abi.encodePacked(oracle, id, slots)); }
    function prepareCondition(address oracle, bytes32 id, uint256 slots) external { getOutcomeSlotCount[getConditionId(oracle, id, slots)] = slots; }
    function corruptSlots(bytes32 condition, uint256 slots) external { getOutcomeSlotCount[condition] = slots; }
    function reportPayouts(bytes32 id, uint256[] calldata payouts) external {
        require(!failReport, "test report failure");
        bytes32 condition = getConditionId(msg.sender, id, payouts.length);
        require(payoutDenominator[condition] == 0, "already resolved");
        for (uint256 i; i < payouts.length; i++) { payoutNumerators[condition][i] = payouts[i]; payoutDenominator[condition] += payouts[i]; }
    }
}

contract TestRevertingUmaRecipient is ICallback {
    bool public reject = true;
    function setReject(bool value) external { reject = value; }
    function assertionResolvedCallback(bytes32, bool) external view { require(!reject, "test callback failure"); }
    function assertionDisputedCallback(bytes32) external view { require(!reject, "test callback failure"); }
}
