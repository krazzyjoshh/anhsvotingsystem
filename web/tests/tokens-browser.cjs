const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:5173';

(async () => {
  const browser = await chromium.launch({ ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addInitScript(() => localStorage.setItem('adminToken', 'test-session'));
    const tokens = Array.from({ length: 11 }, (_, index) => ({
      id: index + 1, code: `A${String(index).padStart(7, '0')}`,
      first_name: 'Ana', last_name: `Peña ${index + 1}`, given_name: 'Cruz',
      grade: index < 2 ? 'Grade 7' : 'Grade 8', section: index < 2 ? 'A' : 'B',
      student_active: 1, used: index % 2,
    }));
    const sections = [{ grade: 'Grade 7', section: 'A' }, { grade: 'Grade 8', section: 'B' }];
    let failTokens = false;
    let lastQuery;
    await context.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      let data;
      if (url.pathname === '/api/admin/me') data = { id: 1, email: 'admin@school.test' };
      else if (url.pathname === '/api/admin/tokens') {
        lastQuery = url.searchParams;
        if (failTokens) return route.fulfill({ status: 500, json: { error: 'Token service unavailable' } });
        data = { sections, tokens: tokens.filter((token) =>
          (!lastQuery.get('grade') || token.grade === lastQuery.get('grade')) &&
          (!lastQuery.get('section') || token.section === lastQuery.get('section')) &&
          (!lastQuery.get('status') || Boolean(token.used) === (lastQuery.get('status') === 'used')) &&
          (!lastQuery.get('active') || token.student_active === Number(lastQuery.get('active')))
        ) };
      } else if (url.pathname === '/api/admin/students') data = { students: [], sections };
      else if (url.pathname === '/api/admin/stats') data = { tokens: 11, usedTokens: 5, published: false };
      else data = {};
      await route.fulfill({ json: data });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    async function download(expectedPages) {
      const event = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
      const result = await event;
      assert.equal(result.suggestedFilename(), 'anhs-student-tokens.pdf');
      const bytes = await fs.readFile(await result.path());
      assert.ok(bytes.toString('ascii').startsWith('%PDF-'));
      assert.match(bytes.toString('latin1'), new RegExp(`/Count ${expectedPages}\\b`));
      await page.getByRole('button', { name: 'Download PDF', exact: true }).waitFor();
    }

    await page.goto(origin + '/admin/tokens');
    await page.getByText('11 shown', { exact: true }).waitFor();
    await download(2);
    await page.getByLabel('Filter token grade', { exact: true }).selectOption('Grade 7');
    await page.getByLabel('Filter token section', { exact: true }).selectOption('A');
    await page.getByLabel('Filter token usage', { exact: true }).selectOption('unused');
    await page.getByLabel('Filter token student status', { exact: true }).selectOption('1');
    await page.getByText('1 shown', { exact: true }).waitFor();
    await download(1);
    assert.deepEqual(Object.fromEntries(lastQuery), { grade: 'Grade 7', section: 'A', status: 'unused', active: '1' });

    failTokens = true;
    await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
    await page.getByText('Token service unavailable', { exact: true }).waitFor();
    failTokens = false;

    const printPath = await page.getByRole('link', { name: 'Print', exact: true }).getAttribute('href');
    await page.goto(origin + printPath);
    await page.getByText('1 token(s)', { exact: true }).waitFor();
    await page.getByText('Peña 1, Ana Cruz', { exact: true }).waitFor();
    await download(1);

    await page.goto(origin + '/admin/tokens/print?active=0');
    await page.getByText('0 token(s)', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Print', exact: true }).isDisabled(), true);

    failTokens = true;
    await page.goto(origin + '/admin/tokens/print');
    await page.getByRole('alert').getByText('Token service unavailable', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: PDF downloads, pagination, all filters, print preview, empty results and API errors (mock data only).');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
