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

test("the team key passes from phone to phone without the server being able to open it", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const keys = await import("../app/team-key.ts");
  const teamKey = keys.newTeamKey();
  const holder = await keys.devicePair();
  store.clear();
  const newcomer = await keys.devicePair();
  assert.notDeepEqual(holder.publicJwk, newcomer.publicJwk);
  const wrapped = await keys.wrapTeamKey(teamKey, keys.publicKeyText(newcomer), holder);
  assert.ok(!wrapped.includes(teamKey), "the key isn't readable in what the server carries");
  assert.ok(!keys.publicKeyText(newcomer).includes('"d"'), "only the public half leaves the phone");
  assert.equal(await keys.unwrapTeamKey(wrapped, newcomer), teamKey);
  store.clear();
  const stranger = await keys.devicePair();
  assert.equal(await keys.unwrapTeamKey(wrapped, stranger), null, "another phone can't open it");
  // The server shows a hash of the proof, so seeing it doesn't let you prove you have the key.
  const proof = await keys.keyProof(teamKey);
  assert.notEqual(await keys.keyCheck(teamKey), proof);
});

test("what's being sent reads naturally", async () => {
  const { describeShare } = await import("../app/share-build.ts");
  assert.equal(describeShare({ weeks: [["2026-11-22", "2026-11-28"]] }), "the Nov 22 – 28 schedule");
  assert.equal(describeShare({ weeks: [["2026-11-22"], ["2026-11-29"]], directory: true, contacts: true }), "2 schedules, the directory and coworker contacts");
});

test("only the owner counts as the owner", async () => {
  const team = await import("../app/team.ts");
  assert.equal(team.isOwner({ memberId: "a", ownerId: "a" }), true);
  assert.equal(team.isOwner({ memberId: "b", ownerId: "a" }), false);
  assert.equal(team.isOwner({ memberId: "b" }), false, "unknown owner is not you");
  assert.equal(team.isOwner(null), false);
  assert.deepEqual(team.teammates({ memberId: "a", people: [{ id: "a", name: "David" }, { id: "b", name: "Nicole" }] }).map((p) => p.name), ["Nicole"]);
});

test("handing over suggests whoever has used the app longest (not you)", async () => {
  const { recommendedSuccessor } = await import("../app/people.ts");
  const people = [
    { id: "me", name: "David", since: "2026-11-01T00:00:00Z" },
    { id: "b", name: "Landon", since: "2026-11-10T00:00:00Z" },
    { id: "c", name: "Nicole", since: "2026-11-03T00:00:00Z" },
  ];
  assert.equal(recommendedSuccessor(people, "me").name, "Nicole");
  assert.equal(recommendedSuccessor([people[0]], "me"), null);
  assert.equal(recommendedSuccessor([...people, { id: "x", name: "Zed", since: "2026-10-01T00:00:00Z", blocked: true }], "me").name, "Nicole",
    "blocked people aren't suggested");
});

test("a typed name finds the name the app knows, allowing small typos", async () => {
  const { matchName, tidyName } = await import("../worker/name-match.ts");
  const known = ["David LaBarre", "Nicole W. Watson", "Landon Price", "Mike Smyth", "Mike Smith"];
  assert.equal(matchName("Nicole Watson", known), "Nicole W. Watson", "middle initials don't matter");
  assert.equal(matchName("nicol watsen", known), "Nicole W. Watson");
  assert.equal(matchName("David Labare", known), "David LaBarre");
  assert.equal(matchName("Dvaid LaBarre", known), "David LaBarre", "swapped letters");
  assert.equal(matchName("Landon Pryce", known), "Landon Price");
  assert.equal(matchName("Mike Smth", known), null, "two names fit equally: no guess");
  assert.equal(matchName("Mike Smitt", known), "Mike Smith");
  assert.equal(matchName("Sarah Connor", known), null);
  assert.equal(matchName("Davidd", known), null, "needs a last name");
  assert.equal(tidyName("nicole", "WATSON"), "Nicole Watson");
  assert.equal(tidyName("david", "LaBarre"), "David LaBarre");
  assert.equal(tidyName("mary-jo", "o'neil"), "Mary-Jo O'Neil");
});

test("a shared schedule carries what the sender's phone read, matched to the photo it sends", async () => {
  const { buildShare } = await import("../app/share-build.ts");
  const shifts = [
    { id: "2026-11-24-Nicole Watson-07:30", date: "2026-11-24", worker: "Nicole Watson", start: "07:30", end: "11:30", status: "working" },
    { id: "2026-11-25-Nicole Watson-07:30", date: "2026-11-25", worker: "Nicole Watson", start: "07:30", end: "11:30", status: "working" },
  ];
  const layout = { width: 1161, height: 1134, left: 0, right: 1160, slope: 0, spacing: 145, centers: [], header: { top: 320, bottom: 340 }, rows: [] };
  const asked = [];
  const { share } = await buildShare({
    documents: [{
      id: "doc", hash: "h", name: "Schedule.jpg", dates: ["2026-11-22"], shifts, flights: [], parserVersion: 6,
      review: { sourceLayout: layout, deskewed: true, uncertainShifts: ["2026-11-25-Nicole Watson-07:30"] },
    }],
    person: "David LaBarre",
    loadFile: async (id, straightened) => {
      asked.push(straightened ? "straightened" : "original");
      return new Blob([straightened ? "straight" : "tilted"], { type: "image/jpeg" });
    },
  });
  assert.deepEqual(asked, ["straightened"], "a straightened photo is sent as straightened, since the layout matches it");
  assert.equal(await share.files[0].text(), "straight");
  const read = share.manifest.schedules[0].read;
  assert.equal(read.shifts.length, 2);
  assert.deepEqual(read.sourceLayout, layout);
  assert.deepEqual(read.uncertain, ["2026-11-25|Nicole Watson|07:30"]);
  assert.deepEqual(read.dates, ["2026-11-22"]);
});
