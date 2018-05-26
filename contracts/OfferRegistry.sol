pragma solidity ^0.4.23;

import "./OfferMultiSig.sol";

contract OfferRegistry {

    mapping (address => address[]) public participantToChannels;

    event InitializedChannel(address msig, address ambassador, address expert);

    function initializeOfferChannel(address _offerLib, address _ambassador, address _expert, uint _settlementPeriodLength) public returns(address) {
        require(msg.sender == _ambassador);
        require(address(0) != _expert);
        require(address(0) != _ambassador);
        require(address(0) != _offerLib);

        address msig = new OfferMultiSig(_offerLib, _ambassador, _expert, _settlementPeriodLength);

        participantToChannels[_ambassador].push(msig);
        participantToChannels[_expert].push(msig);

        emit InitializedChannel(msig, _ambassador, _expert);

        return msig;
    }

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
