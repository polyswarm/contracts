'use strict'
const Web3Utils = require('web3-utils');
const OfferRegistry = artifacts.require("./OfferRegistry.sol");
const OfferMultiSig = artifacts.require("./OfferMultiSig.sol");
const NectarToken = artifacts.require("./NectarToken.sol");
const Utils = require('./helpers/stateutils');
const sha256 = require('sha256');

// offer state
let guid;
let registry
let offerArray
let offerStateBytes
let ambassador
let expert
let offerLib
let offerState = []
let offerChannelID
let artifactHash
let engagementDeadline
let assertionDeadline
let commitment
let assertion
let IPFSUri
let metadata
let nectar;
let nectarAddress;
let mockMultiSigAddress;
let ambassadorBalance;
let expertBalance;
let offerAmount;
let nonce;
let isClosed;
// lib for interacting with state
let offerMsig;

contract('OfferRegistry', function([owner, ambassador, expert]) {

  before(async () => {
    let nectar = await NectarToken.new();
    
    registry = await OfferRegistry.new(nectar.address);
    offerChannelID = Math.floor(Math.random() * 1000)
    guid = Math.floor(Math.random() * 1000)
    artifactHash = sha256('artifactHash').slice(32);
    engagementDeadline = 10;
    assertionDeadline = 50;
    commitment = 10;
    assertion = 45;
    IPFSUri = sha256('IPFSUri').slice(32);
    metadata = 'Locky';
    nectarAddress = nectar.address;
    mockMultiSigAddress = '0x043bbf1af93df1220dacc94b9ca51b789bf20dc3';
    ambassadorBalance = 20;
    expertBalance = 0;
    offerAmount = 1;
    nonce = 2;
    isClosed = 0;
    // channel offerState
    offerState.push(isClosed); // is closed flag
    offerState.push(nonce); // nonce
    offerState.push(ambassador); // ambassador address
    offerState.push(expert); // expert address
    offerState.push(mockMultiSigAddress); //  random msig address
    offerState.push(ambassadorBalance); // balance in nectar ambassador
    offerState.push(expertBalance); // balance in nectar expert
    offerState.push(nectarAddress); // token address
    offerState.push(guid); // A globally-unique identi er for the Listing.
    offerState.push(offerAmount); // The Offer Amount.
    offerState.push(artifactHash); // Cryptographic hash of the Artifact.
    offerState.push(IPFSUri); // The URI of the Artifact.
    offerState.push(engagementDeadline); // Engagement Deadline
    offerState.push(assertionDeadline); // Assertion Deadline
    offerState.push(commitment); // has the expert made commitment
    offerState.push(assertion); // “malicious” or “benign”
    offerState.push(metadata); // Information derived during Assertion generation
    
    offerArray = offerState;
    offerStateBytes = Utils.marshallState(offerState);
  })

  it("can init msig contract", async () => {
    let settlementPeriodLength = 60; // seconds
    let tx = await registry.initializeOfferChannel(guid, ambassador, expert, settlementPeriodLength, { from: ambassador, gas: 5000000 });

    offerMsig = await registry.getParticipantsChannel(ambassador, expert);
  })

  it("get number of offers in registry", async () => {
    const num = await registry.getNumberOfOffers();

    assert.equal(num, 1);
  })

  it("should get offer msig address", async () => {
    const address = await registry.getParticipantsChannel(ambassador, expert);

    assert.equal(address, offerMsig);
  })

  it("should get a list of all the offers' guids", async () => {
    const guids = await registry.getChannelsGuids();

    assert.equal(guids.length, 1);
  })

  it("should be able to pause all offer multi sigs", async () => {
    let msig = await web3.eth.contract(OfferMultiSig.abi).at(offerMsig);
    await registry.pauseChannels();

    assert.equal(await msig.paused(), true);
  })

  it("should be able to resume all offer multi sigs", async () => {
    let msig = await web3.eth.contract(OfferMultiSig.abi).at(offerMsig);
    await registry.unpauseChannels();

    assert.equal(await msig.paused(), false);
  })

  it("should get offer state", async () => {
    const rawOfferState = await registry.getOfferState(offerStateBytes);
    const [_guid, _nonce, _amount, _msigAddress, _balanceA,
     _balanceB, _ambassador, _expert, _isClosed, _token,
      _commitment, _assertion] = rawOfferState;

    assert.equal(Web3Utils.hexToNumberString(_guid), guid, 'guid mismatch');
    assert.equal(Web3Utils.hexToNumber(_amount), offerAmount, 'offer amount mismatch');
    assert.equal(Web3Utils.hexToNumber(_nonce), nonce, 'nonce mismatch');
    assert.equal(_msigAddress, mockMultiSigAddress, 'multi sig mismatch');
    assert.equal(_balanceA, ambassadorBalance, 'ambassador balance mismatch');
    assert.equal(_balanceB, expertBalance, 'expert balance mismatch');
    assert.equal(_ambassador, ambassador, 'ambassador address mismatch');
    assert.equal(_expert, expert, 'expert address mismatch');
    assert.equal(_isClosed, isClosed, 'closed flag mismatch');
    assert.equal(_token, nectarAddress, 'nectar token mismatch');
    assert.equal(Web3Utils.hexToNumber(_commitment), commitment, 'expert commitment mismatch');
    assert.equal(Web3Utils.hexToNumber(_assertion), assertion, 'export assertion mismatch');
  })

})
