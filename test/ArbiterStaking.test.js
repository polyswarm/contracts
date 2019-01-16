/* global web3, artifacts, it, contract, before, beforeEach, describe */


import BN from 'bn.js';
import bnChai from 'bn-chai';
import ether from './helpers/ether';
import { advanceBlocks } from './helpers/advanceToBlock';
import EVMRevert from './helpers/EVMRevert';

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(BN))
  .should();

const ArbiterStaking = artifacts.require('ArbiterStaking');
const NectarToken = artifacts.require('NectarToken');
const BountyRegistry = artifacts.require('BountyRegistry');

// From contracts/BountyRegistry.sol
const ARBITER_VOTE_WINDOW = 100;
// From contracts/ArbiterStaking.sol
const STAKE_DURATION = 100;
const MINIMUM_STAKE = 10000000 * 10 ** 18;

contract('ArbiterStaking', ([owner, arbiter]) => {
  before(async () => {
    // Advance to the max stake duration so the subtraction in
    // withdrawableBalanceOf and withdraw doesn't revert()
    await advanceBlocks(STAKE_DURATION);
  });

  beforeEach(async function () {
    this.token = await NectarToken.new();
    this.staking = await ArbiterStaking.new(this.token.address, STAKE_DURATION);
    this.registry = await BountyRegistry.new(this.token.address, this.staking.address, ARBITER_VOTE_WINDOW);

    this.staking.setBountyRegistry(this.registry.address);
    await [arbiter].forEach(async (account) => {
      await this.token.mint(account, web3.utils.toHex(ether(1000000000)));
      const blockNumber = await web3.eth.getBlockNumber();
      await this.registry.addArbiter(account, blockNumber);
    });

    await this.token.enableTransfers();
  });

  describe('life cycle', () => {
    it('should be owned', async function () {
      const o = await this.staking.owner();
      o.should.be.equal(owner);
    });

    it('should be pauseable', async function () {
      await this.staking.pause();
      await this.staking.deposit('1', { from: arbiter }).should.be.rejectedWith(EVMRevert);
      await this.staking.unpause();
      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      const tx = await this.staking.deposit('1', { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN('1');
    });
  });

  describe('deposits', () => {
    it('should allow deposits', async function () {
      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      const tx = await this.staking.deposit('1', { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN('1');
    });

    it('update the balance after a deposit', async function () {
      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      const tx = await this.staking.deposit('1', { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN('1');

      const balance = await this.staking.balanceOf(arbiter);
      balance.should.eq.BN('1');
    });

    it('update the withdrawable balance after a deposit', async function () {
      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      let tx = await this.staking.deposit('1', { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN('1');

      await advanceBlocks(10);

      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      tx = await this.staking.deposit('1', { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN('1');

      const b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('2');

      let wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('0');

      await advanceBlocks(STAKE_DURATION - 10);
      wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('1');

      await advanceBlocks(10);
      wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('2');
    });

    it('should return 0 when block.number is less than stakingDuration', async function () {
      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      const tx = await this.staking.deposit('1', { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN('1');

      const balance = await this.staking.withdrawableBalanceOf(arbiter);
      balance.should.eq.BN('0');
    });

    it('should reject a deposit where total is over max staking', async function () {
      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      await this.staking.deposit('1', { from: arbiter }).should.be.fulfilled;
      const b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('1');

      await this.token.approve(this.staking.address, ether('100000000'), { from: arbiter }).should.be.fulfilled;
      await this.staking.deposit(ether('100000000'), { from: arbiter }).should.be.rejectedWith(EVMRevert);
    });

    it('should reject a deposit where the msg sender is not an arbiter', async function () {
      const blockNumber = await web3.eth.getBlockNumber();
      await this.registry.removeArbiter(arbiter, blockNumber);
      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      await this.staking.deposit('1', { from: arbiter }).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('withdrawals', () => {
    it('should reject sender with no deposits', async function () {
      await this.staking.withdraw('1', { from: arbiter }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow withdrawals after the minimum staking time', async function () {
      await this.token.approve(this.staking.address, '1', { from: arbiter }).should.be.fulfilled;
      let tx = await this.staking.deposit('1', { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN('1');

      let b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('1');
      let wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('0');

      await this.staking.withdraw('1', { from: arbiter }).should.be.rejectedWith(EVMRevert);

      await advanceBlocks(STAKE_DURATION);

      b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('1');
      wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('1');

      tx = await this.staking.withdraw('1', { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.to.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN('1');

      b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('0');
      wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('0');
    });

    it('should handle combinations of deposits and withdrawals', async function () {
      const self = this;

      const deposit = async function (amount) {
        await self.token.approve(self.staking.address, amount, { from: arbiter }).should.be.fulfilled;
        return self.staking.deposit(amount, { from: arbiter });
      };

      const withdraw = async function (amount) {
        return self.staking.withdraw(amount, { from: arbiter });
      };

      let b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('0');
      let wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('0');

      await deposit(10).should.be.fulfilled;
      await advanceBlocks(8);
      await deposit(20).should.be.fulfilled;
      await advanceBlocks(8);
      await deposit(30).should.be.fulfilled;
      await advanceBlocks(8);
      await deposit(40).should.be.fulfilled;
      await advanceBlocks(8);

      b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('100');
      wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('0');

      await advanceBlocks(STAKE_DURATION - 40 + 1);

      b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('100');
      wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('10');

      await withdraw('20').should.be.rejectedWith(EVMRevert);
      await withdraw('5').should.be.fulfilled;
      await withdraw('10').should.be.rejectedWith(EVMRevert);
      await withdraw('3').should.be.fulfilled;

      await advanceBlocks(10);

      await withdraw('25').should.be.rejectedWith(EVMRevert);
      await withdraw('22').should.be.fulfilled;

      await advanceBlocks(10);

      await withdraw('30').should.be.fulfilled;

      await advanceBlocks(10);

      await withdraw('15').should.be.fulfilled;

      b = await this.staking.balanceOf(arbiter);
      b.should.eq.BN('25');
      wb = await this.staking.withdrawableBalanceOf(arbiter);
      wb.should.eq.BN('25');
    });
  });

  describe('arbiter', () => {
    it('should correctly detect eligible arbiters before bounty record', async function () {
      let isArbiter = await this.staking.isEligible(arbiter);
      isArbiter.should.be.equal(false);

      const value = ether('10000000');
      await this.token.approve(this.staking.address, value, { from: arbiter }).should.be.fulfilled;
      const tx = await this.staking.deposit(value, { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.be.equal(arbiter);
      tx.logs[0].args.value.should.eq.BN(value);

      isArbiter = await this.staking.isEligible(arbiter);
      isArbiter.should.be.equal(true);
    });

    it('should correctly detect eligible arbiters with bounty record', async function () {
      let isArbiter = await this.staking.isEligible(arbiter);
      isArbiter.should.be.equal(false);

      const value = ether('10000000');
      const blockNumber = await web3.eth.getBlockNumber();

      await this.token.approve(this.staking.address, value, { from: arbiter }).should.be.fulfilled;
      const tx = await this.staking.deposit(value, { from: arbiter }).should.be.fulfilled;
      tx.logs[0].args.from.should.eq.BN(arbiter);
      tx.logs[0].args.value.should.eq.BN(value);

      // set registry as owner, so we can call recordBounty
      await this.staking.setBountyRegistry(owner);
      for (let i = 0; i < 9; i++) {
        await this.staking.recordBounty(arbiter, i + 1, blockNumber, { from: owner }).should.be.fulfilled;
      }
      await this.staking.recordBounty(owner, 10, blockNumber, { from: owner }).should.be.fulfilled;
      isArbiter = await this.staking.isEligible(arbiter);
      isArbiter.should.be.equal(true);

      await this.staking.recordBounty(owner, 11, blockNumber, { from: owner });
      isArbiter = await this.staking.isEligible(arbiter);
      isArbiter.should.be.equal(false);
    });
  });
});
