const Buffer = require('buffer').Buffer
const util = require('ethereumjs-util')

module.exports = {

  getBytes: function getBytes(input) {
    if(Buffer.isBuffer(input)) input = '0x' + input.toString('hex')
    if(66-input.length <= 0) return web3.toHex(input)
    return this.padBytes32(web3.toHex(input))
  },

  marshallState: function marshallState(inputs, log) {
    var m = this.getBytes(inputs[0])

    for(var i=1; i<inputs.length;i++) {
      if (log) {
        console.log(m + '\n');
      }
      m += this.getBytes(inputs[i]).substr(2, this.getBytes(inputs[i]).length)
    }
    return m
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