const Buffer = require('buffer').Buffer
const util = require('ethereumjs-util')
const Web3Utils = require('web3-utils')

module.exports = {

  getBytes: function getBytes(input) {
    if(Buffer.isBuffer(input)) input = '0x' + input.toString('hex')
    if(66-input.length <= 0) return web3.utils.toHex(input)
    return this.padBytes32(web3.utils.toHex(input))
  },

  marshallState: function marshallState(inputs) {
    var m = this.getBytes(inputs[0])
    for(var i=1; i<inputs.length;i++) {
      m += this.getBytes(inputs[i]).substr(2, this.getBytes(inputs[i]).length)
    }
    return m
  },

  convertToParts: function convertToParts(input) {
    var m = [];

    for(var i=0; i < input.length; i+=32) {
      m.push(Web3Utils.stringToHex(input.slice(i, i + 32)))
    }

    return m;
  },

  padBytes32: function padBytes32(data){
    // TODO: check input is hex / move to TS
    let l = 66-data.length

    let x = data.substr(2, data.length)

    for(var i=0; i<l; i++) {
      x = 0 + x
    }
    return '0x' + x
  }

}