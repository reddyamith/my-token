// A mix of easy, medium and hard tasks, interleaved so the site shows range. Payment scales
// with difficulty (test USDC); PAYMENT env overrides the easy tier and the others scale from it.
const TIERS = { easy: 1n, medium: 3n, hard: 6n }; // multiples of PAYMENT
const PROMPTS = [
  { tier: "easy", spec: "Write a 3-sentence explanation of escrow for someone who has never used crypto." },
  { tier: "medium", spec: "Write a 400-word blog post titled 'Why AI agents need collateral', with an intro, three sections with headings, and a closing call to action. Plain, concrete language; no hype." },
  { tier: "hard", spec: "Write a Python script that reads a CSV of transactions (columns: date, address, amount_usdc, status), removes duplicate rows, flags addresses with more than 3 rejected tasks in any 7-day window, and prints a summary table. Include type hints, docstrings, and a usage example with sample data." },
  { tier: "easy", spec: "List 5 tasks a business could safely delegate to an AI agent today, one line each." },
  { tier: "medium", spec: "Compare escrow-based payment with invoice-then-pay for freelance work: a table with 6 criteria (speed, trust, dispute handling, fees, cross-border, automation), then a 120-word recommendation for a solo developer." },
  { tier: "hard", spec: "Design a dispute-resolution policy for an AI-agent marketplace: roles, evidence required, timelines, appeal path, and what happens to the agent's bond in each outcome. 600 to 800 words, structured with headings, written so a non-lawyer can follow it." },
  { tier: "easy", spec: "Draft a 60-word product update announcing that a service now accepts USDC payments." },
  { tier: "medium", spec: "Write a JavaScript function that validates an Ethereum address (checksum included, no libraries), with 8 unit tests in plain Node assert. Explain the checksum algorithm in 5 lines above the code." },
  { tier: "hard", spec: "Produce a go-to-market plan for a developer tool that lets AI agents get paid on-chain: target segments ranked, the first 90 days week by week, three channels with expected cost per signup, and the two metrics that decide whether to continue after 90 days. Under 900 words." },
  { tier: "easy", spec: "Explain in 100 words what a stablecoin is and why freelancers might prefer to be paid in one." },
  { tier: "medium", spec: "Write a SQL query (PostgreSQL) over tables tasks(id, client, agent, payment, status, created_at) and agents(address, bond, registered_at) that returns, per agent, completed task count, total earned, median payment and days since registration, sorted by total earned. Explain each clause briefly." },
  { tier: "hard", spec: "Review this Solidity pattern for an escrow release function and list every security issue with severity and a fix: function release(uint id) external { Task storage t = tasks[id]; require(msg.sender == t.client); token.transfer(t.agent, t.payment); t.status = Done; } Then rewrite it correctly with checks-effects-interactions, reentrancy protection and events." },
  { tier: "easy", spec: "Write a polite 3-sentence email declining a meeting and proposing an async update instead." },
  { tier: "medium", spec: "Write a 350-word onboarding guide for a first-time client of an AI agent marketplace: what to prepare, how to write a good task spec, how to review a delivery, when to reject. Use numbered steps." },
  { tier: "easy", spec: "Give 5 name ideas for a newsletter about AI agents, each with a one-line tagline." },
  { tier: "hard", spec: "Write a bash script that watches a JSON-RPC endpoint list, measures latency and block height for each every 30 seconds, marks an endpoint unhealthy if it lags the best height by more than 3 blocks or times out twice in a row, and writes the ranked healthy list to a file atomically. Include a shebang, set -euo pipefail, comments, and a short README section." },
  { tier: "easy", spec: "Turn this into a tweet under 240 characters: AI agents can now post a bond and get paid on-chain when the client approves." },
  { tier: "medium", spec: "Summarise the trade-offs of fixed-supply tokens versus inflationary tokens for a work marketplace in 300 words, ending with a one-paragraph position and the main risk of that position." },
];

module.exports = { TIERS, PROMPTS };
