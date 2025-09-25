// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

/// @title EnglishAuction
/// @notice Minimal English auction with reserve price, min increment, settlement, loser withdrawals, and EIP-2981 hook.
contract EnglishAuction is ReentrancyGuard {
    using Address for address payable;

    error NotSeller();
    error NotStarted();
    error AlreadyStarted();
    error NotEndedYet();
    error BelowReserve();
    error BidTooLow();
    error NoBid();
    error AlreadySettled();

    event Started(uint64 startTime, uint64 endTime);
    event BidPlaced(address indexed bidder, uint256 amount);
    event Withdrawn(address indexed bidder, uint256 amount);
    event Settled(address indexed winner, uint256 amount, address royaltyReceiver, uint256 royaltyPaid);

    IERC721 public immutable nft;
    uint256 public immutable tokenId;
    address public immutable seller;
    uint256 public immutable reservePrice;
    uint256 public immutable minIncrement;

    uint64 public startTime;
    uint64 public endTime;
    address public highestBidder;
    uint256 public highestBid;
    bool public settled;

    mapping(address => uint256) public pendingReturns;

    constructor(
        address _seller,
        address _nft,
        uint256 _tokenId,
        uint256 _reservePrice,
        uint256 _minIncrement
    ) {
        seller = _seller;
        nft = IERC721(_nft);
        tokenId = _tokenId;
        reservePrice = _reservePrice;
        minIncrement = _minIncrement;
    }

    function start(uint64 _start, uint64 _end) external {
        if (msg.sender != seller) revert NotSeller();
        if (startTime != 0) revert AlreadyStarted();

        // transfer NFT into contract custody
        nft.transferFrom(seller, address(this), tokenId);

        startTime = _start;
        endTime = _end;

        emit Started(_start, _end);
    }

    function bid() external payable nonReentrant {
        if (block.timestamp < startTime || block.timestamp > endTime) revert NotStarted();

        if (highestBid == 0) {
            if (msg.value < reservePrice) revert BelowReserve();
        } else {
            if (msg.value < highestBid + minIncrement) revert BidTooLow();
            pendingReturns[highestBidder] += highestBid;
        }

        highestBidder = msg.sender;
        highestBid = msg.value;

        emit BidPlaced(msg.sender, msg.value);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        if (amount == 0) revert NoBid();
        pendingReturns[msg.sender] = 0;
        payable(msg.sender).sendValue(amount);

        emit Withdrawn(msg.sender, amount);
    }

    function settle() external nonReentrant {
        if (settled) revert AlreadySettled();
        if (startTime == 0) revert NotStarted();
        if (block.timestamp < endTime) revert NotEndedYet(); // clearer revert
        settled = true;

        address winner = highestBidder;
        uint256 amount = highestBid;
        if (winner == address(0)) revert NoBid();

        nft.transferFrom(address(this), winner, tokenId);

        (address receiver, uint256 royaltyAmount) = address(nft) != address(0)
            ? IERC2981(address(nft)).royaltyInfo(tokenId, amount)
            : (address(0), 0);

        if (receiver != address(0) && royaltyAmount > 0) {
            payable(receiver).sendValue(royaltyAmount);
        }

        payable(seller).sendValue(amount - royaltyAmount);

        emit Settled(winner, amount, receiver, royaltyAmount);
    }
}
