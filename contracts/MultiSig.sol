pragma solidity ^0.4.23;

import "./OfferChannel.sol";
import "./OfferRegistry.sol";

contract MultiSig is OfferChannel {

    string public constant NAME = "Offer Channel MultiSig";
    string public constant VERSION = "0.0.1";

    address public offerRegistry;
    address public offerLib;

    bool public isOpen = false; // true when both parties have joined
    bool public isPending = false; // true when waiting for counterparty to join agreement

    constructor(address _offerLib, address _registry, address _ambassador, address _expert, uint _settlementPeriodLength) public {
        require(_offerLib != 0x0, 'No offer lib provided to Msig constructor');
        offerLib = _offerLib;
        ambassador = _ambassador;
        expert = _expert;
        offerRegistry = _registry;
        settlementPeriodLength = _settlementPeriodLength;
    }

    function openAgreement(bytes _state, uint8 _v, bytes32 _r, bytes32 _s) public payable {
        // require the channel is not open yet
        require(isOpen == false, 'openAgreement already called, isOpen true');
        require(isPending == false, 'openAgreement already called, isPending true');

        isPending = true;
        // check the account opening a channel signed the initial state
        address _initiator = _getSig(_state, _v, _r, _s);
        require(ambassador == _initiator);

        uint _length = _state.length;

        // the open inerface can generalize an entry point for differenct kinds of checks
        // on opening state
        require(address(offerLib).delegatecall(bytes4(keccak256("open(bytes)")), bytes32(32), bytes32(_length), _state));

        OfferRegistry(offerRegistry).add(_state, ambassador);
    }

    function joinAgreement(bytes _state, uint8 _v, bytes32 _r, bytes32 _s) public payable {
        require(isOpen == false);

        // no longer allow joining functions to be called
        isOpen = true;

        // check that the state is signed by the sender and sender is in the state
        address _joiningParty = _getSig(_state, _v, _r, _s);

        require(expert == _joiningParty);

        state = _state;

        uint _length = _state.length;

        require(address(offerLib).delegatecall(bytes4(keccak256("join(bytes)")), bytes32(32), bytes32(_length), _state));
        // Set storage for state
        expert = _joiningParty;

        OfferRegistry(offerRegistry).add(_state, expert);
    }

    function depositState(bytes _state, uint8[2] sigV, bytes32[2] sigR, bytes32[2] sigS) public payable {

        require(isOpen == true, 'Tried adding state to a close msig wallet');
        address _ambassador = _getSig(_state, sigV[0], sigR[0], sigS[0]);
        address _expert = _getSig(_state, sigV[1], sigR[1], sigS[1]);

        // Require both signatures
        require(_hasAllSigs(_ambassador, _expert));

        uint _length = _state.length;

        state = _state;

        require(address(offerLib).delegatecall(bytes4(keccak256("update(bytes)")), bytes32(32), bytes32(_length), _state));
    }

    function closeAgreementWithTimeout(bytes _state, uint8[2] sigV, bytes32[2] sigR, bytes32[2] sigS) public {
        address _ambassador = _getSig(_state, sigV[0], sigR[0], sigS[0]);
        address _expert = _getSig(_state, sigV[1], sigR[1], sigS[1]);

        require(settlementPeriodEnd <= now);
        require(isClosed == 0);
        require(isInSettlementState == 1);

        require(_hasAllSigs(_ambassador, _expert));
        require(keccak256(state) == keccak256(_state));

        isClosed = 1;

        _finalize(_state);
        isOpen = false;
    }

    function closeAgreement(bytes _state, uint8[2] sigV, bytes32[2] sigR, bytes32[2] sigS) public {
        address _ambassador = _getSig(_state, sigV[0], sigR[0], sigS[0]);
        address _expert = _getSig(_state, sigV[1], sigR[1], sigS[1]);

        require(isClosed == 0);
        
        /// @dev make sure we're not in dispute
        require(isInSettlementState == 0);

        /// @dev must have close flag
        require(_isClose(_state), 'State did not have a signed close out state');
        require(_hasAllSigs(_ambassador, _expert));

        isClosed = 1;
        state = _state;

        _finalize(_state);
        isOpen = false;
    }

    function getSettlementPeriodEnd() public view returns (uint) {
        return settlementPeriodEnd;
    }

    function getNow() public view returns (uint) {
        return now;
    }

    // Internal
    function _finalize(bytes _s) internal {
        uint _length = _s.length;
        
        require(address(offerLib).delegatecall(bytes4(keccak256("finalize(bytes)")), bytes32(32), bytes32(_length), _s));
    }

    function _hasAllSigs(address _a, address _b) internal view returns (bool) {
        require(_a == ambassador && _b == expert, 'Signatures do not match parties in state');

        return true;
    }

    function _isClose(bytes _state) internal pure returns(bool) {
        uint8 isClosedState;

        assembly {
            isClosedState := mload(add(_state, 32))
        }

        require(isClosedState == 1);

        return true;
    }

    function _getSig(bytes _d, uint8 _v, bytes32 _r, bytes32 _s) internal pure returns(address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 h = keccak256(_d);

        bytes32 prefixedHash = keccak256(prefix, h);

        address a = ecrecover(prefixedHash, _v, _r, _s);

        return(a);
    }
}
