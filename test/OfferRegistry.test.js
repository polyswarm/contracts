'use strict'
const OfferRegistry = artifacts.require("./OfferRegistry.sol")
const OfferMultiSig = artifacts.require("./OfferMultiSig.sol")
const NectarToken = artifacts.require("./NectarToken.sol")

// offer state
let guid = 101;
let registry

// lib for interacting with state
let offerMsig;

contract('OfferRegistry', function([owner, ambassador, expert]) {

  before(async () => {
    let nectar = await NectarToken.new();
    
    registry = await OfferRegistry.new(nectar.address);
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

})
