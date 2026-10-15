const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MyToken", function () {
  const SUPPLY = ethers.parseUnits("100000000", 18);
  const CAP = ethers.parseUnits("1000000000", 18);
  let token, owner, alice;

  beforeEach(async () => {
    [owner, alice] = await ethers.getSigners();
    token = await ethers.deployContract("MyToken", ["MyToken", "MTK", SUPPLY, CAP, owner.address]);
  });

  it("has the right metadata and initial supply", async () => {
    expect(await token.name()).to.equal("MyToken");
    expect(await token.symbol()).to.equal("MTK");
    expect(await token.decimals()).to.equal(18);
    expect(await token.totalSupply()).to.equal(SUPPLY);
    expect(await token.balanceOf(owner.address)).to.equal(SUPPLY);
  });

  it("transfers tokens", async () => {
    await token.transfer(alice.address, 1000n);
    expect(await token.balanceOf(alice.address)).to.equal(1000n);
  });

  it("lets the owner mint up to the cap", async () => {
    await token.mint(alice.address, CAP - SUPPLY);
    expect(await token.totalSupply()).to.equal(CAP);
    await expect(token.mint(alice.address, 1n)).to.be.revertedWithCustomError(token, "CapExceeded");
  });

  it("blocks non-owners from minting", async () => {
    await expect(token.connect(alice).mint(alice.address, 1n))
      .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
  });

  it("burns tokens", async () => {
    await token.burn(500n);
    expect(await token.totalSupply()).to.equal(SUPPLY - 500n);
  });
});
