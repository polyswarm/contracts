pragma solidity ^0.4.18;

import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";
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
        uint256 verdicts;
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

    address internal owner;
    NectarToken internal token;

    // 0.0625NCT (1/16)
    uint256 public constant BOUNTY_FEE = 62500000000000000;
    uint256 public constant ASSERTION_FEE = 62500000000000000;
    uint256 public constant BOUNTY_AMOUNT_MINIMUM = 62500000000000000;
    uint256 public constant ASSERTION_BID_MINIMUM = 62500000000000000;
    uint256 public constant ARBITER_LOOKBACK_RANGE = 100;

    uint128[] public bountyGuids;
    mapping (uint128 => Bounty) public bountiesByGuid;
    mapping (uint128 => Assertion[]) public assertionsByGuid;
    mapping (address => bool) public arbiters;

    /**
     * Construct a new BountyRegistry
     *
     * @param nectarTokenAddr address of NCT token to use
     */
    function BountyRegistry(address nectarTokenAddr) public {
        owner = msg.sender;
        token = NectarToken(nectarTokenAddr);
    }

    /** Function only callable by arbiter */
    modifier onlyArbiter() {
        require(arbiters[msg.sender]);
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
        AddedArbiter(newArbiter, blockNumber);
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
        RemovedArbiter(arbiter, blockNumber);
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

        Bounty memory b = Bounty(
            guid,
            msg.sender,
            amount,
            artifactURI,
            durationBlocks.add(block.number),
            false,
            0
        );
        bountiesByGuid[guid] = b;
        bountyGuids.push(guid);

        NewBounty(
            b.guid,
            b.author,
            b.amount,
            b.artifactURI,
            b.expirationBlock
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

        NewAssertion(
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
    function settleBounty(
        uint128 bountyGuid,
        uint256 verdicts
    )
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

        bountiesByGuid[bountyGuid].verdicts = verdicts;
        bountiesByGuid[bountyGuid].resolved = true;

        uint256 i = 0;

        uint256 numAssertions = assertions.length;
        uint256 pot = bounty.amount;
        uint256 fees = BOUNTY_FEE.add(ASSERTION_FEE.mul(numAssertions));

        uint256 numLosers = 0;
        for (i = 0; i < numAssertions; i++) {
            // TODO: For now, verdicts are all-or-nothing
            if (assertions[i].verdicts != verdicts) {
                pot = pot.add(assertions[i].bid);
                numLosers = numLosers.add(1);
            }
        }

        // Arbiter will get a split too
        uint256 numWinners = numAssertions.sub(numLosers).add(1);
        // Split is bounty amount + all bids divided by number of winners,
        // rounded down. Remainder goes to arbiter.
        uint256 split = pot.div(numWinners);
        uint256 remainder = pot % numWinners;

        uint256 reward = 0;
        for (i = 0; i < numAssertions; i++) {
            if (assertions[i].verdicts == verdicts) {
                reward = assertions[i].bid.add(split);
                // TODO: Don't revert if one transfer fails, what to do?
                // Transfers are not expected to ever fail though
                require(token.transfer(assertions[i].author, reward));
            }
        }

        // Transfer remainder of pot to arbiter, handles fractional NCT remainders
        require(token.transfer(msg.sender, split.add(fees).add(remainder)));

        NewVerdict(bountyGuid, verdicts);
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
