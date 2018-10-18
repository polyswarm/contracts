pragma solidity ^0.4.23;

import "zeppelin-solidity/contracts/math/SafeMath.sol";

import "./NectarToken.sol";

/// @title Lib for preforming actions based on offer state
library OfferLib {

    using SafeMath for uint256;

    // TODO: Think about removing useless state varibles and or replacing with merkle root

    // State Map (+32 byte offset for bytes length)
    /// @dev Required State
    // [0-31] is close flag
    // [32-63] nonce
    // [64-95] ambassador address
    // [96-127] expert address
    // [128-159] msig address
    // [160-191] balance in nectar for ambassador
    // [192-223] balance in nectar for expert
    // [224-255] token address
    // [256-287] A globally-unique identifier for the Listing.
    // [288-319] The Offer Amount.

    /// @dev Optional State
    // [320-351] Cryptographic hash of the Artifact.
    // [352-383] The IPFS URI of the Artifact.
    // [384-415] Engagement Deadline
    // [416-447] Assertion Deadline
    // [448-479] current commitment
    // [480-511] bitmap of verdicts
    // [512-543] meta data


    function getCloseFlag(bytes _state) public pure returns(uint8 _flag) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _flag := mload(add(_state, 32))
        }
    }

    function getSequence(bytes _state) public pure returns(uint256 _seq) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _seq := mload(add(_state, 64))
        }
    }

    function getPartyA(bytes _state) public pure returns(address _ambassador) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _ambassador := mload(add(_state, 96))
        }
    }

    function getPartyB(bytes _state) public pure returns(address _expert) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _expert := mload(add(_state, 128))
        }
    }

    function getMultiSigAddress(bytes _state) public pure returns(address _multisig) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _multisig := mload(add(_state, 160))
        }
    }

    function getBalanceA(bytes _state) public pure returns(uint256 _balanceA) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _balanceA := mload(add(_state,192))
        }
    }

    function getBalanceB(bytes _state) public pure returns(uint256 _balanceB) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _balanceB := mload(add(_state,224))
        }
    }

    function getTokenAddress(bytes _state) public pure returns (address _token) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _token := mload(add(_state,256))
        }
    }

    function getEngagementDeadline(bytes _state) public pure returns (uint256 _engagementDeadline) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _engagementDeadline := mload(add(_state, 416))
        }
    }

    function getAssertionDeadline(bytes _state) public pure returns (uint256 _assertionDeadline) {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
            _assertionDeadline := mload(add(_state, 448))
        }
    }

    function getOfferState(
        bytes _state
    )
    public
    pure
        returns(
            bytes32 _guid,
            uint256 _amount,
            bytes32 _artifactHash,
            bytes32 _artifactURI,
            uint256 _engagementDeadline,
            uint256 _assertionDeadline,
            bytes32 _commitment,
            bytes32 _assertion,
            bytes32 _meta
        )
    {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
             _guid := mload(add(_state, 288)) // [256-287] A globally-unique identifier for the Listing.
             _amount := mload(add(_state, 320)) // [288-319] The Offer Amount.
             _artifactHash := mload(add(_state, 352)) // [320-351] Cryptographic hash of the Artifact.
             _artifactURI := mload(add(_state, 384)) // [352-383] The IPFS URI of the Artifact.
             _engagementDeadline := mload(add(_state, 416)) // [384-415] Engagement Deadline
             _assertionDeadline := mload(add(_state, 448)) // [416-447] Assertion Deadline
             _commitment := mload(add(_state, 480)) // [448-479] commitment
             _assertion := mload(add(_state, 512)) // [480-511] bitmap of verdicts
             _meta := mload(add(_state, 544)) // [512-543] Information derived during Assertion generation
        }
    }

    function getTotal(bytes _state) public pure returns(uint256) {
        uint256 _a = getBalanceA(_state);
        uint256 _b = getBalanceB(_state);

        return _a.add(_b);
    }

    function open(bytes _state) public returns (bool) {
        require(msg.sender == getPartyA(_state), "Party A does not match signature recovery");

        // get the token instance used to allow funds to msig
        NectarToken _t = NectarToken(getTokenAddress(_state));

        // ensure the amount sent to open channel matches the signed state balance
        require(_t.allowance(getPartyA(_state), this) == getBalanceA(_state), "value does not match ambassador state balance");

        // complete the tranfer of ambassador approved tokens
        _t.transferFrom(getPartyA(_state), this, getBalanceA(_state));
        return true;
    }

    function join(bytes _state) public view returns (bool) {
        // get the token instance used to allow funds to msig
        NectarToken _t = NectarToken(getTokenAddress(_state));

        // ensure the amount sent to join channel matches the signed state balance
        require(msg.sender == getPartyB(_state), "Party B does not match signature recovery");

        // Require bonded is the sum of balances in state
        require(getTotal(_state) == _t.balanceOf(this), "token total deposited does not match state balance");

        return true;
    }

    function update(bytes _state) public returns (bool) {
        // get the token instance used to allow funds to msig
        NectarToken _t = NectarToken(getTokenAddress(_state));

        if(_t.allowance(getPartyA(_state), this) > 0) {
            _t.transferFrom(getPartyA(_state), this, _t.allowance(getPartyA(_state), this));
        }

        require(getTotal(_state) == _t.balanceOf(this), "token total deposited does not match state balance");
    }

    function cancel(address tokenAddress) public returns (bool) {
        NectarToken _t = NectarToken(tokenAddress);

        return _t.transfer(msg.sender, _t.balanceOf(this));
    }

    function finalize(bytes _state) public returns (bool) {
        address _a = getPartyA(_state);
        address _b = getPartyB(_state);

        NectarToken _t = NectarToken(getTokenAddress(_state));
        require(getTotal(_state) == _t.balanceOf(this), "tried finalizing token state that does not match bonded value");

        _t.transfer(_a, getBalanceA(_state));
        _t.transfer(_b, getBalanceB(_state));
    }
}
