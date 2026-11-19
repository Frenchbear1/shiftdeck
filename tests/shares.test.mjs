import assert from "node:assert/strict";
import test from "node:test";

const data = await import("../app/share-data.ts");

test("a share packs and unpacks with its files intact", async () => {
  const photo = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "image/jpeg" });
  const pdf = new Blob([new Uint8Array([9, 8, 7])], { type: "application/pdf" });
  const manifest = {
    v: 1, from: "David", createdAt: "2026-11-18T00:00:00Z",
    schedules: [
      { name: "week.jpg", type: "image/jpeg", dates: ["2026-11-15"], hash: "a", size: 5 },
      { name: "charter.pdf", type: "application/pdf", dates: ["2026-11-20"], hash: "b", size: 3 },
    ],
    directory: [{ id: "1", first: "Kody", last: "Hermany", phone: "610-266-6000" }],
  };
  const packed = await data.packShare({ manifest, files: [photo, pdf] });
  const { manifest: back, files } = data.unpackShare(packed);
  assert.deepEqual(back, manifest);
  assert.deepEqual([...new Uint8Array(await files[0].arrayBuffer())], [1, 2, 3, 4, 5]);
  assert.deepEqual([...new Uint8Array(await files[1].arrayBuffer())], [9, 8, 7]);
  assert.equal(files[1].type, "application/pdf");
  assert.throws(() => data.unpackShare(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), /isn't a Shiftdeck share/);
});

test("a shared directory adds what's new and only fills in what's missing", () => {
  const mine = [
    { id: "m1", first: "Kody", last: "Hermany", department: "Airline Services", phone: "610-266-6000" },
    { id: "m2", line: "Operations Center", phone: "610-555-0199" },
    { id: "m3", first: "Priya", last: "Shah", department: "Coworkers", email: "mine@abe.com" },
  ];
  const shared = [
    { id: "s1", first: "Kody", last: "Hermany", department: "Airline Services", phone: "610-000-0000", ext: "8119" },
    { id: "s2", line: "Operations Center", phone: "610-555-0199" },
    { id: "s3", first: "Priya", last: "Shah", department: "Security", email: "theirs@abe.com", cell: "484-555-1111" },
    { id: "s4", first: "Landon", last: "Weber", department: "Ramp" },
  ];
  const result = data.mergeSharedDirectory(mine, shared);
  assert.deepEqual([result.added, result.updated, result.same], [1, 2, 1]);
  assert.equal(result.entries.length, 4);
  const kody = result.entries.find((entry) => entry.id === "m1");
  assert.equal(kody.phone, "610-266-6000", "their own number is kept");
  assert.equal(kody.ext, "8119", "a missing extension is filled in");
  const priya = result.entries.find((entry) => entry.id === "m3");
  assert.deepEqual([priya.email, priya.cell, priya.department], ["mine@abe.com", "484-555-1111", "Coworkers"]);
  assert.equal(mine[0].ext, undefined, "the original list isn't changed");
  assert.equal(data.mergeSummary(result), "1 new · 2 filled in · 1 already there");
  // Opening the same link again adds nothing.
  const again = data.mergeSharedDirectory(result.entries, shared);
  assert.deepEqual([again.added, again.updated], [0, 0]);
});

test("shared contacts never replace someone's own", () => {
  const result = data.mergeSharedContacts(
    { landonweber: { email: "mine@abe.com" }, kodyhermany: { email: "k@abe.com", phone: "4845550000" } },
    { landonweber: { email: "theirs@abe.com", phone: "4845551234" }, kodyhermany: { email: "x@abe.com" }, nicolewatson: { phone: "4845559876" }, empty: {} },
  );
  assert.deepEqual(result.contacts.landonweber, { email: "mine@abe.com", phone: "4845551234" });
  assert.deepEqual(result.contacts.kodyhermany, { email: "k@abe.com", phone: "4845550000" });
  assert.deepEqual(result.contacts.nicolewatson, { phone: "4845559876" });
  assert.deepEqual([result.added, result.updated, result.same], [1, 1, 1]);
});

test("week labels read naturally", () => {
  assert.equal(data.weekLabel(["2026-11-21", "2026-11-15", "2026-11-18"]), "Nov 15 – 21");
  assert.equal(data.weekLabel(["2026-11-29", "2026-12-05"]), "Nov 29 – Dec 5");
});

test("team invites keep their keys in the link's fragment", async () => {
  const team = await import("../app/team.ts");
  const link = team.inviteLink(
    { id: "AbCdEfGhIjKlMnOpQrSt12", name: "ABE Ramp", key: "secret-key_123", joinSecret: "join-secret_456", memberId: "m", memberToken: "t" },
    "https://frenchbear1.github.io/shiftdeck/",
  );
  const url = new URL(link);
  assert.equal(url.searchParams.get("team"), "AbCdEfGhIjKlMnOpQrSt12");
  assert.ok(!url.search.includes("secret"), "keys never go in the part servers see");
  assert.deepEqual(team.teamInLocation(url), { id: "AbCdEfGhIjKlMnOpQrSt12", key: "secret-key_123", joinSecret: "join-secret_456" });
  assert.deepEqual(team.teamInText(`David invited you to ABE Ramp. Open this:\n${link}`)?.joinSecret, "join-secret_456");
  assert.equal(team.teamInText("no link here"), null);
});

test("what's being sent reads naturally", async () => {
  const { describeShare } = await import("../app/share-build.ts");
  assert.equal(describeShare({ weeks: [["2026-11-22", "2026-11-28"]] }), "the Nov 22 – 28 schedule");
  assert.equal(describeShare({ weeks: [["2026-11-22"], ["2026-11-29"]], directory: true, contacts: true }), "2 schedules, the directory and coworker contacts");
});
