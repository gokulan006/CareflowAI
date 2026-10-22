import json
import os
from unittest.mock import MagicMock, patch
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import Case, PatientIntake, ConsentRecord, ClinicianReview, CaseActivity, AIResult, IntakeChatMessage
from .ai_service import (
    build_ai_request_payload,
    evaluate_deterministic_safety_rules,
    validate_ai_response,
    dispatch_ai_pipeline,
    generate_openai_summary,
    get_active_ai_pipeline_mode,
    AISchemaValidationError,
    AIServiceUnavailableError,
    AITimeoutError,
    AIRateLimitError,
    SCHEMA_VERSION_REQUEST,
    SCHEMA_VERSION_RESPONSE,
)

User = get_user_model()


class AIServiceUnitTests(APITestCase):
    def setUp(self):
        self.patient_group, _ = Group.objects.get_or_create(name="Patient")
        self.patient = User.objects.create_user(username="test_patient", password="Password123!")
        self.patient.groups.add(self.patient_group)

        self.case = Case.objects.create(
            owner=self.patient,
            patient_name="Alex River",
            description="Mild cough for three days.",
            preferred_language="en",
        )
        self.intake = PatientIntake.objects.create(
            case=self.case,
            symptoms=["cough", "fatigue"],
            symptom_onset="3 days ago",
            duration="3 days",
            severity_description="Mild",
            progression="Stable",
            medical_history="Mild asthma in childhood",
            current_medications="None",
            allergies="Penicillin",
            additional_information="No fever noted",
        )

    def test_build_ai_request_payload_construction(self):
        payload = build_ai_request_payload(self.case)
        self.assertEqual(payload["schema_version"], SCHEMA_VERSION_REQUEST)
        self.assertEqual(payload["case_id"], f"case-{self.case.pk}")
        self.assertEqual(payload["patient_context"]["preferred_language"], "en")

        sources = {s["source_id"]: s for s in payload["sources"]}
        self.assertIn("case.description", sources)
        self.assertEqual(sources["case.description"]["text"], "Mild cough for three days.")
        self.assertIn("intake.symptoms", sources)
        self.assertEqual(sources["intake.symptoms"]["text"], "cough, fatigue")
        self.assertIn("intake.onset", sources)
        self.assertIn("intake.duration", sources)
        self.assertIn("intake.allergies", sources)
        self.assertEqual(sources["intake.allergies"]["text"], "Penicillin")

    def test_missing_information_semantics(self):
        empty_case = Case.objects.create(owner=self.patient, patient_name="Empty Intake", description="")
        empty_intake = PatientIntake.objects.create(case=empty_case)
        payload = build_ai_request_payload(empty_case)

        sources = {s["source_id"]: s for s in payload["sources"]}
        self.assertEqual(sources["case.description"].get("availability"), "not_provided")
        self.assertEqual(sources["intake.allergies"].get("availability"), "not_provided")
        self.assertEqual(sources["intake.symptoms"].get("availability"), "not_provided")
        # Absent allergy must never be claimed as "no allergies"
        self.assertNotIn("text", sources["intake.allergies"])

    def test_deterministic_safety_rules_detection(self):
        urgent_sources = [
            {"source_id": "case.description", "text": "Experiencing severe chest pain radiating to left arm and shortness of breath."},
            {"source_id": "intake.symptoms", "text": "chest tightness"},
        ]
        triggers, alerts, forced_priority = evaluate_deterministic_safety_rules(urgent_sources)
        self.assertEqual(forced_priority, "RED")
        rule_ids = [t["rule_id"] for t in triggers]
        self.assertIn("RULE_ACUTE_CHEST_PAIN", rule_ids)
        self.assertIn("RULE_SEVERE_RESPIRATORY_DISTRESS", rule_ids)
        self.assertTrue(len(alerts) >= 2)

    def test_validate_ai_response_valid_synthetic(self):
        submitted_sources = {"case.description", "intake.symptoms", "intake.duration"}
        valid_response = {
            "schema_version": SCHEMA_VERSION_RESPONSE,
            "case_id": "case-99",
            "status": "COMPLETED",
            "model_name": "gpt-4o-mini",
            "structured_output": {
                "patient_summary": "Dry cough for two days.",
                "relevant_history": [],
                "key_positive_findings": [
                    {"finding": "Dry cough", "source_references": ["case.description"]}
                ],
                "important_negative_findings": [],
                "missing_information": [
                    {"item": "Medication history", "reason": "Not provided", "source_references": ["case.description"]}
                ],
                "unclear_information": [],
                "contradictions": [],
                "urgent_alerts": [],
                "suggested_follow_up_questions": ["Has the cough worsened at night?"],
                "suggested_priority": "GREEN",
                "priority_explanation": "Mild symptom duration with no acute warning triggers.",
                "source_references": ["case.description", "intake.duration"],
            },
            "evidence": [],
            "uncertainty_flags": [],
            "rule_triggers": [],
            "error_code": "",
        }
        # Should validate without exception
        validate_ai_response(valid_response, submitted_sources, expected_case_id="case-99")

    def test_validate_ai_response_rejects_unsupported_schema_version(self):
        resp = {
            "schema_version": "careflow-ai-response/99",
            "case_id": "case-99",
            "status": "COMPLETED",
            "structured_output": {},
            "evidence": [],
            "uncertainty_flags": [],
        }
        with self.assertRaises(AISchemaValidationError):
            validate_ai_response(resp, set(), "case-99")

    def test_validate_ai_response_rejects_mismatched_case_id(self):
        resp = {
            "schema_version": SCHEMA_VERSION_RESPONSE,
            "case_id": "case-wrong",
            "status": "COMPLETED",
            "structured_output": {},
            "evidence": [],
            "uncertainty_flags": [],
        }
        with self.assertRaises(AISchemaValidationError):
            validate_ai_response(resp, set(), "case-99")

    def test_validate_ai_response_rejects_invalid_priority_enum(self):
        submitted_sources = {"case.description"}
        resp = {
            "schema_version": SCHEMA_VERSION_RESPONSE,
            "case_id": "case-1",
            "status": "COMPLETED",
            "structured_output": {
                "patient_summary": "Summary",
                "relevant_history": [],
                "key_positive_findings": [],
                "important_negative_findings": [],
                "missing_information": [],
                "unclear_information": [],
                "contradictions": [],
                "urgent_alerts": [],
                "suggested_follow_up_questions": [],
                "suggested_priority": "SUPER_EMERGENCY",
                "priority_explanation": "Explanation",
                "source_references": ["case.description"],
            },
            "evidence": [],
            "uncertainty_flags": [],
        }
        with self.assertRaises(AISchemaValidationError):
            validate_ai_response(resp, submitted_sources, "case-1")

    def test_validate_ai_response_rejects_fabricated_source_references(self):
        submitted_sources = {"case.description"}
        resp = {
            "schema_version": SCHEMA_VERSION_RESPONSE,
            "case_id": "case-1",
            "status": "COMPLETED",
            "structured_output": {
                "patient_summary": "Summary",
                "relevant_history": [],
                "key_positive_findings": [
                    {"finding": "Fever", "source_references": ["external_web_citation"]}
                ],
                "important_negative_findings": [],
                "missing_information": [],
                "unclear_information": [],
                "contradictions": [],
                "urgent_alerts": [],
                "suggested_follow_up_questions": [],
                "suggested_priority": "GREEN",
                "priority_explanation": "Explanation",
                "source_references": ["case.description"],
            },
            "evidence": [],
            "uncertainty_flags": [],
        }
        with self.assertRaises(AISchemaValidationError):
            validate_ai_response(resp, submitted_sources, "case-1")

    def test_active_pipeline_mode_reporting(self):
        with patch.dict("os.environ", {"AI_PIPELINE_URL": "https://external.test", "OPENAI_API_KEY": ""}):
            self.assertEqual(get_active_ai_pipeline_mode(), "external_adapter")
        with patch.dict("os.environ", {"AI_PIPELINE_URL": "", "OPENAI_API_KEY": "sk-synthetic"}):
            self.assertEqual(get_active_ai_pipeline_mode(), "openai_direct")
        with patch.dict("os.environ", {"AI_PIPELINE_URL": "", "OPENAI_API_KEY": ""}):
            self.assertEqual(get_active_ai_pipeline_mode(), "unconfigured")


class AIEndpointIntegrationTests(APITestCase):
    def setUp(self):
        self.patient_group, _ = Group.objects.get_or_create(name="Patient")
        self.clinician_group, _ = Group.objects.get_or_create(name="Clinician")

        self.patient = User.objects.create_user(username="ai_patient_1", password="Password123!")
        self.patient.groups.add(self.patient_group)

        self.other_patient = User.objects.create_user(username="ai_patient_2", password="Password123!")
        self.other_patient.groups.add(self.patient_group)

        self.clinician = User.objects.create_user(username="ai_clinician", password="Password123!")
        self.clinician.groups.add(self.clinician_group)

        self.case = Case.objects.create(
            owner=self.patient,
            patient_name="Morgan Kelly",
            description="Persistent dry cough for two days.",
            status=Case.Status.NEEDS_REVIEW,
        )
        self.intake = PatientIntake.objects.create(
            case=self.case,
            symptoms=["dry cough"],
            duration="2 days",
            severity_description="Mild",
        )
        self.consent = ConsentRecord.objects.create(
            case=self.case,
            user=self.patient,
            purpose="CareFlow case processing",
            notice_version="1.0",
            granted=True,
            granted_at=timezone.now(),
        )

        self.client.force_authenticate(user=self.patient)

    def _make_synthetic_llm_json(self):
        return json.dumps({
            "patient_summary": "Patient reports dry cough for two days.",
            "relevant_history": [],
            "key_positive_findings": [
                {"finding": "Dry cough", "source_references": ["case.description"]}
            ],
            "important_negative_findings": [],
            "missing_information": [
                {"item": "Medications", "reason": "Not provided", "source_references": ["intake.symptoms"]}
            ],
            "unclear_information": [],
            "contradictions": [],
            "urgent_alerts": [],
            "suggested_follow_up_questions": ["Any shortness of breath?"],
            "suggested_priority": "GREEN",
            "priority_explanation": "Stable mild cough without acute red-flag symptoms.",
            "source_references": ["case.description", "intake.symptoms"],
        })

    def test_submit_ai_success_with_openai_model(self):
        mock_completion = MagicMock()
        mock_completion.choices = [
            MagicMock(message=MagicMock(content=self._make_synthetic_llm_json()))
        ]

        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "OPENAI_MODEL": "gpt-4o-mini", "AI_PIPELINE_URL": ""}):
            with patch("openai.OpenAI") as mock_openai_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create.return_value = mock_completion
                mock_openai_cls.return_value = mock_client

                response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
                self.assertEqual(response.status_code, status.HTTP_201_CREATED)
                self.assertIn("suggestions", response.data)
                self.assertEqual(response.data["suggestions"]["suggested_priority"], "GREEN")

                # Verify persistence
                ai_result = AIResult.objects.filter(case=self.case).order_by("-created_at").first()
                self.assertIsNotNone(ai_result)
                self.assertEqual(ai_result.status, AIResult.ProcessingStatus.COMPLETED)
                self.assertTrue(ai_result.is_validated)
                self.assertEqual(ai_result.model_name, "gpt-4o-mini")
                self.assertEqual(ai_result.schema_version, SCHEMA_VERSION_RESPONSE)

                # Verify activities
                activities = CaseActivity.objects.filter(case=self.case).values_list("action", flat=True)
                self.assertIn("AI_ANALYSIS_REQUESTED", activities)
                self.assertIn("AI_ANALYSIS_COMPLETED", activities)
                self.assertIn("AI_PRIORITY_ASSIGNED", activities)

                # Verify clinical case priority was updated by GPT and status remains NEEDS_REVIEW
                self.case.refresh_from_db()
                self.assertEqual(self.case.status, Case.Status.NEEDS_REVIEW)
                self.assertEqual(self.case.priority, Case.Priority.GREEN)

    def test_submit_ai_requires_active_consent(self):
        # Withdraw consent
        self.consent.withdrawn_at = timezone.now()
        self.consent.save(update_fields=["withdrawn_at"])

        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "AI_PIPELINE_URL": ""}):
            response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
            self.assertIn("consent", response.data["detail"].lower())

    def test_submit_ai_cross_case_unauthorized(self):
        # Other patient cannot submit
        self.client.force_authenticate(user=self.other_patient)
        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "AI_PIPELINE_URL": ""}):
            response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_submit_ai_clinician_cannot_submit_patient_endpoint(self):
        self.client.force_authenticate(user=self.clinician)
        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "AI_PIPELINE_URL": ""}):
            response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_submit_ai_unconfigured_service(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "", "AI_PIPELINE_URL": ""}):
            response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
            self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
            self.assertEqual(response.data["status"], "not_configured")

    def test_submit_ai_timeout_handling(self):
        from openai import APITimeoutError

        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "AI_PIPELINE_URL": ""}):
            with patch("openai.OpenAI") as mock_openai_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create.side_effect = APITimeoutError("Request timed out")
                mock_openai_cls.return_value = mock_client

                response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
                self.assertEqual(response.status_code, status.HTTP_504_GATEWAY_TIMEOUT)
                self.assertEqual(response.data["error_code"], "TIMEOUT")

                ai_result = AIResult.objects.filter(case=self.case).order_by("-created_at").first()
                self.assertIsNotNone(ai_result)
                self.assertEqual(ai_result.status, AIResult.ProcessingStatus.FAILED)
                self.assertFalse(ai_result.is_validated)
                self.assertEqual(ai_result.error_code, "TIMEOUT")

    def test_submit_ai_rate_limit_handling(self):
        from openai import RateLimitError

        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "AI_PIPELINE_URL": ""}):
            with patch("openai.OpenAI") as mock_openai_cls:
                mock_client = MagicMock()
                mock_response = MagicMock(status_code=429, headers={})
                mock_client.chat.completions.create.side_effect = RateLimitError("Rate limit exceeded", response=mock_response, body=None)
                mock_openai_cls.return_value = mock_client

                response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
                self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
                self.assertEqual(response.data["error_code"], "RATE_LIMIT_EXCEEDED")

                ai_result = AIResult.objects.filter(case=self.case).first()
                self.assertEqual(ai_result.status, AIResult.ProcessingStatus.FAILED)
                self.assertFalse(ai_result.is_validated)

    def test_submit_ai_malformed_json_handling(self):
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content="not valid json at all"))]

        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "AI_PIPELINE_URL": ""}):
            with patch("openai.OpenAI") as mock_openai_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create.return_value = mock_completion
                mock_openai_cls.return_value = mock_client

                response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
                self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
                self.assertEqual(response.data["error_code"], "VALIDATION_FAILED")

                ai_result = AIResult.objects.filter(case=self.case).first()
                self.assertEqual(ai_result.status, AIResult.ProcessingStatus.FAILED)
                self.assertFalse(ai_result.is_validated)

    def test_submit_ai_fabricated_source_ref_fails_validation(self):
        bad_json = json.dumps({
            "patient_summary": "Patient summary",
            "relevant_history": [],
            "key_positive_findings": [
                {"finding": "Fabricated finding", "source_references": ["non_existent_source_123"]}
            ],
            "important_negative_findings": [],
            "missing_information": [],
            "unclear_information": [],
            "contradictions": [],
            "urgent_alerts": [],
            "suggested_follow_up_questions": [],
            "suggested_priority": "GREEN",
            "priority_explanation": "Explanation",
            "source_references": ["case.description"],
        })
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock(message=MagicMock(content=bad_json))]

        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "AI_PIPELINE_URL": ""}):
            with patch("openai.OpenAI") as mock_openai_cls:
                mock_client = MagicMock()
                mock_client.chat.completions.create.return_value = mock_completion
                mock_openai_cls.return_value = mock_client

                response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
                self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)
                self.assertEqual(response.data["error_code"], "VALIDATION_FAILED")

                ai_result = AIResult.objects.filter(case=self.case).first()
                self.assertEqual(ai_result.status, AIResult.ProcessingStatus.FAILED)
                self.assertFalse(ai_result.is_validated)

    def test_duplicate_submission_in_progress_protection(self):
        AIResult.objects.create(
            case=self.case,
            status=AIResult.ProcessingStatus.PENDING,
        )
        with patch.dict("os.environ", {"OPENAI_API_KEY": "sk-synthetic-key", "AI_PIPELINE_URL": ""}):
            response = self.client.post(f"/api/cases/{self.case.pk}/submit-ai/")
            self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
            self.assertEqual(response.data["status"], "in_progress")

    def test_patient_suggestions_allowlist_excludes_evidence_and_errors(self):
        AIResult.objects.create(
            case=self.case,
            status=AIResult.ProcessingStatus.COMPLETED,
            schema_version=SCHEMA_VERSION_RESPONSE,
            model_name="gpt-4o-mini",
            structured_output={
                "patient_summary": "Dry cough.",
                "missing_information": [],
                "unclear_information": [],
                "contradictions": [],
                "urgent_alerts": [],
                "suggested_follow_up_questions": ["How long?"],
                "suggested_priority": "GREEN",
                "priority_explanation": "Mild symptom.",
                "source_references": ["case.description"],
                "internal_diagnostic_code": "ICD-999",
            },
            evidence=[{"source": "case.description", "secret": "confidential_trace"}],
            uncertainty_flags=["low_confidence"],
            rule_triggers=[{"rule": "none"}],
            error_code="internal_debug_code",
            is_validated=True,
        )

        response = self.client.get(f"/api/cases/{self.case.pk}/patient-ai-suggestions/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["status"], "completed")

        suggestions = response.data["result"]["suggestions"]
        self.assertIn("patient_summary", suggestions)
        self.assertNotIn("internal_diagnostic_code", suggestions)
        self.assertNotIn("evidence", response.data["result"])
        self.assertNotIn("uncertainty_flags", response.data["result"])
        self.assertNotIn("error_code", response.data["result"])

    def test_clinician_access_to_assigned_and_unassigned_ai_results(self):
        # Create completed AI result
        AIResult.objects.create(
            case=self.case,
            status=AIResult.ProcessingStatus.COMPLETED,
            schema_version=SCHEMA_VERSION_RESPONSE,
            model_name="gpt-4o-mini",
            structured_output={"patient_summary": "Summary"},
            is_validated=True,
        )

        # Case is unassigned (assigned_clinician is None)
        self.client.force_authenticate(user=self.clinician)
        unassigned_resp = self.client.get(f"/api/cases/{self.case.pk}/ai_results/")
        self.assertEqual(unassigned_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(unassigned_resp.data), 1)

        # Case is assigned to this clinician
        self.case.assigned_clinician = self.clinician
        self.case.save(update_fields=["assigned_clinician"])
        assigned_resp = self.client.get(f"/api/cases/{self.case.pk}/ai_results/")
        self.assertEqual(assigned_resp.status_code, status.HTTP_200_OK)

        # Clinician assigned to a DIFFERENT case cannot view this case (filtered out by queryset scoping)
        other_clinician = User.objects.create_user(username="other_clinician", password="Password123!")
        other_clinician.groups.add(self.clinician_group)
        self.client.force_authenticate(user=other_clinician)
        forbidden_resp = self.client.get(f"/api/cases/{self.case.pk}/ai_results/")
        self.assertIn(forbidden_resp.status_code, (status.HTTP_404_NOT_FOUND, status.HTTP_403_FORBIDDEN))

    def test_external_adapter_fallback_when_url_configured(self):
        expected_response = {
            "schema_version": SCHEMA_VERSION_RESPONSE,
            "case_id": f"case-{self.case.pk}",
            "status": "COMPLETED",
            "model_name": "external-pipeline",
            "structured_output": {
                "patient_summary": "External summary",
                "relevant_history": [],
                "key_positive_findings": [],
                "important_negative_findings": [],
                "missing_information": [],
                "unclear_information": [],
                "contradictions": [],
                "urgent_alerts": [],
                "suggested_follow_up_questions": [],
                "suggested_priority": "GREEN",
                "priority_explanation": "External explanation",
                "source_references": ["case.description"],
            },
            "evidence": [],
            "uncertainty_flags": [],
            "rule_triggers": [],
            "error_code": "",
        }

        with patch.dict("os.environ", {"AI_PIPELINE_URL": "https://external.test/pipeline"}):
            with patch("web.ai_pipeline.submit_case", return_value=expected_response) as mock_submit:
                payload = build_ai_request_payload(self.case)
                result = dispatch_ai_pipeline(payload, "idemp-key-1")
                self.assertEqual(result["model_name"], "external-pipeline")
                self.assertTrue(mock_submit.called)
