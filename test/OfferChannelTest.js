'use strict'
const Web3Utils = require('web3-utils');
const OfferRegistry = artifacts.require("./OfferRegistry.sol")
const OfferMultiSig = artifacts.require("./OfferMultiSig.sol")
const NectarToken = artifacts.require("./NectarToken.sol")
const OfferLib = artifacts.require("./OfferLib.sol")
const Utils = require('./helpers/stateutils')
const fs = require('fs')
const offerABI = JSON.parse(fs.readFileSync(__dirname + '/../build/contracts/OfferMultiSig.json', 'utf8')).abi;

// offer state
let guid = 101;
let subchannelInputs
let artifactHash
let engagementDeadline
let assertionDeadline
let commitment
let assertion
let IPFSUri
let metadata
let nectar;
let nectaraddress;
let publicWebsocketUri = '127.0.0.1:37713'
// offer channel contrat
let msig

let registry

// channel participants
let ambassador
let expert

// lib for interacting with state
let offerLib

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



contract('OfferMultiSig', function(accounts) {

  before(async () => {
    ambassador = accounts[1];
    expert = accounts[2];

    nectar = await NectarToken.new();
    nectaraddress = nectar.address;
    nectar.mint(ambassador, 2000);
    offerLib = await OfferLib.new();
  })

  it("deploy MultiSig with 10 second settlement period length", async () => {
    let settlementPeriodLength = 10; // seconds

    registry = await OfferRegistry.new();

    let tx = await registry.initializeOfferChannel(guid, offerLib.address, ambassador, expert, settlementPeriodLength, { from: ambassador, gas: 5000000 });

    let offerChannel = await registry.getParticipantsChannel(ambassador, expert);

    msig = await web3.eth.contract(offerABI).at(offerChannel);

  })

  it("can set websocket uri", async () => {
    await msig.setCommunicationUri(Utils.getBytes(publicWebsocketUri), { from: ambassador, gas: 400000 });
  })

  it("can get websocket uri", async () => {
    let ws = await msig.getWebsocketUri();

    ws = Web3Utils.hexToString(ws)
    
    assert.equal(ws, publicWebsocketUri);
  })

  it("approve MultiSig to accept control nectar for ambassador", async () => {
    await nectar.approve(msig.address, 20, { from: ambassador })
  })

  it("allow nectar transfers", async () => {
    await nectar.enableTransfers({ gas: 1000000 })
  })

  it("generate initial offer state", async () => {
    let inputs = []
    inputs.push(0) // is close
    inputs.push(0) // nonce
    inputs.push(ambassador) // ambassador address
    inputs.push(expert) // expert address
    inputs.push(msig.address) //  msig address
    inputs.push(20) // balance in nectar ambassador
    inputs.push(0) // balance in nectar expert
    inputs.push(nectaraddress) // token address

    s0 = inputs
    s0marshall = Utils.marshallState(inputs)
  })

  it("ambassador signs state and opens msig agreement", async () => {
    s0sigA = await web3.eth.sign(ambassador, web3.sha3(s0marshall, { encoding: 'hex' }));

    let r = s0sigA.substr(0, 66)
    let s = "0x" + s0sigA.substr(66, 64)
    let v = parseInt(s0sigA.substr(130, 2)) + 27
    
    let receipt = await msig.openAgreement(s0marshall, v, r, s, { from: ambassador })

  })

  it("approve MultiSig to accept control nectar for expert", async () => {
    await nectar.approve(msig.address, 0, { from: expert })
  })

  it("expert signs state and joins msig agreement", async () => {
    s0sigB = await web3.eth.sign(expert, web3.sha3(s0marshall, {encoding: 'hex'}))
    let r = s0sigB.substr(0,66)
    let s = "0x" + s0sigB.substr(66,64)
    let v = parseInt(s0sigB.substr(130, 2)) + 27

    let receipt = await msig.joinAgreement(s0marshall, v, r, s, { from: expert, gas: 1000000 })
  })

  it("generate offer", async () => {
    guid = Math.floor(Math.random() * 10000)
    subchannelInputs = [];
    artifactHash = web3.sha3(Math.random());
    engagementDeadline = 10;
    assertionDeadline = 50;
    commitment = false;
    assertion = 'none';
    IPFSUri = web3.sha3(Math.random());
    metadata = 'Locky';

    // channel offerState
    const offerState = []
    offerState.push(0) // is close
    offerState.push(1) // sequence
    offerState.push(ambassador) // ambassador address
    offerState.push(expert) // expert address
    offerState.push(msig.address) //  msig address
    offerState.push(20) // balance in nectar ambassador
    offerState.push(0) // balance in nectar expert
    offerState.push(nectaraddress) // token address
    offerState.push(guid) // A globally-unique identi er for the Listing.
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
    s1sigA = await web3.eth.sign(ambassador, web3.sha3(s1marshall, {encoding: 'hex'}))
    s1sigB = await web3.eth.sign(expert, web3.sha3(s1marshall, {encoding: 'hex'}))
  })

  it("can update MultiSig balance", async () => {

    // channel deposit update and allow for more tokens on contract
    await nectar.approve(msig.address, 180, { from: ambassador })

    const offerState = []
    offerState.push(0) // is close
    offerState.push(2) // sequence
    offerState.push(ambassador) // ambassador address
    offerState.push(expert) // expert address
    offerState.push(msig.address) //  msig address
    offerState.push(200) // new balance in nectar ambassador
    offerState.push(0) // balance in nectar expert
    offerState.push(nectaraddress) // token address
    offerState.push(guid) // A globally-unique identi er for the Listing.
    offerState.push(1) // The Offer Amount.
    offerState.push(artifactHash) // Cryptographic hash of the Artifact.
    offerState.push(IPFSUri) // The URI of the Artifact.
    offerState.push(engagementDeadline) // Engagement Deadline
    offerState.push(assertionDeadline) // Assertion Deadline
    offerState.push(commitment) // has the expert made commitment
    offerState.push(assertion) // “malicious” or “benign”
    offerState.push(metadata) // Information derived during Assertion generation

    let depositState = Utils.marshallState(offerState)
    let sigA = await web3.eth.sign(ambassador, web3.sha3(depositState, {encoding: 'hex'}))
    let sigB = await web3.eth.sign(expert, web3.sha3(depositState, {encoding: 'hex'}))

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

    await msig.depositState(depositState, sigV, sigR, sigS, { from: ambassador, gas: 1000000 });
    let newBal = await nectar.balanceOf(msig.address);

    assert.equal(newBal.toNumber(), 200);
  })

  it("expert can accept offer", async () => {
    commitment = true;

    // channel offerState
    const offerState = []
    offerState.push(0) // is close
    offerState.push(3) // sequence
    offerState.push(ambassador) // ambassador address
    offerState.push(expert) // expert address
    offerState.push(msig.address) //  msig address
    offerState.push(200) // balance in nectar ambassador
    offerState.push(0) // balance in nectar expert
    offerState.push(nectaraddress) // token address
    offerState.push(guid) // A globally-unique identi er for the Listing.
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
    s2sigA = await web3.eth.sign(ambassador, web3.sha3(s2marshall, {encoding: 'hex'}))
    s2sigB = await web3.eth.sign(expert, web3.sha3(s2marshall, {encoding: 'hex'}))
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

    msig.startSettle(s1marshall, sigV, sigR, sigS, { from: expert, gas: 1000000 })
  })

  it("should revert if already in settlement state", async () => {
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

    try {
      await msig.startSettle(s1marshall, sigV, sigR, sigS, { from: expert, gas: 1000000 })
    } catch (err) {
      errorMessage = err.message;
    }

    assert.equal(errorMessage, 'VM Exception while processing transaction: revert', 'Did not revert the payment');

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

    msig.challengeSettle(s2marshall, sigV, sigR, sigS, { from: ambassador, gas: 1000000 })
  })

  it("should revert if tring to before reply timeout", async () => {
    const timeout = ms => new Promise(res => setTimeout(res, ms))

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

    sigV.push(v)
    sigV.push(v2)
    sigR.push(r)
    sigR.push(r2)
    sigS.push(s)
    sigS.push(s2)

    // increase time
    await timeout(1000);

    web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_mine',
      id: Math.floor(Math.random() * 10000)
    });

    try {
      await msig.closeAgreementWithTimeout(s2marshall, sigV, sigR, sigS, { from: ambassador, gas: 1000000 });
    } catch (err) {
      errorMessage = err.message;
    }

    assert.equal(errorMessage, 'VM Exception while processing transaction: revert', 'Did not revert the payment');

  })

  it("can end the close after 10 seconds", async () => {
    const timeout = ms => new Promise(res => setTimeout(res, ms))

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

    // increase time
    await timeout(11000);

    await web3.currentProvider.send({
      jsonrpc: '2.0',
      method: 'evm_mine',
      id: Math.floor(Math.random() * 10000)
    });

    await msig.closeAgreementWithTimeout(s2marshall, sigV, sigR, sigS, { from: ambassador, gas: 1000000 });
  })

})
