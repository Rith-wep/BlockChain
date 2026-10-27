// SPDX-License-Identifier: MIT
pragma solidity ^0.8.34;

// this interface describes the read functions already provided by question registry
interface IQuestionRegistry {
    struct Question {
        string text;
        address creator;
        address resolver;
        bool resolved;
        bool outcome;
    }

    function getQuestion(uint256 questionId) external view returns (Question memory);
    function questionCount() external view returns (uint256);
}

// this practice contract reads questions from an existing question registry
contract QuestionReader {
    error InvalidQuestionId(uint256 questionId, uint256 questionCount);
    error ZeroRegistryAddress();
    error RegistryAddressHasNoCode(address registryAddress);

    IQuestionRegistry public immutable registry;

    // remember which deployed registry this reader should use
    constructor(address registryAddress) {
        if (registryAddress == address(0)) revert ZeroRegistryAddress();
        if (registryAddress.code.length == 0) {
            revert RegistryAddressHasNoCode(registryAddress);
        }
        registry = IQuestionRegistry(registryAddress);
    }

    // check the id, then ask the registry for the saved question.
    function readQuestion(uint256 questionId) external view returns (IQuestionRegistry.Question memory) {
        uint256 count = registry.questionCount();

        if (questionId >= count) revert InvalidQuestionId(questionId, count);

        return registry.getQuestion(questionId);
    }
}
