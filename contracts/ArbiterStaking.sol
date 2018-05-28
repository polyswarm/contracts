pragma solidity ^0.4.21;

import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "zeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "./NectarToken.sol";

contract ArbiterStaking is Pausable {
    using SafeMath for uint256;
    using SafeERC20 for NectarToken;

    uint256 public constant MINIMUM_STAKE = 10000000 * 10 ** 18;
    uint256 public constant MAXIMUM_STAKE = 100000000 * 10 ** 18;
    uint8 public constant VOTE_RATIO_NUMERATOR = 9;
    uint8 public constant VOTE_RATIO_DENOMINATOR = 10;

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
    struct Bounty {
        uint128 guid;
        uint256 blockNumber;
    }

    event NewBounty(
        uint128 indexed guid,
        uint256 blockNumber
    );

    Bounty[] public bounties;
    mapping(uint128 => mapping(address => bool)) public bountyResponseByGuidAndAddress;
    mapping(uint128 => uint256) internal bountyGuidToIndex;

    uint256 public stakeDuration;
    NectarToken internal token;

    /**
     * Construct a new ArbiterStaking
     *
     * @param _token address of NCT token to use
     */
    constructor(address _token, uint256 _stakeDuration) Ownable() public {
        token = NectarToken(_token);
        stakeDuration = _stakeDuration;

        // Push a dummy bounty at index 0
        bounties.push(Bounty(0, 0));
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
        // Ensure we are depositing something
        require(_value > 0);
        // Ensure we're being called from he right token contract
        require(_tokenContract == address(token));
        // Ensure that we are not staking more than the maximum
        require(balanceOf(_from).add(_value) <= MAXIMUM_STAKE);

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
        require(receiveApproval(msg.sender, value, token, new bytes(0)));
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
        uint256 remaining = value;
        uint256 latest_block = block.number.sub(stakeDuration);
        Deposit[] storage ds = deposits[msg.sender];

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
        require(remaining == 0);

        // Delete the obsolete deposits
        for (uint256 i = 0; i < ds.length.sub(end); i++) {
            ds[i] = ds[i.add(end)];
        }
        for (i = ds.length.sub(end); i < ds.length; i++) {
            delete ds[i];
        }
        ds.length -= end;

        // Do the transfer
        token.safeTransfer(msg.sender, value);
        emit NewWithdrawal(msg.sender, value);
    }

    /**
     * Is an address an elligible arbiter?
     * @param addr The address to validate
     * @return true if address is elligible else false
     */
    function isElligible(address addr) public view returns (bool) {
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
    function recordBounty(address arbiter, uint128 bountyGuid, uint256 blockNumber) public onlyOwner {
        require(arbiter != address(0));
        require(blockNumber != 0);

        if (bountyGuidToIndex[bountyGuid] == 0) {
            // Find a spot for our new bounty, shouldn't be far from end
            for (uint256 start = bounties.length; start > 0; start--) {
                if (bounties[start.sub(1)].blockNumber <= blockNumber) {
                    break;
                }
            }

            bounties.length++;
            for (uint256 i = bounties.length.sub(1); i > start; i--) {
                bounties[i] = bounties[i.sub(1)];
            }

            bounties[start] = Bounty(bountyGuid, blockNumber);
            bountyGuidToIndex[bountyGuid] = start;

            emit NewBounty(bountyGuid, blockNumber);
        }

        bountyResponseByGuidAndAddress[bountyGuid][arbiter] = true;
    }

    /**
     * Determines the ratio of past verdicts that the arbiter has responded to
     *
     * @param arbiter The address of the arbiter
     * @return number of bounties responded to, number of bounties considered
     */
    function arbiterResponseRate(address arbiter) public view returns (uint256 num, uint256 den) {
        uint256 start = 0;
        if (block.number > stakeDuration) {
            for (start = bounties.length.sub(1); start > 0; start--) {
                if (bounties[start].blockNumber < block.number.sub(stakeDuration)) {
                    break;
                }
            }
        }

        // We go one past, so increment
        start = start.add(1);
        den = bounties.length.sub(start);

        for (uint256 i = start; i < bounties.length; i++) {
            if (bountyResponseByGuidAndAddress[bounties[i].guid][arbiter]) {
                num = num.add(1);
            }
        }
    }
}
