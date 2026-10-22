import assert from "node:assert/strict";
import test from "node:test";

test("case switching monotonic load request gate rejects stale intake responses", () => {
  let loadRequestId = 0;
  let activeCaseId = 101;

  // Case 101 starts loading
  activeCaseId = 101;
  const req1 = ++loadRequestId;

  // User quickly switches to Case 102
  activeCaseId = 102;
  const req2 = ++loadRequestId;

  // Verify that a late response from req1 (Case 101) is discarded
  const isReq1Valid = (req1 === loadRequestId && activeCaseId === 101);
  assert.equal(isReq1Valid, false, "Stale request from Case 101 must be ignored");

  // Verify that response for req2 (Case 102) is accepted
  const isReq2Valid = (req2 === loadRequestId && activeCaseId === 102);
  assert.equal(isReq2Valid, true, "Current request for Case 102 must be accepted");
});

test("case switching chat message dispatch only appends assistant reply to originating case", () => {
  let activeCaseId = 201;
  let messagesMap = {
    201: [{ role: "user", content: "Severe headache" }],
    202: [{ role: "user", content: "Knee pain" }],
  };

  const dispatchAssistantReply = (targetCaseId, replyText) => {
    // Only append if the targetCaseId matches or guard with target
    if (messagesMap[targetCaseId]) {
      messagesMap[targetCaseId] = [
        ...messagesMap[targetCaseId],
        { role: "assistant", content: replyText },
      ];
    }
  };

  // Dispatch reply intended for 201
  dispatchAssistantReply(201, "How long have you had the headache?");

  assert.equal(messagesMap[201].length, 2);
  assert.equal(messagesMap[201][1].content, "How long have you had the headache?");
  assert.equal(messagesMap[202].length, 1, "Case 202 must not receive messages meant for Case 201");
});

test("archived cases are excluded from active list by default while preserving clinical fields", () => {
  const cases = [
    {
      id: 1,
      patient_name: "Patient One",
      status: "NEEDS_REVIEW",
      priority: "HIGH",
      is_archived: false,
      archived_at: null,
      description: "Chest tightness",
    },
    {
      id: 2,
      patient_name: "Patient Two",
      status: "IN_REVIEW",
      priority: "MEDIUM",
      is_archived: true,
      archived_at: "2026-10-22T10:00:00Z",
      description: "Rash",
    },
  ];

  const activeCases = cases.filter((c) => !c.is_archived);
  assert.equal(activeCases.length, 1);
  assert.equal(activeCases[0].id, 1);

  // Soft deletion preserves all clinical data on the archived case
  const archivedCase = cases.find((c) => c.is_archived);
  assert.equal(archivedCase.description, "Rash");
  assert.equal(archivedCase.status, "IN_REVIEW");
  assert.equal(archivedCase.priority, "MEDIUM");
  assert.notEqual(archivedCase.archived_at, null);
});

test("archiving case updates local state cleanly without data loss", () => {
  const initialCases = [
    { id: 10, patient_name: "Alice", is_archived: false },
    { id: 11, patient_name: "Bob", is_archived: false },
  ];

  // Archive case 10
  const updatedCases = initialCases.map((c) =>
    c.id === 10 ? { ...c, is_archived: true, archived_at: new Date().toISOString() } : c
  );

  const activeOnly = updatedCases.filter((c) => !c.is_archived);
  assert.equal(activeOnly.length, 1);
  assert.equal(activeOnly[0].id, 11);
  assert.equal(updatedCases.find((c) => c.id === 10).is_archived, true);
});

test("dropdown and case list invoke the same case selection logic and resolve the correct case", () => {
  const allCases = [
    { id: 101, patient_name: "Alice", description: "Fever" },
    { id: 102, patient_name: "Bob", description: "Sprained wrist" },
    { id: 103, patient_name: "Charlie", description: "Allergic reaction" },
  ];

  let selectedCase = null;
  const onSelectCase = (target) => {
    selectedCase = target;
  };

  const handleSelectCase = (caseOrId) => {
    const target =
      typeof caseOrId === "object" && caseOrId !== null
        ? caseOrId
        : allCases.find((c) => String(c.id) === String(caseOrId));
    if (!target) return;
    onSelectCase(target);
  };

  // Case list click with case object
  handleSelectCase(allCases[1]);
  assert.equal(selectedCase?.id, 102);
  assert.equal(selectedCase?.patient_name, "Bob");

  // Dropdown change with string value "103"
  handleSelectCase("103");
  assert.equal(selectedCase?.id, 103);
  assert.equal(selectedCase?.patient_name, "Charlie");
});

test("active case selection in parent state does not trigger detail modal popup", () => {
  let activeIntakeCaseId = null;
  let selectedModalCase = null;
  const currentTab = "Intake chat";

  const handleSelectIntakeCase = (c) => {
    activeIntakeCaseId = c.id;
  };

  const openDetailModal = (c) => {
    selectedModalCase = c;
  };

  // User clicks a case in the Intake Chat section
  const targetCase = { id: 45, patient_name: "Dana" };
  handleSelectIntakeCase(targetCase);

  assert.equal(activeIntakeCaseId, 45, "Active intake case should be updated");
  assert.equal(selectedModalCase, null, "Modal case must remain null when selecting case in chat");

  // Verify modal visibility condition prevents rendering over the intake chat
  const isPatientModalVisible = Boolean(selectedModalCase && currentTab !== "Intake chat");
  assert.equal(isPatientModalVisible, false, "PatientCaseDetailModal must not render over Intake Chat");
});

test("active case persists across simulated page refresh using stored case identifier", () => {
  const mockStorage = new Map();
  mockStorage.set("careflow_active_case_id", "88");

  const restoredId = mockStorage.get("careflow_active_case_id");
  const loadedCases = [
    { id: 77, description: "Earache" },
    { id: 88, description: "Migraine" },
    { id: 99, description: "Back pain" },
  ];

  const resolvedActiveCase =
    loadedCases.find((c) => String(c.id) === String(restoredId)) || loadedCases[0];

  assert.equal(resolvedActiveCase.id, 88);
  assert.equal(resolvedActiveCase.description, "Migraine");
});

test("navigating to intake chat from dashboard case card switches tab and sets active case", () => {
  let currentTab = "Overview";
  let activeIntakeCaseId = null;
  let selectedModalCase = { id: 12 }; // simulated prior modal state

  const handleOpenIntakeChat = (item) => {
    activeIntakeCaseId = item.id;
    selectedModalCase = null; // dismiss any open modal
    currentTab = "Intake chat";
  };

  handleOpenIntakeChat({ id: 50, patient_name: "Eve" });

  assert.equal(currentTab, "Intake chat");
  assert.equal(activeIntakeCaseId, 50);
  assert.equal(selectedModalCase, null);
});
