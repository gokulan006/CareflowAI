import test from "node:test";
import assert from "node:assert/strict";

test("voice transcript appends properly to existing input draft", () => {
  const existingDraft = "I started having headaches";
  const transcript = "two days ago with fever";
  
  const updated = existingDraft.trim()
    ? `${existingDraft.trim()} ${transcript.trim()}`
    : transcript.trim();

  assert.equal(updated, "I started having headaches two days ago with fever");
});

test("voice transcript handles empty initial draft", () => {
  const existingDraft = "";
  const transcript = "Severe chest tightness";
  
  const updated = existingDraft.trim()
    ? `${existingDraft.trim()} ${transcript.trim()}`
    : transcript.trim();

  assert.equal(updated, "Severe chest tightness");
});

test("direct voice send formats message for immediate clinical dispatch", () => {
  const spokenText = "I have a sharp pain in my right abdomen";
  let dispatchedPayload = null;

  function mockSendDirectly(text) {
    if (!text || !text.trim()) return;
    dispatchedPayload = {
      message: text.trim(),
      role: "patient",
      timestamp: Date.now()
    };
  }

  mockSendDirectly(spokenText);
  assert.ok(dispatchedPayload);
  assert.equal(dispatchedPayload.message, "I have a sharp pain in my right abdomen");
  assert.equal(dispatchedPayload.role, "patient");
});
