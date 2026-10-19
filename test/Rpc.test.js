const { expect } = require("chai");
const { ethers } = require("ethers");
const { makeProvider, rpcUrls } = require("../agent/lib");

describe("RPC fallbacks", function () {
  afterEach(() => { delete process.env.SEPOLIA_RPC_URLS; delete process.env.SEPOLIA_RPC_URL; });

  it("puts the user's endpoints first and appends the public ones, without duplicates", function () {
    process.env.SEPOLIA_RPC_URLS = "https://my.node/x, https://ethereum-sepolia-rpc.publicnode.com";
    const urls = rpcUrls("sepolia");
    expect(urls[0]).to.equal("https://my.node/x");
    expect(urls.filter((u) => u.includes("publicnode")).length).to.equal(1);
    expect(urls.length).to.be.greaterThan(3);
  });

  it("builds a FallbackProvider for sepolia and a plain provider for localhost", function () {
    // No network calls here: the container running the tests may be offline.
    const sep = makeProvider("sepolia");
    expect(sep).to.be.instanceOf(ethers.FallbackProvider);
    expect(sep.providerConfigs.length).to.equal(rpcUrls("sepolia").length);
    expect(sep.quorum).to.equal(1);
    const loc = makeProvider("localhost");
    expect(loc).to.be.instanceOf(ethers.JsonRpcProvider);
    expect(loc).to.not.be.instanceOf(ethers.FallbackProvider);
    sep.destroy(); loc.destroy();
  });
});
