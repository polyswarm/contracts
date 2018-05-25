pragma solidity ^0.4.23;

contract OfferRegistry {

    mapping (address => address[]) public participantToChannels;
    event Added(address msig, address participant);

    function add(bytes state, address participant) public {
        address msig = getMultiSigAddress(state);

        require(msg.sender == msig);

        participantToChannels[participant].push(msig);

        emit Added(msig, participant);
    }

    function getParticipantChannels(address participant) external returns (address[]) {
        require(participantToChannels[participant].length != 0);
        
        address[] memory participantChannels = new address[](participantToChannels[participant].length);

        for (uint i = 0; i < participantToChannels[participant].length; i++) {
            participantChannels[i] = participantToChannels[participant][i];
        }

        return participantChannels;
    }

    function getMultiSigAddress(bytes _state) internal pure returns (address _multisig) {
        assembly {
            _multisig := mload(add(_state, 160))
        }
    }

    function() payable public {
        revert();
    }
}
