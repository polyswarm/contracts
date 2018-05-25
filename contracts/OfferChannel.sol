
pragma solidity ^0.4.23;

contract OfferChannel {

    address public ambassador; // Address of first channel participant
    address public expert; // Address of second channel participant
    uint public settlementPeriodLength; // How long challengers have to reply to settle engagement
    uint public isClosed; // if the period has closed
    bytes public state; // the current state
    uint public sequence; // state nonce used in during settlement

    // settlement state
    uint public isInSettlementState; // meta channel is in settling 1: Not settling 0
    uint public isInSubSettlementState; // sub channel is in settling 1: Not settling 0
    uint public settlementPeriodEnd; // The time when challenges are no longer accepted after

    function startSettle(bytes _state, uint8[2] _v, bytes32[2] _r, bytes32[2] _s) public {
        address _ambassador = _getSig(_state, _v[0], _r[0], _s[0]);
        address _expert = _getSig(_state, _v[1], _r[1], _s[1]);

        require(_hasAllSigs(_ambassador, _expert));

        require(isClosed == 0);
        require(isInSettlementState == 0);

        state = _state;

        sequence = _getSequence(_state);

        isInSettlementState = 1;
        settlementPeriodEnd = now + settlementPeriodLength;
    }

    function challengeSettle(bytes _state, uint8[2] _v, bytes32[2] _r, bytes32[2] _s) public {
        address _ambassador = _getSig(_state, _v[0], _r[0], _s[0]);
        address _expert = _getSig(_state, _v[1], _r[1], _s[1]);

        require(_hasAllSigs(_ambassador, _expert));

        require(isInSettlementState == 1);
        require(now < settlementPeriodEnd);

        require(_getSequence(_state) > sequence);

        settlementPeriodEnd = now + settlementPeriodLength;
        state = _state;
        sequence = _getSequence(_state);
    }

    // Internal Functions
    function _getSequence(bytes _state) public pure returns (uint _seq) {
        assembly {
            _seq := mload(add(_state, 64))
        }
    }

    function _hasAllSigs(address _a, address _b) internal view returns (bool) {
        require(_a == ambassador && _b == expert);
        return true;
    }

    function _hasOneSig(address _c) internal view returns (bool) {
        require(_c == ambassador || _c == expert);
        return true;
    }

    function _getSig(bytes _state, uint8 _v, bytes32 _r, bytes32 _s) internal pure returns(address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 h = keccak256(_state);

        bytes32 prefixedHash = keccak256(prefix, h);

        address a = ecrecover(prefixedHash, _v, _r, _s);

        return(a);
    }

    function() payable public {}
}
