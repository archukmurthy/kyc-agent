"use strict";

// Server-side upload checks. The browser already checks type and size, but the
// browser is not where the file arrives - anyone can POST straight to the route.

const { test } = require("node:test");
const assert = require("node:assert");
const { validateUpload, MAX_UPLOAD_BYTES } = require("../uploadValidation");

const PDF = Buffer.from("%PDF-1.7\n...");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

test("a real PDF, PNG and JPEG are accepted", () => {
  assert.equal(validateUpload({ filename: "a.pdf", mimetype: "application/pdf", size: 1000, head: PDF }).ok, true);
  assert.equal(validateUpload({ filename: "a.png", mimetype: "image/png", size: 1000, head: PNG }).ok, true);
  assert.equal(validateUpload({ filename: "a.jpg", mimetype: "image/jpeg", size: 1000, head: JPEG }).ok, true);
});

test("a file over the limit is refused with 413", () => {
  const r = validateUpload({ filename: "a.pdf", mimetype: "application/pdf", size: MAX_UPLOAD_BYTES + 1, head: PDF });
  assert.equal(r.ok, false);
  assert.equal(r.status, 413);
});

test("an empty file is refused", () => {
  assert.equal(validateUpload({ filename: "a.pdf", mimetype: "application/pdf", size: 0, head: PDF }).ok, false);
});

test("a type we do not accept is refused", () => {
  const r = validateUpload({ filename: "a.exe", mimetype: "application/x-msdownload", size: 10, head: ZIP });
  assert.equal(r.ok, false);
  assert.equal(r.status, 415);
});

test("a program renamed to .pdf is refused on its contents", () => {
  // The attack: claim application/pdf, name it invoice.pdf, send something else.
  // Only the bytes settle it.
  const r = validateUpload({ filename: "invoice.pdf", mimetype: "application/pdf", size: 10, head: Buffer.from([0x4d, 0x5a, 0x90, 0]) });
  assert.equal(r.ok, false);
  assert.equal(r.status, 415);
  assert.match(r.error, /contents/i);
});

test("a PNG declared as a PDF is refused - the declaration must match the bytes", () => {
  const r = validateUpload({ filename: "a.pdf", mimetype: "application/pdf", size: 10, head: PNG });
  assert.equal(r.ok, false);
  assert.equal(r.status, 415);
});

test("an extension that disagrees with the declared type is refused", () => {
  const r = validateUpload({ filename: "a.png", mimetype: "application/pdf", size: 10, head: PDF });
  assert.equal(r.ok, false);
  assert.equal(r.status, 415);
});

test("a missing filename is refused rather than guessed", () => {
  assert.equal(validateUpload({ filename: "", mimetype: "application/pdf", size: 10, head: PDF }).ok, false);
});
