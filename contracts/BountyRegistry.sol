pragma solidity ^0.4.21;

import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "./ArbiterStaking.sol";
import "./NectarToken.sol";


contract BountyRegistry is Pausable {
    using SafeMath for uint256;

    struct Bounty {
        uint128 guid;
        address author;
        uint256 amount;
        string artifactURI;
        uint256 expirationBlock;
        bool resolved;
        uint256[] verdicts;
        address[] voters;
        uint256 votingLimitBlock;
    }

    struct Assertion {
        address author;
        uint256 bid;
        uint256 mask;
        uint256 verdicts;
        string metadata;
    }

    event AddedArbiter(
        address arbiter,
        uint256 blockNumber
    );

    event RemovedArbiter(
        address arbiter,
        uint256 blockNumber
    );

    event NewBounty(
        uint128 guid,
        address author,
        uint256 amount,
        string artifactURI,
        uint256 expirationBlock
    );

    event NewAssertion(
        uint128 bountyGuid,
        address author,
        uint256 index,
        uint256 bid,
        uint256 mask,
        uint256 verdicts,
        string metadata
    );

    event NewVerdict(
        uint128 bountyGuid,
        uint256 verdicts
    );

    ArbiterStaking public staking;
    NectarToken internal token;

    // 0.0625NCT (1/16)
    uint256 public constant BOUNTY_FEE = 62500000000000000;
    uint256 public constant ASSERTION_FEE = 62500000000000000;
    uint256 public constant BOUNTY_AMOUNT_MINIMUM = 62500000000000000;
    uint256 public constant ASSERTION_BID_MINIMUM = 62500000000000000;
    uint256 public constant ARBITER_LOOKBACK_RANGE = 100;
    uint256 public constant ARBITER_VOTE_WINDOW = 25; // BLOCKS

    // ~4 months in blocks
    uint256 public constant STAKE_DURATION = 701333;

    uint128[] public bountyGuids;
    mapping (uint128 => Bounty) public bountiesByGuid;
    mapping (uint128 => Assertion[]) public assertionsByGuid;
    mapping (address => bool) public arbiters;
    mapping (uint256 => mapping (uint256 => uint256)) verdictCountByGuid;

    /**
     * Construct a new BountyRegistry
     *
     * @param _token address of NCT token to use
     */
    constructor(address _token) Ownable() public {
        owner = msg.sender;
        staking = new ArbiterStaking(_token, STAKE_DURATION);
        token = NectarToken(_token);
    }

    /** Function only callable by arbiter */
    modifier onlyArbiter() {
        require(arbiters[msg.sender]);
        require(staking.isElligible(msg.sender));
        _;
    }

    /**
     * Function called to add an arbiter, emits an evevnt with the added arbiter
     * and block number used to calculate their arbiter status based on public
     * arbiter selection algorithm.
     *
     * @param newArbiter the arbiter to add
     * @param blockNumber the block number the determination to add was
     *      calculated from
     */
    function addArbiter(address newArbiter, uint256 blockNumber) external whenNotPaused onlyOwner {
        require(newArbiter != address(0));
        require(!arbiters[newArbiter]);

        arbiters[newArbiter] = true;
        emit AddedArbiter(newArbiter, blockNumber);
    }

    /**
     * Function called to remove an arbiter, emits an evevnt with the removed
     * arbiter and block number used to calculate their arbiter status based on
     * public arbiter selection algorithm.
     *
     * @param arbiter the arbiter to remove
     * @param blockNumber the block number the determination to remove was
     *      calculated from
     */
    function removeArbiter(address arbiter, uint256 blockNumber) external whenNotPaused onlyOwner {
        arbiters[arbiter] = false;
        emit RemovedArbiter(arbiter, blockNumber);
    }

    /**
     * Function called by end users and ambassadors to post a bounty
     *
     * @param guid the guid of the bounty, must be unique
     * @param amount the amount of NCT to post as a reward
     * @param artifactURI uri of the artifacts comprising this bounty
     * @param durationBlocks duration of this bounty in blocks
     */
    function postBounty(
        uint128 guid,
        uint256 amount,
        string artifactURI,
        uint256 durationBlocks
    )
        external
        whenNotPaused
    {
        // Check if a bounty with this GUID has already been initialized
        require(bountiesByGuid[guid].author == address(0));
        // Check that our bounty amount is sufficient
        require(amount >= BOUNTY_AMOUNT_MINIMUM);
        // Check that our URI is non-empty
        require(bytes(artifactURI).length > 0);
        // Check that our duration is non-zero
        require(durationBlocks > 0);

        // Assess fees and transfer bounty amount into escrow
        require(token.transferFrom(msg.sender, address(this), amount.add(BOUNTY_FEE)));

        bountiesByGuid[guid].guid = guid;
        bountiesByGuid[guid].author = msg.sender;
        bountiesByGuid[guid].amount = amount;
        bountiesByGuid[guid].artifactURI = artifactURI;
        bountiesByGuid[guid].expirationBlock = durationBlocks.add(block.number);
        bountiesByGuid[guid].votingLimitBlock = ARBITER_VOTE_WINDOW.add(bountiesByGuid[guid].expirationBlock);

        bountyGuids.push(guid);

        emit NewBounty(
            bountiesByGuid[guid].guid,
            bountiesByGuid[guid].author,
            bountiesByGuid[guid].amount,
            bountiesByGuid[guid].artifactURI,
            bountiesByGuid[guid].expirationBlock
        );
    }

    /**
     * Function called by security experts to post an assertion on a bounty
     *
     * @param bountyGuid the guid of the bounty to assert on
     * @param bid the amount of NCT to stake
     * @param mask the artifacts to assert on from the set in the bounty
     * @param verdicts the verdicts making up this assertion
     * @param metadata optional metadata to include in the assertion
     */
    function postAssertion(
        uint128 bountyGuid,
        uint256 bid,
        uint256 mask,
        uint256 verdicts,
        string metadata
    )
        external
        whenNotPaused
    {
        // Check if this bounty has been initialized
        require(bountiesByGuid[bountyGuid].author != address(0));
        // Check that our bid amount is sufficient
        require(bid >= ASSERTION_BID_MINIMUM);
        // Check if this bounty is active
        require(bountiesByGuid[bountyGuid].expirationBlock > block.number);

        // Assess fees and transfer bid amount into escrow
        require(token.transferFrom(msg.sender, address(this), bid.add(ASSERTION_FEE)));

        Assertion memory a = Assertion(
            msg.sender,
            bid,
            mask,
            verdicts,
            metadata
        );

        uint256 index = assertionsByGuid[bountyGuid].push(a) - 1;

        emit NewAssertion(
            bountyGuid,
            a.author,
            index,
            a.bid,
            a.mask,
            a.verdicts,
            a.metadata
        );
    }

    /**
     * Function called by arbiter after bounty expiration to settle with their
     * ground truth determination and pay out assertion rewards
     *
     * @param bountyGuid the guid of the bounty to settle
     * @param verdicts bitset of verdicts representing ground truth for the
     *      bounty's artifacts
     */

    function voteOnBounty(
        uint128 bountyGuid,
        uint256 verdicts
    )
        external
        onlyArbiter
        whenNotPaused
    {
        Bounty storage bounty = bountiesByGuid[bountyGuid];

        // Check if this bounty has been initialized
        require(bounty.author != address(0));
        // Check if the deadline has expired
        require(bounty.expirationBlock <= block.number);
        // Check if the voting window has closed
        require(bounty.votingLimitBlock > block.number);

        bounty.verdicts.push(verdicts);
        bounty.voters.push(msg.sender);

        staking.recordBounty(msg.sender, bountyGuid, block.number);
        
        emit NewVerdict(bountyGuid, verdicts);
    }

    /**
     * Function called by an arbiter after window has closed to add ground truth determination
     *
     * This function will pay out rewards if the the bounty has a super majority
     * @param bountyGuid the guid of the bounty to settle
     */

    function settleBounty(uint128 bountyGuid)
        external
        onlyArbiter
        whenNotPaused
    {
        Bounty memory bounty = bountiesByGuid[bountyGuid];
        Assertion[] memory assertions = assertionsByGuid[bountyGuid];

        // Check if this bounty has been initialized
        require(bounty.author != address(0));
        // Check if the deadline has expired
        require(bounty.expirationBlock <= block.number);
        // Check if the voting window has closed
        require(bounty.votingLimitBlock <= block.number);

        bountiesByGuid[bountyGuid].resolved = true;

        uint256 i = 0;
        uint256 numAssertions = assertions.length;

        uint256 lastVerdictCount;
        uint256 verdictWithHighestCount;

        for (i = 0; i < bounty.verdicts.length; i++) {
            uint256 verdict = bounty.verdicts[i];

            verdictCountByGuid[bountyGuid][verdict]++;

            if (verdictCountByGuid[bountyGuid][verdict] > lastVerdictCount) {
                lastVerdictCount = verdictCountByGuid[bountyGuid][verdict];
                verdictWithHighestCount = verdict;
            }

        }

        if (lastVerdictCount.mul(1000) < bounty.verdicts.length.mul(1000).div(3).mul(2)) {
            // if the arbiters counldn't reach super majority we return the bids in escrow
            for (i = 0; i < numAssertions; i++) {
                require(token.transfer(assertions[i].author, assertions[i].bid));
            }

        } else {
            disperseRewards(bountyGuid, verdictWithHighestCount, bounty.amount);
        }

    }

    /**
     * Gets a random Arbiter weighted by the amount of Nectar they have
     *
     * @param bountyGuid the guid of the bounty
     * @param verdictWithHighestCount arbiter verdict with the highest numer in agreement
     * @param bountyAmount the amount the bounty was put up for
     */

    function disperseRewards(uint128 bountyGuid, uint256 verdictWithHighestCount, uint256 bountyAmount) constant private {
        uint256 numLosers = 0;
        uint256 i = 0;
        uint256 pot = bountyAmount;

        Assertion[] memory assertions = assertionsByGuid[bountyGuid];

        uint256 fees = BOUNTY_FEE.add(ASSERTION_FEE.mul(assertions.length));

        for (i = 0; i < assertions.length; i++) {
            // TODO: For now, verdicts are all-or-nothing
            if (assertions[i].verdicts != verdictWithHighestCount) {
                pot = pot.add(assertions[i].bid);
                numLosers = numLosers.add(1);
            }
        }

        // Arbiter will get a split too
        uint256 numWinners = assertions.length.sub(numLosers).add(1);
        // Split is bounty amount + all bids divided by number of winners,
        // rounded down. Remainder goes to arbiter.
        uint256 split = pot.div(numWinners);
        uint256 remainder = pot % numWinners;

        uint256 reward = 0;

        for (i = 0; i < assertions.length; i++) {
            if (assertions[i].verdicts == verdictWithHighestCount) {
                reward = assertions[i].bid.add(split);
                // TODO: Don't revert if one transfer fails, what to do?
                // Transfers are not expected to ever fail though
                require(token.transfer(assertions[i].author, reward));
            }
        }

        // Transfer remainder of pot to arbiter, handles fractional NCT remainders
        require(token.transfer(getWeightedRandomArbiter(bountyGuid), split.add(fees).add(remainder)));

    }

    /**
     *  Generates a random number from 0 to range based on the last block hash 
     *
     *  @param seed random number for reprocucing
     *  @param range end range for random number
     */
    function randomGen(uint seed, int256 range) constant returns (int256 randomNumber) {
        return int256(int256(sha3(block.blockhash(block.number-1), seed ))%range);
    }

    /**
     * Gets a random Arbiter weighted by the amount of Nectar they have
     *
     * @param bountyGuid the guid of the bounty
     */

    function getWeightedRandomArbiter(uint128 bountyGuid) public constant returns (address voter) {
        require(bountiesByGuid[bountyGuid].author != address(0));

        Bounty memory bounty = bountiesByGuid[bountyGuid];
        uint i;
        int256 sum;
        int256 randomNum;

        for (i = 0; i < bounty.voters.length; i++) {
            sum += int256(token.balanceOf(bounty.voters[i]));
        }

        randomNum = randomGen(block.number, sum);

        for (i = 0; i < bounty.voters.length; i++) {
            randomNum -= int256(token.balanceOf(bounty.voters[i]));

            if (randomNum <= 0) {
                voter = bounty.voters[i];
                break;
            }
        }

    }

    /**
     * Get the total number of bounties tracked by the contract
     * @return total number of bounties
     */
    function getNumberOfBounties() external view returns (uint) {
        return bountyGuids.length;
    }

    /**
     * Gets the number of assertions for a bounty
     *
     * @param bountyGuid the guid of the bounty
     * @return number of assertions for the given bounty
     */
    function getNumberOfAssertions(uint128 bountyGuid) external view returns (uint) {
        // Check if this bounty has been initialized
        require(bountiesByGuid[bountyGuid].author != address(0));

        return assertionsByGuid[bountyGuid].length;
    }

    /**
     * Gets the vote count for a specific bounty
     *
     * @param bountyGuid the guid of the bounty
     */

    function getVerdictCount(uint128 bountyGuid) external view returns (uint) {
        require(bountiesByGuid[bountyGuid].author != address(0));

        return bountiesByGuid[bountyGuid].verdicts.length;
    }

    /**
     * Gets all the voters for a specific bounty
     *
     * @param bountyGuid the guid of the bounty
     */

    function getVoters(uint128 bountyGuid) external view returns (address[]) {
        require(bountiesByGuid[bountyGuid].author != address(0));

        uint count = bountiesByGuid[bountyGuid].voters.length;

        address[] memory voters = new address[](count);

        for (uint i = 0; i < count; i++) {
            voters[i] = bountiesByGuid[bountyGuid].voters[i];
        }

        return voters;
    }

    /** Candidate for future arbiter */
    struct Candidate {
        address addr;
        uint256 count;
    }

    /**
     * View function displays most active bounty posters over past
     * ARBITER_LOOKBACK_RANGE bounties to select future arbiters
     *
     * @return sorted array of most active bounty posters
     */
    function getArbiterCandidates() external view returns (address[]) {
        require(bountyGuids.length > 0);

        uint256 count = 0;
        Candidate[] memory candidates = new Candidate[](ARBITER_LOOKBACK_RANGE);

        uint256 lastBounty = 0;
        if (bountyGuids.length > ARBITER_LOOKBACK_RANGE) {
            lastBounty = bountyGuids.length.sub(ARBITER_LOOKBACK_RANGE);
        }

        for (uint256 i = bountyGuids.length; i > lastBounty; i--) {
            address addr = bountiesByGuid[bountyGuids[i.sub(1)]].author;
            bool found = false;
            for (uint256 j = 0; j < count; j++) {
                if (candidates[j].addr == addr) {
                    candidates[j].count = candidates[j].count.add(1);
                    found = true;
                    break;
                }
            }

            if (!found) {
                candidates[count] = Candidate(addr, 1);
                count = count.add(1);
            }
        }

        address[] memory ret = new address[](count);

        for (i = 0; i < ret.length; i++) {
            uint256 next = 0;
            uint256 value = candidates[0].count;

            for (j = 0; j < count; j++) {
                if (candidates[j].count > value) {
                    next = j;
                    value = candidates[j].count;
                }
            }

            ret[i] = candidates[next].addr;
            candidates[next] = candidates[count.sub(1)];
            count = count.sub(1);
        }

        return ret;
    }
}
