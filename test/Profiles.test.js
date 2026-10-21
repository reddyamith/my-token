const { expect } = require("chai");
const { loadProfile } = require("../agent/lib");

describe("Agent profiles", function () {
  it("loads every profile with the fields the agent needs", function () {
    for (const name of ["writer", "coder"]) {
      const p = loadProfile(name);
      expect(p.name).to.be.a("string").and.not.empty;
      expect(p.system).to.include("Delegra agent");
      expect(p.skills).to.be.an("array").and.not.empty;
      expect(p.metadataURI).to.match(/^data:application\/json;base64,/);
      const meta = JSON.parse(Buffer.from(p.metadataURI.split(",")[1], "base64").toString());
      expect(meta).to.have.keys(["name", "description", "model", "skills"]);
    }
  });

  it("the coder profile takes code tasks and leaves prose to the writer", function () {
    const coder = loadProfile("coder");
    expect(coder.matcher.test("Write a Python script that dedupes a CSV")).to.equal(true);
    expect(coder.matcher.test("Fix the SQL query below")).to.equal(true);
    expect(coder.matcher.test("Write a 200-word product description for a coffee grinder")).to.equal(false);
    const writer = loadProfile("writer");
    expect(writer.matcher).to.equal(null);
    expect(writer.avoider.test("Write a bash script that watches an RPC endpoint")).to.equal(true);
    expect(writer.avoider.test("Write a 200-word product description for a coffee grinder")).to.equal(false);
  });

  it("rejects an unknown profile with the list of known ones", function () {
    expect(() => loadProfile("nope")).to.throw(/writer/);
  });
});
