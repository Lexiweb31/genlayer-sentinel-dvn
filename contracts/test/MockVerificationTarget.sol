// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
contract MockVerificationTarget {
    bytes32 public last;
    bytes public lastHeader;
    bytes32 public lastPayloadHash;
    uint64 public lastConfirmations;
    uint256 public calls;

    function verify(bytes32 value) external { last = value; ++calls; }
    function verify(bytes calldata header, bytes32 payloadHash, uint64 confirmations) external {
        lastHeader = header;
        lastPayloadHash = payloadHash;
        lastConfirmations = confirmations;
        ++calls;
    }
    function fail() external pure { revert("fail"); }
}
