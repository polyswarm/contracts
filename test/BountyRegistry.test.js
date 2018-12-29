import ether from './helpers/ether';
import advanceToBlock, { advanceBlock, advanceBlocks } from './helpers/advanceToBlock';
import EVMRevert from './helpers/EVMRevert';
import utils from 'ethereumjs-util';
import BN from 'bn.js';

const BigNumber = web3.BigNumber;

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should();

const ArbiterStaking = artifacts.require('ArbiterStaking');
const BountyRegistry = artifacts.require('BountyRegistry');
const NectarToken = artifacts.require('NectarToken');

const IPFS_README = 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB';
const BOUNTY_FEE = ether(0.0625);
const ASSERTION_FEE = ether(0.03125);
const BOUNTY_MIN = ether(0.0625);
const BID_MIN = ether(0.0625);
const ASSERTION_MIN = ether(0.0625);
const MAX_DURATION = 100;
const ASSERTION_REVEAL_WINDOW = 25;
const ARBITER_VOTE_WINDOW = 100;
const STAKE_DURATION = 100;
const STARTING_EXPERT_BALANCE = 100000000;
const STARTING_AMBASSADOR_BALANCE = 100000000;
const STARTING_ARBITER_BALANCE = 90000000;

function randomGuid() {
  return utils.bufferToHex(utils.sha3(utils.toBuffer(Math.random() * (1 << 30)))).substring(0, 33);
}

async function postBounty(token, bountyregistry, from, amount, url, numArtifacts, duration) {
  let guid = randomGuid();
  await token.approve(bountyregistry.address, amount.add(BOUNTY_FEE), { from });
  return await bountyregistry.postBounty(guid, amount, url, numArtifacts, duration, [0, 0, 0, 0, 0, 0, 0, 0], { from });
}

async function postAssertion(token, bountyregistry, from, bountyGuid, bid, mask, verdicts) {
  let nonce = new BN(utils.bufferToHex(utils.sha3(utils.toBuffer(Math.random() * (1 << 30)))).substring(2, 67), 16);
  verdicts = new BN(verdicts);
  let from_num = new BN(from.substring(2), 16);
  let hashed_nonce = new BN(utils.bufferToHex(utils.sha3(utils.toBuffer(nonce))).substring(2, 67), 16);
  let commitment = utils.bufferToHex(utils.sha3(utils.toBuffer(verdicts.xor(hashed_nonce).xor(from_num))));

  await token.approve(bountyregistry.address, bid.add(ASSERTION_FEE), { from });
  return {nonce: '0x' + nonce.toString(16), receipt: await bountyregistry.postAssertion(bountyGuid, bid, mask, commitment, { from })};
}

async function revealAssertion(token, bountyregistry, from, bountyGuid, assertionId, nonce, verdicts, metadata) {
  return await bountyregistry.revealAssertion(bountyGuid, assertionId, nonce, verdicts, metadata, { from });
}

async function settleBounty(bountyregistry, from, bountyGuid) {
  return await bountyregistry.settleBounty(bountyGuid, { from });
}

async function voteOnBounty(bountyregistry, from, bountyGuid, votes) {
  return await bountyregistry.voteOnBounty(bountyGuid, votes, true, { from });
}

contract('BountyRegistry', function ([owner, user0, user1, user2, expert0, expert1, arbiter0, arbiter1, arbiter2, arbiter3]) {
  before(async function () {
    // Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
    await advanceBlock(STAKE_DURATION);
  });

  beforeEach(async function () {
    this.token = await NectarToken.new();

    await [owner, user0, user1, user2, expert0, expert1, arbiter0, arbiter1, arbiter2, arbiter3].forEach(async account => {
      await this.token.mint(account, ether(STARTING_EXPERT_BALANCE));
    });

    await this.token.enableTransfers();

    this.staking = await ArbiterStaking.new(this.token.address, STAKE_DURATION);
    this.bountyregistry = await BountyRegistry.new(this.token.address, this.staking.address, ARBITER_VOTE_WINDOW);
    await this.staking.setBountyRegistry(this.bountyregistry.address);

    let arbiters = [arbiter0, arbiter1, arbiter2, arbiter3];
    // The async forEach we have been doing doesn't actually work
    for (let i = 0; i < arbiters.length; i++) {
      await this.bountyregistry.addArbiter(arbiters[i], web3.eth.blockNumber);
      await this.token.approve(this.staking.address, ether(10000000), { from: arbiters[i] });
      await this.staking.deposit(ether(10000000), { from: arbiters[i] });
    }
  });

  describe('token', function() {
    it('should allocate NCT to each participant', async function() {
      await [owner, user0, user1, user2, expert0, expert1].forEach(async account => {
        let balance = await this.token.balanceOf(account);
        balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE));
      });

      await [arbiter0, arbiter1, arbiter2, arbiter3].forEach(async account => {
        let balance = await this.token.balanceOf(account);
        balance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE));
      });
    });

    it('should allow transfering NCT between accounts', async function() {
      await this.token.transfer(user0, ether(10));
      let ownerBalance = await this.token.balanceOf(owner);
      ownerBalance.should.be.bignumber.equal(ether(99999990));
      let userBalance = await this.token.balanceOf(user0);
      userBalance.should.be.bignumber.equal(ether(100000010));
    });
  });

  describe('bounty', function() {
    it('should allow users to post bounties', async function() {
      let amount = ether(10);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      let userBalance = await this.token.balanceOf(user0);
      userBalance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(amount).sub(BOUNTY_FEE));
      let numBounties = await this.bountyregistry.getNumberOfBounties();
      numBounties.should.be.bignumber.equal(1);
      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      bounty[0].should.be.bignumber.equal(guid);
    });

    it('should reject bounties with duplicate guids', async function() {
      let amount = ether(10);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      await this.token.approve(this.bountyregistry.address, amount.add(BOUNTY_FEE), { from: user0 });
      await this.bountyregistry.postBounty(guid, amount, IPFS_README, 1, 10, [0, 0, 0, 0, 0, 0, 0, 0], { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with amounts below the minimum', async function() {
      let amount = ether(0.05);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with blank URIs', async function() {
      let amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, "", 1, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with zero duration', async function() {
      let amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 0).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with too long of a duration', async function() {
      let amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, MAX_DURATION + 1).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties the user can\'t cover', async function() {
      let amount = ether(100000001);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with num artifacts zero', async function() {
      let amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, "", 0, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should report the proper round for a bounty during its life cycle', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let round = await this.bountyregistry.getCurrentRound(guid);
      round.should.be.bignumber.equal(0);

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      round = await this.bountyregistry.getCurrentRound(guid);
      round.should.be.bignumber.equal(1);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      round = await this.bountyregistry.getCurrentRound(guid);
      round.should.be.bignumber.equal(2);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      round = await this.bountyregistry.getCurrentRound(guid);
      round.should.be.bignumber.equal(3);
    });
  });

  describe('assertion', function() {
    // passes but takes a long time because it has to mine 40k+ blocks
    it('should allow users to post assertions', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10).should.be.fulfilled;
      let guid = tx.logs[0].args.guid;

      let {nonce, receipt} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.fulfilled;
      let index = receipt.logs[0].args.index;

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, index, nonce, 0x1, "foo").should.be.fulfilled;

      let expert0Balance = await this.token.balanceOf(expert0);
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));
      let numAssertions = await this.bountyregistry.getNumberOfAssertions(guid);
      numAssertions.should.be.bignumber.equal(1);
      let assertion = await this.bountyregistry.assertionsByGuid(guid, index);
      assertion[1].should.be.bignumber.equal(bid);
    });

    it('should reject assertions with no associated bounty', async function() {
      let bid = ether(20);
      let guid = randomGuid();
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should reject assertions with a bid below the minimum', async function() {
      let amount = ether(10);
      let bid = ether(0.05);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should reject assertions against an expired bounty', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;
      await advanceBlocks(10);
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should reject assertions on a bounty from the same user', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1);
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('arbiters', function() {
    it('should allow arbiters vote on bounty', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(35);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);

      const voters = await this.bountyregistry.getVoters(guid);
      voters.length.should.equal(3);
    });

    it('should not allow arbiters to settle if before voting round ends', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;
      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x0);
      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);
    });

    it('should allow arbiters to settle if after voting round', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init + bid + amount - assertionFee
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(bid).add(amount).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + (assertionFee * 2) + bountyFee
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(ASSERTION_FEE.mul(2)).add(BOUNTY_FEE));
    });

    it('should allow voting after quorum is reached', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(35);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x3).should.be.fulfilled;
    });

    it('should not allow abriters to settle before the voting period ends', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;
      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await settleBounty(this.bountyregistry, expert0, guid);

      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);
    });

    it('should allow arbiters to settle multi-artifact bounties', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) - (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount.div(2)).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bid + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(bid).add(amount.div(2)).add(ASSERTION_FEE.mul(2)).add(BOUNTY_FEE));
    });


    it('should allow any arbiters to settle after 256 blocks past voting round has closed', async function() {
      const VALID_HASH_BLOCK = 256;
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;
      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      await advanceBlocks(VALID_HASH_BLOCK);

      await settleBounty(this.bountyregistry, arbiter2, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.equal(arbiter2);

      let expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) - (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount.div(2)).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(arbiter2);
      // init + bid + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(bid).add(amount.div(2)).add(ASSERTION_FEE.mul(2)).add(BOUNTY_FEE));
    });

    it('should reach quorum if all arbiters vote malicious for first artifact', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceBlocks(ARBITER_VOTE_WINDOW);
      let rewards = await this.bountyregistry.calculateBountyRewards(guid);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount.div(4)).sub(bid.div(2)).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount.mul(3).div(4)).add(bid.div(2)).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(ASSERTION_FEE.mul(2)).add(BOUNTY_FEE));
    });

    it('should reach quorum if all arbiters vote malicious for the second artifact', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x2);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount.div(2)).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) - (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bid + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(bid).add(amount.div(2)).add(ASSERTION_FEE.mul(2)).add(BOUNTY_FEE));
    });

    it('should treat assertions that haven\'t been revealed as incorrect', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      // only revealing one assertion
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) - (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount.div(2)).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bid + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(bid).add(amount.div(2)).add(ASSERTION_FEE.mul(2)).add(BOUNTY_FEE));
    });

    it('should only allow owner to modify arbiters', async function() {
      await this.bountyregistry.removeArbiter(arbiter0, web3.eth.blockNumber, { from: user0 }).should.be.rejectedWith(EVMRevert);
      await this.bountyregistry.addArbiter(user0, web3.eth.blockNumber, { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow removing arbiters', async function() {
      await this.bountyregistry.removeArbiter(arbiter0, web3.eth.blockNumber);

      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(10);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should allow removing and adding arbiters', async function() {
      await this.bountyregistry.removeArbiter(arbiter0, web3.eth.blockNumber);
      await this.bountyregistry.addArbiter(arbiter0, web3.eth.blockNumber);

      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.fulfilled;
    });

    it('should calculate arbiter candidates', async function() {
      let amount = ether(10);
      let bid = ether(20);

      // Post a bunch of bounties
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user1, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user2, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user1, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);

      let arbiter0Candidates = await this.bountyregistry.getArbiterCandidates();
      arbiter0Candidates[0].should.equal(user0);
      arbiter0Candidates[1].should.equal(user1);
      arbiter0Candidates[2].should.equal(user2);
    });
  });

  describe('payouts', function() {
    it('should refund bounty amount and bounty fee to ambassador if there are no assertions or votes', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      // wait for assertion period to pass
      await advanceBlocks(10);

      // wait for reveal period to pass
      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);

      let ambassadorBalance = await this.token.balanceOf(user0);
      // init - bountyFee
      ambassadorBalance.should.be.bignumber.equal(ether(STARTING_AMBASSADOR_BALANCE));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should refund bounty amount to ambassador if there are no assertions', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      // wait for assertion period to pass
      await advanceBlocks(10);

      // wait for reveal period to pass
      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let ambassadorBalance = await this.token.balanceOf(user0);
      // init - bounty fee
      ambassadorBalance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(BOUNTY_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bounty fee
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should refund bounty fee to ambassador if there are no votes', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let ambassadorBalance = await this.token.balanceOf(user0);
      // init
      ambassadorBalance.should.be.bignumber.equal(ether(STARTING_AMBASSADOR_BALANCE).sub(amount));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should refund a portion of bounty amount to ambassador if there are no assertions for one of the artifacts', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x1, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let ambassadorBalance = await this.token.balanceOf(user0);
      // init - bountyFee - bounty_amount /2
      ambassadorBalance.should.be.bignumber.equal(ether(STARTING_AMBASSADOR_BALANCE).sub(BOUNTY_FEE).sub(amount.div(2)));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should refund bounty amount to ambassador if there are no assertions for any artifacts', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let ambassadorBalance = await this.token.balanceOf(user0);
      // init - bountyFee
      ambassadorBalance.should.be.bignumber.equal(ether(STARTING_AMBASSADOR_BALANCE).sub(BOUNTY_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout assertion fee, bid, and bounty amount to expert if there are no votes (1 expert)', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout assertion fee, bid, and a portion of bounty amount to experts if there are no votes (2 experts)', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount / 2
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount.div(2)));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) + bounty_amount / 2
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount.div(2)));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should lose bid if expert does not reveal', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount / 2
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) + bounty_amount / 2
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee) + amount + bid * 2
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)).add(amount).add(bid.mul(2)));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout bid to expert if expert submits mask 0', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) - assertionFee
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) - assertionFee
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout half of bounty amount to expert and lose half of bid when assertion has 1 artifact correct and 1 wrong (1 expert)', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x1, "foo").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) - bid / 2 + bounty_amount / 2
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).sub(bid.div(2)).add(amount.div(2)));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee) + bounty_amount /2 + bid / 2
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE).add(amount.div(2)).add(bid.div(2)));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout portion of bid and bounty amount to expert when assertion has 1 artifact correct and 1 wrong (2 experts)', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x1);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x1, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) - bid / 2 + bounty_amount / 4 (2 because 2 bounties, 2 because they got one wrong)
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).sub(bid.div(2)).add(amount.div(4)));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) - bid / 2 + bounty_amount / 4 (2 because 2 bounties, 2 because they got one wrong)
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).sub(bid.div(2)).add(amount.div(4)));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee) + bounty_amount /2 (because of half wrong assertions) + bid / 2 * 2
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)).add(amount.div(2)).add(bid));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout portion of losing bids, a portion of their own bid, and bounty amount to experts when assertion have opposite 1 artifact correct and 1 wrong (2 experts)', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x2);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x2, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount / 2
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).add(amount.div(2)));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) + bounty_amount / 2
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).add(amount.div(2)));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout bid and portion of bounty amount relative to bid amount to expert when multiple experts assert', async function() {
      let amount = ether(10);
      let bid0 = ether(20);
      let bid1 = ether(30);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid0, 0x3, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid1, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount * bid/(total bids)
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).add(amount.mul(bid0).div(bid0.add(bid1))));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) + bounty_amount * bid/(total bids)
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).add(amount.mul(bid1).div(bid0.add(bid1))));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout nothing to arbiter when no votes', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      let registry = this.bountyregistry;
      let token = this.token;
      let arbiters = [arbiter0, arbiter1, arbiter2, arbiter3];
      await Promise.all(arbiters.map(async function(arbiter) {
        await settleBounty(registry, arbiter, guid);
        let arbiterBalance = await token.balanceOf(arbiter);
        // init
        arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE));
      }));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout nothing to arbiter when no votes and no assertions', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      await advanceBlocks(10);
      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      let registry = this.bountyregistry;
      let token = this.token;
      let arbiters = [arbiter0, arbiter1, arbiter2, arbiter3];
      await Promise.all(arbiters.map(async function(arbiter) {
        await settleBounty(registry, arbiter, guid);
        let arbiterBalance = await token.balanceOf(arbiter);
        // init
        arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE));
      }));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout bounty fee to arbiter when no assertions', async function() {
      let amount = ether(10);
      let bid0 = ether(20);
      let bid1 = ether(30);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      await advanceBlocks(10);
      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout bounty fee and assertion fees to arbiter', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout bounty fee, assertion fees, and bounty amount to arbiter if every expert is wrong', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x0);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x0, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)).add(amount).add(bid.mul(2)));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout bounty fee, assertion fees, and bounty amount to arbiter if every expert is wrong', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x0);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x0, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)).add(amount).add(bid.mul(2)));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout so abriter and expert profit when the expert is correct using bounty minimums (1 expert)', async function() {
      let amount = BOUNTY_MIN;
      let bid = BID_MIN;
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;
      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.above(ether(STARTING_ARBITER_BALANCE));

      let expert0Balance = await this.token.balanceOf(expert0);

      expert0Balance.should.be.bignumber.above(ether(STARTING_EXPERT_BALANCE));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout so abriter profits and experts break-even when both experts are correct using bounty minimums (2 experts)', async function() {
      let amount = BOUNTY_MIN;
      let bid = BID_MIN;
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;
      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1,  guid);

      let arbiterBalance = await this.token.balanceOf(selected);

      arbiterBalance.should.be.bignumber.above(ether(STARTING_ARBITER_BALANCE));

      let expert0Balance = await this.token.balanceOf(expert0);

      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE));

      let expert1Balance = await this.token.balanceOf(expert1);

      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });

    it('should payout so abriter and correct expert profit and the incorrect expert losses nectar using bounty minimums (2 experts)', async function() {
      let amount = BOUNTY_MIN;
      let bid = BID_MIN;
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;
      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x0);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x0, "bar").should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1,  guid);

      let arbiterBalance = await this.token.balanceOf(selected);

      arbiterBalance.should.be.bignumber.above(ether(STARTING_ARBITER_BALANCE));

      let expert0Balance = await this.token.balanceOf(expert0);

      expert0Balance.should.be.bignumber.above(ether(STARTING_EXPERT_BALANCE));

      let expert1Balance = await this.token.balanceOf(expert1);

      expert1Balance.should.be.bignumber.below(ether(STARTING_EXPERT_BALANCE));

      let registryBalance = await this.token.balanceOf(this.bountyregistry.address);
      
      registryBalance.should.be.bignumber.equal(0);
    });
  });
});
