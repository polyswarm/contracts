import ether from './helpers/ether';
import advanceToBlock, { advanceBlock } from './helpers/advanceToBlock';
import EVMRevert from './helpers/EVMRevert';
import utils from 'ethereumjs-util';

const BigNumber = web3.BigNumber;

require('chai')
  .use(require('chai-as-promised'))
  .use(require('chai-bignumber')(BigNumber))
  .should();

const NectarToken = artifacts.require('NectarToken');
const ERC20Relay = artifacts.require('ERC20Relay');

// From coinmarketcap on 5/28/18
const NctEthExchangeRate = 80972;

contract('ERC20Relay', function ([owner, feeWallet, verifier0, verifier1, verifier2, user0, user1]) {
  beforeEach(async function () {
    this.token = await NectarToken.new();
    this.relay = await ERC20Relay.new(this.token.address, NctEthExchangeRate, feeWallet, [verifier0, verifier1, verifier2]);

    await this.token.mint(user0, ether(1000000000));
    await this.token.mint(user1, ether(1000000000));
    await this.token.enableTransfers();
  });

  describe('constructor', function() {
    it('should require a valid token address', async function () {
      await ERC20Relay.new('0x0000000000000000000000000000000000000000', NctEthExchangeRate, feeWallet,
        [verifier0, verifier1, verifier2], { from: owner }).should.be.rejectedWith(EVMRevert);
    });

    it('should require at least MINIMUM_VERIFIERS', async function () {
      await ERC20Relay.new(this.token.address, NctEthExchangeRate, feeWallet,
        [verifier0], { from: owner }).should.be.rejectedWith(EVMRevert);
    });

    it('should have two required verifiers', async function () {
      const required_verifiers = await this.relay.requiredVerifiers();
      required_verifiers.should.be.bignumber.equal(2);
    });
  });

  describe('fallback', function() {
    it('should revert when sent ether', async function () {
      await this.relay.send(ether(1)).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('verifiers', function() {
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
      const initial_verifiers = await this.relay.activeVerifiers();
      initial_verifiers[0].should.equal(verifier0);
      initial_verifiers[1].should.equal(verifier1);
      initial_verifiers[2].should.equal(verifier2);

      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      const new_verifiers = await this.relay.activeVerifiers();
      new_verifiers[0].should.equal(verifier0);
      new_verifiers[1].should.equal(verifier1);
      new_verifiers[2].should.equal(verifier2);
      new_verifiers[3].should.equal('0x0000000000000000000000000000000000000001');
    });

    it('should report the number of verifiers', async function () {
      for (let i = 0; i < 10; i++) {
        const num_verifiers = await this.relay.numberOfVerifiers();
        num_verifiers.should.bignumber.equal(i + 3);
        await this.relay.addVerifier('0x000000000000000000000000000000000000000' + (i + 1).toString(16)).should.be.fulfilled;
      }
    });

    it('should calculate the required number of verifier votes', async function () {
      for (let i = 0; i < 10; i++) {
        const required_verifiers = await this.relay.requiredVerifiers();
        required_verifiers.should.bignumber.equal(Math.floor((i + 3) * 2 / 3));
        await this.relay.addVerifier('0x000000000000000000000000000000000000000' + (i + 1).toString(16)).should.be.fulfilled;
      }
    });

    it('should report if an address is a verifier', async function () {
      let is_verifier;

      is_verifier = await this.relay.isVerifier(verifier0);
      is_verifier.should.equal(true);
      is_verifier = await this.relay.isVerifier(verifier1);
      is_verifier.should.equal(true);
      is_verifier = await this.relay.isVerifier(verifier2);
      is_verifier.should.equal(true);

      is_verifier = await this.relay.isVerifier('0x0000000000000000000000000000000000000001');
      is_verifier.should.equal(false);

      await this.relay.addVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      is_verifier = await this.relay.isVerifier('0x0000000000000000000000000000000000000001');
      is_verifier.should.equal(true);

      await this.relay.removeVerifier('0x0000000000000000000000000000000000000001').should.be.fulfilled;
      is_verifier = await this.relay.isVerifier('0x0000000000000000000000000000000000000001');
      is_verifier.should.equal(false);
    });
  });

  describe('withdrawals', function() {
    it('should only allow verifiers to approve withdrawals', async function () {
      await this.relay.approveWithdrawal(user0, '1', '0', '0', '0', { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow verifiers to approve withdrawals', async function () {
      let amount = ether(1000);
      let tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      let txHash = tx['tx'];
      let blockHash = tx['receipt']['blockHash'];
      let blockNumber = tx['receipt']['blockHash'];

      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier1 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(1);
      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier2 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
    });

    it('should not allow verifiers to approve different transactions with the same hash', async function () {
      await this.relay.approveWithdrawal(user0, ether(1000), '0', '0', '0', { from: verifier0 }).should.be.fulfilled;
      await this.relay.approveWithdrawal(user0, ether(2000), '0', '0', '0', { from: verifier1 }).should.be.rejectedWith(EVMRevert);
    
      await this.relay.approveWithdrawal(user1, ether(1000), '0', '0', '1', { from: verifier0 }).should.be.fulfilled;
      await this.relay.approveWithdrawal(user1, ether(1000), '0', '0', '1', { from: verifier1 }).should.be.rejectedWith(EVMRevert);
    });

    it('should not allow verifiers to approve multiple times', async function () {
      let amount = ether(1000);
      let tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      let txHash = tx['tx'];
      let blockHash = tx['receipt']['blockHash'];
      let blockNumber = tx['receipt']['blockHash'];
    
      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });
    
    it('should only allow verifiers to unapprove withdrawals', async function () {
      let amount = ether(1000);
      let tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      let txHash = tx['tx'];
      let blockHash = tx['receipt']['blockHash'];
      let blockNumber = tx['receipt']['blockHash'];
    
      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow verifiers to unapprove withdrawals', async function () {
      let amount = ether(1000);
      let tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      let txHash = tx['tx'];
      let blockHash = tx['receipt']['blockHash'];
      let blockNumber = tx['receipt']['blockHash'];
    
      await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
      await this.relay.unapproveWithdrawal(txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
    });

    it('should not allow verifiers to unapprove non-existent withdrawals', async function () {
      await this.relay.unapproveWithdrawal('0', '0', '0', { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should not allow verifiers to unapprove processed withdrawals', async function () {
      let amount = ether(1000);
      let tx = await this.token.transfer(this.relay.address, amount, { from: user0 });
      let txHash = tx['tx'];
      let blockHash = tx['receipt']['blockHash'];
      let blockNumber = tx['receipt']['blockHash'];
    
      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      tx = await this.relay.approveWithdrawal(user0, amount, txHash, blockHash, blockNumber, { from: verifier1 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(1);

      await this.relay.unapproveWithdrawal(txHash, blockHash, blockNumber, { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });
  });

  describe('anchors', function() {
    it('should only allow verifiers to anchor blocks', async function () {
      await this.relay.anchor('0', '0', { from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow verifiers to anchor blocks', async function () {
      let tx;

      tx = await this.relay.anchor('0', '0', { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      tx = await this.relay.anchor('0', '0', { from: verifier1 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(1);
      tx = await this.relay.anchor('0', '0', { from: verifier2 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
    });

    it('should allow verifiers to anchor blocks multiple times', async function () {
      let tx;

      await this.relay.anchor('0', '0', { from: verifier0 }).should.be.fulfilled;
      await this.relay.anchor('0', '0', { from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should only allow verifiers to unanchor blocks', async function () {
      await this.relay.anchor('0', '0', { from: verifier0 }).should.be.fulfilled;
      await this.relay.unanchor({ from: user0 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow verifiers to unanchor blocks', async function () {
      let tx = await this.relay.anchor('0', '0', { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      await this.relay.unanchor({ from: verifier0 }).should.be.fulfilled;
    });

    it('should not allow verifiers to unanchor processed blocks', async function () {
      let tx;

      tx = await this.relay.anchor('0', '0', { from: verifier0 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(0);
      tx = await this.relay.anchor('0', '0', { from: verifier1 }).should.be.fulfilled;
      tx.logs.length.should.be.equal(1);
      tx = await this.relay.unanchor({ from: verifier0 }).should.be.rejectedWith(EVMRevert);
    });
  });
});
