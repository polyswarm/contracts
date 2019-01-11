pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/lifecycle/Pausable.sol";

import "./OfferMultiSig.sol";

/// @title Creates new Offer Channel contracts and keeps track of them
contract OfferRegistry is Pausable, Ownable {

    struct OfferChannel {
        address msig;
        address ambassador;
        address expert;
    }

    event InitializedChannel(
        address msig,
        address ambassador,
        address expert,
        uint128 guid
    );

    uint128[] public channelsGuids;
    mapping (bytes32 => address) public participantsToChannel;
    mapping (uint128 => OfferChannel) public guidToChannel;

    address public nectarAddress;

    constructor(address _nectarAddress) public {
        require(_nectarAddress != address(0), "Invalid token address");

        nectarAddress = _nectarAddress;
    }

    /**
     * Function called by ambassador to initialize an offer contract
     * It deploys a new offer multi sig and saves it for each participant
     *
     * @param _ambassador address of ambassador
     * @param _expert address of expert
     * @param _settlementPeriodLength how long the parties have to dispute the settlement offer channel
     */
    function initializeOfferChannel(uint128 guid, address _ambassador, address _expert, uint _settlementPeriodLength) external whenNotPaused {
        require(address(0) != _expert, "Invalid expert address");
        require(address(0) != _ambassador, "Invalid ambassador address");
        require(msg.sender == _ambassador, "Initializer isn't ambassador");
        require(guidToChannel[guid].msig == address(0), "GUID already in use");

        bytes32 key = getParticipantsHash(_ambassador, _expert);

        if (participantsToChannel[key] != address(0)) {
            /// @dev check to make sure the participants don't already have an open channel
            // solium-disable-next-line indentation
            require(OfferMultiSig(participantsToChannel[key]).isChannelOpen() == false,
                "Channel already exists between parties");
        }

        address msig = address(new OfferMultiSig(nectarAddress, _ambassador, _expert, _settlementPeriodLength));

        participantsToChannel[key] = msig;

        guidToChannel[guid].msig = msig;
        guidToChannel[guid].ambassador = _ambassador;
        guidToChannel[guid].expert = _expert;

        channelsGuids.push(guid);

        emit InitializedChannel(msig, _ambassador, _expert, guid);
    }

    /**
     * Get the total number of offer channels tracked by the contract
     *
     * @return total number of offer channels
     */
    function getNumberOfOffers() external view returns (uint) {
        return channelsGuids.length;
    }

    /**
     * Function to get channel participants are on
     *
     * @param _ambassador the address of ambassador
     * @param _expert the address of ambassador
     */
    function getParticipantsChannel(address _ambassador, address _expert) external view returns (address) {
        bytes32 key = getParticipantsHash(_ambassador, _expert);

        require(participantsToChannel[key] != address(0), "Channel does not exist between parties");

        return participantsToChannel[key];
    }

    /**
     * Gets all the created channelsGuids
     *
     * @return list of every channel registered
     */
    function getChannelsGuids() external view returns (uint128[] memory) {
        require(channelsGuids.length != 0, "No channels initialized");

        uint128[] memory registeredChannelsGuids = new uint128[](channelsGuids.length);

        for (uint i = 0; i < channelsGuids.length; i++) {
            registeredChannelsGuids[i] = channelsGuids[i];
        }

        return registeredChannelsGuids;
    }

    /**
     * Pause all channels
     *
     * @return list of every channel registered
     */
    function pauseChannels() external onlyOwner whenNotPaused {
        require(channelsGuids.length != 0, "No channels initialized");

        pause();

        for (uint i = 0; i < channelsGuids.length; i++) {
            OfferMultiSig(guidToChannel[channelsGuids[i]].msig).pause();
        }

    }

    /**
     * Unpause all channels
     *
     * @return list of every channel registered
     */

    function unpauseChannels() external onlyOwner whenPaused {
        require(channelsGuids.length != 0, "No channels initialized");

        for (uint i = 0; i < channelsGuids.length; i++) {
            OfferMultiSig(guidToChannel[channelsGuids[i]].msig).unpause();
        }

    }

    /**
     * Return offer information from state
     *
     * @return list of every channel registered
     * @param _state offer state agreed on by both parties
     */

    function getOfferState(
        bytes memory _state
    )
    public
    pure
        returns (
            bytes32 _guid,
            uint256 _nonce,
            uint256 _amount,
            address _msigAddress,
            uint256 _balanceA,
            uint256 _balanceB,
            address _ambassador,
            address _expert,
            uint256 _isClosed,
            address _token,
            uint256 _mask,
            uint256 _assertion
        )
    {
        // solium-disable-next-line security/no-inline-assembly
        assembly {
             _guid := mload(add(_state, 288)) // [256-287] - a globally-unique identifier for the listing
             _nonce:= mload(add(_state, 64)) // [32-63] - the sequence of state
             _amount := mload(add(_state, 320)) // [288-319] - the offer amount awarded to expert for responses
             _msigAddress := mload(add(_state, 160)) // [128-159] - msig address where funds and offer are managed
             _balanceA := mload(add(_state,192)) // [160-191] balance in nectar for ambassador
             _balanceB := mload(add(_state,224)) // [192-223] balance in nectar for expert
             _ambassador := mload(add(_state, 96)) // [64-95] - offer's ambassador address
             _expert := mload(add(_state, 128)) // [96-127] - offer's expert address
             _isClosed := mload(add(_state, 32)) // [0-31] - 0 or 1 for if the state is marked as closed
             _token := mload(add(_state, 256)) // [224-255] - nectar token address
             _mask := mload(add(_state, 480)) // [448-479] - assertion mask
             _assertion := mload(add(_state, 512)) // [480-511] - assertions from expert
        }
    }

    // Internals

    /**
     * Utility function to get hash
     *
     * @param _ambassador address of ambassador
     * @param _expert address of expert
     * @return hash of ambassador and expert
     */

    function getParticipantsHash(address _ambassador, address _expert) internal pure returns (bytes32) {
        string memory str_ambassador = toString(_ambassador);
        string memory str_expert = toString(_expert);

        return keccak256(abi.encodePacked(strConcat(str_ambassador, str_expert)));
    }

    function toString(address x) internal pure returns (string memory) {
        bytes memory b = new bytes(20);
        for (uint i = 0; i < 20; i++) {
            b[i] = byte(uint8(uint(x) / (2**(8*(19 - i)))));
        }
        return string(b);
    }

    function strConcat(string memory _a, string memory _b) internal pure returns (string memory) {
        bytes memory _ba = bytes(_a);
        bytes memory _bb = bytes(_b);
        string memory abcde = new string(_ba.length + _bb.length);
        bytes memory babcde = bytes(abcde);
        uint k = 0;
        uint i = 0;

        for (i = 0; i < _ba.length; i++) {
            babcde[k++] = _ba[i];
        }

        for (i = 0; i < _bb.length; i++) {
            babcde[k++] = _bb[i];
        }

        return string(babcde);
    }


    /** Disable usage of the fallback function */
    function() external payable {
        revert("Do not allow sending Eth to this contract");
    }
}
