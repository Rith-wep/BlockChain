// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

// this practice contract stores questions and their outcomes.
contract QuestionRegistry is Ownable {
    error EmptyQuestion();
    error InvalidResolver();
    error ResolverNotAssigned();
    error NotResolver();
    error AlreadyResolved();

    struct Question {
        string text;
        address creator;
        address resolver;
        bool resolved;
        bool outcome;
    }

    Question[] private questions;

    event QuestionCreated(uint256 indexed questionId, address indexed creator, string text);
    event ResolverAssigned(
        uint256 indexed questionId,
        address indexed previousResolver,
        address indexed newResolver,
        address assignedBy
    );
    event QuestionResolved(
        uint256 indexed questionId,
        address indexed resolver,
        bool outcome
    );

    constructor() Ownable(msg.sender) {}

    // add a new question and return its id
    function createQuestion(string calldata text) external returns (uint256 questionId) {
        if (bytes(text).length == 0) revert EmptyQuestion();

        questionId = questions.length;
        questions.push(Question({
            text: text,
            creator: msg.sender,
            resolver: address(0),
            resolved: false,
            outcome: false
        }));

        emit QuestionCreated(questionId, msg.sender, text);
    }

    // only the registry administrator assigns or replaces an unresolved question's resolver.
    function assignResolver(uint256 questionId, address resolver) external onlyOwner {
        if (resolver == address(0)) revert InvalidResolver();

        Question storage question = questions[questionId];
        if (question.resolved) revert AlreadyResolved();

        address previousResolver = question.resolver;
        question.resolver = resolver;

        emit ResolverAssigned(questionId, previousResolver, resolver, msg.sender);
    }

    // let the assigned resolver save the final outcome exactly once.
    function resolveQuestion(uint256 questionId, bool outcome) external {
        Question storage question = questions[questionId];

        if (question.resolved) revert AlreadyResolved();
        if (question.resolver == address(0)) revert ResolverNotAssigned();
        if (msg.sender != question.resolver) revert NotResolver();

        question.resolved = true;
        question.outcome = outcome;

        emit QuestionResolved(questionId, msg.sender, outcome);
    }

    // get the saved details for a question. 
    function getQuestion(uint256 questionId) external view returns (Question memory) {
        return questions[questionId];
    }

    // get the number of questions created so far.
    function questionCount() external view returns (uint256) {
        return questions.length;
    }
}
