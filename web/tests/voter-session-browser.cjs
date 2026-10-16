const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";

(async () => {
  const browser = await chromium.launch({ ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    let activeSession = null, serial = 0, failLogout = false;
    const errors = [];
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    for (const context of contexts) {
      // Intercept every API request: this check cannot log in or vote on a real election.
      await context.route("**/api/**", async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        const authorized = activeSession && route.request().headers().authorization === `Bearer ${activeSession}`;
        let status = 200, body;
        if (pathname === "/api/vote/login") {
          if (activeSession) {
            status = 409; body = { error: "This token is already in use on another device or browser.", code: "TOKEN_IN_USE" };
          } else { activeSession = `fixture-session-${++serial}`; body = { token: activeSession }; }
        } else if (!authorized) { status = 401; body = { error: "Your session has expired." }; }
        else if (pathname === "/api/vote/logout") {
          if (failLogout) { status = 503; body = { error: "Temporarily unavailable." }; }
          else { activeSession = null; body = { ok: true }; }
        } else if (pathname === "/api/vote/me") {
          body = { title: "Test Election", student: { fullName: "Test Student", grade: "Grade 7", section: "A" } };
        } else if (pathname === "/api/vote/ballot") {
          body = { title: "Test Election", positions: [{ id: 1, name: "President", candidates: [] }] };
        } else { status = 404; body = { error: "Unexpected fixture endpoint." }; }
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      });
    }
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of pages) page.on("pageerror", (error) => errors.push(error.message));
    const [first, second] = pages;
    const login = async (page) => {
      await page.getByLabel("Enter your token", { exact: true }).fill("ABCDEF01");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    };
    const welcome = (page) => page.getByRole("heading", { name: "Welcome, Test Student" });
    await Promise.all(pages.map((page) => page.goto(`${origin}/vote`)));
    await login(first); await welcome(first).waitFor();
    const firstSession = activeSession;
    await login(second);
    await second.getByRole("alert").filter({ hasText: "already in use on another device" }).waitFor();
    assert.equal(await second.evaluate(() => sessionStorage.getItem("voterToken")), null);
    await first.reload(); await welcome(first).waitFor();
    assert.equal(activeSession, firstSession);

    failLogout = true;
    await first.getByRole("button", { name: "Log out", exact: true }).click();
    await first.getByRole("alert").filter({ hasText: "Unable to log out" }).waitFor();
    await welcome(first).waitFor();
    assert.equal(await first.evaluate(() => sessionStorage.getItem("voterToken")), firstSession);
    failLogout = false;
    await first.getByRole("button", { name: "Log out", exact: true }).click();
    await first.getByLabel("Enter your token", { exact: true }).waitFor();
    assert.equal(activeSession, null);
    assert.equal(await first.evaluate(() => sessionStorage.getItem("voterToken")), null);

    await login(second); await welcome(second).waitFor();
    await second.getByRole("button", { name: "Start voting", exact: true }).click();
    await second.getByRole("button", { name: "Cancel", exact: true }).click();
    await second.getByLabel("Enter your token", { exact: true }).waitFor();
    assert.equal(activeSession, null);
    await login(first); await welcome(first).waitFor();
    assert.deepEqual(errors, []);
    console.log("PASS Second-browser rejection, first-session reload, logout retry and cancel release");
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
