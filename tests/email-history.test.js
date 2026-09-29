import test from "node:test";
import assert from "node:assert/strict";
import {
  addEmailHistory,
  createEmailHistoryEntry,
  EMAIL_HISTORY_KEY,
  EMAIL_HISTORY_LIMIT,
  loadEmailHistory,
  saveEmailHistory,
} from "../welcome-email-sender/emailHistory.js";

const makeStorage = () => {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
};

const makeEntry = number => createEmailHistoryEntry({
  recipient: `person${number}@example.com`,
  caseManager: `Manager ${number}`,
  managerName: `Manager ${number}`,
  subject: `Subject ${number}`,
  language: "english",
}, new Date(Date.UTC(2026, 8, 29, 12, 0, number)));

test("single-email history persists across reloads with useful display fields", () => {
  const storage = makeStorage();
  const history = addEmailHistory([], makeEntry(1));
  saveEmailHistory(storage, history);
  assert.deepEqual(loadEmailHistory(storage), history);
  assert.deepEqual(Object.keys(history[0]).sort(), ["createdAt", "id", "language", "managerName", "recipient", "subject"]);
  assert.equal(history[0].recipient, "person1@example.com");
  assert.equal(history[0].managerName, "Manager 1");
  assert.equal(history[0].subject, "Subject 1");
});

test("history is newest first and removes the oldest after 20 records", () => {
  let history = [];
  for (let number = 0; number <= EMAIL_HISTORY_LIMIT; number++) {
    history = addEmailHistory(history, makeEntry(number));
  }
  assert.equal(history.length, 20);
  assert.equal(history[0].recipient, "person20@example.com");
  assert.equal(history.at(-1).recipient, "person1@example.com");
  assert.equal(history.some(entry => entry.recipient === "person0@example.com"), false);
});

test("stored history is allowlisted, bounded, and malformed data fails safely", () => {
  const storage = makeStorage();
  storage.setItem(EMAIL_HISTORY_KEY, JSON.stringify([
    { ...makeEntry(2), body: "private body", accessToken: "secret", webLink: "https://example.invalid/private" },
    { recipient: "not-an-email", subject: "Bad", managerName: "Bad", language: "english", createdAt: "bad-date", id: "bad" },
  ]));
  const history = loadEmailHistory(storage);
  assert.equal(history.length, 1);
  assert.equal("body" in history[0], false);
  assert.equal("accessToken" in history[0], false);
  assert.equal("webLink" in history[0], false);
  storage.setItem(EMAIL_HISTORY_KEY, "not json");
  assert.deepEqual(loadEmailHistory(storage), []);
});
