import assert from "node:assert/strict";
import test from "node:test";
import {
  isElectionFixturePreviewLocation,
  parseElectionFixturePreviewLocation,
} from "./electionFixturePreview.js";

test("fixture preview only opts in on the explicit Elections feed route", () => {
  assert.equal(parseElectionFixturePreviewLocation("/profile", "?electionsFixture=normal", { enabled: true }), null);
  assert.equal(parseElectionFixturePreviewLocation("/feed", "", { enabled: true }), null);
  assert.equal(parseElectionFixturePreviewLocation("/feed", "?electionsCoverage=unknownish", { enabled: true }), null);
  assert.equal(parseElectionFixturePreviewLocation("/feed", "?electionsVisual=0", { enabled: true }).visualCandidateCount, 0);
  assert.equal(parseElectionFixturePreviewLocation("/feed", "?electionsVisual=4", { enabled: true }), null);
  assert.equal(parseElectionFixturePreviewLocation("/feed", "?electionsVisual=5", { enabled: false }), null);
  assert.equal(isElectionFixturePreviewLocation("/feed", "?electionsVisual=5"), false);
});

test("fixture preview parses bounded visual, viewer, latency, response, and status scenarios", () => {
  const options = parseElectionFixturePreviewLocation("/feed",
    "?electionsVisual=5&electionsViewer=simulated&electionsDelay=250&electionsPageSize=3" +
    "&electionsCursor=invalidated&electionsSource=unavailable" +
    "&electionsResponseState=seventy-five&electionsGeography=state-only" +
    "&electionsCoverage=unknown&electionsBuild=refresh-failure" +
    "&electionsFailAt=save-response%3A1&electionsFailAt=positions%3Anext-page%3A2",
    { enabled: true });

  assert.equal(options.visualCandidateCount, 5);
  assert.equal(options.simulatedViewer, true);
  assert.equal(options.latencyMs, 250);
  assert.equal(options.pageSize, 3);
  assert.equal(options.invalidateCursorOnce, true);
  assert.equal(options.sourceUnavailable, true);
  assert.equal(options.responseState, "seventy-five");
  assert.equal(options.geographyStatus, "state-only");
  assert.equal(options.coverageStatus, "unknown");
  assert.equal(options.buildScenario, "refresh-failure");
  assert.deepEqual(options.failAt, { "save-response": 1, "positions:next-page": 2 });
  assert.equal(options.showCoverageNotice, true);
});

test("fixture preview permits only explicit no-race and candidate availability states", () => {
  const options = parseElectionFixturePreviewLocation("/feed",
    "?electionsRaceStatus=confirmed-none",
    { enabled: true });
  assert.equal(options.raceStatus, "confirmed-none");

  const candidateOptions = parseElectionFixturePreviewLocation("/feed",
    "?electionsCandidateAvailability=crawl-failed",
    { enabled: true });
  assert.equal(candidateOptions.candidateAvailabilityScenario, "crawl-failed");

  const coverageOptions = parseElectionFixturePreviewLocation("/feed", "?electionsCoverage=unknown", { enabled: true });
  assert.equal(coverageOptions.coverageStatus, "unknown");
  assert.equal(coverageOptions.showCoverageNotice, true);

  const invalid = parseElectionFixturePreviewLocation("/feed",
    "?electionsVisual=5&electionsRaceStatus=maybe&electionsCandidateAvailability=ballot-confirmed",
    { enabled: true });
  assert.equal(invalid.raceStatus, null);
  assert.equal(invalid.candidateAvailabilityScenario, null);
});

test("malformed optional scenario parameters fall back to safe defaults", () => {
  const options = parseElectionFixturePreviewLocation("/feed", "?electionsFixture=normal&electionsDelay=30000&electionsPageSize=0&electionsFail=unknown&electionsFailAt=alignment%3A0&electionsResponseState=made-up", { enabled: true });
  assert.equal(options.latencyMs, 0);
  assert.equal(options.pageSize, undefined);
  assert.equal(options.invalidateCursorOnce, false);
  assert.equal(options.sourceUnavailable, false);
  assert.deepEqual(options.failures, []);
  assert.deepEqual(options.failAt, {});
  assert.equal(options.responseState, null);
  assert.equal(options.raceStatus, null);
  assert.equal(options.candidateAvailabilityScenario, null);
  assert.equal(options.showCoverageNotice, false);
});
