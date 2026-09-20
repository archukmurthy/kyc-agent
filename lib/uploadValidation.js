// What may be uploaded, checked where the file actually arrives.
//
// src/App.js checks type and size in the browser, which stops mistakes and
// nothing else: the route is a public endpoint and takes whatever is POSTed to
// it. Three things have to agree here - the declared type, the extension, and
// the first bytes of the file - because the first two are written by the caller
// and only the third is evidence.
//
// Deliberately narrow: the app accepts PDF, PNG and JPEG and nothing else.
//
// CommonJS so api/ handlers can require it.

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // matches the browser-side limit

// Magic bytes, the part a caller cannot fake by renaming the file.
const TYPES = [
  { mimetype: "application/pdf", extensions: [".pdf"], magic: [Buffer.from("%PDF")] },
  { mimetype: "image/png", extensions: [".png"], magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])] },
  { mimetype: "image/jpeg", extensions: [".jpg", ".jpeg"], magic: [Buffer.from([0xff, 0xd8, 0xff])] },
];

function fail(status, error) {
  return { ok: false, status, error };
}

function extensionOf(filename) {
  const dot = String(filename || "").lastIndexOf(".");
  return dot === -1 ? "" : String(filename).slice(dot).toLowerCase();
}

/** @param {{filename:string, mimetype:string, size:number, head:Buffer}} file
 *  `head` is the first bytes of the file - 8 is enough for every type here. */
function validateUpload({ filename, mimetype, size, head }) {
  if (!filename) return fail(400, "A filename is required");
  if (!Number.isFinite(size) || size <= 0) return fail(400, "The file is empty");
  if (size > MAX_UPLOAD_BYTES) return fail(413, `The file must be ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB or smaller`);

  const declared = TYPES.find((t) => t.mimetype === String(mimetype || "").toLowerCase());
  if (!declared) return fail(415, "Only PDF, PNG and JPEG files are accepted");

  if (!declared.extensions.includes(extensionOf(filename))) {
    return fail(415, `A ${declared.mimetype} file must end in ${declared.extensions.join(" or ")}`);
  }

  const bytes = Buffer.isBuffer(head) ? head : Buffer.from(head || []);
  const matches = declared.magic.some((m) => bytes.length >= m.length && bytes.subarray(0, m.length).equals(m));
  if (!matches) return fail(415, "The file contents do not match the type it claims to be");

  return { ok: true, mimetype: declared.mimetype };
}

module.exports = { validateUpload, MAX_UPLOAD_BYTES, ACCEPTED_TYPES: TYPES.map((t) => t.mimetype) };
