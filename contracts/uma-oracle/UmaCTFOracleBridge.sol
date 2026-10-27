// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {OptimisticOracleV3Interface as IOO} from "./vendor/OptimisticOracleV3Interface.sol";
import {OptimisticOracleV3CallbackRecipientInterface} from "./vendor/OptimisticOracleV3CallbackRecipientInterface.sol";
import {IUmaConfiguration, IUmaFinder, IUmaCurrencyWhitelist, IUmaIdentifierWhitelist, ICTFResolution} from "./ProviderInterfaces.sol";

// learning bridge: holds assertion bonds briefly, never holds market positions.
contract UmaCTFOracleBridge is Ownable, ReentrancyGuard, OptimisticOracleV3CallbackRecipientInterface {
    using SafeERC20 for IERC20;

    enum Outcome { YES, NO, INVALID }
    enum Status { Unknown, Pending, Disputed, Accepted, Rejected }
    struct Market {
        bytes32 conditionId;
        bytes32 rulesHash;
        uint64 deadline;
        string rules;
        string evidence;
        string invalidCriteria;
        bytes32 activeAssertion;
        bytes32 lastAssertion;
        bool finalized;
    }
    struct Proposal {
        bytes32 questionId;
        Outcome outcome;
        address proposer;
        uint256 bond;
        bytes32 claimHash;
        Status status;
    }

    uint64 public constant ASSERTION_LIVENESS = 7200;
    uint256 public constant BOND_FLOOR = 400_000_000;
    bytes32 public constant IDENTIFIER = "ASSERT_TRUTH";
    ICTFResolution public immutable ctf;
    IOO public immutable oo;
    IERC20 public immutable bondToken;
    IUmaFinder public immutable finder;
    mapping(bytes32 => Market) private markets;
    mapping(bytes32 => Proposal) public proposals;

    error InvalidConfiguration();
    error UnsupportedProviderParameters();
    error InvalidMarket();
    error MarketNotOpen();
    error BondLimitExceeded(uint256 required, uint256 maximum);
    error IncorrectBondTransfer();
    error InvalidAssertion();
    error UnauthorizedCallback();
    error ConflictingCallback();
    error NotFinal();
    error InvalidCondition();

    event MarketCreated(bytes32 indexed questionId, bytes32 indexed conditionId, bytes32 rulesHash, uint64 deadline);
    event OutcomeProposed(bytes32 indexed questionId, bytes32 indexed assertionId, address indexed proposer, Outcome outcome, uint256 bond, bytes claim);
    event AssertionStatusChanged(bytes32 indexed assertionId, Status status);
    event MarketFinalized(bytes32 indexed questionId, bytes32 indexed assertionId, Outcome outcome);

    // pin dependencies; a six-decimal token alone is not sufficient: UMA must allow it.
    constructor(address ctfAddress, address ooAddress, address currency, address administrator) Ownable(administrator) {
        if (ctfAddress.code.length == 0 || ooAddress.code.length == 0 || currency.code.length == 0) {
            revert InvalidConfiguration();
        }
        if (IERC20Metadata(currency).decimals() != 6) revert InvalidConfiguration();
        ctf = ICTFResolution(ctfAddress);
        oo = IOO(ooAddress);
        bondToken = IERC20(currency);
        address f = IUmaConfiguration(ooAddress).finder();
        if (f.code.length == 0) revert InvalidConfiguration();
        finder = IUmaFinder(f);
        _requireSupported();
    }

    // local market ids are domain-separated from other bridges and chains.
    function getQuestionId(bytes32 marketId) public view returns (bytes32) {
        return keccak256(abi.encode("UMA_CTF_MARKET_V1", block.chainid, address(this), address(ctf), marketId));
    }

    function getMarket(bytes32 questionId) external view returns (Market memory) {
        return markets[questionId];
    }

    // store full immutable evidence rules before preparing the exact binary tuple.
    function createMarket(bytes32 marketId, string calldata rules, string calldata evidence, string calldata invalidCriteria, uint64 deadline)
        external onlyOwner nonReentrant returns (bytes32 questionId)
    {
        if (marketId == bytes32(0) || deadline <= block.timestamp || !_validText(rules) || !_validText(evidence) || !_validText(invalidCriteria)) revert InvalidMarket();
        questionId = getQuestionId(marketId);
        if (markets[questionId].deadline != 0) revert InvalidMarket();
        _requireSupported();
        bytes32 conditionId = ctf.getConditionId(address(this), questionId, 2);
        if (conditionId != keccak256(abi.encodePacked(address(this), questionId, uint256(2)))) revert InvalidCondition();
        uint256 slots = ctf.getOutcomeSlotCount(conditionId);
        if (slots == 0) ctf.prepareCondition(address(this), questionId, 2);
        if (ctf.getOutcomeSlotCount(conditionId) != 2 || ctf.payoutDenominator(conditionId) != 0) revert InvalidCondition();
        Market storage m = markets[questionId];
        m.conditionId = conditionId;
        m.rulesHash = keccak256(abi.encode(rules, evidence, invalidCriteria, deadline));
        m.deadline = deadline;
        m.rules = rules;
        m.evidence = evidence;
        m.invalidCriteria = invalidCriteria;
        emit MarketCreated(questionId, conditionId, m.rulesHash, deadline);
    }

    // quote is advisory: assertion refreshes UMA's cache and rechecks the user's cap.
    function requiredBond() public view returns (uint256) {
        uint256 minimum = oo.getMinimumBond(address(bondToken));
        return minimum > BOND_FLOOR ? minimum : BOND_FLOOR;
    }

    // include readable rules and identities so a challenger can interpret the claim.
    function buildClaim(bytes32 questionId, Outcome outcome) public view returns (bytes memory) {
        Market storage m = markets[questionId];
        if (m.deadline == 0) revert InvalidMarket();
        return abi.encodePacked(
            "CTF outcome assertion. Chain: ", Strings.toString(block.chainid),
            "; bridge: ", Strings.toHexString(address(this)), "; CTF: ", Strings.toHexString(address(ctf)),
            "; question: ", Strings.toHexString(uint256(questionId), 32),
            "; rules hash: ", Strings.toHexString(uint256(m.rulesHash), 32),
            "; deadline UTC unix: ", Strings.toString(m.deadline),
            "; proposed outcome: ", outcome == Outcome.YES ? "YES" : outcome == Outcome.NO ? "NO" : "INVALID",
            "; rules: ", m.rules, "; evidence: ", m.evidence, "; INVALID criteria: ", m.invalidCriteria
        );
    }

    // only the funded proposer owns the bond refund; no position ownership is needed.
    function assertOutcome(bytes32 questionId, Outcome outcome, uint256 maximumBond) external nonReentrant returns (bytes32 assertionId) {
        Market storage m = markets[questionId];
        if (m.deadline == 0 || block.timestamp < m.deadline || m.finalized || m.activeAssertion != bytes32(0)) revert MarketNotOpen();
        if (m.lastAssertion != bytes32(0)) _verifySettlement(m.lastAssertion, false);
        if (ctf.payoutDenominator(m.conditionId) != 0) revert InvalidCondition();
        _requireSupported();
        oo.syncUmaParams(IDENTIFIER, address(bondToken));
        uint256 bond = requiredBond();
        if (bond > maximumBond) revert BondLimitExceeded(bond, maximumBond);
        uint256 beforeBalance = bondToken.balanceOf(address(this));
        bondToken.safeTransferFrom(msg.sender, address(this), bond);
        if (bondToken.balanceOf(address(this)) != beforeBalance + bond) revert IncorrectBondTransfer();
        bondToken.forceApprove(address(oo), bond);
        bytes memory claim = buildClaim(questionId, outcome);
        assertionId = oo.assertTruth(claim, msg.sender, address(this), address(0), ASSERTION_LIVENESS, bondToken, bond, IDENTIFIER, bytes32(0));
        bondToken.forceApprove(address(oo), 0);
        if (bondToken.balanceOf(address(this)) != beforeBalance) revert IncorrectBondTransfer();
        if (assertionId == bytes32(0) || proposals[assertionId].status != Status.Unknown) revert InvalidAssertion();
        proposals[assertionId] = Proposal(questionId, outcome, msg.sender, bond, keccak256(claim), Status.Pending);
        m.activeAssertion = assertionId;
        m.lastAssertion = assertionId;
        IOO.Assertion memory a = oo.getAssertion(assertionId);
        _verifyIdentity(a, proposals[assertionId]);
        if (a.settled || a.disputer != address(0) || a.assertionTime != block.timestamp) revert InvalidAssertion();
        emit OutcomeProposed(questionId, assertionId, msg.sender, outcome, bond, claim);
    }

    // idempotent notifications never modify another attempt's market state.
    function assertionDisputedCallback(bytes32 assertionId) external {
        Proposal storage p = _callbackProposal(assertionId);
        if (p.status == Status.Accepted || p.status == Status.Rejected || p.status == Status.Disputed) return;
        if (markets[p.questionId].activeAssertion != assertionId) revert InvalidAssertion();
        p.status = Status.Disputed;
        emit AssertionStatusChanged(assertionId, p.status);
    }

    // false rejects the proposal, not the market; INVALID is never inferred here.
    function assertionResolvedCallback(bytes32 assertionId, bool truthful) external {
        Proposal storage p = _callbackProposal(assertionId);
        Status result = truthful ? Status.Accepted : Status.Rejected;
        if (p.status == Status.Accepted || p.status == Status.Rejected) {
            if (p.status != result) revert ConflictingCallback();
            return;
        }
        Market storage m = markets[p.questionId];
        if (m.activeAssertion != assertionId) revert InvalidAssertion();
        p.status = result;
        if (!truthful) m.activeAssertion = bytes32(0);
        emit AssertionStatusChanged(assertionId, result);
    }

    // reporting is separate from provider callbacks and rolls back on CTF failure.
    function finalizeMarket(bytes32 questionId) external nonReentrant {
        Market storage m = markets[questionId];
        bytes32 assertionId = m.activeAssertion;
        if (m.finalized || assertionId == bytes32(0) || proposals[assertionId].status != Status.Accepted) revert NotFinal();
        _verifySettlement(assertionId, true);
        if (ctf.getConditionId(address(this), questionId, 2) != m.conditionId || ctf.getOutcomeSlotCount(m.conditionId) != 2 || ctf.payoutDenominator(m.conditionId) != 0) revert InvalidCondition();
        Outcome outcome = proposals[assertionId].outcome;
        uint256[] memory payouts = new uint256[](2);
        payouts[0] = outcome == Outcome.NO ? 0 : 1;
        payouts[1] = outcome == Outcome.YES ? 0 : 1;
        m.finalized = true;
        ctf.reportPayouts(questionId, payouts);
        if (ctf.payoutDenominator(m.conditionId) != payouts[0] + payouts[1] || ctf.payoutNumerators(m.conditionId, 0) != payouts[0] || ctf.payoutNumerators(m.conditionId, 1) != payouts[1]) revert InvalidCondition();
        emit MarketFinalized(questionId, assertionId, outcome);
    }

    function _verifySettlement(bytes32 id, bool truthful) private view {
        Proposal storage p = proposals[id];
        IOO.Assertion memory a = oo.getAssertion(id);
        _verifyIdentity(a, p);
        if (!a.settled || a.settlementResolution != truthful || oo.getAssertionResult(id) != truthful) revert NotFinal();
    }

    function _verifyIdentity(IOO.Assertion memory a, Proposal storage p) private view {
        IOO.EscalationManagerSettings memory e = a.escalationManagerSettings;
        if (
            a.asserter != p.proposer ||
            a.callbackRecipient != address(this) ||
            address(a.currency) != address(bondToken) ||
            a.bond != p.bond ||
            a.identifier != IDENTIFIER ||
            a.domainId != bytes32(0) ||
            e.assertingCaller != address(this) ||
            e.escalationManager != address(0) ||
            e.arbitrateViaEscalationManager ||
            e.discardOracle ||
            e.validateDisputers ||
            uint256(a.expirationTime) != uint256(a.assertionTime) + ASSERTION_LIVENESS
        ) revert InvalidAssertion();
    }

    function _callbackProposal(bytes32 id) private view returns (Proposal storage p) {
        if (msg.sender != address(oo)) revert UnauthorizedCallback();
        p = proposals[id];
        if (p.status == Status.Unknown) revert InvalidAssertion();
    }

    function _requireSupported() private view {
        address currencies = finder.getImplementationAddress("CollateralWhitelist");
        address identifiers = finder.getImplementationAddress("IdentifierWhitelist");
        if (currencies.code.length == 0 || identifiers.code.length == 0) revert UnsupportedProviderParameters();
        if (!IUmaCurrencyWhitelist(currencies).isOnWhitelist(address(bondToken)) || !IUmaIdentifierWhitelist(identifiers).isIdentifierSupported(IDENTIFIER)) revert UnsupportedProviderParameters();
    }

    function _validText(string calldata value) private pure returns (bool) {
        return bytes(value).length > 0 && bytes(value).length <= 2048;
    }
}
