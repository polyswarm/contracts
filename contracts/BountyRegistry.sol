pragma solidity ^0.4.21;

import "zeppelin-solidity/contracts/lifecycle/Pausable.sol";
import "zeppelin-solidity/contracts/math/SafeMath.sol";
import "zeppelin-solidity/contracts/token/ERC20/SafeERC20.sol";
import "./ArbiterStaking.sol";
import "./NectarToken.sol";


contract BountyRegistry is Pausable {
    using SafeMath for uint256;
    using SafeERC20 for NectarToken;

    struct Bounty {
        uint128 guid;
        address author;
        uint256 amount;
        string artifactURI;
        uint256 numArtifacts;
        uint256 expirationBlock;
        address assignedArbiter;
        bool quorumReached;
        uint256 quorumBlock;
        uint256[8] bloom;
        address[] voters;
        uint256[] verdicts;
        bool[] bloomVotes;
        mapping (uint256 => uint256) quorumVerdicts;
    }

    struct Assertion {
        address author;
        uint256 bid;
        uint256 mask;
        uint256 commitment;
        uint256 nonce;
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
        uint256 commitment
    );

    event RevealedAssertion(
        uint128 bountyGuid,
        address author,
        uint256 index,
        uint256 nonce,
        uint256 verdicts,
        string metadata
    );

    event NewVerdict(
        uint128 bountyGuid,
        uint256 verdicts
    );

    event QuorumReached(
        uint256 block
    );

    ArbiterStaking public staking;
    NectarToken internal token;

    // 0.0625NCT (1/16)
    uint256 public constant BOUNTY_FEE = 62500000000000000;
    uint256 public constant ASSERTION_FEE = 62500000000000000;
    uint256 public constant BOUNTY_AMOUNT_MINIMUM = 62500000000000000;
    uint256 public constant ASSERTION_BID_MINIMUM = 62500000000000000;
    uint256 public constant ARBITER_LOOKBACK_RANGE = 100;
    uint256 public constant ASSERTION_REVEAL_WINDOW = 25; // BLOCKS
    uint256 public constant MALICIOUS_VOTE_COEFFICIENT = 10;
    uint256 public constant BENIGN_VOTE_COEFFICIENT = 1;


    uint256 public arbiterCount;
    uint256 public arbiterVoteWindow;
    uint128[] public bountyGuids;
    mapping (uint128 => Bounty) public bountiesByGuid;
    mapping (uint128 => Assertion[]) public assertionsByGuid;
    mapping (address => bool) public arbiters;
    mapping (uint256 => mapping (uint256 => uint256)) public verdictCountByGuid;
    mapping (uint256 => mapping (address => bool)) public arbiterVoteResgistryByGuid;
    mapping (uint256 => mapping (address => bool)) public expertAssertionResgistryByGuid;
    mapping (uint128 => mapping (address => bool)) public bountySettled;

    /**
     * Construct a new BountyRegistry
     *
     * @param _token address of NCT token to use
     */
    constructor(address _token, uint256 _arbiterVoteWindow, uint256 _stakeDuration) Ownable() public {
        owner = msg.sender;
        token = NectarToken(_token);
        staking = new ArbiterStaking(_token, _stakeDuration);
        arbiterVoteWindow = _arbiterVoteWindow;
    }

    /**
     * Function to check if an address is a valid arbiter
     *
     * @param addr The address to check
     * @return true if addr is a valid arbiter else false
     */
    function isArbiter(address addr) public view returns (bool) {
        // Remove arbiter requirements for now, while we are whitelisting
        // arbiters on the platform
        //return arbiters[addr] && staking.isEligible(addr);
        return arbiters[addr];
    }

    /** Function only callable by arbiter */
    modifier onlyArbiter() {
        require(isArbiter(msg.sender));
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
        arbiterCount = arbiterCount.add(1);
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
        arbiterCount = arbiterCount.sub(1);
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
        uint256 numArtifacts,
        uint256 durationBlocks,
        uint256[8] bloom
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
        // Check that our number of artifacts is valid
        require(numArtifacts <= 256);
        // Check that our duration is non-zero
        require(durationBlocks > 0);

        // Assess fees and transfer bounty amount into escrow
        token.safeTransferFrom(msg.sender, address(this), amount.add(BOUNTY_FEE));

        bountiesByGuid[guid].guid = guid;
        bountiesByGuid[guid].author = msg.sender;
        bountiesByGuid[guid].amount = amount;
        bountiesByGuid[guid].artifactURI = artifactURI;
        // FIXME
        bountiesByGuid[guid].numArtifacts = numArtifacts;
        bountiesByGuid[guid].expirationBlock = durationBlocks.add(block.number);
        bountiesByGuid[guid].bloom = bloom;

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
     * @param commitment a commitment hash of the verdicts being asserted, equal
     *      to keccak256(verdicts ^ keccak256(nonce)) where nonce != 0
     */
    function postAssertion(
        uint128 bountyGuid,
        uint256 bid,
        uint256 mask,
        uint256 commitment
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
        // Check if the sender has already made an assertion
        require(expertAssertionResgistryByGuid[bountyGuid][msg.sender] == false);
        // Assess fees and transfer bid amount into escrow
        token.safeTransferFrom(msg.sender, address(this), bid.add(ASSERTION_FEE));

        expertAssertionResgistryByGuid[bountyGuid][msg.sender] = true;

        Assertion memory a = Assertion(
            msg.sender,
            bid,
            mask,
            commitment,
            0,
            0,
            ""
        );

        uint256 index = assertionsByGuid[bountyGuid].push(a) - 1;

        emit NewAssertion(
            bountyGuid,
            a.author,
            index,
            a.bid,
            a.mask,
            a.commitment
        );
    }

    // https://ethereum.stackexchange.com/questions/4170/how-to-convert-a-uint-to-bytes-in-solidity
    function uint256_to_bytes(uint256 x) internal pure returns (bytes b) {
        b = new bytes(32);
        assembly { mstore(add(b, 32), x) }
    }

    /**
     * Function called by security experts to reveal an assertion after bounty
     * expiration
     *
     * @param bountyGuid the guid of the bounty to assert on
     * @param assertionId the id of the assertion to reveal
     * @param assertionId the id of the assertion to reveal
     * @param nonce the nonce used to generate the commitment hash
     * @param verdicts the verdicts making up this assertion
     * @param metadata optional metadata to include in the assertion
     */
    function revealAssertion(
        uint128 bountyGuid,
        uint256 assertionId,
        uint256 nonce,
        uint256 verdicts,
        string metadata
    )
        external
        whenNotPaused
    {
        // Check if this bounty has been initialized
        require(bountiesByGuid[bountyGuid].author != address(0));
        // Check that the bounty is no longer active
        require(bountiesByGuid[bountyGuid].expirationBlock <= block.number);
        // Check if the reveal round has closed
        require(bountiesByGuid[bountyGuid].expirationBlock.add(ASSERTION_REVEAL_WINDOW) > block.number);
        // Zero is defined as an invalid nonce
        require(nonce != 0);

        // Check our id
        require(assertionId < assertionsByGuid[bountyGuid].length);

        Assertion storage a = assertionsByGuid[bountyGuid][assertionId];
        require(a.author == msg.sender);
        require(a.nonce == 0);

        // Check our commitment hash
        uint256 hashed_nonce = uint256(keccak256(uint256_to_bytes(nonce)));
        uint256 commitment = uint256(keccak256(uint256_to_bytes(verdicts ^ hashed_nonce)));
        require(commitment == a.commitment);

        a.nonce = nonce;
        a.verdicts = verdicts;
        a.metadata = metadata;

        emit RevealedAssertion(
            bountyGuid,
            a.author,
            assertionId,
            a.nonce,
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
        uint256 verdicts,
        bool validBloom
    )
        external
        onlyArbiter
        whenNotPaused
    {
        Bounty storage bounty = bountiesByGuid[bountyGuid];

        // Check if this bounty has been initialized
        require(bounty.author != address(0));
        // Check that the reveal round has closed
        require(bounty.expirationBlock.add(ASSERTION_REVEAL_WINDOW) <= block.number);
        // Check if the voting round has closed
        require(bounty.expirationBlock.add(ASSERTION_REVEAL_WINDOW).add(arbiterVoteWindow) > block.number);
        // Check to make sure arbiters can't double vote
        require(arbiterVoteResgistryByGuid[bountyGuid][msg.sender] == false);
        // Check for quorum
        require(bounty.quorumReached == false);

        bounty.verdicts.push(verdicts);
        bounty.voters.push(msg.sender);
        bounty.bloomVotes.push(validBloom);

        staking.recordBounty(msg.sender, bountyGuid, block.number);
        arbiterVoteResgistryByGuid[bountyGuid][msg.sender] = true;

        uint256 quorumCount = 0;

        if (bounty.quorumReached == false) {
            for (uint256 i = 0; i < bounty.numArtifacts; i++) {
                uint256 malVotes = bounty.quorumVerdicts[i];
                // removing 1 to exclude the current voter
                uint256 benignVotes = bounty.voters.length.sub(bounty.quorumVerdicts[i]).sub(1);
                //
                uint256 maxBenignValue = arbiterCount.sub(malVotes).mul(BENIGN_VOTE_COEFFICIENT);
                uint256 maxMalValue = arbiterCount.sub(benignVotes).mul(MALICIOUS_VOTE_COEFFICIENT);

                // check for previous quorum on artifact and skip if so
                if (malVotes.mul(MALICIOUS_VOTE_COEFFICIENT) >= maxBenignValue) {
                    quorumCount = quorumCount.add(1);
                    bounty.quorumVerdicts[i] = bounty.voters.length;
                    continue;
                } else if (benignVotes.mul(BENIGN_VOTE_COEFFICIENT) > maxMalValue) {
                    quorumCount = quorumCount.add(1);
                    bounty.quorumVerdicts[i] = 0;
                    continue;
                }

                if (verdicts & (1 << i) != 0) {
                    bounty.quorumVerdicts[i] = bounty.quorumVerdicts[i].add(1);
                }

                // check to see if we have quorum now
                malVotes = bounty.quorumVerdicts[i];
                benignVotes = bounty.voters.length.sub(bounty.quorumVerdicts[i]);
                maxBenignValue = arbiterCount.sub(malVotes).mul(BENIGN_VOTE_COEFFICIENT);
                maxMalValue = arbiterCount.sub(benignVotes).mul(MALICIOUS_VOTE_COEFFICIENT);

                if (malVotes.mul(MALICIOUS_VOTE_COEFFICIENT) >= maxBenignValue) {
                    quorumCount = quorumCount.add(1);
                    bounty.quorumVerdicts[i] = bounty.voters.length;
                } else if (benignVotes.mul(BENIGN_VOTE_COEFFICIENT) > maxMalValue) {
                    quorumCount = quorumCount.add(1);
                    bounty.quorumVerdicts[i] = 0;
                }

            }
        }

        emit NewVerdict(bountyGuid, verdicts);

        // check if all arbiters have voted or if we have quorum for all the artifacts
        if (bounty.voters.length == arbiterCount || quorumCount == bounty.numArtifacts) {
            bounty.quorumReached = true;
            bounty.quorumBlock = block.number - bountiesByGuid[bountyGuid].expirationBlock;
            emit QuorumReached(block.number);
        }

        emit NewVerdict(bountyGuid, verdicts);
     }

    // This struct exists to move state from settleBounty into memory from stack
    // to avoid solidity limitations
    struct ArtifactPot {
        uint256 numWinners;
        uint256 numLosers;
        uint256 winnerPool;
        uint256 loserPool;
    }

    /**
     * Function to calculate the reward disbursment of a bounty
     *
     * @param bountyGuid the guid of the bounty to calculate
     * @return Rewards distributed by the bounty
     */
    function calculateBountyRewards(
        uint128 bountyGuid
    )
        public
        view
        returns (uint256 bountyRefund, uint256 arbiterReward, uint256[] expertRewards)
    {
        Bounty storage bounty = bountiesByGuid[bountyGuid];
        Assertion[] memory assertions = assertionsByGuid[bountyGuid];

        // Check if this bountiesByGuid[bountyGuid] has been initialized
        require(bounty.author != address(0));
        // Check if this bounty has been previously resolved for the sender
        require(!bountySettled[bountyGuid][msg.sender]);
        // Check that the voting round has closed
        require(bounty.expirationBlock.add(ASSERTION_REVEAL_WINDOW).add(arbiterVoteWindow) <= block.number || bounty.quorumReached);

        expertRewards = new uint256[](assertions.length);

        ArtifactPot memory ap;

        uint256 i = 0;
        uint256 j = 0;

        if (assertions.length == 0) {
            // Refund the bounty amount and fees to ambassador
            bountyRefund = bounty.amount.mul(bounty.numArtifacts);
        } else if (bounty.verdicts.length == 0) {
            // Refund bids and distribute the bounty amount evenly to experts
            for (j = 0; j < assertions.length; j++) {
                expertRewards[j] = expertRewards[j].add(assertions[j].bid);
                expertRewards[j] = expertRewards[j].add(bounty.amount.div(assertions.length));
            }
        } else {
            for (i = 0; i < bounty.numArtifacts; i++) {
                    bool consensus = bounty.quorumVerdicts[i].mul(MALICIOUS_VOTE_COEFFICIENT) >= bounty.voters.length.sub(bounty.quorumVerdicts[i]).mul(BENIGN_VOTE_COEFFICIENT);

                    for (j = 0; j < assertions.length; j++) {
                        bool malicious;

                        // If we didn't assert on this artifact
                        if (assertions[j].mask & (1 << i) == 0) {
                            continue;
                        }

                        // If we haven't revealed set to incorrect value
                        if (assertions[j].nonce == 0) {
                            malicious = !consensus;
                        } else {
                            malicious = (assertions[j].verdicts & assertions[j].mask) & (1 << i) != 0;
                        }

                        if (malicious == consensus) {
                            ap.numWinners = ap.numWinners.add(1);
                            ap.winnerPool = ap.winnerPool.add(assertions[j].bid);
                        } else {
                            ap.numLosers = ap.numLosers.add(1);
                            ap.loserPool = ap.loserPool.add(assertions[j].bid);
                        }
                    }

                    // If nobody asserted on this artifact, refund the ambassador
                    if (ap.numWinners == 0 && ap.numLosers == 0) {
                        bountyRefund = bountyRefund.add(bounty.amount);
                        for (j = 0; j < assertions.length; j++) {
                            expertRewards[j] = expertRewards[j].add(assertions[j].bid);
                        }
                    } else {
                        for (j = 0; j < assertions.length; j++) {
                            expertRewards[j] = expertRewards[j].add(assertions[j].bid);

                            // If we didn't assert on this artifact
                            if (assertions[j].mask & (1 << i) == 0) {
                                continue;
                            }

                            // If we haven't revealed set to incorrect value
                            if (assertions[j].nonce == 0) {
                                malicious = !consensus;
                            } else {
                                malicious = (assertions[j].verdicts & assertions[j].mask) & (1 << i) != 0;
                            }

                            if (malicious == consensus) {
                                expertRewards[j] = expertRewards[j].add(assertions[j].bid.mul(ap.loserPool).div(ap.winnerPool));
                                expertRewards[j] = expertRewards[j].add(bounty.amount.mul(ap.loserPool).div(ap.winnerPool));
                            } else {
                                expertRewards[j] = expertRewards[j].sub(assertions[j].bid);
                            }
                        }
                    }

                delete ap;
            }
        }

        // Calculate rewards
        uint256 pot = bounty.amount.add(BOUNTY_FEE.add(ASSERTION_FEE.mul(assertions.length)));
        for (i = 0; i < assertions.length; i++) {
            pot = pot.add(assertions[i].bid);
        }

        bountyRefund = bountyRefund.div(bounty.numArtifacts);
        pot = pot.sub(bountyRefund);

        for (i = 0; i < assertions.length; i++) {
            expertRewards[i] = expertRewards[i].div(bounty.numArtifacts);
            pot = pot.sub(expertRewards[i]);
        }

        arbiterReward = pot;
    }

    /**
     * Function called after window has closed to handle reward disbursal
     *
     * This function will pay out rewards if the the bounty has a super majority
     * @param bountyGuid the guid of the bounty to settle
     */
    function settleBounty(uint128 bountyGuid) external whenNotPaused {
        Bounty storage bounty = bountiesByGuid[bountyGuid];
        Assertion[] storage assertions = assertionsByGuid[bountyGuid];

        // Check if this bountiesByGuid[bountyGuid] has been initialized
        require(bounty.author != address(0));
        // Check if this bounty has been previously resolved for the sender
        require(!bountySettled[bountyGuid][msg.sender]);
        // Check that the voting round has closed
        require(bounty.expirationBlock.add(ASSERTION_REVEAL_WINDOW).add(arbiterVoteWindow) <= block.number || bounty.quorumReached);

        if (bounty.assignedArbiter == address(0)) {
            bounty.assignedArbiter = getWeightedRandomArbiter(bountyGuid);
        }

        uint256 bountyRefund;
        uint256 arbiterReward;
        uint256[] memory expertRewards;
        (bountyRefund, arbiterReward, expertRewards) = calculateBountyRewards(bountyGuid);

        bountySettled[bountyGuid][msg.sender] = true;

        // Disburse rewards
        if (bountyRefund != 0 && bounty.author == msg.sender) {
            token.safeTransfer(bounty.author, bountyRefund);
        }

        for (uint256 i = 0; i < assertions.length; i++) {
            if (expertRewards[i] != 0 && assertions[i].author == msg.sender) {
                token.safeTransfer(assertions[i].author, expertRewards[i]);
            }
        }

        if (arbiterReward != 0 && bounty.assignedArbiter == msg.sender) {
            token.safeTransfer(bounty.assignedArbiter, arbiterReward);
        }
    }

    /**
     *  Generates a random number from 0 to range based on the last block hash
     *
     *  @param seed random number for reprocucing
     * @param range end range for random number
     */
    function randomGen(uint seed, uint256 range) constant private returns (int256 randomNumber) {
        return int256(uint256(keccak256(abi.encodePacked(blockhash(block.number-1), seed))) % range);
    }

    /**
     * Gets a random Arbiter weighted by the amount of Nectar they have
     *
     * @param bountyGuid the guid of the bounty
     */
    function getWeightedRandomArbiter(uint128 bountyGuid) public view returns (address voter) {
        require(bountiesByGuid[bountyGuid].author != address(0));

        Bounty memory bounty = bountiesByGuid[bountyGuid];

        if (bounty.voters.length == 0) {
            return address(0);
        }

        uint i;
        uint256 sum;
        int256 randomNum;

        for (i = 0; i < bounty.voters.length; i++) {
            sum = sum.add(staking.balanceOf(bounty.voters[i]));
        }

        randomNum = randomGen(block.number, sum);

        for (i = 0; i < bounty.voters.length; i++) {
            randomNum -= int256(staking.balanceOf(bounty.voters[i]));

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
     * Get the current round for a bounty
     *
     * @param bountyGuid the guid of the bounty
     * @return the current round
     *      0 = assertions being accepted
     *      1 = assertions being revealed
     *      2 = arbiters voting
     *      3 = bounty finished
     */
    function getCurrentRound(uint128 bountyGuid) external view returns (uint) {
        // Check if this bounty has been initialized
        require(bountiesByGuid[bountyGuid].author != address(0));

        Bounty memory bounty = bountiesByGuid[bountyGuid];

        if (bounty.expirationBlock > block.number) {
            return 0;
        } else if (bounty.expirationBlock.add(ASSERTION_REVEAL_WINDOW) > block.number) {
            return 1;
        } else if (bounty.expirationBlock.add(ASSERTION_REVEAL_WINDOW).add(arbiterVoteWindow) > block.number &&
                  !bounty.quorumReached) {
            return 2;
        } else {
            return 3;
        }
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


    /**
     * View function displays the most active bounty voters over past
     * ARBITER_LOOKBACK_RANGE bounties to select future arbiters
     *
     * @return a sorted array of most active bounty voters and a boolean array of whether
     * or not they were active in 90% of bounty votes
     */

    function getActiveArbiters() external view returns (address[], bool[]) {
        require(bountyGuids.length > 0);
        uint256 count = 0;
        uint256 threshold = bountyGuids.length.div(10).mul(9);
        address[] memory ret_addr = new address[](count);
        bool[] memory ret_arbiter_ativity_threshold = new bool[](count);

        Candidate[] memory candidates = new Candidate[](ARBITER_LOOKBACK_RANGE);

        uint256 lastBounty = 0;
        if (bountyGuids.length > ARBITER_LOOKBACK_RANGE) {
            lastBounty = bountyGuids.length.sub(ARBITER_LOOKBACK_RANGE);
            threshold = lastBounty.div(10).mul(9);
        }

        for (uint256 i = bountyGuids.length.sub(1); i > lastBounty; i--) {
            address[] memory voters = bountiesByGuid[bountyGuids[i]].voters;

            for (uint256 j = 0; j < voters.length; j++) {
                bool found = false;
                address addr = voters[j];

                for (uint256 k = 0; k < count; k++) {
                    if (candidates[k].addr == addr) {
                        candidates[k].count = candidates[k].count.add(1);
                        found = true;
                        break;
                    }
                }

                if (!found) {
                    candidates[count] = Candidate(addr, 1);
                    count = count.add(1);
                }

            }

        }


        for (i = 0; i < ret_addr.length; i++) {
            uint256 next = 0;
            uint256 value = candidates[0].count;

            for (j = 0; j < count; j++) {
                if (candidates[j].count > value) {
                    next = j;
                    value = candidates[j].count;
                }
            }

            ret_addr[i] = candidates[next].addr;
            if (candidates[next].count.div(10).mul(9) < threshold) {
                ret_arbiter_ativity_threshold[i] = false;
            } else {
                ret_arbiter_ativity_threshold[i] = true;
            }

            count = count.sub(1);
            candidates[next] = candidates[count];
        }

        return (ret_addr, ret_arbiter_ativity_threshold);

    }

}
