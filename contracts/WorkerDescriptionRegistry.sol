pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract WorkerDescriptionRegistry is Pausable {
    using SafeMath for uint256;

    struct WorkerDescription {
        address workerOwner;
        string ipfsURI;
        uint256 index;
        uint256 id;
    }


    mapping (address => uint256) public addressToId;
    mapping (uint256 => WorkerDescription) public idToWorkerDescription;

    uint256[] public ids;

    event AddedWorkerDescription(
        address indexed owner,
        string ipfsURI
    );

    event RemovedWorkerDescription(
        address indexed owner,
        uint256 indexed id
    );

    event UpdatedWorkerDescription(
        address indexed owner,
        uint256 indexed id,
        string ipfsURI
    );

    modifier onlyWorkerDescriptionOwner(uint256 id) {
        require(msg.sender == idToWorkerDescription[id].workerOwner, "msg.sender does not own this worker");
        _;
    }

    constructor() public {
        // push zero to avoid worker descriptions with zero ids
        ids.push(0);
    }

    /**
     * Adds new worker description
     * @param ipfsURI - SHA2-256 IPFS hash for worker description json
     */
    function addWorkerDescription(string memory ipfsURI) public whenNotPaused {
        require(bytes(ipfsURI).length != 0, "ipfsURI cannot be empty");
        require(idToWorkerDescription[addressToId[msg.sender]].workerOwner == address(0), "msg.sender already owns this worker");

        uint256 id = ids.length;
        uint256 index = ids.push(id).sub(1);

        WorkerDescription memory wd = WorkerDescription(msg.sender, ipfsURI, index, index);

        idToWorkerDescription[id] = wd;
        addressToId[msg.sender] = id;

        emit AddedWorkerDescription(msg.sender, ipfsURI);
    }

    /**
     * Removes worker description
     * @param id - Worker description id
     */
    function removeWorkerDescription(uint256 id) public onlyWorkerDescriptionOwner(id) whenNotPaused {
        uint256 indexToRemove = idToWorkerDescription[id].index;
        uint256 replacementId = ids[ids.length.sub(1)];

        idToWorkerDescription[id].workerOwner = address(0);

        ids[indexToRemove] = replacementId;
        WorkerDescription storage wd = idToWorkerDescription[replacementId];
        wd.index = indexToRemove;

        delete addressToId[msg.sender];
        delete ids[ids.length.sub(1)];

        ids.length = ids.length.sub(1);

        emit RemovedWorkerDescription(msg.sender, id);
    }

    /**
     * Update worker description with a new ipfs uri
     * @param id - Worker description id
     * @param ipfsURI - SHA2-256 IPFS hash for worker description json
     */
    function updateWorkerDescription(uint256 id, string memory ipfsURI) public onlyWorkerDescriptionOwner(id) whenNotPaused {
        require(bytes(ipfsURI).length != 0, "ipfsURI cannot be empty");

        idToWorkerDescription[id].ipfsURI = ipfsURI;

        emit UpdatedWorkerDescription(msg.sender, id, ipfsURI);
    }

    /**
     * Retrieve all addresses registered as a worker owner
     * @return addresses with a registered worker
     */
    function getWorkerOwnerAddresses() public view returns (address[] memory) {
        address[] memory ret = new address[](ids.length.sub(1));
        for (uint256 i = 1; i < ids.length; i++) {
            ret[i.sub(1)] = idToWorkerDescription[i].workerOwner;
        }

        return ret;
    }

}
