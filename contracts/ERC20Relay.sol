pragma solidity ^0.4.21;

import "zeppelin-solidity/contracts/ownership/Ownable.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/token/ERC20/ERC20.sol";
import "zeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";

contract ERC20Relay is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for ERC20;

    /* Verifiers */
    uint256 constant MINIMUM_VERIFIERS = 3;
    uint256 public requiredVerifiers;
    address[] private verifiers;
    mapping (address => uint256) private verifierAddressToIndex;

    /* Withdrawals */
    uint256 constant GAS_PRICE = 20 * 10 ** 9;
    uint256 constant ESTIMATED_GAS_PER_VERIFIER = 54301;
    uint256 constant ESTIMATED_GAS_PER_WITHDRAWAL= 73458;
    uint256 public nctEthExchangeRate;
    uint256 public fees;
    address public feeWallet;

    struct Withdrawal {
        address destination;
        uint256 amount;
        address[] approvals;
        bool processed;
    }

    mapping (bytes32 => Withdrawal) public withdrawals;

    event WithdrawalProcessed(
        address indexed destination,
        uint256 amount,
        bytes32 txHash,
        bytes32 blockHash,
        uint256 blockNumber
    );

    event FeesChanged(
        uint256 newFees
    );

    /* Sidechain anchoring */
    struct Anchor {
        bytes32 blockHash;
        uint256 blockNumber;
        address[] approvals;
        bool processed;
    }

    Anchor[] public anchors;

    event AnchoredBlock(
        bytes32 indexed blockHash,
        uint256 indexed blockNumber
    );

    ERC20 private token;

    constructor(address _token, uint256 _nctEthExchangeRate, address _feeWallet, address[] _verifiers) public {
        require(_token != address(0), "Invalid token address");
        require(_verifiers.length >= MINIMUM_VERIFIERS, "Number of verifiers less than minimum");

        // Dummy verifier at index 0
        verifiers.push(address(0));

        for (uint256 i = 0; i < _verifiers.length; i++) {
            verifiers.push(_verifiers[i]);
            verifierAddressToIndex[_verifiers[i]] = i.add(1);
        }

        requiredVerifiers = calculateRequiredVerifiers();

        nctEthExchangeRate = _nctEthExchangeRate;
        fees = calculateFees();

        token = ERC20(_token);
        feeWallet = _feeWallet;
    }

    /** Disable usage of the fallback function */
    function () external payable {
        revert("Do not allow sending Eth to this contract");
    }

    // TODO: Allow existing verifiers to vote on adding/removing others
    function addVerifier(address addr) external onlyOwner {
        require(addr != address(0), "Invalid verifier address");
        require(verifierAddressToIndex[addr] == 0, "Address is already a verifier");

        uint256 index = verifiers.push(addr);
        verifierAddressToIndex[addr] = index.sub(1);

        requiredVerifiers = calculateRequiredVerifiers();
        fees = calculateFees();
    }

    // TODO: Allow existing verifiers to vote on adding/removing others
    function removeVerifier(address addr) external onlyOwner {
        require(addr != address(0), "Invalid verifier address");
        require(verifierAddressToIndex[addr] != 0, "Address is not a verifier");
        require(verifiers.length.sub(1) > MINIMUM_VERIFIERS, "Removing verifier would put number of verifiers below minimum");

        uint256 index = verifierAddressToIndex[addr];
        require(verifiers[index] == addr, "Verifier address not present in verifiers array");
        verifiers[index] = verifiers[verifiers.length.sub(1)];
        delete verifierAddressToIndex[addr];
        verifiers.length--;

        requiredVerifiers = calculateRequiredVerifiers();
        fees = calculateFees();
    }

    function activeVerifiers() public view returns (address[]) {
        require(verifiers.length > 0, "Invalid number of verifiers");

        address[] memory ret = new address[](verifiers.length.sub(1));

        // Skip dummy verifier at index 0
        for (uint256 i = 1; i < verifiers.length; i++) {
            ret[i.sub(1)] = verifiers[i];
        }

        return ret;
    }

    function numberOfVerifiers() public view returns (uint256) {
        require(verifiers.length > 0, "Invalid number of verifiers");
        return verifiers.length.sub(1);
    }

    function calculateRequiredVerifiers() internal view returns(uint256) {
        return numberOfVerifiers().mul(2).div(3);
    }

    function isVerifier(address addr) public view returns (bool) {
        return verifierAddressToIndex[addr] != 0 && verifiers[verifierAddressToIndex[addr]] == addr;
    }

    modifier onlyVerifier() {
        require(isVerifier(msg.sender), "msg.sender is not verifier");
        _;
    }

    function setNctEthExchangeRate(uint256 _nctEthExchangeRate) external onlyOwner {
        nctEthExchangeRate = _nctEthExchangeRate;
        fees = calculateFees();

        emit FeesChanged(fees);
    }

    function calculateFees() internal view returns (uint256) {
        uint256 estimatedGas = ESTIMATED_GAS_PER_VERIFIER.mul(numberOfVerifiers())
            .add(ESTIMATED_GAS_PER_WITHDRAWAL);
        return estimatedGas.mul(GAS_PRICE).mul(nctEthExchangeRate);
    }

    function approveWithdrawal(
        address destination,
        uint256 amount,
        bytes32 txHash,
        bytes32 blockHash,
        uint256 blockNumber
    )
        external
        onlyVerifier
    {
        bytes32 hash = keccak256(abi.encodePacked(txHash, blockHash, blockNumber));
        uint256 net = amount.sub(fees);

        if (withdrawals[hash].destination == address(0)) {
            withdrawals[hash] = Withdrawal(destination, net, new address[](0), false);
        }

        Withdrawal storage w = withdrawals[hash];
        require(w.destination == destination, "Destination mismatch");
        require(w.amount == net, "Amount mismatch");

        for (uint256 i = 0; i < w.approvals.length; i++) {
            require(w.approvals[i] != msg.sender, "Already approved withdrawal");
        }

        w.approvals.push(msg.sender);

        if (w.approvals.length >= requiredVerifiers && !w.processed) {
            if (fees != 0 && feeWallet != address(0)) {
                token.safeTransfer(feeWallet, fees);
            }

            token.safeTransfer(destination, net);

            w.processed = true;
            emit WithdrawalProcessed(destination, net, txHash, blockHash, blockNumber);
        }
    }

    // Allow verifiers to retract their withdrawals in the case of a chain
    // reorganization. This shouldn't happen but is possible.
    function unapproveWithdrawal(
        bytes32 txHash,
        bytes32 blockHash,
        uint256 blockNumber
    )
        external
        onlyVerifier
    {
        bytes32 hash = keccak256(abi.encodePacked(txHash, blockHash, blockNumber));
        require(withdrawals[hash].destination != address(0), "No such withdrawal");

        Withdrawal storage w = withdrawals[hash];
        require(!w.processed, "Withdrawal already processed");

        uint256 length = w.approvals.length;
        for (uint256 i = 0; i < length; i++) {
            if (w.approvals[i] == msg.sender) {
                w.approvals[i] = w.approvals[length.sub(1)];
                delete w.approvals[i];
                w.approvals.length--;
                break;
            }
        }
    }

    function anchor(bytes32 blockHash, uint256 blockNumber) external onlyVerifier {
        // solium-disable-next-line operator-whitespace
        if (anchors.length == 0 ||
            anchors[anchors.length.sub(1)].blockHash != blockHash ||
            anchors[anchors.length.sub(1)].blockNumber != blockNumber) {

            // TODO: Check required number of sigs on last block? What to do if
            // it doesn't validate?
            anchors.push(Anchor(blockHash, blockNumber, new address[](0), false));
        }

        Anchor storage a = anchors[anchors.length.sub(1)];
        require(a.blockHash == blockHash, "Block hash mismatch");
        require(a.blockNumber == blockNumber, "Block number mismatch");

        for (uint256 i = 0; i < a.approvals.length; i++) {
            require(a.approvals[i] != msg.sender, "Already approved anchor block");
        }

        a.approvals.push(msg.sender);
        if (a.approvals.length >= requiredVerifiers && !a.processed) {
            a.processed = true;
            emit AnchoredBlock(blockHash, blockNumber);
        }
    }

    function unanchor() external onlyVerifier {
        Anchor storage a = anchors[anchors.length.sub(1)];
        require(!a.processed, "Block anchor already processed");

        uint256 length = a.approvals.length;
        for (uint256 i = 0; i < length; i++) {
            if (a.approvals[i] == msg.sender) {
                a.approvals[i] = a.approvals[length.sub(1)];
                delete a.approvals[i];
                a.approvals.length--;
                break;
            }
        }
    }
}
