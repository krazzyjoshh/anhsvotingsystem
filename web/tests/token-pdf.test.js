import assert from "node:assert/strict";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import { createTokensPdf } from "../src/token-pdf.js";

function tokens(count) {
  return Array.from({ length: count }, (_, index) => ({
    code: `A${String(index).padStart(7, "0")}`,
    last_name: "Peña",
    first_name: "Ana",
    given_name: "Cruz",
    grade: "Grade 7",
    section: "A",
    used: index % 2,
  }));
}

function pageText(pdf) {
  const source = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
  return [...source.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(([, stream]) =>
    inflateSync(Buffer.from(stream, "latin1")).toString("latin1")
  );
}

test("empty results do not create a blank PDF", async () => {
  await assert.rejects(createTokensPdf([]), /No tokens to export/);
});

test("tickets contain full names, accented characters, codes and usage", async () => {
  const pdf = await createTokensPdf(tokens(2));
  assert.equal(pdf.getNumberOfPages(), 1);
  const [text] = pageText(pdf);
  assert.match(text, /Peña, Ana Cruz/);
  assert.match(text, /Grade 7 \| A/);
  assert.match(text, /Unused/);
  assert.match(text, /Used/);
  assert.match(text, /Single use only/);
  for (const token of tokens(2)) assert.equal(text.split(token.code).length - 1, 1);
});

test("A4 pagination keeps each ticket together without extra blank pages", async () => {
  for (const count of [1, 10, 11, 20, 101]) {
    const data = tokens(count);
    const pdf = await createTokensPdf(data);
    const pages = pageText(pdf);
    assert.equal(pdf.getNumberOfPages(), Math.ceil(count / 10));
    assert.equal(pages.length, Math.ceil(count / 10));
    assert.ok(Math.abs(pdf.internal.pageSize.getWidth() - 210) < 0.01);
    assert.ok(Math.abs(pdf.internal.pageSize.getHeight() - 297) < 0.01);
    data.forEach((token, index) => {
      assert.equal(pages.join("").split(token.code).length - 1, 1);
      assert.ok(pages[Math.floor(index / 10)].includes(token.code));
    });
  }
});
