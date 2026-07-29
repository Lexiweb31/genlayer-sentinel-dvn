// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract RevertingActionTarget {
    uint256 public calls;

    function record(bytes32) external payable {
        ++calls;
        revert("REJECTED");
    }
}
