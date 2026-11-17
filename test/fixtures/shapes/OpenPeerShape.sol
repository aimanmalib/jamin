// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

// Shape C: Solidity-mode port that keeps OpenPeer's layout: one contract, many escrows in a mapping.
contract OpenPeerShape {
    struct Escrow {
        bool exists;
        uint32 sellerCanCancelAfter;
        uint256 fee;
        bool dispute;
    }

    address payable public seller;
    address public feeRecipient;
    mapping(bytes32 => Escrow) public escrows;

    event EscrowCreated(bytes32 indexed orderHash);
    event Released(bytes32 indexed orderHash);
    event CancelledByBuyer(bytes32 indexed orderHash);

    error EscrowNotFound();

    function createNativeEscrow(bytes32 orderId, address payable buyer, uint256 amount, uint32 waitingTime)
        external payable
    {
        require(amount > 0, "Invalid amount");
        uint256 fee = (amount * 30) / 10_000;
        require(msg.value == amount + fee, "Tokens not sent");
        bytes32 orderHash = sha256(abi.encodePacked(orderId, seller, buyer, amount));
        require(!escrows[orderHash].exists, "Order already exists");
        escrows[orderHash] = Escrow(true, uint32(block.timestamp) + waitingTime, fee, false);
        emit EscrowCreated(orderHash);
    }

    function release(bytes32 orderId, address payable buyer, uint256 amount) external {
        require(msg.sender == seller, "Must be seller");
        bytes32 orderHash = sha256(abi.encodePacked(orderId, seller, buyer, amount));
        Escrow memory escrow = escrows[orderHash];
        if (!escrow.exists) revert EscrowNotFound();
        delete escrows[orderHash];
        buyer.transfer(amount);
        payable(feeRecipient).transfer(escrow.fee);
        emit Released(orderHash);
    }

    function buyerCancel(bytes32 orderId, address payable buyer, uint256 amount) external {
        require(msg.sender == buyer, "Must be buyer");
        bytes32 orderHash = sha256(abi.encodePacked(orderId, seller, buyer, amount));
        Escrow memory escrow = escrows[orderHash];
        if (!escrow.exists) revert EscrowNotFound();
        delete escrows[orderHash];
        seller.transfer(amount + escrow.fee);
        emit CancelledByBuyer(orderHash);
    }
}
