import { ethers } from "hardhat";
import { expect } from "chai";
import { Signer } from "ethers";
import { MockERC721Royalty, EnglishAuction } from "../typechain-types";

describe("EnglishAuction", () => {
  let auction: EnglishAuction;
  let nft: MockERC721Royalty;
  let seller: Signer, alice: Signer, bob: Signer, royaltyReceiver: Signer;

  beforeEach(async () => {
    [seller, alice, bob, royaltyReceiver] = await ethers.getSigners();

    // Deploy mock ERC721 with royalty support
    const NFT = await ethers.getContractFactory("MockERC721Royalty");
    nft = await NFT.deploy();

    // Mint tokenId 1 to seller
    await nft.connect(seller).mint(1);

    // Set per-token royalty = 5% to royaltyReceiver
    await nft
      .connect(seller)
      .setTokenRoyalty(1, await royaltyReceiver.getAddress(), 500);

    // Deploy auction
    const Auction = await ethers.getContractFactory("EnglishAuction");
    auction = await Auction.connect(seller).deploy(
      await seller.getAddress(),
      await nft.getAddress(),
      1,
      ethers.parseEther("1"), // reserve price = 1 ETH
      ethers.parseEther("0.1") // min increment = 0.1 ETH
    );

    // Seller approves auction to pull NFT
    await nft.connect(seller).approve(await auction.getAddress(), 1);
  });

  it("escrows NFT when started", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);
    expect(await nft.ownerOf(1)).to.equal(await auction.getAddress());
  });

  it("enforces reserve price", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);

    await expect(
      auction.connect(alice).bid({ value: ethers.parseEther("0.5") })
    ).to.be.revertedWithCustomError(auction, "BelowReserve");

    await auction.connect(alice).bid({ value: ethers.parseEther("1") });
    expect(await auction.highestBid()).to.equal(ethers.parseEther("1"));
  });

  it("requires min increment after first bid", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);

    await auction.connect(alice).bid({ value: ethers.parseEther("1") });

    await expect(
      auction.connect(bob).bid({ value: ethers.parseEther("1.05") })
    ).to.be.revertedWithCustomError(auction, "BidTooLow");

    await auction.connect(bob).bid({ value: ethers.parseEther("1.1") });
    expect(await auction.highestBidder()).to.equal(await bob.getAddress());
  });

  it("tracks pending returns for outbid bidders", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);

    await auction.connect(alice).bid({ value: ethers.parseEther("1") });
    await auction.connect(bob).bid({ value: ethers.parseEther("1.1") });

    expect(
      await auction.pendingReturns(await alice.getAddress())
    ).to.equal(ethers.parseEther("1"));
  });

  it("allows loser to withdraw once", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);

    await auction.connect(alice).bid({ value: ethers.parseEther("1") });
    await auction.connect(bob).bid({ value: ethers.parseEther("1.1") });

    await expect(auction.connect(alice).withdraw())
      .to.emit(auction, "Withdrawn")
      .withArgs(await alice.getAddress(), ethers.parseEther("1"));

    await expect(auction.connect(alice).withdraw()).to.be.revertedWithCustomError(
      auction,
      "NoBid"
    );
  });

  it("settles and pays royalties correctly", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);

    await auction.connect(alice).bid({ value: ethers.parseEther("1") });
    await auction.connect(bob).bid({ value: ethers.parseEther("2") });

    // Fast-forward to after end
    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 200]);
    await ethers.provider.send("evm_mine", []);

    const sellerBefore = await ethers.provider.getBalance(
      await seller.getAddress()
    );
    const royaltyBefore = await ethers.provider.getBalance(
      await royaltyReceiver.getAddress()
    );

    await expect(auction.connect(alice).settle())
      .to.emit(auction, "Settled")
      .withArgs(
        await bob.getAddress(),
        ethers.parseEther("2"),
        await royaltyReceiver.getAddress(),
        ethers.parseEther("0.1") // 5% of 2 ETH
      );

    expect(await nft.ownerOf(1)).to.equal(await bob.getAddress());

    const sellerAfter = await ethers.provider.getBalance(
      await seller.getAddress()
    );
    const royaltyAfter = await ethers.provider.getBalance(
      await royaltyReceiver.getAddress()
    );

    expect(sellerAfter - sellerBefore).to.equal(
      ethers.parseEther("1.9")
    );
    expect(royaltyAfter - royaltyBefore).to.equal(
      ethers.parseEther("0.1")
    );
  });

  it("reverts settle before auction ends", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);
    await auction.connect(alice).bid({ value: ethers.parseEther("1") });

    await expect(auction.connect(alice).settle()).to.be.revertedWithCustomError(
      auction,
      "NotEndedYet"
    );
  });

  it("reverts settle if no bids", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);

    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 200]);
    await ethers.provider.send("evm_mine", []);

    await expect(auction.connect(seller).settle()).to.be.revertedWithCustomError(
      auction,
      "NoBid"
    );
  });

  it("reverts if settle is called twice", async () => {
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await auction.connect(seller).start(now, now + 100);

    await auction.connect(alice).bid({ value: ethers.parseEther("2") });

    await ethers.provider.send("evm_setNextBlockTimestamp", [now + 200]);
    await ethers.provider.send("evm_mine", []);

    await auction.connect(alice).settle();

    await expect(auction.connect(alice).settle()).to.be.revertedWithCustomError(
      auction,
      "AlreadySettled"
    );
  });
});
