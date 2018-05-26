pragma solidity ^0.4.23;

contract OfferMultiSig {

    string public constant NAME = "Offer MultiSig";
    string public constant VERSION = "0.0.1";

    address public offerLib;

    address public ambassador; // Address of first channel participant
    address public expert; // Address of second channel participant

    bool public isOpen = false; // true when both parties have joined
    bool public isPending = false; // true when waiting for counterparty to join agreement

    uint public settlementPeriodLength; // How long challengers have to reply to settle engagement
    uint public isClosed; // if the period has closed
    bytes public state; // the current state
    uint public sequence; // state nonce used in during settlement

    uint public isInSettlementState; // meta channel is in settling 1: Not settling 0
    uint public settlementPeriodEnd; // The time when challenges are no longer accepted after

    constructor(address _offerLib, address _ambassador, address _expert, uint _settlementPeriodLength) public {
        require(_offerLib != 0x0, 'No offer lib provided to Msig constructor');
        offerLib = _offerLib;
        ambassador = _ambassador;
        expert = _expert;
        settlementPeriodLength = _settlementPeriodLength;
    }

    /**
     * Function called by ambassador to open channel to _expert 
     * 
     * @param _state inital offer state
     * @param _v the recovery id from signature of state
     * @param _r output of ECDSA signature of state
     * @param _s output of ECDSA signature of state
     */

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
    }

    /**
     * Function called by ambassador to complete opening the channel with an ambassador defined in the _state
     * 
     * @param _state offer state from ambassador
     * @param _v the recovery id from signature of state
     * @param _r output of ECDSA signature  of state
     * @param _s output of ECDSA signature of state
     */

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
    }

    /**
     * Function called by ambassador to update balance and add to escrow
     * by default to escrows the allowed balance
     * @param _state offer state from ambassador
     * @param sigV the recovery id from signature of state by both parties
     * @param sigR output of ECDSA signature  of state by both parties
     * @param sigS output of ECDSA signature of state by both parties
     * @dev index 0 is the ambassador signature
     * @dev index 1 is the expert signature
     */

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

    /**
     * Function called by ambassador or expert to close a their channel after a dispute has timedout
     *
     * @param _state final offer state agreed on by both parties through dispute settlement
     * @param sigV the recovery id from signature of state by both parties
     * @param sigR output of ECDSA signature  of state by both parties
     * @param sigS output of ECDSA signature of state by both parties
     * @dev index 0 is the ambassador signature
     * @dev index 1 is the expert signature
     */

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


    /**
     * Function called by ambassador or expert to close a their channel with close flag
     *
     * @param _state final offer state agreed on by both parties with close flag
     * @param sigV the recovery id from signature of state by both parties
     * @param sigR output of ECDSA signature  of state by both parties
     * @param sigS output of ECDSA signature of state by both parties
     * @dev index 0 is the ambassador signature
     * @dev index 1 is the expert signature
     */

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

    /**
     * Return with the settlement period is going to end. This is the amount of time
     * an ambassor or expert has to reply with a new state
     */

    function getSettlementPeriodEnd() public view returns (uint) {
        return settlementPeriodEnd;
    }

    function _getSequence(bytes _state) public pure returns (uint _seq) {
        assembly {
            _seq := mload(add(_state, 64))
        }
    }

    // Internal Functions

    /**
     * Function called by closeAgreementWithTimeout or closeAgreement to disperse payouts
     *
     * @param _s final offer state agreed on by both parties with close flag
     */

    function _finalize(bytes _s) internal {
        uint _length = _s.length;
        
        require(address(offerLib).delegatecall(bytes4(keccak256("finalize(bytes)")), bytes32(32), bytes32(_length), _s));
    }

    /**
     * A utility function to check if both parties have signed
     *
     * @param _a ambassador address
     * @param _b expert address
     */

    function _hasAllSigs(address _a, address _b) internal view returns (bool) {
        require(_a == ambassador && _b == expert, 'Signatures do not match parties in state');

        return true;
    }

    /**
     * A utility function to check for the closed flag in the offer state
     *
     * @param _state current offer state
     */

    function _isClose(bytes _state) internal pure returns(bool) {
        uint8 isClosedState;

        assembly {
            isClosedState := mload(add(_state, 32))
        }

        require(isClosedState == 1);

        return true;
    }

    /**
     * A utility function to return the address of the person that signed the state
     *
     * @param _state offer state that was signed
     * @param _v the recovery id from signature of state by both parties
     * @param _r output of ECDSA signature  of state by both parties
     * @param _s output of ECDSA signature of state by both parties
     */
    function _getSig(bytes _state, uint8 _v, bytes32 _r, bytes32 _s) internal pure returns(address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 h = keccak256(_state);

        bytes32 prefixedHash = keccak256(prefix, h);

        address a = ecrecover(prefixedHash, _v, _r, _s);

        return(a);
    }
}
