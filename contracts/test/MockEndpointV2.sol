// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MessagingParams, MessagingFee, MessagingReceipt, Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {Packet} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ISendLib.sol";
import {PacketV1Codec} from "@layerzerolabs/lz-evm-protocol-v2/contracts/messagelib/libs/PacketV1Codec.sol";
import {GUID} from "@layerzerolabs/lz-evm-protocol-v2/contracts/libs/GUID.sol";
import {IOAppReceiver} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppReceiver.sol";

/// @notice Minimal EndpointV2 behavioral harness. It is not a protocol implementation.
contract MockEndpointV2 {
    using PacketV1Codec for Packet;
    event PacketSent(bytes encodedPayload, bytes options, address sendLibrary);
    event DVNFeePaid(address[] requiredDVNs, address[] optionalDVNs, uint256[] fees);
    uint32 public immutable eid;
    uint256 public constant NATIVE_FEE = 1e12;
    address public optionalDvn;
    mapping(address => address) public delegates;
    mapping(address => mapping(uint32 => mapping(bytes32 => uint64))) public outboundNonce;
    constructor(uint32 localEid) { eid = localEid; }
    function setDelegate(address delegate) external { delegates[msg.sender] = delegate; }
    function setOptionalDvn(address dvn) external {
        require(dvn != address(0), "dvn");
        optionalDvn = dvn;
    }
    function lzToken() external pure returns (address) { return address(0); }
    function quote(MessagingParams calldata, address) external pure returns (MessagingFee memory) { return MessagingFee(NATIVE_FEE, 0); }
    function send(MessagingParams calldata p, address) external payable returns (MessagingReceipt memory receipt) {
        require(msg.value == NATIVE_FEE, "fee");
        uint64 nonce = ++outboundNonce[msg.sender][p.dstEid][p.receiver];
        bytes32 guid = GUID.generate(nonce, eid, msg.sender, p.dstEid, p.receiver);
        Packet memory packet = Packet(nonce, eid, msg.sender, p.dstEid, p.receiver, guid, p.message);
        emit PacketSent(PacketV1Codec.encode(packet), p.options, address(this));
        require(optionalDvn != address(0), "dvn");
        address[] memory requiredDvns = new address[](0);
        address[] memory optionalDvns = new address[](1);
        optionalDvns[0] = optionalDvn;
        uint256[] memory fees = new uint256[](1);
        fees[0] = NATIVE_FEE;
        emit DVNFeePaid(requiredDvns, optionalDvns, fees);
        return MessagingReceipt(guid, nonce, MessagingFee(NATIVE_FEE, 0));
    }
    function deliver(address receiver, Origin calldata origin, bytes32 guid, bytes calldata message) external {
        IOAppReceiver(receiver).lzReceive(origin, guid, message, address(this), "");
    }
}
