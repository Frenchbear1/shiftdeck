import assert from "node:assert/strict";
import test from "node:test";
import { dedupePunches, merge, stamp, values } from "../app/vault-data.ts";
import { syncVault } from "../app/vault.ts";
import { clockFromVault, vaultValuesOf } from "../app/vault-values.ts";
import { DEFAULT_SETTINGS } from "../app/time-clock.ts";

const punch = (id, start, end) => ({ id, in: `2026-11-1${start}T07:00:00.000Z`, ...(end ? { out: `2026-11-1${end}T15:30:00.000Z` } : {}) });
const clock = (punches, settings = DEFAULT_SETTINGS) => ({ punches, settings, checks: {}, sheets: {} });
const vals = (data, prefs = { title: "Work" }) => vaultValuesOf(data, prefs, {}, []);
const defaults = { pref: { title: "Work" }, clock: { settings: DEFAULT_SETTINGS } };

test("two devices' punches both survive a merge; a deletion sticks", () => {
  let phone = stamp({}, vals(clock([punch("a", 1, 1)])), 100, defaults);
  let ipad = stamp({}, vals(clock([punch("b", 2, 2)])), 110, defaults);
  let both = merge(phone, ipad);
  assert.deepEqual(clockFromVault(both).punches.map((p) => p.id), ["a", "b"]);
  // The iPad deletes a; the phone still has it but hasn't changed it: it stays gone.
  ipad = stamp(both, vals(clock([punch("b", 2, 2)])), 200, defaults);
  both = merge(phone, ipad);
  assert.deepEqual(clockFromVault(both).punches.map((p) => p.id), ["b"]);
  // An edit on one device and a clock-in on the other: both kept.
  phone = stamp(both, vals(clock([{ ...punch("b", 2, 2), out: "2026-11-12T16:00:00.000Z" }])), 300, defaults);
  ipad = stamp(both, vals(clock([punch("b", 2, 2), punch("c", 3)])), 310, defaults);
  const result = clockFromVault(merge(phone, ipad));
  assert.deepEqual(result.punches.map((p) => p.id), ["b", "c"]);
  assert.equal(result.punches[0].out, "2026-11-12T16:00:00.000Z");
});

test("a new device's defaults never overwrite real settings", () => {
  const custom = { ...DEFAULT_SETTINGS, wage: 18.25 };
  const phone = stamp({}, vals(clock([], custom), { title: "Ramp" }), 100, defaults);
  // A new device with nothing set yet, stamped later.
  const fresh = stamp({}, vals(clock([]), { title: "Work" }), 500, defaults, true);
  const both = merge(fresh, phone);
  assert.equal(clockFromVault(both).settings.wage, 18.25);
  assert.equal(values(both, "pref").title, "Ramp");
  // ...but a change made on it later wins.
  const changed = stamp(both, vals(clock([], { ...custom, wage: 19 }), { title: "Ramp" }), 600, defaults);
  assert.equal(clockFromVault(merge(phone, changed)).settings.wage, 19);
});

test("a device joining late adds what only it has, without overwriting", () => {
  const phone = stamp({}, vals(clock([punch("a", 1, 1)]), { title: "Ramp" }), 100, defaults);
  const old = stamp({}, vals(clock([punch("z", 4, 4)]), { title: "Old title" }), 900, defaults, true);
  const both = merge(phone, old);
  assert.deepEqual(clockFromVault(both).punches.map((p) => p.id), ["a", "z"]);
  assert.equal(values(both, "pref").title, "Ramp");
});

test("the same punch read from Paycom on two devices is kept once, the same one everywhere", () => {
  const sheetPunch = (id) => ({ ...punch(id, 5, 5), from: "paycom" });
  const merged = merge(stamp({}, vals(clock([sheetPunch("x2")])), 100), stamp({}, vals(clock([sheetPunch("x1")])), 120));
  const once = dedupePunches(merged);
  assert.deepEqual(clockFromVault(once).punches.map((p) => p.id), ["x1"]);
  assert.equal(dedupePunches(once), once); // Nothing left to do.
});

test("merge is the same whichever way round", () => {
  const a = stamp({}, vals(clock([punch("a", 1, 1)]), { title: "A" }), 100);
  const b = stamp({}, vals(clock([punch("b", 2, 2)]), { title: "B" }), 100);
  assert.deepEqual(merge(a, b), merge(b, a));
});

/** A server like the worker's: versions, and a 409 when someone saved first. */
function fakeServer() {
  const server = { data: null, version: 0, puts: 0 };
  return {
    server,
    api: () => ({
      get: async (have) => ({ version: server.version, data: server.version === have ? null : server.data }),
      put: async (data, base) => {
        if (base !== server.version) return null;
        server.data = data;
        server.version += 1;
        server.puts += 1;
        return { version: server.version };
      },
    }),
  };
}
const teamKey = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");

test("two devices saving at once both end up with everything", async () => {
  const { server, api } = fakeServer();
  const phone = { vault: stamp({}, vals(clock([punch("a", 1, 1)])), 100), version: 0, stamped: true, dirty: true };
  const ipad = { vault: stamp({}, vals(clock([punch("b", 2, 2)])), 110), version: 0, stamped: true, dirty: true };
  // The iPad got its copy before the phone saved, then saves after: a conflict, merged and retried.
  const realApi = api();
  let first = true;
  const racing = {
    get: async (have) => {
      const answer = await realApi.get(have);
      if (first) {
        first = false;
        await syncVault(phone, realApi, teamKey, "person-1");
      }
      return answer;
    },
    put: realApi.put,
  };
  const ipadAfter = await syncVault(ipad, racing, teamKey, "person-1");
  assert.deepEqual(clockFromVault(ipadAfter.vault).punches.map((p) => p.id), ["a", "b"]);
  // The phone catches up and has nothing more to save.
  const before = server.puts;
  const phoneAfter = await syncVault({ ...phone, version: 1, dirty: false }, realApi, teamKey, "person-1");
  assert.deepEqual(clockFromVault(phoneAfter.vault).punches.map((p) => p.id), ["a", "b"]);
  assert.equal(server.puts, before);
  assert.equal(phoneAfter.version, server.version);
  // In step, nothing changed: no traffic beyond one small check.
  const again = await syncVault({ ...phoneAfter, dirty: false }, realApi, teamKey, "person-1");
  assert.equal(server.puts, before);
  assert.equal(again.version, server.version);
});

test("a vault that doesn't open with this key is never overwritten", async () => {
  const { server, api } = fakeServer();
  await syncVault({ vault: stamp({}, vals(clock([punch("a", 1, 1)])), 1), version: 0, stamped: true, dirty: true }, api(), teamKey, "person-1");
  const saved = server.data;
  const otherKey = Buffer.from(new Uint8Array(32).fill(9)).toString("base64url");
  await assert.rejects(syncVault({ vault: {}, version: 0, stamped: true, dirty: true }, api(), otherKey, "person-1"));
  assert.equal(server.data, saved);
});
