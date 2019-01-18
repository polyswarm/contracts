/* global artifacts, it, assert, contract, beforeEach, describe */


import bnChai from 'bn-chai';
import BN from 'bn.js';
import EVMRevert from './helpers/EVMRevert';

require('chai')
  .use(require('chai-as-promised'))
  .use(bnChai(BN))
  .should();

const WorkerDescriptionRegistry = artifacts.require('WorkerDescriptionRegistry');
let wdr;
const ipfsHash = 'QmfC6Ra1rGSBWzBDsbJxhKbocr5Buoou3AgG5G9y5DGPHv';

contract('WorkerDescriptionRegistry', ([owner, user0, user1, user2]) => {
  describe('Worker Description Registry functions', () => {
    beforeEach(async () => {
      wdr = await WorkerDescriptionRegistry.new();
    });

    it('should allow users to add a worker description', async () => {
      await wdr.addWorkerDescription(ipfsHash, { from: user0 });
      await wdr.addWorkerDescription(ipfsHash, { from: user1 });
      await wdr.addWorkerDescription(ipfsHash, { from: user2 });

      let wdlID = await wdr.addressToId.call(user0);
      let wd = await wdr.idToWorkerDescription.call(wdlID);

      assert.equal(wd[0], user0);
      assert.equal(wd[1], ipfsHash);

      wdlID = await wdr.addressToId.call(user1);
      wd = await wdr.idToWorkerDescription.call(wdlID);

      assert.equal(wd[0], user1);
      assert.equal(wd[1], ipfsHash);

      wdlID = await wdr.addressToId.call(user2);
      wd = await wdr.idToWorkerDescription.call(wdlID);

      assert.equal(wd[0], user2);
      assert.equal(wd[1], ipfsHash);
    });

    it('should allow a user to remove their worker description', async () => {
      await wdr.addWorkerDescription(ipfsHash, { from: user0 });
      await wdr.addWorkerDescription(ipfsHash, { from: user1 });
      await wdr.addWorkerDescription(ipfsHash, { from: user2 });

      let wdlID = await wdr.addressToId.call(user0);

      await wdr.removeWorkerDescription(wdlID.toNumber(), { from: user0 });

      wdlID = await wdr.addressToId.call(owner);

      assert.equal(0, wdlID.toNumber());
    });

    it('should not allow a user to remove their worker description if they have removed it', async () => {
      await wdr.addWorkerDescription(ipfsHash, { from: user0 });
      await wdr.addWorkerDescription(ipfsHash, { from: user1 });
      await wdr.addWorkerDescription(ipfsHash, { from: user2 });

      let wdlID = await wdr.addressToId.call(user1);

      await wdr.removeWorkerDescription(wdlID.toNumber(), { from: user1 });

      wdlID = await wdr.addressToId.call(owner);

      assert.equal(0, wdlID.toNumber());

      await wdr.removeWorkerDescription(wdlID.toNumber(), { from: user1 }).should.be.rejectedWith(EVMRevert);
    });

    it('should allow a user to update their worker description', async () => {
      await wdr.addWorkerDescription(ipfsHash, { from: user0 });
      await wdr.addWorkerDescription(ipfsHash, { from: user1 });
      await wdr.addWorkerDescription(ipfsHash, { from: user2 });

      const newIPFSHash = 'Qmb4atcgbbN5v4CDJ8nz5QG5L2pgwSTLd3raDrnyhLjnUH';

      const wdlID = await wdr.addressToId.call(user2);

      await wdr.updateWorkerDescription(wdlID.toNumber(), newIPFSHash, { from: user2 });

      const wd = await wdr.idToWorkerDescription.call(wdlID);

      assert.equal(wd[1], newIPFSHash);
    });

    it('should allow listing addresses of worker description owners', async () => {
      await wdr.addWorkerDescription(ipfsHash, { from: user0 });
      await wdr.addWorkerDescription(ipfsHash, { from: user1 });
      await wdr.addWorkerDescription(ipfsHash, { from: user2 });

      const addresses = await wdr.getWorkerOwnerAddresses();
      assert.equal(addresses[0], user0);
      assert.equal(addresses[1], user1);
      assert.equal(addresses[2], user2);
    });
  });
});
