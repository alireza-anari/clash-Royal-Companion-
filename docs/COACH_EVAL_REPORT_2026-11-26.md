# Coach evaluation report — 2026-11-26

## Scope and method

- Dataset: 60 synthetic Persian scenarios, run once against each model (120 successful inference calls): 20 deck/cards, 10 battle analysis, 10 single-card swaps, 10 Evolution/Hero, and 10 meta/events.
- Models: @cf/google/gemma-4-26b-a4b-it and @cf/zai-org/glm-4.7-flash.
- Prompts use the candidate coach identity, retrieved official knowledge, synthetic evidence marked client_submitted_unverified, and the same deterministic response-quality gate used by the Worker.
- Output mode: JSON object; 384-token completion cap; temperature 0.1; seed 20261126; sequential API execution with four concurrent workers per batch.
- Scoring is a deterministic compliance/evidence rubric (schema, fact keys, safe swap, citations, required/forbidden content, abstention and language). It is not a semantic LLM judge or a substitute for human game-expert review.
- No real player tags, account records, secrets, or production API data were used.

## Final results after personal-stat guard

| Scenario group | Cases | Gemma mean / pass rate | GLM mean / pass rate |
|---|---:|---:|---:|
| Deck and cards | 20 | 89.0 / 80% | 91.2 / 75% |
| Battle evidence | 10 | 90.0 / 90% | 20.0 / 20% |
| Single-card swaps | 10 | 100.0 / 100% | 87.4 / 70% |
| Evolution and Hero | 10 | 98.0 / 90% | 100.0 / 100% |
| Meta and events | 10 | 99.5 / 90% | 98.5 / 90% |
| **Overall** | **60** | **94.3 / 88.3%** | **81.4 / 71.7%** |

## Latency, usage and token-price equivalent

| Metric | Gemma 4 26B | GLM 4.7 Flash |
|---|---:|---:|
| Mean latency | 6.25 s | 6.95 s |
| Input tokens | 107,465 | 121,402 |
| Output tokens | 11,593 | 7,704 |
| Measured Neurons | 1,293.12 | 948.14 |
| Token-price equivalent | $0.014225 | $0.010367 |

Combined usage for the 120-call final run: **2,241.26 Neurons** and about **$0.024592 token-price equivalent**. Cloudflare bills Workers AI by Neurons; the token-price equivalent is not an invoice. Cloudflare's published pricing page states a 10,000-Neuron daily free allocation and $0.011 per 1,000 Neurons above that allocation on Workers Paid. Total account usage from other workloads is not included here.

## What the results mean

1. **Keep Gemma as the substantive coaching default.** It scored 94.3 overall and passed 88.3% of the scenarios. It was materially stronger in battle analysis and safe single-card swaps.
2. **Do not enable GLM as a general coaching fallback yet.** It used fewer Neurons and did well on Evolution/Hero and meta/events, but its battle score was only 20/100 with a 20% pass rate. It often inserted personal counts or win-rate calculations into prose even when asked to leave those to the server.
3. **Keep the fast route disabled by default.** The router still requires an explicit allowlisted COACH_FAST_MODEL setting and only permits trivial greetings/thanks. No such binding was enabled by this work.
4. **Retain the server-side personal-stat guard.** It blocks model-authored battle counts, wins/losses and numeric averages; server-computed facts remain the only source for displayed personal statistics.
5. **Treat swap routing conservatively.** Gemma selected only valid candidates in this run. GLM selected incorrect indices in two cases and attempted a protected/invalid swap in one case; the quality gate rejected the invalid selection.

## Remaining failures to review

- Gemma: D03/D14 personal-stat prose blocked; D15 source attribution; D17 unsupported upgrade priority; B07 personal-stat prose blocked; E09 account-ownership abstention; M08 current-event abstention.
- GLM: D03/D13/D14 personal-stat prose blocked; D07/D11 incomplete mechanical explanation; D17 weak abstention; B01–B07 and B09 personal-stat prose blocked; S02/S04 wrong swap index; S09 invalid swap; M08 missing source attribution.
- Some failures are phrasing/rubric-sensitive. Review the raw response and rubric before changing the gate; do not weaken safety checks merely to increase the pass rate.

## CI and rollout

- CI validation, evaluation dataset checks, Coach unit tests, generated Worker bundle consistency, and browser smoke all passed on the development branch.
- The live evaluation itself was run directly against Workers AI with synthetic prompts. No production Worker deployment, account setting, routing binding, quota, or secret was changed.
- A final read-only fetch of the deployed Worker script could not be completed because the Cloudflare connector returned an authentication error. The production script was not modified.
- The PR remains open and in draft; merge/deploy is intentionally not part of this evaluation stage.
