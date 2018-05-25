'use strict'

const Web3Utils = require('web3-utils');
const sha256 = require('sha256');
const NectarToken = artifacts.require("./NectarToken.sol")
const OfferLib = artifacts.require("./OfferLib.sol")
const Utils = require('./helpers/utils')
let offerArray
let offerStateBytes
let ambassador
let expert
let offerLib
let offerState = []
let offerChannelID
let guid
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
let merkleProof;

contract('Offer State Library', function(accounts) {

  before(async () => {
    ambassador = accounts[1];
    expert = accounts[2];
    offerChannelID = Math.floor(Math.random() * 1000)
    guid = Math.floor(Math.random() * 1000)
    subchannelInputs = [];
    artifactHash = sha256('artifactHash').slice(32);
    engagementDeadline = 10;
    assertionDeadline = 50;
    commitment = false;
    assertion = 'none';
    IPFSUri = sha256('IPFSUri').slice(32);
    metadata = 'Locky';
    nectar = await NectarToken.new();
    nectaraddress = nectar.address;

    // channel offerState
    offerState.push(0) // is close
    offerState.push(2) // nonce
    offerState.push(ambassador) // ambassador address
    offerState.push(expert) // expert address
    offerState.push('0x043bbf1af93df1220dacc94b9ca51b789bf20dc3') //  random msig address
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
    
    offerArray = offerState
    offerStateBytes = Utils.marshallState(offerState)
    
    offerLib = await OfferLib.new();
  })

  it("should get offer state", async () => {
    const rawOfferState = await offerLib.getOfferState(offerStateBytes);

    const [_guid, _amount, _artifactHash, _artifactURI,
     _engagementDeadline, _assertionDeadline, _commitment, _assertion,
      _meta] = rawOfferState;

    assert.equal(Web3Utils.hexToNumberString(_guid), guid, 'guid mismatch');
    assert.equal(Web3Utils.hexToNumber(_amount), 1, 'offer amount mismatch');
    assert.equal(Web3Utils.hexToString(_artifactHash), artifactHash, 'artifact hash mismatch');
    assert.equal(Web3Utils.hexToString(_artifactURI), IPFSUri, 'artifact uri (ipfs hash) mismatch');
    assert.equal(Web3Utils.hexToNumber(_engagementDeadline), engagementDeadline, 'engagement deadline mismatch');
    assert.equal(Web3Utils.hexToNumber(_assertionDeadline), assertionDeadline, 'assertion deadline mismatch');
    assert.equal(Web3Utils.hexToString(_commitment), commitment, 'commitment mismatch');
    assert.equal(Web3Utils.hexToString(_assertion), assertion, 'assertion mismatch');
    assert.equal(Web3Utils.hexToString(_meta), metadata, 'metadata mismatch');

  })

  it("should get close flag", async () => {
    const raw = await offerLib.getCloseFlag(offerStateBytes);

    assert.equal(Web3Utils.hexToNumber(raw), 0);
  })

  it("should get state sequence", async () => {
    const raw = await offerLib.getSequence(offerStateBytes);

    assert.equal(Web3Utils.hexToNumber(raw), 2);
  })

  it("should get ambassador address", async () => {
    const raw = await offerLib.getPartyA(offerStateBytes);

    assert.equal(raw, ambassador);
  })

  it("should get expert address", async () => {
    const raw = await offerLib.getPartyB(offerStateBytes);

    assert.equal(raw, expert);
  })

  it("should get multi sig address", async () => {
    const raw = await offerLib.getMultiSigAddress(offerStateBytes);

    assert.equal(raw, '0x043bbf1af93df1220dacc94b9ca51b789bf20dc3');
  })

  it("should get ambassador balance", async () => {
    const raw = await offerLib.getBalanceA(offerStateBytes);
    
    assert.equal(Web3Utils.hexToNumber(raw), 20);
  })

  it("should get expert balance", async () => {
    const raw = await offerLib.getBalanceB(offerStateBytes);
    
    assert.equal(Web3Utils.hexToNumber(raw), 0);
  })

  it("should get nectar address", async () => {
    const raw = await offerLib.getTokenAddress(offerStateBytes);

    assert.equal(raw, nectaraddress);
  })

  it("should get channel total", async () => {
    const raw = await offerLib.getTotal(offerStateBytes);
    
    assert.equal(Web3Utils.hexToNumber(raw), 20);
  })

  it("should get channel total", async () => {
    const raw = await offerLib.getTotal(offerStateBytes);
    
    assert.equal(Web3Utils.hexToNumber(raw), 20);
  })

})
