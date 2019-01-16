/* global artifacts, it, contract, beforeEach, describe */

import BN from 'bn.js';
import bnChai from 'bn-chai';
import ether from './helpers/ether';
import advanceToBlock from './helpers/advanceToBlock';
import EVMRevert from './helpers/EVMRevert';

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(BN))
  .should();

const ZERO_HASH = '0x0000000000000000000000000000000000000000';
const ONE_HASH = '0x0000000000000000000000000000000000000001';
const NectarToken = artifacts.require('NectarToken');
const ERC20Relay = artifacts.require('ERC20Relay');

// From coinmarketcap on 5/28/18
const NctEthExchangeRate = 80972;

contract('ERC20Relay', ([owner, feeWallet, verifier0, verifier1, verifier2, user0, user1, verifierManager, feeManager]) => {
  beforeEach(async function () {
    this.token = await NectarToken.new();
    this.relay = await ERC20Relay.new(this.token.address, NctEthExchangeRate, feeWallet, [verifier0, verifier1, verifier2]);

    await this.token.mint(user0, ether(1000000000));
    await this.token.mint(user1, ether(1000000000));
    await this.token.enableTransfers();
  });

  describe('constructor', () => {
    it('should require a valid token address', async () => {
      await ERC20Relay.new('0x0000000000000000000000000000000000000000', NctEthExchangeRate, feeWallet,
        [verifier0, verifier1, verifier2], { from: owner }).should.be.rejectedWith(EVMRevert);
    });

    it('should require at least MINIMUM_VERIFIERS', async function () {
      await ERC20Relay.new(this.token.address, NctEthExchangeRate, feeWallet,
        [verifier0], { from: owner }).should.be.rejectedWith(EVMRevert);
    });

    it('should have two required verifiers', async function () {
      const requiredVerifiers = await this.relay.requiredVerifiers();
      requiredVerifiers.should.eq.BN(2);
    });
  });

  describe('fallback', () => {
    it('should revert when sent ether', async function () {
      await this.relay.send(ether(1)).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('managers', () => {
    it('should allow owner to set managers', async function () {
      await this.relay.setVerifierManager(verifierManager).should.be.fulfilled;
      await this.relay.setFeeManager(feeManager).should.be.fulfilled;

      await this.relay.setVerifierManager(verifierManager, { from: user0 }).should.be.rejectedWith(EVMRevert);
      await this.relay.setFeeManager(feeManager, { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow owner to perform manager functions only if not set', async function () {
      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      await this.relay.setNctEthExchangeRate('1000').should.be.fulfilled;

      await this.relay.setVerifierManager(verifierManager).should.be.fulfilled;
      await this.relay.addVerifier('0x0000000000000000000000000000000000000002').should.be.rejectedWith(EVMRevert);
      await this.relay.addVerifier('0x0000000000000000000000000000000000000002', { from: verifierManager }).should.be.fulfilled;

      await this.relay.setFeeManager(feeManager).should.be.fulfilled;
      await this.relay.setNctEthExchangeRate('2000').should.be.rejectedWith(EVMRevert);
      await this.relay.setNctEthExchangeRate('2000', { from: feeManager }).should.be.fulfilled;
    });
  });

  describe('verifiers', () => {
    it('should allow owner to add verifiers', async function () {
      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
    });

    it('should allow owner to remove verifiers', async function () {
      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      await this.relay.removeVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
    });

    it('should not allow owner to add the zero address as a verifier', async function () {
      await this.relay.addVerifier('0x0000000000000000000000000000000000000000').should.be.rejectedWith(EVMRevert);
    });

    it('should allow not owner to remove the zero address as a verifier', async function () {
      await this.relay.removeVerifier('0x0000000000000000000000000000000000000000').should.be.rejectedWith(EVMRevert);
    });

    it('should not allow adding duplicate verifiers', async function () {
      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.rejectedWith(EVMRevert);
    });

    it('should not allow removing non verifiers', async function () {
      await this.relay.removeVerifier('0x0000000000000000000000000000000000000001').should.be.rejectedWith(EVMRevert);
    });

    it('should not allow removing verifiers if number drops below minimum', async function () {
      await this.relay.removeVerifier(verifier0).should.be.rejectedWith(EVMRevert);
    });

    it('should report the active verifiers', async function () {
      const initialVerifiers = await this.relay.activeVerifiers();
      initialVerifiers[0].should.equal(verifier0);
      initialVerifiers[1].should.equal(verifier1);
      initialVerifiers[2].should.equal(verifier2);

      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      const newVerifiers = await this.relay.activeVerifiers();
      newVerifiers[0].should.equal(verifier0);
      newVerifiers[1].should.equal(verifier1);
      newVerifiers[2].should.equal(verifier2);
      newVerifiers[3].should.equal('0x0000000000000000000000000000000000000001');
    });

    it('should report the number of verifiers', async function () {
      for (let i = 0; i < 10; i++) {
        const numVerifiers = await this.relay.numberOfVerifiers();
        numVerifiers.should.eq.BN(i + 3);
        await this.relay.addVerifier(`0x000000000000000000000000000000000000000${(i + 1).toString(16)}`).should.be.fulfilled;
      }
    });

    it('should calculate the required number of verifier votes', async function () {
      for (let i = 0; i < 10; i++) {
        const requiredVerifiers = await this.relay.requiredVerifiers();
        requiredVerifiers.should.eq.BN(Math.floor((i + 3) * 2 / 3));
        await this.relay.addVerifier(`0x000000000000000000000000000000000000000${(i + 1).toString(16)}`).should.be.fulfilled;
      }
    });

    it('should report if an address is a verifier', async function () {
      let isVerifier;

      isVerifier = await this.relay.isVerifier(verifier0);
      isVerifier.should.equal(true);
      isVerifier = await this.relay.isVerifier(verifier1);
      isVerifier.should.equal(true);
      isVerifier = await this.relay.isVerifier(verifier2);
      isVerifier.should.equal(true);

      isVerifier = await this.relay.isVerifier('0x0000000000000000000000000000000000000001');
      isVerifier.should.equal(false);

      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      isVerifier = await this.relay.isVerifier('0x0000000000000000000000000000000000000001');
      isVerifier.should.equal(true);

      await this.relay.removeVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      isVerifier = await this.relay.isVerifier('0x0000000000000000000000000000000000000001');
      isVerifier.should.equal(false);
    });

    it('regression test: remove verifiers', async function () {
      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      await this.relay.addVerifier('0x0000000000000000000000000000000000000002').should.be.fulfilled;
      await this.relay.removeVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      await this.relay.removeVerifier('0x0000000000000000000000000000000000000002').should.be.fulfilled;
    });
  });

  describe('withdrawals', () => {
    it('should only allow verifiers to approve withdrawals', async function () {
      await this.relay.approveWithdrawal(user0, '1', ZERO_HASH, ZERO_HASH, '0', { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow verifiers to approve withdrawals', async function () {
      const amount = ether(1000);
      let tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      const txHash = tx.tx;
      const { blockHash } = tx.receipt;
      const blockNumber = tx.receipt.blockHash;

      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier1 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(1);
      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier2 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
    });

    it('should not allow verifiers to approve different transactions with the same hash', async function () {
      await this.relay.approveWithdrawal(user0, ether(1000), ZERO_HASH, ZERO_HASH, '0', { from: verifier0 }).should.be.fulfilled;
      await this.relay.approveWithdrawal(user0, ether(2000), ZERO_HASH, ZERO_HASH, '0', { from: verifier1 }).should.be.rejectedWith(EVMRevert);

      await this.relay.approveWithdrawal(user1, ether(1000), ZERO_HASH, ZERO_HASH, '1', { from: verifier0 }).should.be.fulfilled;
      await this.relay.approveWithdrawal(user1, ether(1000), ZERO_HASH, ZERO_HASH, '1', { from: verifier1 }).should.be.rejectedWith(EVMRevert);
    });

    it('should not allow verifiers to approve multiple times', async function () {
      const amount = ether(1000);
      const tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      const txHash = tx.tx;
      const blockHash = tx.receipt.blockHash;
      const blockNumber = tx.receipt.blockHash;

      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should only allow verifiers to unapprove withdrawals', async function () {
      const amount = ether(1000);
      const tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      const txHash = tx.tx;
      const blockHash = tx.receipt.blockHash;
      const blockNumber = tx.receipt.blockHash;

      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow verifiers to unapprove withdrawals', async function () {
      const amount = ether(1000);
      const tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      const txHash = tx.tx;
      const blockHash = tx.receipt.blockHash;
      const blockNumber = tx.receipt.blockHash;

      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
      await this.relay.unapproveWithdrawal(txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
    });

    it('should not allow verifiers to unapprove non-existent withdrawals', async function () {
      await this.relay.unapproveWithdrawal(ZERO_HASH, ZERO_HASH, '0', { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should not allow verifiers to unapprove processed withdrawals', async function () {
      const amount = ether(1000);
      let tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      const txHash = tx.tx;
      const { blockHash } = tx.receipt;
      const blockNumber = tx.receipt.blockHash;

      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier1 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(1);

      await this.relay.unapproveWithdrawal(txHash, blockHash, blockNumber, { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });

    it('regression test: should not allow withdrawals less than or equal to fees', async function () {
      const amount = await this.relay.fees();
      const tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      const txHash = tx.tx;
      const blockHash = tx.receipt.blockHash;
      const blockNumber = tx.receipt.blockHash;

      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('anchors', () => {
    it('should only allow verifiers to anchor blocks', async function () {
      await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow verifiers to anchor blocks', async function () {
      let tx;

      tx = await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      tx = await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier1 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(1);
      tx = await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier2 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
    });

    it('should not allow verifiers to anchor blocks multiple times', async function () {
      await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier0 }).should.be.fulfilled;
      await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should not emit ContestedBlock if current anchor is processed before a new one is added', async function () {
      let tx;
      await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier0 }).should.be.fulfilled;
      await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier1 }).should.be.fulfilled;
      await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier2 }).should.be.fulfilled;
      tx = await this.relay.anchor(ZERO_HASH, ONE_HASH, { from: verifier1 });
      tx.logs.length.should.be.equal(0);
    });

    it('should emit ContestedBlock if new anchor pushed before current one is processed', async function () {
      await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier0 }).should.be.fulfilled;
      const tx = await this.relay.anchor(ZERO_HASH, '1', { from: verifier1 });
      tx.logs[0].event.should.equal('ContestedBlock');
    });

    it('should only allow verifiers to unanchor blocks', async function () {
      await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier0 }).should.be.fulfilled;
      await this.relay.unanchor({ from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow verifiers to unanchor blocks', async function () {
      const tx = await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      await this.relay.unanchor({ from: verifier0 }).should.be.fulfilled;
    });

    it('should not allow verifiers to unanchor processed blocks', async function () {
      let tx;

      tx = await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      tx = await this.relay.anchor(ZERO_HASH, ZERO_HASH, { from: verifier1 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(1);
      tx = await this.relay.unanchor({ from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });
  });
});
