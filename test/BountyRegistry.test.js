/* global artifacts, it, contract, before, beforeEach, describe */


import utils from 'ethereumjs-util';
import BN from 'bn.js';
import bnChai from 'bn-chai';
import ether from './helpers/ether';
import { advanceBlock, advanceBlocks } from './helpers/advanceToBlock';
import EVMRevert from './helpers/EVMRevert';

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(BN))
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
  const guid = randomGuid();
  await token.approve(bountyregistry.address, amount.add(BOUNTY_FEE), { from });
  return await bountyregistry.postBounty(guid, amount, url, numArtifacts, duration, [0, 0, 0, 0, 0, 0, 0, 0], { from });
}

async function postAssertion(token, bountyregistry, from, bountyGuid, bid, mask, verdicts) {
  const nonce = new BN(utils.bufferToHex(utils.sha3(utils.toBuffer(Math.random() * (1 << 30)))).substring(2, 67), 16);
  verdicts = new BN(verdicts);
  const from_num = new BN(from.substring(new BN(2)), 16);
  const hashed_nonce = new BN(utils.bufferToHex(utils.sha3(utils.toBuffer(nonce))).substring(2, 67), 16);
  const commitment = utils.bufferToHex(utils.sha3(utils.toBuffer(verdicts.xor(hashed_nonce).xor(from_num))));

  await token.approve(bountyregistry.address, bid.add(ASSERTION_FEE), { from });
  return { nonce: `0x${nonce.toString(16)}`, receipt: await bountyregistry.postAssertion(bountyGuid, bid, mask, commitment, { from }) };
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

contract('BountyRegistry', ([owner, user0, user1, user2, expert0, expert1, arbiter0, arbiter1, arbiter2, arbiter3]) => {
  before(async () => {
    // Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
    await advanceBlock(STAKE_DURATION);
  });

  beforeEach(async function () {
    this.token = await NectarToken.new();

    await [owner, user0, user1, user2, expert0, expert1, arbiter0, arbiter1, arbiter2, arbiter3].forEach(async (account) => {
      await this.token.mint(account, ether(STARTING_EXPERT_BALANCE));
    });

    await this.token.enableTransfers();

    this.staking = await ArbiterStaking.new(this.token.address, STAKE_DURATION);
    this.bountyregistry = await BountyRegistry.new(this.token.address, this.staking.address, ARBITER_VOTE_WINDOW);
    await this.staking.setBountyRegistry(this.bountyregistry.address);

    const arbiters = [arbiter0, arbiter1, arbiter2, arbiter3];
    // The async forEach we have been doing doesn't actually work
    for (let i = 0; i < arbiters.length; i++) {
      const blockNumber = await web3.eth.getBlockNumber();
      await this.bountyregistry.addArbiter(arbiters[i], blockNumber);
      await this.token.approve(this.staking.address, ether(10000000), { from: arbiters[i] });
      await this.staking.deposit(ether(10000000), { from: arbiters[i] });
    }
  });

  describe('token', () => {
    it('should allocate NCT to each participant', async function () {
      await [owner, user0, user1, user2, expert0, expert1].forEach(async (account) => {
        const balance = await this.token.balanceOf(account);
        balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE));
      });

      await [arbiter0, arbiter1, arbiter2, arbiter3].forEach(async (account) => {
        const balance = await this.token.balanceOf(account);
        balance.should.eq.BN(ether(STARTING_ARBITER_BALANCE));
      });
    });

    it('should allow transfering NCT between accounts', async function () {
      await this.token.transfer(user0, ether(10));
      const ownerBalance = await this.token.balanceOf(owner);
      ownerBalance.should.eq.BN(ether(99999990));
      const userBalance = await this.token.balanceOf(user0);
      userBalance.should.eq.BN(ether(100000010));
    });
  });

  describe('bounty', () => {
    it('should allow users to post bounties', async function () {
      const amount = ether(10);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;

      const userBalance = await this.token.balanceOf(user0);
      userBalance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(amount).sub(BOUNTY_FEE));
      const numBounties = await this.bountyregistry.getNumberOfBounties();
      numBounties.should.eq.BN(1);
      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      bounty[0].should.eq.BN(guid);
    });

    it('should reject bounties with duplicate guids', async function () {
      const amount = ether(10);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;

      await this.token.approve(this.bountyregistry.address, amount.add(BOUNTY_FEE), { from: user0 });
      await this.bountyregistry.postBounty(guid, amount, IPFS_README, 1, 10, [0, 0, 0, 0, 0, 0, 0, 0], { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with amounts below the minimum', async function () {
      const amount = ether(0.05);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with blank URIs', async function () {
      const amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, '', 1, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with zero duration', async function () {
      const amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 0).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with too long of a duration', async function () {
      const amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, MAX_DURATION + 1).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties the user can\'t cover', async function () {
      const amount = ether(100000001);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with num artifacts zero', async function () {
      const amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, '', 0, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should report the proper round for a bounty during its life cycle', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      let round = await this.bountyregistry.getCurrentRound(guid);
      round.should.eq.BN(0);

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      round = await this.bountyregistry.getCurrentRound(guid);
      round.should.eq.BN(1);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      round = await this.bountyregistry.getCurrentRound(guid);
      round.should.eq.BN(new BN(2));

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      round = await this.bountyregistry.getCurrentRound(guid);
      round.should.eq.BN(new BN(3));
    });
  });

  describe('assertion', () => {
    // passes but takes a long time because it has to mine 40k+ blocks
    it('should allow users to post assertions', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10).should.be.fulfilled;
      const { guid } = tx.logs[0].args;

      const { nonce, receipt } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.fulfilled;
      const index = receipt.logs[0].args.index;

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, index, nonce, 0x1, 'foo').should.be.fulfilled;

      const expert0Balance = await this.token.balanceOf(expert0);
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));
      const numAssertions = await this.bountyregistry.getNumberOfAssertions(guid);
      numAssertions.should.eq.BN(1);
      const assertion = await this.bountyregistry.assertionsByGuid(guid, index);
      assertion[1].should.eq.BN(bid);
    });

    it('should reject assertions with no associated bounty', async function () {
      const bid = ether(20);
      const guid = randomGuid();
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should reject assertions with a bid below the minimum', async function () {
      const amount = ether(10);
      const bid = ether(0.05);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should reject assertions against an expired bounty', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;
      await advanceBlocks(10);
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should reject assertions on a bounty from the same user', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;

      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1);
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('arbiters', () => {
    it('should allow arbiters vote on bounty', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(35);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);

      const voters = await this.bountyregistry.getVoters(guid);
      voters.length.should.equal(3);
    });

    it('should not allow arbiters to settle if before voting round ends', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;
      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x0);
      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);
    });

    it('should allow arbiters to settle if after voting round', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init + bid + amount - assertionFee
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(bid).add(amount).sub(ASSERTION_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + (assertionFee * 2) + bountyFee
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(ASSERTION_FEE.mul(new BN(2))).add(BOUNTY_FEE));
    });

    it('should allow voting after quorum is reached', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(35);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x3).should.be.fulfilled;
    });

    it('should not allow abriters to settle before the voting period ends', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;
      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await settleBounty(this.bountyregistry, expert0, guid);

      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);
    });

    it('should allow arbiters to settle multi-artifact bounties', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) - (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount.div(new BN(2))).sub(ASSERTION_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bid + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(bid).add(amount.div(new BN(2))).add(ASSERTION_FEE.mul(new BN(2)))
        .add(BOUNTY_FEE));
    });


    it('should allow any arbiters to settle after 256 blocks past voting round has closed', async function () {
      const VALID_HASH_BLOCK = 256;
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;
      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      await advanceBlocks(VALID_HASH_BLOCK);

      await settleBounty(this.bountyregistry, arbiter2, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.equal(arbiter2);

      const expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) - (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount.div(new BN(2))).sub(ASSERTION_FEE));

      const arbiterBalance = await this.token.balanceOf(arbiter2);
      // init + bid + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(bid).add(amount.div(new BN(2))).add(ASSERTION_FEE.mul(new BN(2)))
        .add(BOUNTY_FEE));
    });

    it('should reach quorum if all arbiters vote malicious for first artifact', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount.div(new BN(4))).sub(bid.div(new BN(2))).sub(ASSERTION_FEE));

      const expert1Balance = await this.token.balanceOf(expert1);
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount.mul(new BN(3)).div(new BN(4))).add(bid.div(new BN(2))).sub(ASSERTION_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(ASSERTION_FEE.mul(new BN(2))).add(BOUNTY_FEE));
    });

    it('should reach quorum if all arbiters vote malicious for the second artifact', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x2);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount.div(new BN(2))).sub(ASSERTION_FEE));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) - (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bid + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(bid).add(amount.div(new BN(2))).add(ASSERTION_FEE.mul(new BN(2)))
        .add(BOUNTY_FEE));
    });

    it('should treat assertions that haven\'t been revealed as incorrect', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      // only revealing one assertion
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) - (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount.div(new BN(2))).sub(ASSERTION_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bid + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(bid).add(amount.div(new BN(2))).add(ASSERTION_FEE.mul(new BN(2)))
        .add(BOUNTY_FEE));
    });

    it('should only allow owner to modify arbiters', async function () {
      const blockNumber = await web3.eth.getBlockNumber();
      await this.bountyregistry.removeArbiter(arbiter0, blockNumber, { from: user0 }).should.be.rejectedWith(EVMRevert);
      await this.bountyregistry.addArbiter(user0, blockNumber, { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow removing arbiters', async function () {
      const blockNumber = await web3.eth.getBlockNumber();
      await this.bountyregistry.removeArbiter(arbiter0, blockNumber);

      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(10);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should allow removing and adding arbiters', async function () {
      const blockNumber = await web3.eth.getBlockNumber();

      await this.bountyregistry.removeArbiter(arbiter0, blockNumber);
      await this.bountyregistry.addArbiter(arbiter0, blockNumber);

      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.fulfilled;
    });

    it('should calculate arbiter candidates', async function () {
      const amount = ether(10);

      // Post a bunch of bounties
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user1, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user2, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user1, amount, IPFS_README, 1, 10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);

      const arbiter0Candidates = await this.bountyregistry.getArbiterCandidates();
      arbiter0Candidates[0].should.equal(user0);
      arbiter0Candidates[1].should.equal(user1);
      arbiter0Candidates[2].should.equal(user2);
    });
  });

  describe('payouts', () => {
    it('should refund bounty amount and bounty fee to ambassador if there are no assertions or votes', async function () {
      const amount = ether(10);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      // wait for assertion period to pass
      await advanceBlocks(10);

      // wait for reveal period to pass
      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);

      const ambassadorBalance = await this.token.balanceOf(user0);
      // init - bountyFee
      ambassadorBalance.should.eq.BN(ether(STARTING_AMBASSADOR_BALANCE));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should refund bounty amount to ambassador if there are no assertions', async function () {
      const amount = ether(10);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

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

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const ambassadorBalance = await this.token.balanceOf(user0);
      // init - bounty fee
      ambassadorBalance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(BOUNTY_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bounty fee
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should refund bounty fee to ambassador if there are no votes', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const ambassadorBalance = await this.token.balanceOf(user0);
      // init
      ambassadorBalance.should.eq.BN(ether(STARTING_AMBASSADOR_BALANCE).sub(amount));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should refund a portion of bounty amount to ambassador if there are no assertions for one of the artifacts', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x1, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const ambassadorBalance = await this.token.balanceOf(user0);
      // init - bountyFee - bounty_amount /2
      ambassadorBalance.should.eq.BN(ether(STARTING_AMBASSADOR_BALANCE).sub(BOUNTY_FEE).sub(amount.div(new BN(2))));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should refund bounty amount to ambassador if there are no assertions for any artifacts', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const ambassadorBalance = await this.token.balanceOf(user0);
      // init - bountyFee
      ambassadorBalance.should.eq.BN(ether(STARTING_AMBASSADOR_BALANCE).sub(BOUNTY_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout assertion fee, bid, and bounty amount to expert if there are no votes (1 expert)', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout assertion fee, bid, and a portion of bounty amount to experts if there are no votes (2 experts)', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount / 2
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount.div(new BN(2))));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) + bounty_amount / 2
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).add(amount.div(new BN(2))));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should lose bid if expert does not reveal', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount / 2
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) + bounty_amount / 2
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(bid).sub(ASSERTION_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee) + amount + bid * 2
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))).add(amount)
        .add(bid.mul(new BN(2))));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout bid to expert if expert submits mask 0', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) - assertionFee
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) - assertionFee
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout half of bounty amount to expert and lose half of bid when assertion has 1 artifact correct and 1 wrong (1 expert)', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x1, 'foo').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) - bid / 2 + bounty_amount / 2
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).sub(bid.div(new BN(2))).add(amount.div(new BN(2))));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee) + bounty_amount /2 + bid / 2
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE).add(amount.div(new BN(2)))
        .add(bid.div(new BN(2))));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout portion of bid and bounty amount to expert when assertion has 1 artifact correct and 1 wrong (2 experts)', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x1);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x1, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) - bid / 2 + bounty_amount / 4 (2 because 2 bounties, 2 because they got one wrong)
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).sub(bid.div(new BN(2))).add(amount.div(new BN(4))));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) - bid / 2 + bounty_amount / 4 (2 because 2 bounties, 2 because they got one wrong)
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).sub(bid.div(new BN(2))).add(amount.div(new BN(4))));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee) + bounty_amount /2 (because of half wrong assertions) + bid / 2 * 2
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))).add(amount.div(new BN(2)))
        .add(bid));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout portion of losing bids, a portion of their own bid, and bounty amount to experts when assertion have opposite 1 artifact correct and 1 wrong (2 experts)', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x2);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x2, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount / 2
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).add(amount.div(new BN(2))));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) + bounty_amount / 2
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).add(amount.div(new BN(2))));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout bid and portion of bounty amount relative to bid amount to expert when multiple experts assert', async function () {
      const amount = ether(10);
      const bid0 = ether(20);
      const bid1 = ether(30);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid0, 0x3, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid1, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const expert0Balance = await this.token.balanceOf(expert0);
      // init (and returned assertion fee) + bounty_amount * bid/(total bids)
      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).add(amount.mul(bid0).div(bid0.add(bid1))));

      const expert1Balance = await this.token.balanceOf(expert1);
      // init (and returned assertion fee) + bounty_amount * bid/(total bids)
      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE).sub(ASSERTION_FEE).add(amount.mul(bid1).div(bid0.add(bid1))));

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout nothing to arbiter when no votes', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      const registry = this.bountyregistry;
      const token = this.token;
      const arbiters = [arbiter0, arbiter1, arbiter2, arbiter3];
      await Promise.all(arbiters.map(async (arbiter) => {
        await settleBounty(registry, arbiter, guid);
        const arbiterBalance = await token.balanceOf(arbiter);
        // init
        arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE));
      }));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout nothing to arbiter when no votes and no assertions', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      await advanceBlocks(10);
      await advanceBlocks(ASSERTION_REVEAL_WINDOW);
      await advanceBlocks(ARBITER_VOTE_WINDOW);

      const registry = this.bountyregistry;
      const token = this.token;
      const arbiters = [arbiter0, arbiter1, arbiter2, arbiter3];
      await Promise.all(arbiters.map(async (arbiter) => {
        await settleBounty(registry, arbiter, guid);
        const arbiterBalance = await token.balanceOf(arbiter);
        // init
        arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE));
      }));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout bounty fee to arbiter when no assertions', async function () {
      const amount = ether(10);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      await advanceBlocks(10);
      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout bounty fee and assertion fees to arbiter', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout bounty fee, assertion fees, and bounty amount to arbiter if every expert is wrong', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x0);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x0, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))).add(amount)
        .add(bid.mul(new BN(2))));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout bounty fee, assertion fees, and bounty amount to arbiter if every expert is wrong', async function () {
      const amount = ether(10);
      const bid = ether(20);
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;

      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x0);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x0, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.eq.BN(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(new BN(2))).add(amount)
        .add(bid.mul(new BN(2))));

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout so abriter and expert profit when the expert is correct using bounty minimums (1 expert)', async function () {
      const amount = BOUNTY_MIN;
      const bid = BID_MIN;
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;
      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);

      const arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.gt.BN(ether(STARTING_ARBITER_BALANCE));

      const expert0Balance = await this.token.balanceOf(expert0);

      expert0Balance.should.be.gt.BN(ether(STARTING_EXPERT_BALANCE));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout so abriter profits and experts break-even when both experts are correct using bounty minimums (2 experts)', async function () {
      const amount = BOUNTY_MIN;
      const bid = BID_MIN;
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;
      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x3);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const arbiterBalance = await this.token.balanceOf(selected);

      arbiterBalance.should.be.gt.BN(ether(STARTING_ARBITER_BALANCE));

      const expert0Balance = await this.token.balanceOf(expert0);

      expert0Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE));

      const expert1Balance = await this.token.balanceOf(expert1);

      expert1Balance.should.eq.BN(ether(STARTING_EXPERT_BALANCE));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });

    it('should payout so abriter and correct expert profit and the incorrect expert losses nectar using bounty minimums (2 experts)', async function () {
      const amount = BOUNTY_MIN;
      const bid = BID_MIN;
      const tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      const { guid } = tx.logs[0].args;
      const { nonce: nonce0 } = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x3);
      const { nonce: nonce1 } = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x0);

      await advanceBlocks(10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, 'foo').should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x0, 'bar').should.be.fulfilled;

      await advanceBlocks(ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceBlocks(ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, arbiter0, guid);

      const bounty = await this.bountyregistry.bountiesByGuid(guid);
      const selected = bounty[6];
      selected.should.not.to.eq.BN(0);

      if (selected !== arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      const arbiterBalance = await this.token.balanceOf(selected);

      arbiterBalance.should.be.gt.BN(ether(STARTING_ARBITER_BALANCE));

      const expert0Balance = await this.token.balanceOf(expert0);

      expert0Balance.should.be.gt.BN(ether(STARTING_EXPERT_BALANCE));

      const expert1Balance = await this.token.balanceOf(expert1);

      expert1Balance.should.be.lt.BN(ether(STARTING_EXPERT_BALANCE));

      const registryBalance = await this.token.balanceOf(this.bountyregistry.address);

      registryBalance.should.eq.BN(0);
    });
  });
});
