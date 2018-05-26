pragma solidity ^0.4.23;
import "./OfferMultiSig.sol";

/// @title Creates new Offer Channel contracts and keeps track of them 
contract OfferRegistry {

    /// @dev maps a participant to a list of channels they belong to
    mapping (address => address[]) public participantToChannels;

    event InitializedChannel(address msig, address ambassador, address expert);
    /**
     * Function called by ambassador to initialize an offer contract
     * It deploys a new offer multi sig and saves it for each participant
     * 
     * @param _offerLib address for OfferLib library
     * @param _ambassador address of ambassador
     * @param _expert address of expert
     * @param _settlementPeriodLength how long the parties have to dispute the settlement offer channel
     */

    function initializeOfferChannel(address _offerLib, address _ambassador, address _expert, uint _settlementPeriodLength) external {
        require(msg.sender == _ambassador);
        require(address(0) != _expert);
        require(address(0) != _ambassador);
        require(address(0) != _offerLib);

        address msig = new OfferMultiSig(_offerLib, _ambassador, _expert, _settlementPeriodLength);

        participantToChannels[_ambassador].push(msig);
        participantToChannels[_expert].push(msig);

        emit InitializedChannel(msig, _ambassador, _expert);
    }


    /**
     * Function to get all the channels an address is apart of
     * 
     * @param participant an address
     */

    function getParticipantChannels(address participant) external constant returns (address[]) {
        require(participantToChannels[participant].length != 0);
        
        address[] memory participantChannels = new address[](participantToChannels[participant].length);

        for (uint i = 0; i < participantToChannels[participant].length; i++) {
            participantChannels[i] = participantToChannels[participant][i];
        }

        return participantChannels;
    }

    function() payable public {
        revert();
    }
}
