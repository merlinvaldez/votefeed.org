# Elections position semantic review

## Run details

- Reviewed: 2026-10-28 17:23 UTC
- Candidate: Yvette Clarke, NY-9 House, 2026 general
- Campaign pages saved by the gated acceptance run: [LGBTQ+ Issues](https://voteyvette.com/lgbtq-issues/) and [About Yvette](https://voteyvette.com/about-yvette/)
- Extractor prompt version: `campaign-position-prompt-1.3`
- Result: 19 positions published to the isolated feed; all 19 excerpts were exact substrings of the two saved pages. The temporary PostgreSQL database was dropped after the run; no production database was used.

I compared each claim and summary with the full saved page text. All 19 claims are supported in their page context; I found no contradictory policy details. The [JSON capture](elections-position-semantic-review.json) preserves the complete source text, claim text, summary, and exact excerpt for every position.

Three excerpts are too narrow to show the relevant support or legislative action on their own. Two are on the LGBTQ+ Issues page and omit the preceding clause “she has supported legislation”; one is on About Yvette and names the Protect Our Sanctuary Cities Act without the preceding words “I took action by introducing ... along with.” Those claims are supported by the surrounding page text, but their excerpts should include that context before use as standalone evidence.

The prompt now tells extraction to preserve past versus current timing and include support/action context in excerpts. This run correctly framed prior bills and votes as past actions, but still produced the three narrow excerpts noted above. The two broad statements about healthcare as a right and immigrant communities sharing in the American dream are explicit and accurately summarized, though they name no particular policy mechanism.

## Reviewed positions

The verdicts below refer to the complete saved page text. “Context needed” means the claim is supported by the page, but the stored excerpt alone omits the relevant relation or action. The JSON capture contains each verbatim excerpt.

1. **Civil rights —** Supports equal fairness and justice across protected identities. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
2. **Civil rights —** Supported the EMPOWER Act addressing workplace harassment and assault. **Context needed.** ([LGBTQ+ Issues](https://voteyvette.com/lgbtq-issues/))
3. **Civil rights —** Supported the Equality Act barring discrimination based on sex, sexual orientation, and gender identity. **Context needed.** ([LGBTQ+ Issues](https://voteyvette.com/lgbtq-issues/))
4. **Civil rights —** Supported legislation recognizing June as LGBTQ Pride Month. **Supported.** ([LGBTQ+ Issues](https://voteyvette.com/lgbtq-issues/))
5. **Economy —** Plans to support small-business and corporate-accountability legislation. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
6. **Education —** Helped pass grants for education and job training in prisons. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
7. **Education —** Previously passed legislation to increase STEM funding. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
8. **Education —** Supports tuition-free college for everyone. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
9. **Education —** Supports student loan relief. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
10. **Healthcare —** Says healthcare is a right, not a privilege. **Supported; broad principle.** ([About Yvette](https://voteyvette.com/about-yvette/))
11. **Healthcare —** Supports Medicare for All to achieve universal coverage. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
12. **Healthcare —** Passed legislation requiring a CMS opioid response plan. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
13. **Healthcare —** Opposes defunding Planned Parenthood. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
14. **Healthcare —** Opposed ACA repeal and helped pass the law. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
15. **Housing —** Introduced a bill to lower subsidized rents and change HUD income calculations. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
16. **Housing —** Introduced a bill to block facial recognition in federally assisted housing. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
17. **Immigration —** Introduced TPS relief legislation. **Supported.** ([About Yvette](https://voteyvette.com/about-yvette/))
18. **Immigration —** Introduced legislation opposing restrictions on sanctuary cities. **Context needed.** ([About Yvette](https://voteyvette.com/about-yvette/))
19. **Immigration —** Says immigrant and undocumented communities should have access to the American dream. **Supported; broad principle.** ([About Yvette](https://voteyvette.com/about-yvette/))
