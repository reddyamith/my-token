const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DLGR = (n) => ethers.parseUnits(String(n), 18);
const YEAR = 365 * 24 * 3600;

describe("TeamVesting and TokenLock", function () {
  let dlgr, deployer, team, other;

  beforeEach(async () => {
    [deployer, team, other] = await ethers.getSigners();
    dlgr = await ethers.deployContract("DelegraToken", [deployer.address]);
  });

  describe("TeamVesting", () => {
    const AMOUNT = DLGR(200_000_000);
    let vesting, start;

    beforeEach(async () => {
      start = (await time.latest()) + 60;
      vesting = await ethers.deployContract("TeamVesting", [team.address, start, 3 * YEAR, YEAR / 2]);
      await dlgr.transfer(await vesting.getAddress(), AMOUNT);
    });

    it("releases nothing before the cliff", async () => {
      await time.increaseTo(start + YEAR / 2 - 10);
      expect(await vesting["releasable(address)"](await dlgr.getAddress())).to.equal(0n);
      await vesting["release(address)"](await dlgr.getAddress());
      expect(await dlgr.balanceOf(team.address)).to.equal(0n);
    });

    it("vests linearly after the cliff and fully at the end", async () => {
      await time.increaseTo(start + YEAR);
      await vesting["release(address)"](await dlgr.getAddress());
      const afterOneYear = await dlgr.balanceOf(team.address);
      expect(afterOneYear).to.be.closeTo(AMOUNT / 3n, DLGR(100));

      await time.increaseTo(start + 3 * YEAR + 1);
      await vesting.connect(other)["release(address)"](await dlgr.getAddress()); // anyone may trigger
      expect(await dlgr.balanceOf(team.address)).to.equal(AMOUNT);
    });

    it("cannot be sped up or redirected", async () => {
      expect(await vesting.owner()).to.equal(team.address);
      expect(await vesting.duration()).to.equal(3 * YEAR);
      expect(await vesting.cliff()).to.equal(start + YEAR / 2);
      // No function exists to withdraw ahead of schedule; the only path is release().
      expect(vesting.interface.getFunction("withdraw")).to.equal(null);
    });
  });

  describe("TokenLock", () => {
    let lock, unlock;

    beforeEach(async () => {
      unlock = (await time.latest()) + YEAR;
      lock = await ethers.deployContract("TokenLock", [await dlgr.getAddress(), team.address, unlock]);
      await dlgr.transfer(await lock.getAddress(), DLGR(1000));
    });

    it("refuses withdrawal before unlock and by others", async () => {
      await expect(lock.connect(team).withdraw()).to.be.revertedWith("still locked");
      await time.increaseTo(unlock + 1);
      await expect(lock.connect(other).withdraw()).to.be.revertedWith("not beneficiary");
    });

    it("releases everything to the beneficiary after unlock", async () => {
      expect(await lock.locked()).to.equal(DLGR(1000));
      await time.increaseTo(unlock + 1);
      await expect(lock.connect(team).withdraw()).to.emit(lock, "Withdrawn").withArgs(team.address, DLGR(1000));
      expect(await dlgr.balanceOf(team.address)).to.equal(DLGR(1000));
      expect(await lock.locked()).to.equal(0n);
    });

    it("rejects an unlock time in the past", async () => {
      await expect(ethers.deployContract("TokenLock", [await dlgr.getAddress(), team.address, 1])).to.be.revertedWith("unlock in past");
    });
  });
});
