/* global artifacts, web3, assert, it, contract, before */

import BN from 'bn.js';
import bnChai from 'bn-chai';
import Web3Utils from 'web3-utils';
import EVMRevert from './helpers/EVMRevert';
import advanceToBlock from './helpers/advanceToBlock';

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(BN))
  .should();

const OfferRegistry = artifacts.require('./OfferRegistry.sol');
const OfferMultiSig = artifacts.require('./OfferMultiSig.sol');
const NectarToken = artifacts.require('./NectarToken.sol');
const Utils = require('./helpers/stateutils');

const offerABI = OfferMultiSig.abi;

// offer state
const guid = 101;
const artifactHash = web3.utils.sha3('testing');
const engagementDeadline = 10;
const assertionDeadline = 50;
let commitment = false;
const assertion = 'none';
const IPFSUri = web3.utils.sha3('testcom.com');
const metadata = 'Locky';
const publicWebsocketUri = '127.0.0.1:37713';

// nectar contract
let nectar;
let nectaraddress;

// offer channel contract
let msig;
let registry;

// sig storage
let s0sigA;
let s0sigB;
let s1sigA;
let s1sigB;
let s2sigA;
let s2sigB;

// state storage
let s0marshall;
let s1marshall;
let s2marshall;

contract('OfferMultiSig', ([owner, ambassador, expert]) => {
  before(async () => {
    nectar = (await NectarToken.new()).contract;
    nectaraddress = nectar.options.address;
    registry = (await OfferRegistry.new(nectaraddress)).contract;
    await nectar.methods.mint(ambassador, 2000).send({ from: owner });
  });

  it('deploy MultiSig less than 10 blocks or 90 days fails', async () => {
    await registry.methods.initializeOfferChannel(guid, ambassador, expert, 1)
      .send({ from: ambassador, gas: 5000000 }).should.be.rejectedWith(EVMRevert);
    await registry.methods.initializeOfferChannel(guid, ambassador, expert, 999999999)
      .send({ from: ambassador, gas: 5000000 }).should.be.rejectedWith(EVMRevert);
  });

  it('deploy MultiSig with 10 second settlement period length', async () => {
    const settlementPeriodLength = 10; // seconds
    await registry.methods.initializeOfferChannel(guid, ambassador, expert, settlementPeriodLength)
      .send({ from: ambassador, gas: 5000000 });
    const offerChannel = await registry.methods.getParticipantsChannel(ambassador, expert).call();

    msig = await new web3.eth.Contract(offerABI, offerChannel);
  });

  it('can set websocket uri', async () => {
    await msig.methods.setCommunicationUri(web3.utils.utf8ToHex(publicWebsocketUri))
      .send({ from: ambassador, gas: 400000 }).should.be.fulfilled;
  });

  it('can get websocket uri', async () => {
    let ws = await msig.methods.getWebsocketUri().call();

    ws = Web3Utils.hexToString(ws);
    assert.equal(ws, publicWebsocketUri);
  });

  it('ambassador can approve nectar for MultiSig', async () => {
    await nectar.methods.approve(msig.options.address, 20).send({ from: ambassador });
  });

  it('allow nectar transfers', async () => {
    await nectar.methods.enableTransfers().send({ from: owner, gas: 1000000 });
  });

  it('should allow for canceling a pending offer', async () => {
    const settlementPeriodLength = 10; // seconds
    const cancelGuid = 111;
    await registry.methods.initializeOfferChannel(cancelGuid, ambassador, expert, settlementPeriodLength)
      .send({ from: ambassador, gas: 5000000 });

    const offerChannel = await registry.methods.getParticipantsChannel(ambassador, expert).call();

    const msigToCancel = await new web3.eth.Contract(offerABI, offerChannel);

    const inputs = [];
    inputs.push(0); // is closeable state
    inputs.push(0); // nonce
    inputs.push(ambassador); // ambassador address
    inputs.push(expert); // expert address
    inputs.push(msigToCancel.options.address); //  msigToCancel address
    inputs.push(20); // balance in nectar ambassador
    inputs.push(0); // balance in nectar expert
    inputs.push(nectaraddress); // token address

    s0marshall = Utils.marshallState(inputs);

    s0sigA = await web3.eth.sign(web3.utils.sha3(s0marshall, { encoding: 'hex' }), ambassador);

    const r = s0sigA.substr(0, 66);
    const s = `0x${s0sigA.substr(66, 64)}`;
    const v = parseInt(s0sigA.substr(130, 2), 8) + 27;

    await nectar.methods.approve(msigToCancel.options.address, 20).send({ from: ambassador });
    await msigToCancel.methods.openAgreement(s0marshall, v, r, s)
      .send({ from: ambassador, gas: 5000000 });
    await msigToCancel.methods.cancelAgreement().send({ from: ambassador, gas: 5000000 });

    const newBal = await nectar.methods.balanceOf(msigToCancel.options.address).call();

    assert.equal(newBal, 0);
  });

  it('generate initial offer state', async () => {
    const inputs = [];
    inputs.push(0); // is closeable state
    inputs.push(0); // nonce
    inputs.push(ambassador); // ambassador address
    inputs.push(expert); // expert address
    inputs.push(msig.options.address); //  msig address
    inputs.push(20); // balance in nectar ambassador
    inputs.push(0); // balance in nectar expert
    inputs.push(nectaraddress); // token address

    s0marshall = Utils.marshallState(inputs);
  });

  it('ambassador signs state and opens msig agreement', async () => {
    s0sigA = await web3.eth.sign(web3.utils.sha3(s0marshall, { encoding: 'hex' }), ambassador);

    const r = s0sigA.substr(0, 66);
    const s = `0x${s0sigA.substr(66, 64)}`;
    const v = parseInt(s0sigA.substr(130, 2), 8) + 27;

    await msig.methods.openAgreement(s0marshall, v, r, s)
      .send({ from: ambassador, gas: 5000000 });
  });

  it('approve MultiSig to accept control nectar for expert', async () => {
    await nectar.methods.approve(msig.options.address, 0).send({ from: expert });
  });

  it('expert signs state and joins msig agreement', async () => {
    s0sigB = await web3.eth.sign(web3.utils.sha3(s0marshall, { encoding: 'hex' }), expert);
    const r = s0sigB.substr(0, 66);
    const s = `0x${s0sigB.substr(66, 64)}`;
    const v = parseInt(s0sigB.substr(130, 2), 8) + 27;

    await msig.methods.joinAgreement(s0marshall, v, r, s)
      .send({ from: expert, gas: 1000000 });
  });

  it('generate offer', async () => {
    // channel offerState
    const offerState = [];
    offerState.push(0); // is closeable state
    offerState.push(1); // sequence
    offerState.push(ambassador); // ambassador address
    offerState.push(expert); // expert address
    offerState.push(msig.options.address); //  msig address
    offerState.push(20); // balance in nectar ambassador
    offerState.push(0); // balance in nectar expert
    offerState.push(nectaraddress); // token address
    offerState.push(guid); // A globally-unique identifier for the Listing.
    offerState.push(1); // The Offer Amount.
    offerState.push(artifactHash); // Cryptographic hash of the Artifact.
    offerState.push(IPFSUri); // The URI of the Artifact.
    offerState.push(engagementDeadline); // Engagement Deadline
    offerState.push(assertionDeadline); // Assertion Deadline
    offerState.push(commitment); // has the expert made commitment
    offerState.push(assertion); // “malicious” or “benign”
    offerState.push(metadata); // Information derived during Assertion generation

    s1marshall = Utils.marshallState(offerState);
  });

  it('both parties sign state: s1', async () => {
    s1sigA = await web3.eth.sign(web3.utils.sha3(s1marshall, { encoding: 'hex' }), ambassador);
    s1sigB = await web3.eth.sign(web3.utils.sha3(s1marshall, { encoding: 'hex' }), expert);
  });

  it('can update MultiSig balance', async () => {
    // channel deposit update and allow for more tokens on contract
    await nectar.methods.approve(msig.options.address, 180).send({ from: ambassador });

    const offerState = [];
    offerState.push(0); // is closeable state
    offerState.push(2); // sequence
    offerState.push(ambassador); // ambassador address
    offerState.push(expert); // expert address
    offerState.push(msig.options.address); //  msig address
    offerState.push(200); // new balance in nectar ambassador
    offerState.push(0); // balance in nectar expert
    offerState.push(nectaraddress); // token address
    offerState.push(guid); // A globally-unique identifier for the Listing.
    offerState.push(1); // The Offer Amount.
    offerState.push(artifactHash); // Cryptographic hash of the Artifact.
    offerState.push(IPFSUri); // The URI of the Artifact.
    offerState.push(engagementDeadline); // Engagement Deadline
    offerState.push(assertionDeadline); // Assertion Deadline
    offerState.push(commitment); // has the expert made commitment
    offerState.push(assertion); // “malicious” or “benign”
    offerState.push(metadata); // Information derived during Assertion generation

    const depositState = Utils.marshallState(offerState);
    const sigA = await web3.eth.sign(web3.utils.sha3(depositState, { encoding: 'hex' }), ambassador);
    const sigB = await web3.eth.sign(web3.utils.sha3(depositState, { encoding: 'hex' }), expert);

    const r = sigA.substr(0, 66);
    const s = `0x${sigA.substr(66, 64)}`;
    const v = parseInt(sigA.substr(130, 2), 8) + 27;

    const r2 = sigB.substr(0, 66);
    const s2 = `0x${sigB.substr(66, 64)}`;
    const v2 = parseInt(sigB.substr(130, 2), 8) + 27;

    const sigV = [];
    const sigR = [];
    const sigS = [];

    sigV.push(v);
    sigV.push(v2);
    sigR.push(r);
    sigR.push(r2);
    sigS.push(s);
    sigS.push(s2);

    await msig.methods.depositFunds(depositState, sigV, sigR, sigS)
      .send({ from: ambassador, gas: 1000000 });
    const newBal = await nectar.methods.balanceOf(msig.options.address).call();

    assert.equal(newBal, 200);
  });

  it('expert can accept offer', async () => {
    commitment = true;

    // channel offerState
    const offerState = [];
    offerState.push(0); // is closeable state
    offerState.push(3); // sequence
    offerState.push(ambassador); // ambassador address
    offerState.push(expert); // expert address
    offerState.push(msig.options.address); //  msig address
    offerState.push(200); // balance in nectar ambassador
    offerState.push(0); // balance in nectar expert
    offerState.push(nectaraddress); // token address
    offerState.push(guid); // A globally-unique identifier for the Listing.
    offerState.push(1); // The Offer Amount.
    offerState.push(artifactHash); // Cryptographic hash of the Artifact.
    offerState.push(IPFSUri); // The URI of the Artifact.
    offerState.push(engagementDeadline); // Engagement Deadline
    offerState.push(assertionDeadline); // Assertion Deadline
    offerState.push(commitment); // has the expert made commitment
    offerState.push(assertion); // “malicious” or “benign”
    offerState.push(metadata); // Information derived during Assertion generation

    s2marshall = Utils.marshallState(offerState);
  });

  it('both parties sign state: s2', async () => {
    s2sigA = await web3.eth.sign(web3.utils.sha3(s2marshall, { encoding: 'hex' }), ambassador);
    s2sigB = await web3.eth.sign(web3.utils.sha3(s2marshall, { encoding: 'hex' }), expert);
  });

  it('party B starts settle game with old state', async () => {
    const r = s1sigA.substr(0, 66);
    const s = `0x${s1sigA.substr(66, 64)}`;
    const v = parseInt(s1sigA.substr(130, 2), 8) + 27;

    const r2 = s1sigB.substr(0, 66);
    const s2 = `0x${s1sigB.substr(66, 64)}`;
    const v2 = parseInt(s1sigB.substr(130, 2), 8) + 27;

    const sigV = [];
    const sigR = [];
    const sigS = [];

    sigV.push(v);
    sigV.push(v2);
    sigR.push(r);
    sigR.push(r2);
    sigS.push(s);
    sigS.push(s2);

    await msig.methods.startSettle(s1marshall, sigV, sigR, sigS)
      .send({ from: expert, gas: 1000000 });
  });

  it('should revert if already in settlement state', async () => {
    const r = s1sigA.substr(0, 66);
    const s = `0x${s1sigA.substr(66, 64)}`;
    const v = parseInt(s1sigA.substr(130, 2), 8) + 27;

    const r2 = s1sigB.substr(0, 66);
    const s2 = `0x${s1sigB.substr(66, 64)}`;
    const v2 = parseInt(s1sigB.substr(130, 2), 8) + 27;

    const sigV = [];
    const sigR = [];
    const sigS = [];

    sigV.push(v);
    sigV.push(v2);
    sigR.push(r);
    sigR.push(r2);
    sigS.push(s);
    sigS.push(s2);

    await msig.methods.startSettle(s1marshall, sigV, sigR, sigS)
      .send({ from: expert, gas: 1000000 }).should.be.rejectedWith(EVMRevert);
  });

  it('party A challenges with new state agreed on earlier', async () => {
    const r = s2sigA.substr(0, 66);
    const s = `0x${s2sigA.substr(66, 64)}`;
    const v = parseInt(s2sigA.substr(130, 2), 8) + 27;

    const r2 = s2sigB.substr(0, 66);
    const s2 = `0x${s2sigB.substr(66, 64)}`;
    const v2 = parseInt(s2sigB.substr(130, 2), 8) + 27;

    const sigV = [];
    const sigR = [];
    const sigS = [];

    sigV.push(v);
    sigV.push(v2);
    sigR.push(r);
    sigR.push(r2);
    sigS.push(s);
    sigS.push(s2);

    await msig.methods.challengeSettle(s2marshall, sigV, sigR, sigS)
      .send({ from: ambassador, gas: 1000000 });
  });

  it('should revert if trying to close before reply timeout', async () => {
    const r = s2sigA.substr(0, 66);
    const s = `0x${s2sigA.substr(66, 64)}`;
    const v = parseInt(s2sigA.substr(130, 2), 8) + 27;

    const r2 = s2sigB.substr(0, 66);
    const s2 = `0x${s2sigB.substr(66, 64)}`;
    const v2 = parseInt(s2sigB.substr(130, 2), 8) + 27;

    const sigV = [];
    const sigR = [];
    const sigS = [];

    sigV.push(v);
    sigV.push(v2);
    sigR.push(r);
    sigR.push(r2);
    sigS.push(s);
    sigS.push(s2);

    await advanceToBlock(await web3.eth.getBlockNumber() + 1);

    await msig.methods.closeAgreementWithTimeout(s2marshall, sigV, sigR, sigS)
      .send({ from: ambassador, gas: 1000000 }).should.be.rejectedWith(EVMRevert);
  });

  it('can end the close after 10 blocks', async () => {
    const r = s2sigA.substr(0, 66);
    const s = `0x${s2sigA.substr(66, 64)}`;
    const v = parseInt(s2sigA.substr(130, 2), 8) + 27;

    const r2 = s2sigB.substr(0, 66);
    const s2 = `0x${s2sigB.substr(66, 64)}`;
    const v2 = parseInt(s2sigB.substr(130, 2), 8) + 27;

    const sigV = [];
    const sigR = [];
    const sigS = [];

    sigV.push(v);
    sigV.push(v2);
    sigR.push(r);
    sigR.push(r2);
    sigS.push(s);
    sigS.push(s2);

    await advanceToBlock(await web3.eth.getBlockNumber() + 10);
    await msig.methods.closeAgreementWithTimeout(s2marshall, sigV, sigR, sigS)
      .send({ from: ambassador, gas: 1000000 });
  });


  it('should get close flag', async () => {
    const raw = await msig.methods.getCloseFlag(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 0);
  });

  it('should get state sequence', async () => {
    const raw = await msig.methods.getSequence(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 0);
  });

  it('should get ambassador address', async () => {
    const raw = await msig.methods.getPartyA(s0marshall).call();

    assert.equal(raw, ambassador);
  });

  it('should get expert address', async () => {
    const raw = await msig.methods.getPartyB(s0marshall).call();

    assert.equal(raw, expert);
  });

  it('should get ambassador balance', async () => {
    const raw = await msig.methods.getBalanceA(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 20);
  });

  it('should get expert balance', async () => {
    const raw = await msig.methods.getBalanceB(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 0);
  });

  it('should get nectar address', async () => {
    const raw = await msig.methods.getTokenAddress(s0marshall).call();

    assert.equal(raw, nectaraddress);
  });

  it('should get channel total', async () => {
    const raw = await msig.methods.getTotal(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 20);
  });

  it('should get channel total', async () => {
    const raw = await msig.methods.getTotal(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 20);
  });
});
