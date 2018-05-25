// 'use strict'

// const MultiSig = artifacts.require("./MultiSig.sol")
// const NectarToken = artifacts.require("./NectarToken.sol")
// const OfferChannel = artifacts.require("./OfferChannel.sol")
// const OfferLib = artifacts.require("./OfferLib.sol")
// const OfferRegistry = artifacts.require("./OfferRegistry.sol")
// const Utils = require('./helpers/utils')
// import socketIOClient from 'socket.io-client';
// const ambassadorSocket = socketIOClient("http://127.0.0.1:4001");
// const expertSocket = socketIOClient("http://127.0.0.1:4001");
// const util = require('ethereumjs-util');

// // offer state
// let offerChannelID
// let guid
// let subchannelInputs
// let artifactHash
// let engagementDeadline
// let assertionDeadline
// let commitment
// let assertion
// let IPFSUri
// let metadata
// let nectar
// let nectaraddress;

// // offer channel contrat
// let msig

// let registry

// // channel participants
// let ambassador
// let expert

// // lib for interacting with state
// let offerLib

// // sig storage
// let s0sigA
// let s0sigB
// let s1sigA
// let s1sigB
// let s2sigA
// let s2sigB

// // state storage
// let s0
// let s0marshall
// let s1
// let s1marshall
// let s2
// let s2marshall

// let offerstates = [];


// contract('Offer Channel MultiSig', function(accounts) {

//   before(async () => {
//     ambassador = accounts[1];
//     expert = accounts[2];

//     nectar = await NectarToken.new();
//     nectaraddress = nectar.address;
//     nectar.mint(ambassador, 2000);
//     offerLib = await OfferLib.new();
//   })

//   it("deploy MultiSig with 10 second settlement period length", async () => {
//     let settlementPeriodLength = 10; // seconds

//     registry = await OfferRegistry.new()
//     msig = await MultiSig.new(offerLib.address, registry.address, ambassador, expert, settlementPeriodLength)
//   })

//   it("approve MultiSig to accept control nectar for ambassador", async () => {
//     await nectar.approve(msig.address, 20, { from: ambassador })
//   })

//   it("allow nectar transfers", async () => {
//     await nectar.enableTransfers()
//   })

//   it("generate initial offer state", async () => {
//     let inputs = []
//     guid = Math.floor(Math.random() * 10000)
    
//     inputs.push(0) // is close
//     inputs.push(0) // nonce
//     inputs.push(ambassador) // ambassador address
//     inputs.push(expert) // expert address
//     inputs.push(msig.address) //  msig address
//     inputs.push(20) // balance in nectar ambassador
//     inputs.push(0) // balance in nectar expert
//     inputs.push(nectaraddress) // token address
//     inputs.push(guid) // A globally-unique identi er for the Listing.

//     s0 = inputs
//     s0marshall = Utils.marshallState(inputs)
//   })

//   it("opens a signed socket connection for ambassador (to prove identity and get access connections)", async () => {
//     const msg = new Buffer('connect');
//     const sig = web3.eth.sign(ambassador, '0x' + msg.toString('hex'));
//     const res = util.fromRpcSig(sig);

//     ambassadorSocket.emit('signed connection', msg, res.r, res.s, res.v, ambassador);

//   });

//   it("opens a signed socket connection for expert (to prove identity and get access connections)", async () => {
//     const msg = new Buffer('connect');
//     const sig = web3.eth.sign(expert, '0x' + msg.toString('hex'));
//     const res = util.fromRpcSig(sig);

//     expertSocket.emit('signed connection', msg, res.r, res.s, res.v, expert);
//   });

//   it("ambassador signs initial state, opens msig agreement, and sends to expert socket (assumes the ambassador knows who the expert is)", async () => {
//     s0sigA = await web3.eth.sign(ambassador, web3.sha3(s0marshall, { encoding: 'hex' }));

//     let r = s0sigA.substr(0, 66)
//     let s = "0x" + s0sigA.substr(66, 64)
//     let v = parseInt(s0sigA.substr(130, 2)) + 27
//     let sequence = s0[1];
//     let receipt = await msig.openAgreement(s0marshall, v, r, s, { from: ambassador })

//     // send a signed message
//     ambassadorSocket.emit('signed state', expert, s0marshall, { ambassador: { v, r, s, sig: s0sigA } });

//     // expert reveices signed message
//     expertSocket.on(expert, async (addy, s0marshall, signatureOb) => {
//         s0sigB = await web3.eth.sign(expert, web3.sha3(s0marshall, { encoding: 'hex' }))
//         r = s0sigB.substr(0,66)
//         s = "0x" + s0sigB.substr(66,64)
//         v = parseInt(s0sigB.substr(130, 2)) + 27
//         receipt = await msig.joinAgreement(s0marshall, v, r, s, { from: expert })

//         expertSocket.emit('signed state', ambassador, s0marshall, { expert: { v, r, s, sig: s0sigB } });
//     })

//     ambassadorSocket.on(ambassador, (addy, s0marshall, signatureOb) => {
//         console.log(addy, s0marshall, signatureOb)
//     })

//   })

//   xit("approve MultiSig to accept control nectar for expert", async () => {
//     await nectar.approve(msig.address, 0, { from: expert })
//   })

//   xit("expert signs state and joins msig agreement", async () => {
//     s0sigB = await web3.eth.sign(expert, web3.sha3(s0marshall, { encoding: 'hex' }))
//     let r = s0sigB.substr(0,66)
//     let s = "0x" + s0sigB.substr(66,64)
//     let v = parseInt(s0sigB.substr(130, 2)) + 27
//     let sequence = s0[1];
//     let receipt = await msig.joinAgreement(s0marshall, v, r, s, { from: expert })
//     let gasUsed = receipt.receipt.gasUsed

//     offerstates[sequence].sigB = s0sigB;

//     // fireapp.database().ref(guid).set({
//     //     offerstates
//     // });

//   })

//   xit("generate offer", async () => {
//     offerChannelID = Math.floor(Math.random() * 10000)
//     subchannelInputs = [];
//     artifactHash = web3.sha3(Math.random());
//     engagementDeadline = 10;
//     assertionDeadline = 50;
//     commitment = false;
//     assertion = 'none';
//     IPFSUri = web3.sha3(Math.random());
//     metadata = 'Locky';

//     // channel offerState
//     const offerState = []
//     offerState.push(0) // is close
//     offerState.push(1) // sequence
//     offerState.push(ambassador) // ambassador address
//     offerState.push(expert) // expert address
//     offerState.push(msig.address) //  msig address
//     offerState.push(20) // balance in nectar ambassador
//     offerState.push(0) // balance in nectar expert
//     offerState.push(nectaraddress) // token address
//     offerState.push(guid) // A globally-unique identi er for the Listing.
//     offerState.push(1) // The Offer Amount.
//     offerState.push(artifactHash) // Cryptographic hash of the Artifact.
//     offerState.push(IPFSUri) // The URI of the Artifact.
//     offerState.push(engagementDeadline) // Engagement Deadline
//     offerState.push(assertionDeadline) // Assertion Deadline
//     offerState.push(commitment) // has the expert made commitment
//     offerState.push(assertion) // “malicious” or “benign”
//     offerState.push(metadata) // Information derived during Assertion generation

//     s1 = offerState
//     s1marshall = Utils.marshallState(offerState)

//     offerstates.push({ state: s1marshall });

//     // fireapp.database().ref(guid).set({
//     //     offerstates
//     // });

//   })

//   xit("both parties sign state: s1", async () => {
//     s1sigA = await web3.eth.sign(ambassador, web3.sha3(s1marshall, {encoding: 'hex'}))
//     s1sigB = await web3.eth.sign(expert, web3.sha3(s1marshall, {encoding: 'hex'}))

//     let sequence = s1[1];

//     offerstates[sequence].sigA = s1sigA;
//     offerstates[sequence].sigB = s1sigB;

//     // fireapp.database().ref(guid).set({
//     //     offerstates
//     // });

//   })

//   xit("can update MultiSig balance", async () => {

//     // channel deposit update and allow for more tokens on contract
//     await nectar.approve(msig.address, 180, { from: ambassador })

//     const offerState = []
//     offerState.push(0) // is close
//     offerState.push(2) // sequence
//     offerState.push(ambassador) // ambassador address
//     offerState.push(expert) // expert address
//     offerState.push(msig.address) //  msig address
//     offerState.push(200) // new balance in nectar ambassador
//     offerState.push(0) // balance in nectar expert
//     offerState.push(nectaraddress) // token address
//     offerState.push(guid) // A globally-unique identi er for the Listing.
//     offerState.push(1) // The Offer Amount.
//     offerState.push(artifactHash) // Cryptographic hash of the Artifact.
//     offerState.push(IPFSUri) // The URI of the Artifact.
//     offerState.push(engagementDeadline) // Engagement Deadline
//     offerState.push(assertionDeadline) // Assertion Deadline
//     offerState.push(commitment) // has the expert made commitment
//     offerState.push(assertion) // “malicious” or “benign”
//     offerState.push(metadata) // Information derived during Assertion generation

//     let depositState = Utils.marshallState(offerState)
//     let sigA = await web3.eth.sign(ambassador, web3.sha3(depositState, {encoding: 'hex'}))
//     let sigB = await web3.eth.sign(expert, web3.sha3(depositState, {encoding: 'hex'}))

//     let r = sigA.substr(0,66)
//     let s = "0x" + sigA.substr(66,64)
//     let v = parseInt(sigA.substr(130, 2)) + 27

//     let r2 = sigB.substr(0,66)
//     let s2 = "0x" + sigB.substr(66,64)
//     let v2 = parseInt(sigB.substr(130, 2)) + 27

//     let sigV = []
//     let sigR = []
//     let sigS = []

//     sigV.push(v)
//     sigV.push(v2)
//     sigR.push(r)
//     sigR.push(r2)
//     sigS.push(s)
//     sigS.push(s2)

//     await msig.depositState(depositState, sigV, sigR, sigS);
//     let newBal = await nectar.balanceOf(msig.address);

//     offerstates.push({ state: s1marshall, sigA, sigB });

//     // fireapp.database().ref(guid).set({
//     //     offerstates
//     // });

//     assert.equal(newBal.toNumber(), 200);
//   })

//   xit("expert can accept offer", async () => {
//     commitment = true;

//     // channel offerState
//     const offerState = []
//     offerState.push(0) // is close
//     offerState.push(3) // sequence
//     offerState.push(ambassador) // ambassador address
//     offerState.push(expert) // expert address
//     offerState.push(msig.address) //  msig address
//     offerState.push(200) // balance in nectar ambassador
//     offerState.push(0) // balance in nectar expert
//     offerState.push(nectaraddress) // token address
//     offerState.push(guid) // A globally-unique identi er for the Listing.
//     offerState.push(1) // The Offer Amount.
//     offerState.push(artifactHash) // Cryptographic hash of the Artifact.
//     offerState.push(IPFSUri) // The URI of the Artifact.
//     offerState.push(engagementDeadline) // Engagement Deadline
//     offerState.push(assertionDeadline) // Assertion Deadline
//     offerState.push(commitment) // has the expert made commitment
//     offerState.push(assertion) // “malicious” or “benign”
//     offerState.push(metadata) // Information derived during Assertion generation


//     s2 = offerState
//     s2marshall = Utils.marshallState(offerState)

//     offerstates.push({ state: s2marshall });

//     // fireapp.database().ref(guid).set({
//     //     offerstates
//     // });

//   })

//   xit("both parties sign state: s2", async () => {
//     s2sigA = await web3.eth.sign(ambassador, web3.sha3(s2marshall, {encoding: 'hex'}))
//     s2sigB = await web3.eth.sign(expert, web3.sha3(s2marshall, {encoding: 'hex'}))

//     let sequence = s2[1];

//     offerstates[sequence].sigA = s2sigA;
//     offerstates[sequence].sigB = s2sigB;

//     // fireapp.database().ref(guid).set({
//     //     offerstates
//     // });

//   })

// })
