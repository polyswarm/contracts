import ether from './helpers/ether';
import advanceToBlock, { advanceBlock } from './helpers/advanceToBlock';
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
const ASSERTION_FEE = ether(0.0625);
const BOUNTY_MIN = ether(0.0625);
const ASSERTION_MIN = ether(0.0625);
const MAX_DURATION = 100;
const ASSERTION_REVEAL_WINDOW = 25;
const ARBITER_VOTE_WINDOW = 100;
const STAKE_DURATION = 100;
const STARTING_EXPERT_BALANCE = 100000000;
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

async function voteOnBounty(bountyregistry, from, bountyGuid, verdicts) {
  return await bountyregistry.voteOnBounty(bountyGuid, verdicts, true, { from });
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

    it('should report the proper round for a bounty during its lifecycle', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let round = await this.bountyregistry.getCurrentRound(guid);
      round.should.be.bignumber.equal(0);

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceToBlock(web3.eth.blockNumber + 10);

      round = await this.bountyregistry.getCurrentRound(guid);
      round.should.be.bignumber.equal(1);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      round = await this.bountyregistry.getCurrentRound(guid);
      round.should.be.bignumber.equal(2);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

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

      await advanceToBlock(web3.eth.blockNumber + 10);

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
      await advanceToBlock(web3.eth.blockNumber + 10);
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

      await advanceToBlock(web3.eth.blockNumber + 35);

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

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;
      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

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

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

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

      await advanceToBlock(web3.eth.blockNumber + 35);

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

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

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

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

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


    it('should allow any arbiters to settle after 256 blocks past voting round hase closed', async function() {
      const VALID_HASH_BLOCK = 256;
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;
      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, expert0, guid);
      await settleBounty(this.bountyregistry, expert1, guid);

      await advanceToBlock(web3.eth.blockNumber + VALID_HASH_BLOCK);

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

    it('should return bounty amount to ambassador if no expert assert', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      // wait for assersion period to pass
      await advanceToBlock(web3.eth.blockNumber + 10);

      // wait for reveal period to pass
      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let ambassadorBalance = await this.token.balanceOf(user0);
      // init - bountyFee
      ambassadorBalance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(BOUNTY_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE));
    });

    it('should return bounty amount to ambassador if experts assert with bit masks of zeros', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x0, 0x3);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x0, 0x3);

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x3, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x3, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x3);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

      await settleBounty(this.bountyregistry, user0, guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      let selected = bounty[6];
      selected.should.not.be.bignumber.equal(0);

      if (selected != arbiter0) {
        await settleBounty(this.bountyregistry, selected, guid);
      }

      let ambassadorBalance = await this.token.balanceOf(user0);
      // init - bountyFee
      ambassadorBalance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(BOUNTY_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + bountyFee + (2 * assertionFee)
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(BOUNTY_FEE).add(ASSERTION_FEE.mul(2)));
    });

    it('should reach quorum if all arbiters vote malicous for first artifact', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);
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
      expert0Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).sub(bid.div(2)).sub(ASSERTION_FEE));

      let expert1Balance = await this.token.balanceOf(expert1);
      expert1Balance.should.be.bignumber.equal(ether(STARTING_EXPERT_BALANCE).add(amount).add(bid.div(4)).sub(ASSERTION_FEE));

      let arbiterBalance = await this.token.balanceOf(selected);
      arbiterBalance.should.be.bignumber.equal(ether(STARTING_ARBITER_BALANCE).add(bid.div(4)).add(ASSERTION_FEE.mul(2)).add(BOUNTY_FEE));
    });

    it('should reach quorum if all arbiters vote malicous for the second artifact', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x2);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x2);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

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

    it('should treat assertions that haven\'t been revealed as inccorect', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 2, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x3, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x3, 0x1);

      await advanceToBlock(web3.eth.blockNumber + 10);

      // only revealing one assertion
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x3);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

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

      await advanceToBlock(web3.eth.blockNumber + 10);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1).should.be.rejectedWith(EVMRevert);
    });

    it('should allow removing and readding arbiters', async function() {
      await this.bountyregistry.removeArbiter(arbiter0, web3.eth.blockNumber);
      await this.bountyregistry.addArbiter(arbiter0, web3.eth.blockNumber);

      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IPFS_README, 1, 10);
      let guid = tx.logs[0].args.guid;

      let {nonce: nonce0} = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0);
      let {nonce: nonce1} = await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1);

      await advanceToBlock(web3.eth.blockNumber + 10);

      await revealAssertion(this.token, this.bountyregistry, expert0, guid, 0x0, nonce0, 0x0, "foo").should.be.fulfilled;
      await revealAssertion(this.token, this.bountyregistry, expert1, guid, 0x1, nonce1, 0x1, "bar").should.be.fulfilled;

      await advanceToBlock(web3.eth.blockNumber + ASSERTION_REVEAL_WINDOW);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);

      await advanceToBlock(web3.eth.blockNumber + ARBITER_VOTE_WINDOW);

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
});
