// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockVerificationTarget {
    bytes32 public last;
    bytes public lastHeader;
    bytes32 public lastPayloadHash;
    uint64 public lastConfirmations;

    function verify(bytes32 value) external { last = value; }
    function verify(bytes calldata header, bytes32 payloadHash, uint64 confirmations) external {
        lastHeader = header;
        lastPayloadHash = payloadHash;
        lastConfirmations = confirmations;
    }
    function fail() external pure { revert("fail"); }
}
