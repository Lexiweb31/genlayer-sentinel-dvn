// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ILayerZeroDVN} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/interfaces/ILayerZeroDVN.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice ULN302-compatible job interface plus Sentinel policy-gated quorum execution. Testnet prototype; unaudited.
/// @dev assignJob must be payable to implement ILayerZeroDVN, but this zero-fee adapter rejects every nonzero msg.value.
// slither-disable-next-line locked-ether
contract SentinelDVNAdapter is ILayerZeroDVN, ReentrancyGuard {
    using ECDSA for bytes32;
    error Unauthorized(); error InvalidQuorum(); error InvalidSigner(); error Replay(); error Expired();
    error InvalidSignatureOrder(); error UnsupportedDestination(); error VerificationCallFailed(bytes reason);
    error UnexpectedNativeValue();
    event JobAssigned(bytes32 indexed jobId, uint32 indexed dstEid, bytes32 payloadHash, uint64 confirmations, address sender);
    event Verified(bytes32 indexed guid, bytes32 indexed packetDigest, bytes32 evidenceDigest, bytes32 executionDigest);

    address public immutable messageLib;
    address public immutable verificationTarget;
    uint32 public immutable supportedDstEid;
    uint256 public immutable quorum;
    mapping(address => bool) public signer;
    mapping(bytes32 => bool) public used;

    constructor(address lib, address target, uint32 dstEid, address[] memory signers, uint256 q) {
        if (lib == address(0) || target == address(0) || q == 0 || q > signers.length) revert InvalidQuorum();
        messageLib = lib; verificationTarget = target; supportedDstEid = dstEid; quorum = q;
        address previous = address(0);
        for (uint256 i; i < signers.length; ++i) {
            if (signers[i] == address(0) || signers[i] <= previous) revert InvalidSigner();
            previous = signers[i]; signer[signers[i]] = true;
        }
    }

    function getFee(uint32 dstEid, uint64, address, bytes calldata) external view override returns (uint256) {
        if (dstEid != supportedDstEid) revert UnsupportedDestination(); return 0;
    }

    function assignJob(ILayerZeroDVN.AssignJobParam calldata p, bytes calldata) external payable override returns (uint256) {
        if (msg.sender != messageLib) revert Unauthorized();
        if (msg.value != 0) revert UnexpectedNativeValue();
        if (p.dstEid != supportedDstEid) revert UnsupportedDestination();
        bytes32 id = keccak256(abi.encode(p.dstEid, p.packetHeader, p.payloadHash, p.confirmations, p.sender));
        emit JobAssigned(id, p.dstEid, p.payloadHash, p.confirmations, p.sender); return 0;
    }

    function executionDigest(bytes32 guid, bytes32 packetDigest, bytes32 evidenceDigest, bytes calldata callData, uint64 expiry)
        public view returns (bytes32)
    { return keccak256(abi.encode(block.chainid, address(this), verificationTarget, guid, packetDigest, evidenceDigest, keccak256(callData), expiry)); }

    function submitVerification(bytes32 guid, bytes32 packetDigest, bytes32 evidenceDigest, bytes calldata callData, uint64 expiry, bytes[] calldata signatures) external nonReentrant {
        if (block.timestamp > expiry) revert Expired();
        bytes32 digest = executionDigest(guid, packetDigest, evidenceDigest, callData, expiry);
        if (used[digest]) revert Replay();
        bytes32 ethDigest = MessageHashUtils.toEthSignedMessageHash(digest);
        address previous = address(0); uint256 count = 0;
        for (uint256 i; i < signatures.length; ++i) {
            address recovered = ECDSA.recover(ethDigest, signatures[i]);
            if (recovered <= previous) revert InvalidSignatureOrder();
            previous = recovered; if (signer[recovered]) ++count;
        }
        if (count < quorum) revert InvalidQuorum();
        used[digest] = true;
        (bool ok, bytes memory reason) = verificationTarget.call(callData);
        if (!ok) revert VerificationCallFailed(reason);
        emit Verified(guid, packetDigest, evidenceDigest, digest);
    }
}
