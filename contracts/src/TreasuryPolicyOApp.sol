// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {OApp, Origin, MessagingFee, MessagingReceipt} from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice LayerZero V2 OApp for explicitly authorized treasury actions. Testnet prototype; unaudited.
contract TreasuryPolicyOApp is OApp, ReentrancyGuard {
    error InvalidAction();
    error Replay();
    error UnauthorizedTarget(address target);

    struct Action { bytes32 authorizationId; address target; uint256 value; bytes data; }
    event ActionSent(bytes32 indexed authorizationId, bytes32 indexed guid, uint32 indexed dstEid, address target, uint256 value);
    event ActionExecuted(bytes32 indexed authorizationId, bytes32 indexed guid, address target, uint256 value);
    event TargetAuthorizationSet(address indexed target, bool allowed);

    mapping(bytes32 => bool) public executedGuid;
    mapping(bytes32 => bool) public executedAuthorization;
    mapping(address => bool) public authorizedTarget;

    constructor(address endpointV2, address delegate) OApp(endpointV2, delegate) Ownable(delegate) {}

    function setAuthorizedTarget(address target, bool allowed) external onlyOwner {
        if (target == address(0)) revert InvalidAction();
        authorizedTarget[target] = allowed;
        emit TargetAuthorizationSet(target, allowed);
    }

    function quoteAction(uint32 dstEid, Action calldata action, bytes calldata options, bool payInLzToken)
        external view returns (MessagingFee memory)
    {
        _validateAction(action);
        return _quote(dstEid, abi.encode(action), options, payInLzToken);
    }

    function sendAction(uint32 dstEid, Action calldata action, bytes calldata options, MessagingFee calldata fee)
        external payable onlyOwner nonReentrant returns (MessagingReceipt memory receipt)
    {
        _validateAction(action);
        receipt = _lzSend(dstEid, abi.encode(action), options, fee, payable(msg.sender));
        emit ActionSent(action.authorizationId, receipt.guid, dstEid, action.target, action.value);
    }

    function _lzReceive(Origin calldata, bytes32 guid, bytes calldata message, address, bytes calldata)
        internal override nonReentrant
    {
        Action memory action = abi.decode(message, (Action));
        _validateAction(action);
        if (executedGuid[guid] || executedAuthorization[action.authorizationId]) revert Replay();
        executedGuid[guid] = true;
        executedAuthorization[action.authorizationId] = true;
        (bool ok, bytes memory reason) = action.target.call(action.data);
        if (!ok) assembly { revert(add(reason, 32), mload(reason)) }
        emit ActionExecuted(action.authorizationId, guid, action.target, action.value);
    }

    function _validateAction(Action memory action) private view {
        if (
            action.authorizationId == bytes32(0)
                || action.target == address(0)
                || action.value != 0
        ) revert InvalidAction();
        if (!authorizedTarget[action.target]) revert UnauthorizedTarget(action.target);
    }
}
