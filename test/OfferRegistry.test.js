'use strict'
const OfferRegistry = artifacts.require("./OfferRegistry.sol")
const OfferMultiSig = artifacts.require("./OfferMultiSig.sol")

// offer state
let guid = 101;
let registry

// channel participants
let ambassador
let expert

// lib for interacting with state
let offerMsig;


contract('OfferRegistry', function(accounts) {

  before(async () => {
    ambassador = accounts[1];
    expert = accounts[2];
  })

  it("can init msig contract", async () => {
    let settlementPeriodLength = 60; // seconds

    registry = await OfferRegistry.new();

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

})
