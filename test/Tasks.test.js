const { expect } = require("chai");
const { TIERS, PROMPTS } = require("../agent/tasks");
const { loadProfile } = require("../agent/lib");

describe("Team task mix", function () {
  it("every prompt has a known tier and a real spec", function () {
    for (const p of PROMPTS) {
      expect(TIERS[p.tier], p.spec).to.be.a("bigint");
      expect(p.spec.length).to.be.greaterThan(40);
    }
    const counts = Object.fromEntries(Object.keys(TIERS).map((t) => [t, PROMPTS.filter((p) => p.tier === t).length]));
    for (const t of Object.keys(TIERS)) expect(counts[t], t).to.be.greaterThan(2);
  });

  it("never posts the same tier more than twice in a row", function () {
    let run = 1;
    for (let i = 1; i < PROMPTS.length; i++) {
      run = PROMPTS[i].tier === PROMPTS[i - 1].tier ? run + 1 : 1;
      expect(run, `position ${i}`).to.be.lessThan(3);
    }
  });

  it("every prompt is claimable by exactly one running profile", function () {
    const writer = loadProfile("writer"), coder = loadProfile("coder");
    for (const p of PROMPTS) {
      const forCoder = coder.matcher.test(p.spec);
      const forWriter = !writer.avoider.test(p.spec);
      expect(forCoder !== forWriter, `"${p.spec.slice(0, 50)}" coder=${forCoder} writer=${forWriter}`).to.equal(true);
    }
    expect(PROMPTS.filter((p) => coder.matcher.test(p.spec)).length).to.be.greaterThan(2);
  });
});
