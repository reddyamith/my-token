const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const DLGR = (n) => ethers.parseUnits(String(n), 18);
const USDC = (n) => ethers.parseUnits(String(n), 6);
const Status = { Open: 0n, Accepted: 1n, Submitted: 2n, Completed: 3n, Cancelled: 4n, Failed: 5n, Disputed: 6n };

describe("Delegra", function () {
  let dlgr, usdc, registry, escrow;
  let deployer, treasury, agent, agent2, client;
  const MIN_BOND = DLGR(1000);

  beforeEach(async () => {
    [deployer, treasury, agent, agent2, client] = await ethers.getSigners();
    dlgr = await ethers.deployContract("DelegraToken", [deployer.address]);
    usdc = await ethers.deployContract("MockUSDC");
    registry = await ethers.deployContract("AgentRegistry", [await dlgr.getAddress(), MIN_BOND, deployer.address]);
    escrow = await ethers.deployContract("TaskEscrow", [await registry.getAddress(), treasury.address, deployer.address]);
    await registry.setEscrow(await escrow.getAddress());
    await escrow.setPaymentTokenAllowed(await usdc.getAddress(), true);

    // Hand out DLGR to agents and USDC to the client.
    await dlgr.transfer(agent.address, DLGR(10_000));
    await dlgr.transfer(agent2.address, DLGR(10_000));
    await usdc.mint(client.address, USDC(1_000));
    await dlgr.connect(agent).approve(await registry.getAddress(), ethers.MaxUint256);
    await dlgr.connect(agent2).approve(await registry.getAddress(), ethers.MaxUint256);
    await usdc.connect(client).approve(await escrow.getAddress(), ethers.MaxUint256);
  });

  async function registerAgent(signer, bond = DLGR(5000)) {
    await registry.connect(signer).register(bond, "ipfs://agent-profile");
  }

  async function postTask({ payment = USDC(100), bond = DLGR(2000), hours = 24, assigned = ethers.ZeroAddress } = {}) {
    const deadline = (await time.latest()) + hours * 3600;
    const tx = await escrow.connect(client).createTask(await usdc.getAddress(), payment, bond, deadline, "ipfs://spec", assigned);
    await tx.wait();
    return await escrow.taskCount();
  }

  describe("token", () => {
    it("has a fixed 1B supply, no mint, and is burnable", async () => {
      expect(await dlgr.totalSupply()).to.equal(DLGR(1_000_000_000));
      expect(dlgr.interface.getFunction("mint")).to.equal(null);
      await dlgr.burn(DLGR(1));
      expect(await dlgr.totalSupply()).to.equal(DLGR(999_999_999));
    });
  });

  describe("registry", () => {
    it("registers an agent with a bond at or above the minimum", async () => {
      await expect(registry.connect(agent).register(DLGR(999), "x")).to.be.revertedWithCustomError(registry, "BondTooLow");
      await registerAgent(agent);
      const a = await registry.getAgent(agent.address);
      expect(a.active).to.equal(true);
      expect(a.freeBond).to.equal(DLGR(5000));
      expect(await dlgr.balanceOf(await registry.getAddress())).to.equal(DLGR(5000));
    });

    it("only the escrow can lock, release or slash", async () => {
      await registerAgent(agent);
      await expect(registry.connect(agent).lockBond(agent.address, 1n)).to.be.revertedWithCustomError(registry, "NotEscrow");
      await expect(registry.slash(agent.address, 1n, client.address)).to.be.revertedWithCustomError(registry, "NotEscrow");
    });

    it("enforces the unbond cooldown and blocks withdrawal with open jobs", async () => {
      await registerAgent(agent);
      const id = await postTask();
      await escrow.connect(agent).acceptTask(id);
      await registry.connect(agent).requestUnbond();
      expect(await registry.isActive(agent.address)).to.equal(false);
      await expect(registry.connect(agent).withdrawBond()).to.be.revertedWithCustomError(registry, "CooldownNotOver");
      await time.increase(7 * 24 * 3600 + 1);
      await expect(registry.connect(agent).withdrawBond()).to.be.revertedWithCustomError(registry, "OpenJobs");
      await escrow.connect(agent).submitResult(id, "ipfs://result");
      await escrow.connect(client).approve(id);
      const before = await dlgr.balanceOf(agent.address);
      await registry.connect(agent).withdrawBond();
      expect(await dlgr.balanceOf(agent.address)).to.equal(before + DLGR(5000));
    });
  });

  describe("escrow happy path", () => {
    it("pays the agent minus a 1% fee on approval and releases the bond", async () => {
      await registerAgent(agent);
      const id = await postTask({ payment: USDC(100), bond: DLGR(2000) });
      expect(await usdc.balanceOf(await escrow.getAddress())).to.equal(USDC(100));

      await escrow.connect(agent).acceptTask(id);
      let a = await registry.getAgent(agent.address);
      expect(a.lockedBond).to.equal(DLGR(2000));
      expect(a.freeBond).to.equal(DLGR(3000));

      await escrow.connect(agent).submitResult(id, "ipfs://result");
      await expect(escrow.connect(client).approve(id)).to.emit(escrow, "TaskCompleted").withArgs(id, USDC(99), USDC(1));

      expect(await usdc.balanceOf(agent.address)).to.equal(USDC(99));
      expect(await usdc.balanceOf(treasury.address)).to.equal(USDC(1));
      a = await registry.getAgent(agent.address);
      expect(a.lockedBond).to.equal(0n);
      expect(a.freeBond).to.equal(DLGR(5000));
      expect(a.jobsCompleted).to.equal(1n);
      expect((await escrow.getTask(id)).status).to.equal(Status.Completed);
    });

    it("auto-finalizes in the agent's favour if the client goes silent", async () => {
      await registerAgent(agent);
      const id = await postTask();
      await escrow.connect(agent).acceptTask(id);
      await escrow.connect(agent).submitResult(id, "ipfs://result");
      await expect(escrow.finalize(id)).to.be.revertedWithCustomError(escrow, "ReviewWindowOpen");
      await time.increase(3 * 24 * 3600 + 1);
      await escrow.connect(agent2).finalize(id);
      expect(await usdc.balanceOf(agent.address)).to.equal(USDC(99));
    });

    it("lets the client cancel an open task for a full refund", async () => {
      const id = await postTask();
      await escrow.connect(client).cancel(id);
      expect(await usdc.balanceOf(client.address)).to.equal(USDC(1_000));
      await expect(escrow.connect(client).cancel(id)).to.be.revertedWithCustomError(escrow, "WrongStatus");
    });

    it("honours task assignment to a specific agent", async () => {
      await registerAgent(agent);
      await registerAgent(agent2);
      const id = await postTask({ assigned: agent.address });
      await expect(escrow.connect(agent2).acceptTask(id)).to.be.revertedWithCustomError(escrow, "NotAssignedAgent");
      await escrow.connect(agent).acceptTask(id);
    });
  });

  describe("escrow failure paths", () => {
    it("refunds the client and slashes the bond on timeout", async () => {
      await registerAgent(agent);
      const id = await postTask({ bond: DLGR(2000), hours: 1 });
      await escrow.connect(agent).acceptTask(id);
      await expect(escrow.connect(client).claimTimeout(id)).to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
      await time.increase(3601);

      const supplyBefore = await dlgr.totalSupply();
      await expect(escrow.connect(client).claimTimeout(id)).to.emit(registry, "BondSlashed").withArgs(agent.address, DLGR(1000), DLGR(1000), client.address);

      expect(await usdc.balanceOf(client.address)).to.equal(USDC(1_000));        // refunded
      expect(await dlgr.balanceOf(client.address)).to.equal(DLGR(1000));         // compensation
      expect(await dlgr.totalSupply()).to.equal(supplyBefore - DLGR(1000));      // burned
      const a = await registry.getAgent(agent.address);
      expect(a.lockedBond).to.equal(0n);
      expect(a.freeBond).to.equal(DLGR(3000));
      expect(a.jobsFailed).to.equal(1n);
      expect(await registry.totalBurned()).to.equal(DLGR(1000));
    });

    it("deactivates an agent whose bond falls below the minimum after slashing", async () => {
      await registerAgent(agent, DLGR(1000));
      const id = await postTask({ bond: DLGR(1000), hours: 1 });
      await escrow.connect(agent).acceptTask(id);
      await time.increase(3601);
      await escrow.connect(client).claimTimeout(id);
      expect(await registry.isActive(agent.address)).to.equal(false);
      await registry.connect(agent).addBond(DLGR(1000));
      expect(await registry.isActive(agent.address)).to.equal(true);
    });

    it("routes rejections to the arbiter, who can side with either party", async () => {
      await registerAgent(agent);
      const id = await postTask();
      await escrow.connect(agent).acceptTask(id);
      await escrow.connect(agent).submitResult(id, "ipfs://bad-result");
      await escrow.connect(client).reject(id, "did not follow the spec");
      expect((await escrow.getTask(id)).status).to.equal(Status.Disputed);

      await expect(escrow.connect(client).resolve(id, false)).to.be.revertedWithCustomError(escrow, "NotArbiter");
      await escrow.resolve(id, false); // deployer is the arbiter
      expect((await escrow.getTask(id)).status).to.equal(Status.Failed);
      expect(await usdc.balanceOf(client.address)).to.equal(USDC(1_000));
    });

    it("agent wins a dispute and gets paid", async () => {
      await registerAgent(agent);
      const id = await postTask();
      await escrow.connect(agent).acceptTask(id);
      await escrow.connect(agent).submitResult(id, "ipfs://good-result");
      await escrow.connect(client).reject(id, "nah");
      await escrow.resolve(id, true);
      expect(await usdc.balanceOf(agent.address)).to.equal(USDC(99));
    });

    it("rejects unregistered agents, disallowed tokens and past deadlines", async () => {
      const id = await postTask();
      await expect(escrow.connect(agent).acceptTask(id)).to.be.revertedWithCustomError(escrow, "AgentNotActive");
      await expect(escrow.connect(client).createTask(await dlgr.getAddress(), 1n, 0n, (await time.latest()) + 100, "x", ethers.ZeroAddress))
        .to.be.revertedWithCustomError(escrow, "TokenNotAllowed");
      await expect(escrow.connect(client).createTask(await usdc.getAddress(), 1n, 0n, (await time.latest()) - 1, "x", ethers.ZeroAddress))
        .to.be.revertedWithCustomError(escrow, "BadDeadline");
    });

    it("caps the protocol fee at 5%", async () => {
      await expect(escrow.setFeeBps(501)).to.be.revertedWithCustomError(escrow, "FeeTooHigh");
      await escrow.setFeeBps(500);
      expect(await escrow.feeBps()).to.equal(500n);
    });
  });
});
