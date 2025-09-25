import hre, { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  // Load environment variables (make sure to define these in .env)
  const seller = process.env.SELLER as string;
  const tokenId = Number(process.env.TOKEN_ID);
  const reserveEth = process.env.RESERVE_ETH || "0.5"; // default 1 ETH
  const minIncEth = process.env.MIN_INC_ETH || "0.1";  // default 0.1 ETH

  const MockERC721Royalty = await ethers.getContractFactory("MockERC721Royalty")
  const mockRoyalty = await MockERC721Royalty.deploy();

  for(let i = 16; i < 20; i ++) {
      await mockRoyalty.mint(i);
  }
  console.log("MockERC721 deployed to:", mockRoyalty.address);

  const Auction = await ethers.getContractFactory("EnglishAuction");
  const auctionArguments = [
    seller,
    process.env.NFT_ADDRESS!,
    tokenId,
    ethers.parseEther(reserveEth),
    ethers.parseEther(minIncEth),
  ];
  const auction = await Auction.deploy(
    seller,
    process.env.NFT_ADDRESS!,
    tokenId,
    ethers.parseEther(reserveEth),
    ethers.parseEther(minIncEth),
  );

  console.log("EnglishAuction deployed to:", await auction.getAddress());


  console.log("🔍 Verifying...");
  await hre.run("verify:verify", {
      address: process.env.NFT_ADDRESS!,
      constructorArguments: []
  });
  await hre.run("verify:verify", {
      address: "0x95aE7858525E71adCECe5e6Eca9a30b5CC1D8484",
      constructorArguments: auctionArguments
  });

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
