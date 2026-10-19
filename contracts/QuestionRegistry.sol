// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

// this practice contract stores questions and their outcomes.
contract QuestionRegistry {
    error EmptyQuestion();
    error NotCreator();
    error AlreadyResolved();

    struct Question {
        string text;
        address creator;
        bool resolved;
        bool outcome;
    }

    Question[] private questions;

    event QuestionCreated(uint256 indexed questionId, address indexed creator, string text);
    event QuestionResolved(uint256 indexed questionId, bool outcome);

    // add a new question and return its id.
    function createQuestion(string calldata text) external returns (uint256 questionId) {
        if (bytes(text).length == 0) revert EmptyQuestion();

        questionId = questions.length;
        questions.push(Question({
            text: text,
            creator: msg.sender,
            resolved: false,
            outcome: false
        }));

        emit QuestionCreated(questionId, msg.sender, text);
    }

    // let the question creator save the final outcome.
    function resolveQuestion(uint256 questionId, bool outcome) external {
        Question storage question = questions[questionId];

        if (msg.sender != question.creator) revert NotCreator();
        if (question.resolved) revert AlreadyResolved();

        question.resolved = true;
        question.outcome = outcome;

        emit QuestionResolved(questionId, outcome);
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
