// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/interfaces/IERC2981.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";

contract MockERC721Royalty is ERC721Royalty {
    constructor() ERC721("MockERC721Royalty", "MR") {}

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override
        returns (bool)
    {
        return interfaceId == type(IERC2981).interfaceId || super.supportsInterface(interfaceId);
    }
    function setTokenRoyalty(uint256 tokenId, address receiver, uint96 feeNumerator) external {
        require(_ownerOf(tokenId) == msg.sender, "Not Owner!");
        _setTokenRoyalty(tokenId, receiver, feeNumerator);
    }

    function mint(uint id) external {
        _safeMint(msg.sender, id);
    }
}
