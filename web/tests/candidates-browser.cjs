const assert = require("node:assert/strict");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = process.env.BROWSER_BASE_URL || "http://127.0.0.1:5173";

(async () => {
  const browser = await chromium.launch({ ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    context.setDefaultTimeout(10000);
    const students = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, first_name: `Student${i + 7}`, last_name: "Example", grade: `Grade ${i + 7}`, section: "A" }));
    const positions = [
      { id: 1, name: "President", candidates: [] },
      ...students.map((student) => ({ id: student.id + 1, name: `${student.grade} Representative`, candidates: [] })),
    ];
    const submissions = [], errors = [];
    let rejectSave = false, failList = false;
    // Intercept every API request: this test cannot alter election or student data.
    await context.route("**/api/**", async (route) => {
      const req = route.request(), url = new URL(req.url());
      let status = 200, data;
      if (url.pathname === "/api/admin/me") data = { id: 1, email: "admin@school.test" };
      else if (url.pathname === "/api/admin/election") data = { published: false, positions };
      else if (url.pathname === "/api/admin/candidate-students") {
        const positionId = Number(url.searchParams.get("position_id"));
        const grade = positionId === 1 ? null : positionId + 5;
        if (failList) { status = 503; data = { error: "Unable to load eligible students." }; }
        else data = { requiredGrade: grade, students: students.filter((student) =>
          (!grade || student.grade === `Grade ${grade}`) && !submissions.some((entry) => Number(entry.student_id) === student.id)) };
      } else if (url.pathname === "/api/admin/candidates" && req.method() === "POST") {
        if (rejectSave) { status = 409; data = { error: "This student is already a candidate. A student can run for only one position." }; }
        else {
          const body = req.postDataJSON(); submissions.push(body);
          positions.find((position) => position.id === body.position_id).candidates.push({ ...body, id: 100 });
          data = { id: 100 };
        }
      } else { status = 404; data = { error: "Unexpected API request" }; }
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    });
    await context.addInitScript(() => localStorage.setItem("adminToken", "test-only-admin"));
    const page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin + "/admin/candidates");
    await page.getByRole("button", { name: "Add candidate", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Add candidate", exact: true });
    const position = modal.getByLabel("Candidate position"), student = modal.getByLabel("Candidate student");
    const name = modal.getByPlaceholder("Full name (max 40 characters)"), grade = modal.getByPlaceholder("Grade", { exact: true });
    await student.locator("option[value='6']").waitFor({ state: "attached" });
    assert.equal(await student.locator("option").count(), 7);
    for (let level = 7; level <= 12; level++) {
      await position.selectOption(String(level - 5));
      await student.locator(`option[value='${level - 6}']`).waitFor({ state: "attached" });
      assert.equal(await student.locator("option").count(), 2);
      await student.selectOption(String(level - 6));
      assert.equal(await name.inputValue(), `Student${level} Example`);
      assert.equal(await grade.inputValue(), `Grade ${level}`);
      assert.equal(await name.getAttribute("readonly"), "");
      assert.equal(await grade.getAttribute("readonly"), "");
    }
    await position.selectOption("2");
    await student.locator("option[value='1']").waitFor({ state: "attached" });
    assert.equal(await student.inputValue(), ""); assert.equal(await name.inputValue(), "");
    assert.equal(await grade.inputValue(), "");
    await student.selectOption("1");
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Candidate added.", { exact: true }).waitFor();
    assert.equal(submissions.length, 1); assert.equal(submissions[0].student_id, "1");
    assert.equal(submissions[0].position_id, 2);
    await page.getByRole("button", { name: "Add candidate", exact: true }).click();
    await student.locator("option[value='6']").waitFor({ state: "attached" });
    assert.equal(await student.locator("option[value='1']").count(), 0);
    await position.selectOption("2");
    await modal.getByText(/No eligible students found/).waitFor();
    assert.equal(await student.locator("option").count(), 1);
    await position.selectOption("3"); await student.locator("option[value='2']").waitFor({ state: "attached" });
    await student.selectOption("2"); rejectSave = true;
    await modal.getByRole("button", { name: "Save", exact: true }).click();
    await modal.getByText(/A student can run for only one position/).waitFor();
    assert.equal(await student.inputValue(), "2"); assert.equal(submissions.length, 1);
    failList = true;
    await position.selectOption("4");
    await modal.getByText("Unable to load eligible students.", { exact: true }).waitFor();
    assert.equal(await student.isDisabled(), true);
    assert.equal(await student.locator("option[value='2']").count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log("PASS Grade 7–12 filtering, selection reset, student identity, duplicate exclusion, save errors, list errors and mobile layout (all API requests mocked).");
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
