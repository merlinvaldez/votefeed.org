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
    refreshed = page.waitForResponse(response => response.url().includes("/comments/bills/") && response.ok());
    await page.getByRole("button", { name: "Make public to other VoteFeed users", exact: true }).click();
    await refreshed;
    await page.getByRole("button", { name: "Show comment actions", exact: true }).click();
    await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
    await page.getByRole("textbox", { name: "Comment draft", exact: true }).fill("An updated comment for this district.");
    refreshed = page.waitForResponse(response => response.url().includes("/comments/bills/") && response.ok());
    await page.getByRole("button", { name: "Submit comment", exact: true }).click();
    await refreshed;
    if (requests.length < 7) throw new Error("Expected discussion requests after folder changes and comment actions");
    if (requests.some(url => url.searchParams.get("state") !== "Alaska" || url.searchParams.get("district") !== "0")) {
      throw new Error("Discussion lost district scope");
    }
    return { scopedRequests: requests.length, guestNavigation: "passed", zeroButtonHidden: "passed", submitPublishEdit: "passed" };
  } finally { page.off("request", record); }
}
