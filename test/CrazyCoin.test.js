const { expect } = require("chai");
const { ethers } = require("hardhat");

const E18 = 10n ** 18n;
const crzy = (n) => BigInt(n) * E18;

describe("CrazyCoin", function () {
  let coin, owner, alice, bob, carol;
  let SUPPLY;

  beforeEach(async () => {
    [owner, alice, bob, carol] = await ethers.getSigners();
    coin = await ethers.deployContract("CrazyCoin", [owner.address]);
    SUPPLY = await coin.TOTAL_SUPPLY();
  });

  // Owner is exempt, so seeding wallets is tax-free and allowed before trading opens.
  async function seed(who, amount) {
    await coin.transfer(who.address, amount);
  }

  describe("basics", () => {
    it("mints the full fixed supply to the owner", async () => {
      expect(await coin.name()).to.equal("CrazyCoin");
      expect(await coin.symbol()).to.equal("CRZY");
      expect(await coin.totalSupply()).to.equal(SUPPLY);
      expect(await coin.balanceOf(owner.address)).to.equal(SUPPLY);
      expect(SUPPLY).to.equal(crzy("1000000000000"));
    });

    it("has no mint function", async () => {
      expect(coin.interface.getFunction("mint")).to.equal(null);
    });
  });

  describe("trading gate", () => {
    it("blocks non-exempt transfers until trading is enabled", async () => {
      await seed(alice, crzy(1000));
      await expect(coin.connect(alice).transfer(bob.address, crzy(10)))
        .to.be.revertedWithCustomError(coin, "TradingNotOpen");
      await coin.enableTrading();
      await coin.connect(alice).transfer(bob.address, crzy(10));
      expect(await coin.balanceOf(bob.address)).to.be.gt(0);
    });

    it("only the owner can open trading", async () => {
      await expect(coin.connect(alice).enableTrading())
        .to.be.revertedWithCustomError(coin, "OwnableUnauthorizedAccount");
    });
  });

  describe("taxes", () => {
    beforeEach(async () => {
      await coin.enableTrading();
      await seed(alice, crzy(100_000));
    });

    it("burns 1% and sends 2% to the jackpot pot on a normal transfer", async () => {
      const amount = crzy(10_000);
      await coin.connect(alice).transfer(bob.address, amount);
      expect(await coin.balanceOf(bob.address)).to.equal(crzy(9_700));
      expect(await coin.jackpotPot()).to.equal(crzy(200));
      expect(await coin.totalBurned()).to.equal(crzy(100));
      expect(await coin.totalSupply()).to.equal(SUPPLY - crzy(100));
      expect(await coin.taxedTransferCount()).to.equal(1n);
    });

    it("waives the tax for Lucky 7 amounts ending in 777", async () => {
      await expect(coin.connect(alice).transfer(bob.address, crzy(1_777)))
        .to.emit(coin, "LuckySeven").withArgs(alice.address, crzy(1_777));
      expect(await coin.balanceOf(bob.address)).to.equal(crzy(1_777));
      expect(await coin.jackpotPot()).to.equal(0n);
    });

    it("does not treat fractional 777 amounts as lucky", async () => {
      await coin.connect(alice).transfer(bob.address, crzy(777) + 1n);
      expect(await coin.jackpotPot()).to.be.gt(0n);
    });

    it("lets the owner retune taxes within the 5% cap", async () => {
      await coin.setTaxes(300, 200);
      expect(await coin.totalTaxBps()).to.equal(500n);
      await expect(coin.setTaxes(300, 201)).to.be.revertedWithCustomError(coin, "TaxTooHigh");
    });

    it("exempt addresses pay no tax", async () => {
      await coin.setExempt(alice.address, true);
      await coin.connect(alice).transfer(bob.address, crzy(1000));
      expect(await coin.balanceOf(bob.address)).to.equal(crzy(1000));
    });
  });

  describe("anti-whale limits", () => {
    beforeEach(async () => {
      await coin.enableTrading();
    });

    it("rejects transfers above 1% of supply", async () => {
      const maxTx = await coin.maxTxAmount();
      await seed(alice, maxTx * 2n);
      await expect(coin.connect(alice).transfer(bob.address, maxTx + 1n))
        .to.be.revertedWithCustomError(coin, "ExceedsMaxTx");
      await coin.connect(alice).transfer(bob.address, maxTx);
    });

    it("rejects transfers that push a wallet above 2% of supply", async () => {
      const maxTx = await coin.maxTxAmount();
      const maxWallet = await coin.maxWalletAmount();
      await seed(alice, maxTx * 4n);
      await seed(bob, maxWallet - crzy(1)); // seeding by owner bypasses limits
      await expect(coin.connect(alice).transfer(bob.address, crzy(100)))
        .to.be.revertedWithCustomError(coin, "ExceedsMaxWallet");
    });

    it("owner can switch limits off", async () => {
      const maxTx = await coin.maxTxAmount();
      await seed(alice, maxTx * 4n);
      await coin.setLimitsEnabled(false);
      await coin.connect(alice).transfer(bob.address, maxTx * 3n);
      expect(await coin.balanceOf(bob.address)).to.be.gt(maxTx);
    });
  });

  describe("jackpot", () => {
    beforeEach(async () => {
      await coin.enableTrading();
      await coin.setDrawInterval(10);
      await seed(alice, crzy(1_000_000));
      await seed(bob, crzy(1_000_000));
    });

    it("rejects a draw interval below the minimum", async () => {
      await expect(coin.setDrawInterval(9)).to.be.revertedWithCustomError(coin, "IntervalTooShort");
    });

    it("pays the whole pot to a recent sender on the Nth taxed transfer", async () => {
      const players = [alice, bob];
      for (let i = 0; i < 9; i++) {
        await coin.connect(players[i % 2]).transfer(carol.address, crzy(1000));
      }
      expect(await coin.transfersUntilDraw()).to.equal(1n);
      const potBefore = await coin.jackpotPot();
      expect(potBefore).to.equal(crzy(20 * 9));

      const balsBefore = { [alice.address]: await coin.balanceOf(alice.address), [bob.address]: await coin.balanceOf(bob.address) };
      const tx = await coin.connect(alice).transfer(carol.address, crzy(1000));
      const receipt = await tx.wait();

      const won = receipt.logs.map((l) => { try { return coin.interface.parseLog(l); } catch { return null; } })
        .find((e) => e && e.name === "JackpotWon");
      expect(won, "JackpotWon emitted").to.not.equal(undefined);
      const [winner, amount, drawNumber] = won.args;
      expect(amount).to.equal(crzy(200)); // 9 previous + this one, 20 CRZY each
      expect(drawNumber).to.equal(1n);
      expect([alice.address, bob.address]).to.include(winner);

      expect(await coin.jackpotPot()).to.equal(0n);
      expect(await coin.totalJackpotsPaid()).to.equal(crzy(200));
      // Winner ended up with the pot on top of whatever the transfer did to them.
      const expectedWinner = winner === alice.address
        ? balsBefore[alice.address] - crzy(1000) + crzy(200)
        : balsBefore[bob.address] + crzy(200);
      expect(await coin.balanceOf(winner)).to.equal(expectedWinner);
      expect(await coin.transfersUntilDraw()).to.equal(10n);
    });

    it("keeps only the last 32 senders as tickets", async () => {
      const signers = await ethers.getSigners();
      await coin.setLimitsEnabled(false);
      await coin.setDrawInterval(1000);
      for (const s of signers.slice(1, 20)) await seed(s, crzy(10));
      for (const s of signers.slice(1, 20)) await coin.connect(s).transfer(carol.address, crzy(1));
      for (const s of signers.slice(1, 20)) await coin.connect(s).transfer(carol.address, crzy(1));
      expect((await coin.tickets()).length).to.equal(32);
    });
  });

  describe("permit", () => {
    it("supports EIP-2612 gasless approvals", async () => {
      const value = crzy(5);
      const deadline = ethers.MaxUint256;
      const nonce = await coin.nonces(alice.address);
      const domain = { name: "CrazyCoin", version: "1", chainId: (await ethers.provider.getNetwork()).chainId, verifyingContract: await coin.getAddress() };
      const types = { Permit: [
        { name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" } ] };
      const sig = ethers.Signature.from(await alice.signTypedData(domain, types, { owner: alice.address, spender: bob.address, value, nonce, deadline }));
      await coin.permit(alice.address, bob.address, value, deadline, sig.v, sig.r, sig.s);
      expect(await coin.allowance(alice.address, bob.address)).to.equal(value);
    });
  });
});
