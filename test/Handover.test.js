const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Admin handover (Ownable2Step)", function () {
  async function deploy() {
    const [deployer, safe, stranger] = await ethers.getSigners();
    const dlgr = await ethers.deployContract("DelegraToken", [deployer.address]);
    const registry = await ethers.deployContract("AgentRegistry", [await dlgr.getAddress(), ethers.parseUnits("1000", 18), deployer.address]);
    const escrow = await ethers.deployContract("TaskEscrow", [await registry.getAddress(), deployer.address, deployer.address]);
    return { deployer, safe, stranger, registry, escrow };
  }

  it("old owner keeps control until the new owner accepts", async function () {
    const { deployer, safe, stranger, registry, escrow } = await deploy();
    for (const c of [registry, escrow]) {
      await c.transferOwnership(safe.address);
      expect(await c.owner()).to.equal(deployer.address);
      expect(await c.pendingOwner()).to.equal(safe.address);
      await expect(c.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(c, "OwnableUnauthorizedAccount");
      await c.connect(safe).acceptOwnership();
      expect(await c.owner()).to.equal(safe.address);
      expect(await c.pendingOwner()).to.equal(ethers.ZeroAddress);
    }
  });

  it("after handover only the new owner can change parameters", async function () {
    const { deployer, safe, escrow } = await deploy();
    await escrow.transferOwnership(safe.address);
    await escrow.connect(safe).acceptOwnership();
    await expect(escrow.setFeeBps(200)).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    await escrow.connect(safe).setFeeBps(200);
    expect(await escrow.feeBps()).to.equal(200);
    await escrow.connect(safe).setTreasury(safe.address);
    expect(await escrow.treasury()).to.equal(safe.address);
    expect(deployer.address).to.not.equal(await escrow.owner());
  });

  it("a mistaken proposal can be cancelled by re-proposing", async function () {
    const { deployer, safe, stranger, registry } = await deploy();
    await registry.transferOwnership(stranger.address);
    await registry.transferOwnership(safe.address);
    await expect(registry.connect(stranger).acceptOwnership()).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    expect(await registry.owner()).to.equal(deployer.address);
  });
});
