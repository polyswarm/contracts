pragma solidity ^0.5.0;

import "openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

contract NectarToken is ERC20Mintable, Ownable {
    string public name = "Nectar";
    string public symbol = "NCT";
    uint8 public decimals = 18;

    bool public transfersEnabled = false;
    event TransfersEnabled();

    // Disable transfers until after the sale
    modifier whenTransfersEnabled() {
        require(transfersEnabled, "Transfers not enabled");
        _;
    }

    modifier whenTransfersNotEnabled() {
        require(!transfersEnabled, "Transfers enabled");
        _;
    }

    function enableTransfers() public onlyOwner whenTransfersNotEnabled {
        transfersEnabled = true;
        emit TransfersEnabled();
    }

    function transfer(address to, uint256 value) public whenTransfersEnabled returns (bool) {
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public whenTransfersEnabled returns (bool) {
        return super.transferFrom(from, to, value);
    }

    // Approves and then calls the receiving contract
    function approveAndCall(address _spender, uint256 _value, bytes memory _extraData) public returns (bool) {
        require(approve(_spender, _value), "approve failed");

        // Call the receiveApproval function on the contract you want to be notified.
        // This crafts the function signature manually so one doesn't have to include a contract in here just for this.
        //
        // receiveApproval(address _from, uint256 _value, address _tokenContract, bytes _extraData)
        //
        // It is assumed that when does this that the call *should* succeed, otherwise one would use vanilla approve instead.

        // solium-disable-next-line security/no-low-level-calls, indentation
        (bool success, ) = _spender.call(
            abi.encodeWithSignature("receiveApproval(address,uint256,address,bytes)", msg.sender, _value, address(this), _extraData));
        require(success, "receiveApproval failed");
        return true;
    }
}
