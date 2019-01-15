'use strict'
import advanceToBlock from './helpers/advanceToBlock';
import BN from 'bn.js';
import bnChai from 'bn-chai';
import EVMRevert from './helpers/EVMRevert';

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(BN))
  .should();

const Web3Utils = require('web3-utils');
const OfferRegistry = artifacts.require("./OfferRegistry.sol")
const OfferMultiSig = artifacts.require("./OfferMultiSig.sol")
const NectarToken = artifacts.require("./NectarToken.sol")
const Utils = require('./helpers/stateutils')
const fs = require('fs')
const offerABI = OfferMultiSig.abi;
const revertMessage = 'VM Exception while processing transaction: revert';

// offer state
let guid = 101;
let artifactHash = web3.utils.sha3("testing");
let engagementDeadline = 10;
let assertionDeadline = 50;
let commitment = false;
let assertion = 'none';
let IPFSUri = web3.utils.sha3("testcom.com");
let metadata = 'Locky'
let publicWebsocketUri = '127.0.0.1:37713'
let nectar;
let nectaraddress;
// offer channel contract
let msig
let registry

// sig storage
let s0sigA
let s0sigB
let s1sigA
let s1sigB
let s2sigA
let s2sigB

// state storage
let s0
let s0marshall
let s1
let s1marshall
let s2
let s2marshall

contract('OfferMultiSig', function([owner, ambassador, expert]) {

  before(async () => {
    nectar = (await NectarToken.new()).contract;
    nectaraddress = nectar.options.address;
    registry = (await OfferRegistry.new(nectaraddress)).contract;
    await nectar.methods.mint(ambassador, 2000).send({ from: owner });
  })

  it("deploy MultiSig less than 10 blocks or 90 days fails", async () => {
    let settlementPeriodLength = 10; // seconds
    let revertLongMessage = `${revertMessage} Settlement period out of range`

    await registry.methods.initializeOfferChannel(guid, ambassador, expert, 1).send({ from: ambassador, gas: 5000000 }).should.be.rejectedWith(EVMRevert);
    await registry.methods.initializeOfferChannel(guid, ambassador, expert, 999999999).send({ from: ambassador, gas: 5000000 }).should.be.rejectedWith(EVMRevert);

  })

  it("deploy MultiSig with 10 second settlement period length", async () => {
    let settlementPeriodLength = 10; // seconds
    await registry.methods.initializeOfferChannel(guid, ambassador, expert, settlementPeriodLength).send({ from: ambassador, gas: 5000000 });
    let offerChannel = await registry.methods.getParticipantsChannel(ambassador, expert).call();

    msig = await new web3.eth.Contract(offerABI, offerChannel);

  })

  it("can set websocket uri", async () => {
    await msig.methods.setCommunicationUri(web3.utils.utf8ToHex(publicWebsocketUri)).send({ from: ambassador, gas: 400000 }).should.be.fulfilled;
  })

  it("can get websocket uri", async () => {
    let ws = await msig.methods.getWebsocketUri().call();

    ws = Web3Utils.hexToString(ws)
    assert.equal(ws, publicWebsocketUri);
  })

  it("ambassador can approve nectar for MultiSig", async () => {
    await nectar.methods.approve(msig.options.address, 20).send({ from: ambassador });
  })

  it("allow nectar transfers", async () => {
    await nectar.methods.enableTransfers().send({ from: owner, gas: 1000000 });
  })

  it("should allow for canceling a pending offer", async () => {
    let settlementPeriodLength = 10; // seconds
    let cancelGuid = 111;
    await registry.methods.initializeOfferChannel(cancelGuid, ambassador, expert, settlementPeriodLength).send({ from: ambassador, gas: 5000000 });

    let offerChannel = await registry.methods.getParticipantsChannel(ambassador, expert).call();

    let msigToCancel = await new web3.eth.Contract(offerABI, offerChannel);

    let inputs = []
    inputs.push(0) // is close
    inputs.push(0) // nonce
    inputs.push(ambassador) // ambassador address
    inputs.push(expert) // expert address
    inputs.push(msigToCancel.options.address) //  msigToCancel address
    inputs.push(20) // balance in nectar ambassador
    inputs.push(0) // balance in nectar expert
    inputs.push(nectaraddress) // token address

    s0 = inputs
    s0marshall = Utils.marshallState(inputs)

    s0sigA = await web3.eth.sign(web3.utils.sha3(s0marshall, { encoding: 'hex' }), ambassador);

    let r = s0sigA.substr(0, 66);
    let s = "0x" + s0sigA.substr(66, 64);
    let v = parseInt(s0sigA.substr(130, 2)) + 27;

    await nectar.methods.approve(msigToCancel.options.address, 20).send({ from: ambassador });
    await msigToCancel.methods.openAgreement(s0marshall, v, r, s).send({ from: ambassador, gas: 5000000 })
    await msigToCancel.methods.cancelAgreement().send({ from: ambassador, gas: 5000000 });

    let newBal = await nectar.methods.balanceOf(msigToCancel.options.address).call();

    assert.equal(newBal, 0);

  })

  it("generate initial offer state", async () => {
    let inputs = []
    inputs.push(0) // is close
    inputs.push(0) // nonce
    inputs.push(ambassador) // ambassador address
    inputs.push(expert) // expert address
    inputs.push(msig.options.address) //  msig address
    inputs.push(20) // balance in nectar ambassador
    inputs.push(0) // balance in nectar expert
    inputs.push(nectaraddress) // token address

    s0 = inputs
    s0marshall = Utils.marshallState(inputs)
  })

  it("ambassador signs state and opens msig agreement", async () => {
    s0sigA = await web3.eth.sign(web3.utils.sha3(s0marshall, { encoding: 'hex' }), ambassador);

    let r = s0sigA.substr(0, 66);
    let s = "0x" + s0sigA.substr(66, 64);
    let v = parseInt(s0sigA.substr(130, 2)) + 27;

    let receipt = await msig.methods.openAgreement(s0marshall, v, r, s).send({ from: ambassador, gas: 5000000 });

  })

  it("approve MultiSig to accept control nectar for expert", async () => {
    await nectar.methods.approve(msig.options.address, 0).send({ from: expert });

  })

  it("expert signs state and joins msig agreement", async () => {
    s0sigB = await web3.eth.sign(web3.utils.sha3(s0marshall, {encoding: 'hex'}), expert)
    let r = s0sigB.substr(0,66)
    let s = "0x" + s0sigB.substr(66,64)
    let v = parseInt(s0sigB.substr(130, 2)) + 27

    let receipt = await msig.methods.joinAgreement(s0marshall, v, r, s).send({ from: expert, gas: 1000000 });
  })

  it("generate offer", async () => {
    // channel offerState
    const offerState = []
    offerState.push(0) // is close
    offerState.push(1) // sequence
    offerState.push(ambassador) // ambassador address
    offerState.push(expert) // expert address
    offerState.push(msig.options.address) //  msig address
    offerState.push(20) // balance in nectar ambassador
    offerState.push(0) // balance in nectar expert
    offerState.push(nectaraddress) // token address
    offerState.push(guid) // A globally-unique identifier for the Listing.
    offerState.push(1) // The Offer Amount.
    offerState.push(artifactHash) // Cryptographic hash of the Artifact.
    offerState.push(IPFSUri) // The URI of the Artifact.
    offerState.push(engagementDeadline) // Engagement Deadline
    offerState.push(assertionDeadline) // Assertion Deadline
    offerState.push(commitment) // has the expert made commitment
    offerState.push(assertion) // “malicious” or “benign”
    offerState.push(metadata) // Information derived during Assertion generation

    s1 = offerState
    s1marshall = Utils.marshallState(offerState)
  })

  it("both parties sign state: s1", async () => {
    s1sigA = await web3.eth.sign(web3.utils.sha3(s1marshall, {encoding: 'hex'}), ambassador)
    s1sigB = await web3.eth.sign(web3.utils.sha3(s1marshall, {encoding: 'hex'}), expert)
  })

  it("can update MultiSig balance", async () => {

    // channel deposit update and allow for more tokens on contract
    await nectar.methods.approve(msig.options.address, 180).send({ from: ambassador });

    const offerState = []
    offerState.push(0) // is close
    offerState.push(2) // sequence
    offerState.push(ambassador) // ambassador address
    offerState.push(expert) // expert address
    offerState.push(msig.options.address) //  msig address
    offerState.push(200) // new balance in nectar ambassador
    offerState.push(0) // balance in nectar expert
    offerState.push(nectaraddress) // token address
    offerState.push(guid) // A globally-unique identifier for the Listing.
    offerState.push(1) // The Offer Amount.
    offerState.push(artifactHash) // Cryptographic hash of the Artifact.
    offerState.push(IPFSUri) // The URI of the Artifact.
    offerState.push(engagementDeadline) // Engagement Deadline
    offerState.push(assertionDeadline) // Assertion Deadline
    offerState.push(commitment) // has the expert made commitment
    offerState.push(assertion) // “malicious” or “benign”
    offerState.push(metadata) // Information derived during Assertion generation

    let depositState = Utils.marshallState(offerState)
    let sigA = await web3.eth.sign(web3.utils.sha3(depositState, {encoding: 'hex'}), ambassador)
    let sigB = await web3.eth.sign(web3.utils.sha3(depositState, {encoding: 'hex'}), expert)

    let r = sigA.substr(0,66)
    let s = "0x" + sigA.substr(66,64)
    let v = parseInt(sigA.substr(130, 2)) + 27

    let r2 = sigB.substr(0,66)
    let s2 = "0x" + sigB.substr(66,64)
    let v2 = parseInt(sigB.substr(130, 2)) + 27

    let sigV = []
    let sigR = []
    let sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    await msig.methods.depositFunds(depositState, sigV, sigR, sigS).send({ from: ambassador, gas: 1000000 });
    let newBal = await nectar.methods.balanceOf(msig.options.address).call();

    assert.equal(newBal, 200);
  })

  it("expert can accept offer", async () => {
    commitment = true;

    // channel offerState
    const offerState = []
    offerState.push(0) // is close
    offerState.push(3) // sequence
    offerState.push(ambassador) // ambassador address
    offerState.push(expert) // expert address
    offerState.push(msig.options.address) //  msig address
    offerState.push(200) // balance in nectar ambassador
    offerState.push(0) // balance in nectar expert
    offerState.push(nectaraddress) // token address
    offerState.push(guid) // A globally-unique identifier for the Listing.
    offerState.push(1) // The Offer Amount.
    offerState.push(artifactHash) // Cryptographic hash of the Artifact.
    offerState.push(IPFSUri) // The URI of the Artifact.
    offerState.push(engagementDeadline) // Engagement Deadline
    offerState.push(assertionDeadline) // Assertion Deadline
    offerState.push(commitment) // has the expert made commitment
    offerState.push(assertion) // “malicious” or “benign”
    offerState.push(metadata) // Information derived during Assertion generation

    s2 = offerState
    s2marshall = Utils.marshallState(offerState)

  })

  it("both parties sign state: s2", async () => {
    s2sigA = await web3.eth.sign(web3.utils.sha3(s2marshall, {encoding: 'hex'}), ambassador)
    s2sigB = await web3.eth.sign(web3.utils.sha3(s2marshall, {encoding: 'hex'}), expert)
  })

  it("party B starts settle game with old state", async () => {
    let r = s1sigA.substr(0,66)
    let s = "0x" + s1sigA.substr(66,64)
    let v = parseInt(s1sigA.substr(130, 2)) + 27

    let r2 = s1sigB.substr(0,66)
    let s2 = "0x" + s1sigB.substr(66,64)
    let v2 = parseInt(s1sigB.substr(130, 2)) + 27

    let sigV = []
    let sigR = []
    let sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    await msig.methods.startSettle(s1marshall, sigV, sigR, sigS).send({ from: expert, gas: 1000000 });
  })

  it("should revert if already in settlement state", async () => {
    let revertLongMessage = `${revertMessage} Offer is in settlement state`
    let errorMessage
    let r = s1sigA.substr(0,66)
    let s = "0x" + s1sigA.substr(66,64)
    let v = parseInt(s1sigA.substr(130, 2)) + 27

    let r2 = s1sigB.substr(0,66)
    let s2 = "0x" + s1sigB.substr(66,64)
    let v2 = parseInt(s1sigB.substr(130, 2)) + 27

    let sigV = []
    let sigR = []
    let sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    await msig.methods.startSettle(s1marshall, sigV, sigR, sigS).send({ from: expert, gas: 1000000 }).should.be.rejectedWith(EVMRevert);

  })

  it("party A challenges with new state agreed on earlier", async () => {
    const r = s2sigA.substr(0,66)
    const s = "0x" + s2sigA.substr(66,64)
    const v = parseInt(s2sigA.substr(130, 2)) + 27

    const r2 = s2sigB.substr(0,66)
    const s2 = "0x" + s2sigB.substr(66,64)
    const v2 = parseInt(s2sigB.substr(130, 2)) + 27

    const sigV = []
    const sigR = []
    const sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)
    
    await msig.methods.challengeSettle(s2marshall, sigV, sigR, sigS).send({ from: ambassador, gas: 1000000 });
  })

  it("should revert if trying to close before reply timeout", async () => {
    const r = s2sigA.substr(0,66)
    const s = "0x" + s2sigA.substr(66,64)
    const v = parseInt(s2sigA.substr(130, 2)) + 27

    const r2 = s2sigB.substr(0,66)
    const s2 = "0x" + s2sigB.substr(66,64)
    const v2 = parseInt(s2sigB.substr(130, 2)) + 27

    const sigV = []
    const sigR = []
    const sigS = []

    let errorMessage
    let revertLongMessage = `${revertMessage} Settlement period hasn't ended`

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    await advanceToBlock(await web3.eth.getBlockNumber() + 1);

    await msig.methods.closeAgreementWithTimeout(s2marshall, sigV, sigR, sigS).send({ from: ambassador, gas: 1000000 }).should.be.rejectedWith(EVMRevert);
  })

  it("can end the close after 10 blocks", async () => {
    const r = s2sigA.substr(0,66)
    const s = "0x" + s2sigA.substr(66,64)
    const v = parseInt(s2sigA.substr(130, 2)) + 27

    const r2 = s2sigB.substr(0,66)
    const s2 = "0x" + s2sigB.substr(66,64)
    const v2 = parseInt(s2sigB.substr(130, 2)) + 27

    const sigV = []
    const sigR = []
    const sigS = []

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    await advanceToBlock(await web3.eth.getBlockNumber() + 10);
    await msig.methods.closeAgreementWithTimeout(s2marshall, sigV, sigR, sigS).send({ from: ambassador, gas: 1000000 });
  })


  it("should get close flag", async () => {
    const raw = await msig.methods.getCloseFlag(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 0);
  })

  it("should get state sequence", async () => {
    const raw = await msig.methods.getSequence(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 0);
  })

  it("should get ambassador address", async () => {
    const raw = await msig.methods.getPartyA(s0marshall).call();

    assert.equal(raw, ambassador);
  })

  it("should get expert address", async () => {
    const raw = await msig.methods.getPartyB(s0marshall).call();

    assert.equal(raw, expert);
  })

  it("should get ambassador balance", async () => {
    const raw = await msig.methods.getBalanceA(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 20);
  })

  it("should get expert balance", async () => {
    const raw = await msig.methods.getBalanceB(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 0);
  })

  it("should get nectar address", async () => {
    const raw = await msig.methods.getTokenAddress(s0marshall).call();

    assert.equal(raw, nectaraddress);
  })

  it("should get channel total", async () => {
    const raw = await msig.methods.getTotal(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 20);
  })

  it("should get channel total", async () => {
    const raw = await msig.methods.getTotal(s0marshall).call();

    assert.equal(Web3Utils.hexToNumber(raw), 20);
  })


})
