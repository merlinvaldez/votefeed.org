// Start bill-page-preview.mjs, then run with playwright-cli run-code --filename this file.
async (page) => {
  const base = "http://127.0.0.1:4180";
  const requests = [];
  const record = request => {
    if (request.url().includes("/comments/bills/")) requests.push(new URL(request.url()));
  };
  page.on("request", record);
  try {
    await page.goto(`${base}/feed`);
    const localComments = page.getByRole("button", { name: "Open comments on H.R. 7 for Alice Smith and Robert Jones", exact: true });
    await localComments.waitFor();
    if (await page.getByRole("button", { name: "Open comments on H.R. 7 for House Member", exact: true }).count()) {
      throw new Error("Zero-count button is visible");
    }
    await localComments.click();
    await page.waitForURL(/#public-comments/);
    await page.getByText("Public comment from this district.", { exact: true }).waitFor();
    for (const folder of ["House", "Senate", "All Reps"]) {
      await page.getByRole("tab", { name: folder, exact: true }).click();
      await page.getByRole("region", { name: "Comments", exact: true }).waitFor();
    }
    await page.goto(`${base}/bill/hr/7?congress=119&chamber=Senate&state=Alaska&district=0&cardId=senate&testUser=1#public-comments`);
    await page.getByRole("button", { name: "Agree with Sens. Smith and Jones", exact: true }).click();
    await page.getByRole("button", { name: "Write comment", exact: true }).click();
    await page.getByRole("textbox", { name: "Comment draft", exact: true }).fill("Please support services for our district.");
    let refreshed = page.waitForResponse(response => response.url().includes("/comments/bills/") && response.ok());
    await page.getByRole("button", { name: "Submit comment", exact: true }).click();
    await refreshed;
    await page.getByText("Please support services for our district.", { exact: true }).waitFor();
    for (const [show, hide, panelId] of [
      ["Show call script", "Hide call script", "bill-call-script-panel"],
      ["Show message template", "Hide message template", "bill-message-template-panel"],
    ]) {
      await page.getByRole("button", { name: show, exact: true }).click();
      await page.locator(`#${panelId}`).waitFor();
      const activeButton = page.getByRole("button", { name: hide, exact: true });
      if (await activeButton.getAttribute("aria-pressed") !== "true" ||
          !(await activeButton.getAttribute("class")).split(" ").includes("active")) {
        throw new Error("Visible contact panel must have an active toggle");
      }
      await activeButton.click();
      await page.locator(`#${panelId}`).waitFor({ state: "hidden" });
      if (await page.getByRole("button", { name: show, exact: true }).getAttribute("aria-pressed") !== "false") {
        throw new Error("Hidden contact panel must have an inactive toggle");
      }
    }
    refreshed = page.waitForResponse(response => response.url().includes("/comments/bills/") && response.ok());
    await page.getByRole("button", { name: "Make public to other VoteFeed users", exact: true }).click();
    await refreshed;
    await page.getByRole("button", { name: "Show comment actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Comment draft", exact: true }).fill("An updated comment for this district.");
    refreshed = page.waitForResponse(response => response.url().includes("/comments/bills/") && response.ok());
    await page.getByRole("button", { name: "Submit comment", exact: true }).click();
    await refreshed;
    for (const folder of ["All Reps", "House", "Senate"]) {
      await page.getByRole("tab", { name: folder, exact: true }).click();
      await page.reload();
      await page.getByRole("button", { name: "Show comment actions", exact: true }).waitFor();
      if (await page.getByRole("region", { name: "Comments", exact: true }).count() !== 1) {
        throw new Error("Expected one unified comments section");
      }
      if (await page.getByText("An updated comment for this district.", { exact: true }).count() !== 1) {
        throw new Error("Owned public comment must render once after returning");
      }
      await page.getByText("Fixture Constituent to Sen. Smith", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Show comment actions", exact: true }).click();
      await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
      if (await page.getByRole("textbox", { name: "Comment draft", exact: true }).inputValue() !== "An updated comment for this district.") {
        throw new Error("Owned comment text was lost");
      }
    }
    await page.reload();
    await page.getByRole("button", { name: "Disagree with Sens. Smith and Jones", exact: true }).click();
    await page.getByRole("button", { name: "Public to other VoteFeed users", exact: true }).click();
    await page.getByRole("button", { name: "Make public to other VoteFeed users", exact: true }).waitFor();
    if (await page.getByRole("button", { name: "Disagree with Sens. Smith and Jones", exact: true }).getAttribute("aria-pressed") !== "true") {
      throw new Error("Comment update restored a stale stance");
    }
    const saved = await page.request.post(`${base}/test-api/interactions/addstance`, {
      data: { bill_id: 7, rep_bioguide_id: "H", member_vote_id: 1, stance: "approve" },
    });
    const house = await saved.json();
    await page.request.post(`${base}/test-api/interactions/${house.id}/comment/submit`, {
      data: { draft_text: "A second owned comment." },
    });
    await page.reload();
    await page.getByText("A second owned comment.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Edit comment", exact: true }).click();
    await page.getByRole("button", { name: "Cancel edit", exact: true }).click();
    await page.getByRole("button", { name: "Show comment actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Comment draft", exact: true }).fill("A revised second comment.");
    await page.getByRole("button", { name: "Submit comment", exact: true }).click();
    await page.getByText("A revised second comment.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Show comment actions", exact: true }).click();
    const deleted = page.waitForResponse(response => response.request().method() === "DELETE" && response.ok());
    await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
    await deleted;
    await page.getByText("A revised second comment.", { exact: true }).waitFor({ state: "hidden" });
    await page.getByText("An updated comment for this district.", { exact: true }).waitFor();
    if (await page.getByText("A revised second comment.", { exact: true }).count()) {
      throw new Error("Deleted comment remained visible");
    }
    if (requests.length < 7) throw new Error("Expected discussion requests after folder changes and comment actions");
    if (requests.some(url => url.searchParams.get("state") !== "Alaska" || url.searchParams.get("district") !== "0")) {
      throw new Error("Discussion lost district scope");
    }
    return { scopedRequests: requests.length, guestNavigation: "passed", zeroButtonHidden: "passed", submitPublishEdit: "passed" };
  } finally { page.off("request", record); }
}
