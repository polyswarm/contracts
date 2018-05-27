import ether from './helpers/ether';
import advanceToBlock, { advanceBlock } from './helpers/advanceToBlock';
import EVMRevert from './helpers/EVMRevert';
import utils from 'ethereumjs-util';

const BigNumber = web3.BigNumber;

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should();

const BountyRegistry = artifacts.require('BountyRegistry');
const NectarToken = artifacts.require('NectarToken');

const IpfsReadme = 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB';
const BountyFee = ether(0.0625);
const AssertionFee = ether(0.0625);
const BountyMin = ether(0.0625);
const AssertionMin = ether(0.0625);

function randomGuid() {
  return utils.bufferToHex(utils.sha3(utils.toBuffer(Math.random() * (1 << 30)))).substring(0, 34);
}

async function postBounty(token, bountyregistry, from, amount, url, duration) {
  let guid = randomGuid();
  await token.approve(bountyregistry.address, amount.add(BountyFee), { from });
  return await bountyregistry.postBounty(guid, amount, url, duration, { from });
}

async function postAssertion(token, bountyregistry, from, bountyGuid, bid, mask, verdicts, metadata) {
  await token.approve(bountyregistry.address, bid.add(AssertionFee), { from });
  return await bountyregistry.postAssertion(bountyGuid, bid, mask, verdicts, metadata, { from });
}

async function settleBounty(bountyregistry, from, bountyGuid) {
  return await bountyregistry.settleBounty(bountyGuid, { from });
}

async function voteOnBounty(bountyregistry, from, bountyGuid, verdicts) {
  return await bountyregistry.voteOnBounty(bountyGuid, verdicts, { from });
}

contract('BountyRegistry', function ([owner, user0, user1, user2, expert0, expert1, arbiter0, arbiter1, arbiter2, arbiter3]) {
  before(async function () {
    // Advance to the next block to correctly read time in the solidity "now" function interpreted by testrpc
    await advanceBlock();
  });

  beforeEach(async function () {
    this.token = await NectarToken.new();

    await [owner, user0, user1, user2, expert0, expert1, arbiter0, arbiter1, arbiter2, arbiter3].forEach(async account => {
      await this.token.mint(account, ether(1000));
    });

    await this.token.enableTransfers();

    this.bountyregistry = await BountyRegistry.new(this.token.address);

    await this.bountyregistry.addArbiter(arbiter0, web3.eth.blockNumber);
    await this.bountyregistry.addArbiter(arbiter1, web3.eth.blockNumber);
    await this.bountyregistry.addArbiter(arbiter2, web3.eth.blockNumber);
    await this.bountyregistry.addArbiter(arbiter3, web3.eth.blockNumber);
  });

  describe('token', function() {
    it('should allocate 1000NCT to each participant', async function() {
      await [owner, user0, user1, user2, expert0, expert1, arbiter0, arbiter1, arbiter2, arbiter3].forEach(async account => {
        let balance = await this.token.balanceOf(account);
        balance.should.be.bignumber.equal(ether(1000));
      });
    });

    it('should allow transfering NCT between accounts', async function() {
      await this.token.transfer(user0, ether(10));
      let ownerBalance = await this.token.balanceOf(owner);
      ownerBalance.should.be.bignumber.equal(ether(990));
      let userBalance = await this.token.balanceOf(user0);
      userBalance.should.be.bignumber.equal(ether(1010));
    });
  });

  describe('bounty', function() {
    it('should allow users to post bounties', async function() {
      let amount = ether(10);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;

      let userBalance = await this.token.balanceOf(user0);
      userBalance.should.be.bignumber.equal(ether(1000).sub(amount).sub(BountyFee));
      let numBounties = await this.bountyregistry.getNumberOfBounties();
      numBounties.should.be.bignumber.equal(1);
      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      bounty[0].should.be.bignumber.equal(guid);
    });

    it('should reject bounties with duplicate guids', async function() {
      let amount = ether(10);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;

      await this.token.approve(this.bountyregistry.address, amount.add(BountyFee), { from: user0 });
      await this.bountyregistry.postBounty(guid, amount, IpfsReadme, 10, { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with amounts below the minimum', async function() {
      let amount = ether(0.05);
      await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with blank URIs', async function() {
      let amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, "", 10).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties with zero duration', async function() {
      let amount = ether(10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 0).should.be.rejectedWith(EVMRevert);
    });

    it('should reject bounties the user can\'t cover', async function() {
      let amount = ether(1001);
      await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('assertion', function() {
    it('should allow users to post assertions', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx0 = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx0.logs[0].args.guid;
      let tx1 = await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1, "foo");
      let index = tx1.logs[0].args.index;

      let expert0Balance = await this.token.balanceOf(expert0);
      expert0Balance.should.be.bignumber.equal(ether(1000).sub(bid).sub(AssertionFee));
      let numAssertions = await this.bountyregistry.getNumberOfAssertions(guid);
      numAssertions.should.be.bignumber.equal(1);
      let assertion = await this.bountyregistry.assertionsByGuid(guid, index);
      assertion[1].should.be.bignumber.equal(bid);
    });

    it('should reject assertions with no associated bounty', async function() {
      let bid = ether(20);
      let guid = randomGuid();
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1, "foo").should.be.rejectedWith(EVMRevert);
    });

    it('should reject assertions with a bid below the minimum', async function() {
      let amount = ether(10);
      let bid = ether(0.05);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1, "foo").should.be.rejectedWith(EVMRevert);
    });

    it('should reject assertions against an expired bounty', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;
      await advanceToBlock(web3.eth.blockNumber + 10);
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x1, "foo").should.be.rejectedWith(EVMRevert);
    });
  });



  describe('arbiters', function() {

    it('should allow arbiters vote on bounty', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0, "foo");
      await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1, "bar");
      await advanceToBlock(web3.eth.blockNumber + 10);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x0);

      const voters = await this.bountyregistry.getVoters(guid);

      voters.length.should.equal(4);
    });

    it('should not allow arbiters to settle if in voting window', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;

      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0, "foo");
      await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1, "bar");

      await advanceToBlock(web3.eth.blockNumber + 10);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x0);

      let errorMessage;
      try {
        await settleBounty(this.bountyregistry, arbiter0, guid);
      } catch (err) {
        errorMessage = err.message;
      }

      assert.equal(errorMessage, 'VM Exception while processing transaction: revert', 'Did not revert the payment');

    });

    it('should allow arbiters to settle if out voting window', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;

      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0, "foo");
      await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1, "bar");
      await advanceToBlock(web3.eth.blockNumber + 10);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x0);

      await advanceToBlock(web3.eth.blockNumber + 27);

      const selected = await this.bountyregistry.getWeightedRandomArbiter(guid);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let expert0Balance = await this.token.balanceOf(expert0);
      // init - bid - assertionFee
      expert0Balance.should.be.bignumber.equal(ether(1000).sub(bid).sub(AssertionFee));

      let expert1Balance = await this.token.balanceOf(expert1);
      // init + (bid / 2) + (amount / 2) - assertionFee
      expert1Balance.should.be.bignumber.equal(ether(1000).add(bid.div(2)).add(amount.div(2)).sub(AssertionFee));

      let arbiterBalance = await this.token.balanceOf(selected);
      // init + (bid / 2) + (amount / 2) + (assertionFee * 2) + bountyFee
      arbiterBalance.should.be.bignumber.equal(ether(1000).add(bid.div(2)).add(amount.div(2)).add(AssertionFee.mul(2)).add(BountyFee));

      let bounty = await this.bountyregistry.bountiesByGuid(guid);
      bounty[5].should.equal(true);

    });

    it('should return funds if less than 2/3 of abiters agree', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;

      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0, "foo");
      await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1, "bar");
      await advanceToBlock(web3.eth.blockNumber + 10);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x0);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x0);

      await advanceToBlock(web3.eth.blockNumber + 27);
      await settleBounty(this.bountyregistry, arbiter0, guid);

      let expert0Balance = await this.token.balanceOf(expert0);
      let expert1Balance = await this.token.balanceOf(expert1);

      // init - assertionFee
      expert0Balance.should.be.bignumber.equal(ether(1000).sub(AssertionFee));
      expert1Balance.should.be.bignumber.equal(ether(1000).sub(AssertionFee));
    });

    it('should only allow arbiters to settle bounties', async function() {
      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0, "foo");
      await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1, "bar");
      await advanceToBlock(web3.eth.blockNumber + 10);
      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);
    });

    it('should only allow owner to modify arbiters', async function() {
      await this.bountyregistry.removeArbiter(arbiter0, web3.eth.blockNumber, { from: user0 }).should.be.rejectedWith(EVMRevert);
      await this.bountyregistry.addArbiter(user0, web3.eth.blockNumber, { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow removing arbiters', async function() {
      await this.bountyregistry.removeArbiter(arbiter0, web3.eth.blockNumber);

      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0, "foo");
      await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1, "bar");
      await advanceToBlock(web3.eth.blockNumber + 10);

      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceToBlock(web3.eth.blockNumber + 20);

      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.rejectedWith(EVMRevert);
    });

    it('should allow removing and readding arbiters', async function() {
      await this.bountyregistry.removeArbiter(arbiter0, web3.eth.blockNumber);
      await this.bountyregistry.addArbiter(arbiter0, web3.eth.blockNumber);

      let amount = ether(10);
      let bid = ether(20);
      let tx = await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      let guid = tx.logs[0].args.guid;
      await postAssertion(this.token, this.bountyregistry, expert0, guid, bid, 0x1, 0x0, "foo");
      await postAssertion(this.token, this.bountyregistry, expert1, guid, bid, 0x1, 0x1, "bar");

      await advanceToBlock(web3.eth.blockNumber + 10);

      await voteOnBounty(this.bountyregistry, arbiter0, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter1, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter2, guid, 0x1);
      await voteOnBounty(this.bountyregistry, arbiter3, guid, 0x1);

      await advanceToBlock(web3.eth.blockNumber + 20);

      await settleBounty(this.bountyregistry, arbiter0, guid).should.be.fulfilled;
    });


    it('should calculate arbiter candidates', async function() {
      let amount = ether(10);
      let bid = ether(20);

      // Post a bunch of bounties
      await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      await postBounty(this.token, this.bountyregistry, user1, amount, IpfsReadme, 10);
      await postBounty(this.token, this.bountyregistry, user2, amount, IpfsReadme, 10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);
      await postBounty(this.token, this.bountyregistry, user1, amount, IpfsReadme, 10);
      await postBounty(this.token, this.bountyregistry, user0, amount, IpfsReadme, 10);

      let arbiter0Candidates = await this.bountyregistry.getArbiterCandidates();
      arbiter0Candidates[0].should.equal(user0);
      arbiter0Candidates[1].should.equal(user1);
      arbiter0Candidates[2].should.equal(user2);
    });
  });
});
