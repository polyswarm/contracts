pragma solidity ^0.4.21;

import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "zeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "./NectarToken.sol";
import "./BountyRegistry.sol";

contract ArbiterStaking is Pausable {
    using SafeMath for uint256;
    using SafeERC20 for NectarToken;

    uint256 public constant MINIMUM_STAKE = 10000000 * 10 ** 18;
    uint256 public constant MAXIMUM_STAKE = 100000000 * 10 ** 18;
    uint8 public constant VOTE_RATIO_NUMERATOR = 9;
    uint8 public constant VOTE_RATIO_DENOMINATOR = 10;
    string public constant VERSION = "1.0.0";

    // Deposits
    struct Deposit {
        uint256 blockNumber;
        uint256 value;
    }

    event NewDeposit(
        address indexed from,
        uint256 value
    );

    event NewWithdrawal(
        address indexed to,
        uint256 value
    );

    mapping(address => Deposit[]) public deposits;

    // Bounties
    event BountyRecorded(
        uint128 indexed guid,
        uint256 blockNumber
    );

    event BountyVoteRecorded(
        address arbiter
    );

    uint256 public numBounties;
    mapping(uint128 => bool) public bounties;
    mapping(address => uint256) public bountyResponses;
    mapping(uint128 => mapping(address => bool)) public bountyResponseByGuidAndAddress;

    uint256 public stakeDuration;
    NectarToken internal token;
    BountyRegistry internal registry;

    /**
     * Construct a new ArbiterStaking
     *
     * @param _token address of NCT token to use
     */
    constructor(address _token, uint256 _stakeDuration) Ownable() public {
        token = NectarToken(_token);
        stakeDuration = _stakeDuration;
    }

    /**
     * Sets the registry value with the live BountyRegistry

     * @param _bountyRegistry Address of BountyRegistry contract
     */
    function setBountyRegistry(address _bountyRegistry) public onlyOwner {
        registry = BountyRegistry(_bountyRegistry);
    }

    /**
     * Handle a deposit upon receiving approval for a token transfer
     * Called from NectarToken.approveAndCall
     *
     * @param _from Account depositing NCT
     * @param _value Amount of NCT being deposited
     * @param _tokenContract Address of the NCT contract
     * @return true if successful else false
     */
    function receiveApproval(
        address _from,
        uint256 _value,
        address _tokenContract,
        bytes
    )
        public
        whenNotPaused
        returns (bool)
    {
        require(msg.sender == address(token), "Must be called from the token.");
        return receiveApprovalInternal(_from, _value, _tokenContract, new bytes(0));
    }

    function receiveApprovalInternal(
        address _from,
        uint256 _value,
        address _tokenContract,
        bytes
    )
        internal
        whenNotPaused
        returns (bool)
    {
        require(registry.isArbiter(_from), "Deposit target is not an arbiter");
        // Ensure we are depositing something
        require(_value > 0, "Zero value being deposited");
        // Ensure we are called from he right token contract
        require(_tokenContract == address(token), "Invalid token being deposited");
        // Ensure that we are not staking more than the maximum
        require(balanceOf(_from).add(_value) <= MAXIMUM_STAKE, "Value greater than maximum stake");

        token.safeTransferFrom(_from, this, _value);
        deposits[_from].push(Deposit(block.number, _value));
        emit NewDeposit(_from, _value);

        return true;
    }

    /**
     * Deposit NCT (requires prior approval)
     *
     * @param value The amount of NCT to deposit
     */
    function deposit(uint256 value) public whenNotPaused {
        require(receiveApprovalInternal(msg.sender, value, token, new bytes(0)), "Depositing stake failed");
    }

    /**
     * Retrieve the (total) current balance of staked NCT for an account
     *
     * @param addr The account whos balance to retrieve
     * @return The current (total) balance of the account
     */
    function balanceOf(address addr) public view returns (uint256) {
        uint256 ret = 0;
        Deposit[] storage ds = deposits[addr];
        for (uint256 i = 0; i < ds.length; i++) {
            ret = ret.add(ds[i].value);
        }
        return ret;
    }

    /**
     * Retrieve the withdrawable current balance of staked NCT for an account
     *
     * @param addr The account whos balance to retrieve
     * @return The current withdrawable balance of the account
     */
    function withdrawableBalanceOf(address addr) public view returns (uint256) {
        uint256 ret = 0;
        if (block.number < stakeDuration) {
            return ret;
        }
        uint256 latest_block = block.number.sub(stakeDuration);
        Deposit[] storage ds = deposits[addr];
        for (uint256 i = 0; i < ds.length; i++) {
            if (ds[i].blockNumber <= latest_block) {
                ret = ret.add(ds[i].value);
            } else {
                break;
            }
        }
        return ret;
    }

    /**
     * Withdraw staked NCT
     * @param value The amount of NCT to withdraw
     */
    function withdraw(uint256 value) public whenNotPaused {
        require(deposits[msg.sender].length > 0, "Cannot withdraw without some deposits.");
        uint256 remaining = value;
        uint256 latest_block = block.number.sub(stakeDuration);
        Deposit[] storage ds = deposits[msg.sender];

        require(value <= withdrawableBalanceOf(msg.sender), "Value exceeds withdrawable balance");

        // Determine which deposits we will modifiy
        for (uint256 end = 0; end < ds.length; end++) {
            if (ds[end].blockNumber <= latest_block) {
                if (ds[end].value >= remaining) {
                    ds[end].value = ds[end].value.sub(remaining);
                    if (ds[end].value == 0) {
                        end++;
                    }
                    remaining = 0;
                    break;
                } else {
                    remaining = remaining.sub(ds[end].value);
                }
            } else {
                break;
            }
        }

        // If we haven't hit our value by now, we don't have enough available
        // funds
        require(remaining == 0, "Value exceeds withdrawable balance");

        // Delete the obsolete deposits
        for (uint256 i = 0; i < ds.length.sub(end); i++) {
            ds[i] = ds[i.add(end)];
        }

        for (i = ds.length.sub(end); i < ds.length; i++) {
            delete ds[i];
        }

        ds.length = ds.length.sub(end);

        // Do the transfer
        token.safeTransfer(msg.sender, value);
        emit NewWithdrawal(msg.sender, value);
    }

    /**
     * Is an address an eligible arbiter?
     * @param addr The address to validate
     * @return true if address is eligible else false
     */
    function isEligible(address addr) public view returns (bool) {
        uint256 num;
        uint256 den;
        (num, den) = arbiterResponseRate(addr);

        return balanceOf(addr) >= MINIMUM_STAKE &&
            (den < VOTE_RATIO_DENOMINATOR || num.mul(VOTE_RATIO_DENOMINATOR).div(den) >= VOTE_RATIO_NUMERATOR);
    }

    /**
     * Record a bounty that an arbiter has voted on
     *
     * @param arbiter The address of the arbiter
     * @param bountyGuid The guid of the bounty
     */
    function recordBounty(address arbiter, uint128 bountyGuid, uint256 blockNumber) public {
        require(msg.sender == address(registry), "Can only be called by the BountyRegistry.");
        require(arbiter != address(0), "Invalid arbiter address");
        require(blockNumber != 0, "Invalid block number");

        // New bounty
        if (!bounties[bountyGuid]) {
            bounties[bountyGuid] = true;
            numBounties = numBounties.add(1);
            emit BountyRecorded(bountyGuid, blockNumber);
        }

        // First response to this bounty by this arbiter
        if (!bountyResponseByGuidAndAddress[bountyGuid][arbiter]) {
            bountyResponseByGuidAndAddress[bountyGuid][arbiter] = true;
            bountyResponses[arbiter] = bountyResponses[arbiter].add(1);
        }

        emit BountyVoteRecorded(arbiter);
    }

    /**
     * Determines the ratio of past bounties that the arbiter has responded to
     *
     * @param arbiter The address of the arbiter
     * @return number of bounties responded to, number of bounties considered
     */
    function arbiterResponseRate(address arbiter) public view returns (uint256 num, uint256 den) {
        num = bountyResponses[arbiter];
        den = numBounties;
    }
}
