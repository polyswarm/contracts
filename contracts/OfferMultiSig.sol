pragma solidity ^0.4.23;

contract OfferMultiSig {

    string public constant NAME = "Offer MultiSig";
    string public constant VERSION = "0.0.1";

    event CommunicationsSet(
        bytes32 websocketUri
    );

    event OpenedAgreement(
        address _ambassador
    );

    event JoinedAgreement(
        address _expert
    );

    event ClosedAgreement(
        address _expert,
        address _ambassador
    );

    event StartedSettle(
        address initiator,
        uint sequence,
        uint settlementPeriodEnd
    );

    event SettleStateChallenged(
        address challenger,
        uint sequence,
        uint settlementPeriodEnd
    );

    address public offerLib;  // Address of offer library
    address public ambassador; // Address of first channel participant
    address public expert; // Address of second channel participant

    bool public isOpen = false; // true when both parties have joined
    bool public isPending = false; // true when waiting for counterparty to join agreement

    uint public settlementPeriodLength; // How long challengers have to reply to settle engagement
    uint public isClosed; // if the period has closed
    uint public sequence; // state nonce used in during settlement
    uint public isInSettlementState; // meta channel is in settling 1: Not settling 0
    uint public settlementPeriodEnd; // The time when challenges are no longer accepted after

    bytes32 public websocketUri; // a geth node running whisper (shh)
    bytes public state; // the current state

    constructor(address _offerLib, address _ambassador, address _expert, uint _settlementPeriodLength) public {
        require(_offerLib != address(0), 'No offer lib provided to Msig constructor');
        require(_ambassador != address(0), 'No ambassador lib provided to Msig constructor');
        require(_expert != address(0), 'No expert lib provided to Msig constructor');

        offerLib = _offerLib;
        ambassador = _ambassador;
        expert = _expert;
        settlementPeriodLength = _settlementPeriodLength;
    }

    /** Function only callable by participants */
    modifier onlyParticipants() {
        require(msg.sender == ambassador || msg.sender == expert);
        _;
    }

    /**
     * Function called by ambassador to open channel with _expert 
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
        require(msg.sender == ambassador);

        isPending = true;
        // check the account opening a channel signed the initial state
        address initiator = _getSig(_state, _v, _r, _s);
        require(ambassador == initiator);

        uint _length = _state.length;

        // the open inerface can generalize an entry point for differenct kinds of checks
        // on opening state
        require(address(offerLib).delegatecall(bytes4(keccak256("open(bytes)")), bytes32(32), bytes32(_length), _state));

        emit OpenedAgreement(ambassador);
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
        require(msg.sender == expert);

        // no longer allow joining functions to be called
        isOpen = true;

        // check that the state is signed by the sender and sender is in the state
        address joiningParty = _getSig(_state, _v, _r, _s);

        require(expert == joiningParty);

        state = _state;

        uint _length = _state.length;

        require(address(offerLib).delegatecall(bytes4(keccak256("join(bytes)")), bytes32(32), bytes32(_length), _state));

        emit JoinedAgreement(expert);
    }

    /**
     * Function called by ambassador to update balance and add to escrow
     * by default to escrows the allowed balance
     * @param _state offer state from ambassador
     * @param _sigV the recovery id from signature of state by both parties
     * @param _sigR output of ECDSA signature  of state by both parties
     * @param _sigS output of ECDSA signature of state by both parties
     * @dev index 0 is the ambassador signature
     * @dev index 1 is the expert signature
     */

    function depositState(bytes _state, uint8[2] _sigV, bytes32[2] _sigR, bytes32[2] _sigS) public payable onlyParticipants {
        require(isOpen == true, 'Tried adding state to a close msig wallet');
        address _ambassador = _getSig(_state, _sigV[0], _sigR[0], _sigS[0]);
        address _expert = _getSig(_state, _sigV[1], _sigR[1], _sigS[1]);

        // Require both signatures
        require(_hasAll_Sigs(_ambassador, _expert));

        uint _length = _state.length;

        state = _state;

        require(address(offerLib).delegatecall(bytes4(keccak256("update(bytes)")), bytes32(32), bytes32(_length), _state));
    }

    /**
     * Function called by ambassador or expert to close a their channel after a dispute has timedout
     *
     * @param _state final offer state agreed on by both parties through dispute settlement
     * @param _sigV the recovery id from signature of state by both parties
     * @param _sigR output of ECDSA signature  of state by both parties
     * @param _sigS output of ECDSA signature of state by both parties
     * @dev index 0 is the ambassador signature
     * @dev index 1 is the expert signature
     */

    function closeAgreementWithTimeout(bytes _state, uint8[2] _sigV, bytes32[2] _sigR, bytes32[2] _sigS) public onlyParticipants {
        address _ambassador = _getSig(_state, _sigV[0], _sigR[0], _sigS[0]);
        address _expert = _getSig(_state, _sigV[1], _sigR[1], _sigS[1]);

        require(settlementPeriodEnd <= now);
        require(isClosed == 0);
        require(isInSettlementState == 1);

        require(_hasAll_Sigs(_ambassador, _expert));
        require(keccak256(state) == keccak256(_state));

        isClosed = 1;

        _finalize(_state);
        isOpen = false;
    }


    /**
     * Function called by ambassador or expert to close a their channel with close flag
     *
     * @param _state final offer state agreed on by both parties with close flag
     * @param _sigV the recovery id from signature of state by both parties
     * @param _sigR output of ECDSA signature  of state by both parties
     * @param _sigS output of ECDSA signature of state by both parties
     * @dev index 0 is the ambassador signature
     * @dev index 1 is the expert signature
     */

    function closeAgreement(bytes _state, uint8[2] _sigV, bytes32[2] _sigR, bytes32[2] _sigS) public onlyParticipants {
        address _ambassador = _getSig(_state, _sigV[0], _sigR[0], _sigS[0]);
        address _expert = _getSig(_state, _sigV[1], _sigR[1], _sigS[1]);

        require(isClosed == 0);
        
        /// @dev make sure we're not in dispute
        require(isInSettlementState == 0);

        /// @dev must have close flag
        require(_isClosed(_state), 'State did not have a signed close out state');
        require(_hasAll_Sigs(_ambassador, _expert));

        isClosed = 1;
        state = _state;

        _finalize(_state);
        isOpen = false;

        emit ClosedAgreement(_expert, _ambassador);

    }


    /**
     * Function called by ambassador or expert to start initalize a disputed settlement
     * using an agreed upon state. It starts a timeout for a reply using `settlementPeriodLength`
     * 
     * @param _state offer state agreed on by both parties
     * @param _sigV the recovery id from signature of state by both parties
     * @param _sigR output of ECDSA signature  of state by both parties
     * @param _sigS output of ECDSA signature of state by both parties
     */

    function startSettle(bytes _state, uint8[2] _sigV, bytes32[2] _sigR, bytes32[2] _sigS) public onlyParticipants {
        address _ambassador = _getSig(_state, _sigV[0], _sigR[0], _sigS[0]);
        address _expert = _getSig(_state, _sigV[1], _sigR[1], _sigS[1]);

        require(msg.sender == _expert || msg.sender == _ambassador);

        require(_hasAll_Sigs(_ambassador, _expert));

        require(isClosed == 0);
        require(isInSettlementState == 0);

        state = _state;

        sequence = _getSequence(_state);

        isInSettlementState = 1;
        settlementPeriodEnd = now + settlementPeriodLength;

        emit StartedSettle(msg.sender, sequence, settlementPeriodEnd);
    }

    /**
     * Function called by ambassador or expert to challenge a disputed state
     * The new state is accepted if it is signed by both parties and has a higher sequence number
     * 
     * @param _state offer state agreed on by both parties
     * @param _sigV the recovery id from signature of state by both parties
     * @param _sigR output of ECDSA signature  of state by both parties
     * @param _sigS output of ECDSA signature of state by both parties
     */

    function challengeSettle(bytes _state, uint8[2] _sigV, bytes32[2] _sigR, bytes32[2] _sigS) public onlyParticipants {
        address _ambassador = _getSig(_state, _sigV[0], _sigR[0], _sigS[0]);
        address _expert = _getSig(_state, _sigV[1], _sigR[1], _sigS[1]);

        require(_hasAll_Sigs(_ambassador, _expert));

        require(isInSettlementState == 1);
        require(now < settlementPeriodEnd);

        require(_getSequence(_state) > sequence);

        settlementPeriodEnd = now + settlementPeriodLength;
        state = _state;
        sequence = _getSequence(_state);

        emit SettleStateChallenged(msg.sender, sequence, settlementPeriodEnd);
    }

    /**
     * Return when the settlement period is going to end. This is the amount of time
     * an ambassor or expert has to reply with a new state
     */

    function getSettlementPeriodEnd() public view returns (uint) {
        return settlementPeriodEnd;
    }

    /**
    * Function to be called by ambassador to set comunication information
    *
    * @param _websocketUri uri of whisper node
    */

    function setCommunicationUri(bytes32 _websocketUri) external {
        require(msg.sender == ambassador);

        websocketUri = _websocketUri;

        emit CommunicationsSet(websocketUri);
    }

    /**
     * Function called to get the state sequence
     *
     * @param _state offer state
     */

    function _getSequence(bytes _state) public pure returns (uint _seq) {
        assembly {
            _seq := mload(add(_state, 64))
        }
    }

    function isChannelOpen() public view returns (bool) {
        return isOpen;
    }

    function getWebsocketUri() public constant returns (bytes32) {
        return websocketUri;
    }


    /**
     * Function called by closeAgreementWithTimeout or closeAgreement to disperse payouts
     *
     * @param _state final offer state agreed on by both parties with close flag
     */

    function _finalize(bytes _state) internal {
        uint _length = _state.length;
        
        require(address(offerLib).delegatecall(bytes4(keccak256("finalize(bytes)")), bytes32(32), bytes32(_length), _state));
    }

    /**
     * A utility function to check if both parties have signed
     *
     * @param _a ambassador address
     * @param _b expert address
     */

    function _hasAll_Sigs(address _a, address _b) internal view returns (bool) {
        require(_a == ambassador && _b == expert, 'Signatures do not match parties in state');

        return true;
    }

    /**
     * A utility function to check for the closed flag in the offer state
     *
     * @param _state current offer state
     */

    function _isClosed(bytes _state) internal pure returns(bool) {
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
