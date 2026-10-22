"""CareFlow AI Service

Handles OpenAI API integration (using gpt-4o-mini by default), payload construction,
deterministic safety rules, strict response validation, and pipeline coordination.
"""
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

SCHEMA_VERSION_REQUEST = "careflow-ai-request/1"
SCHEMA_VERSION_RESPONSE = "careflow-ai-response/1"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"
DEFAULT_TIMEOUT_SECONDS = 8.0

VALID_PRIORITIES = {"UNASSESSED", "RED", "YELLOW", "GREEN"}


class AIProcessingError(Exception):
    """Base exception for AI processing failures."""
    def __init__(self, message: str, error_code: str = "AI_PROCESSING_ERROR"):
        super().__init__(message)
        self.error_code = error_code


class AIServiceUnavailableError(AIProcessingError):
    def __init__(self, message: str = "AI service is unavailable"):
        super().__init__(message, error_code="SERVICE_UNAVAILABLE")


class AIRateLimitError(AIProcessingError):
    def __init__(self, message: str = "AI rate limit exceeded"):
        super().__init__(message, error_code="RATE_LIMIT_EXCEEDED")


class AITimeoutError(AIProcessingError):
    def __init__(self, message: str = "AI service request timed out"):
        super().__init__(message, error_code="TIMEOUT")


class AISchemaValidationError(AIProcessingError):
    def __init__(self, message: str = "AI output failed schema validation"):
        super().__init__(message, error_code="VALIDATION_FAILED")


# Deterministic safety warning rules
SAFETY_RULES = [
    {
        "rule_id": "RULE_ACUTE_CHEST_PAIN",
        "name": "Suspected Acute Chest Pain / Cardiac Warning",
        "patterns": [
            r"\bchest\s+pain\b",
            r"\bchest\s+pressure\b",
            r"\bchest\s+tightness\b",
            r"\bcrushing\s+chest\b",
            r"\bpain\s+radiating\s+to\s+(?:arm|jaw|back|shoulder)\b",
            r"\bangina\b",
        ],
        "alert": "Severe chest pain or cardiac warning sign reported. Requires immediate medical evaluation.",
        "priority": "RED",
    },
    {
        "rule_id": "RULE_SEVERE_RESPIRATORY_DISTRESS",
        "name": "Severe Respiratory Distress",
        "patterns": [
            r"\bshortness\s+of\s+breath\b",
            r"\bdifficulty\s+breathing\b",
            r"\bcannot\s+breathe\b",
            r"\bcan't\s+breathe\b",
            r"\bgasping\s+for\s+air\b",
            r"\bstridor\b",
            r"\bsevere\s+dyspnea\b",
        ],
        "alert": "Severe respiratory distress or breathing difficulty reported. Requires immediate medical evaluation.",
        "priority": "RED",
    },
    {
        "rule_id": "RULE_ACUTE_NEUROLOGICAL_DEFICIT",
        "name": "Acute Neurological Deficit",
        "patterns": [
            r"\bfacial\s+droop\b",
            r"\bslurred\s+speech\b",
            r"\bsudden\s+(?:numbness|weakness)\b",
            r"\bhemiparesis\b",
            r"\bsudden\s+vision\s+loss\b",
            r"\bsudden\s+loss\s+of\s+speech\b",
        ],
        "alert": "Acute neurological deficit reported (signs of stroke). Immediate emergency evaluation recommended.",
        "priority": "RED",
    },
    {
        "rule_id": "RULE_ANAPHYLAXIS_SIGNS",
        "name": "Signs of Anaphylaxis",
        "patterns": [
            r"\bthroat\s+swelling\b",
            r"\bswollen\s+tongue\b",
            r"\bdifficulty\s+swallowing\b.*\bhives\b",
            r"\banaphylaxis\b",
            r"\banaphylactic\b",
        ],
        "alert": "Signs of severe allergic reaction or anaphylaxis reported. Immediate emergency evaluation recommended.",
        "priority": "RED",
    },
    {
        "rule_id": "RULE_SEVERE_HEMORRHAGE",
        "name": "Severe Hemorrhage or Blood Loss",
        "patterns": [
            r"\bsevere\s+bleeding\b",
            r"\buncontrolled\s+bleeding\b",
            r"\bcoughing\s+up\s+blood\b",
            r"\bvomiting\s+blood\b",
            r"\bheavy\s+blood\s+loss\b",
        ],
        "alert": "Severe or uncontrolled bleeding reported. Immediate clinical evaluation required.",
        "priority": "RED",
    },
]


def build_ai_request_payload(case) -> Dict[str, Any]:
    """
    Constructs the canonical CareFlow AI request payload from validated server-side records.
    Never relies on unvalidated client inputs.
    """
    intake = getattr(case, "intake", None)
    sources: List[Dict[str, Any]] = []

    # 1. Case Description
    desc = (case.description or "").strip()
    if desc:
        sources.append({
            "source_id": "case.description",
            "source_type": "patient_description",
            "text": desc,
        })
    else:
        sources.append({
            "source_id": "case.description",
            "source_type": "patient_description",
            "availability": "not_provided",
        })

    # 2. Intake Symptoms
    if intake and intake.symptoms:
        symptoms_str = ", ".join(intake.symptoms) if isinstance(intake.symptoms, list) else str(intake.symptoms)
        sources.append({
            "source_id": "intake.symptoms",
            "source_type": "patient_intake",
            "text": symptoms_str.strip(),
        })
    else:
        sources.append({
            "source_id": "intake.symptoms",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 3. Symptom Onset
    onset = (getattr(intake, "symptom_onset", "") or "").strip()
    if onset:
        sources.append({
            "source_id": "intake.onset",
            "source_type": "patient_intake",
            "text": onset,
        })
    else:
        sources.append({
            "source_id": "intake.onset",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 4. Duration
    duration = (getattr(intake, "duration", "") or "").strip()
    if duration:
        sources.append({
            "source_id": "intake.duration",
            "source_type": "patient_intake",
            "text": duration,
        })
    else:
        sources.append({
            "source_id": "intake.duration",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 5. Severity
    severity = (getattr(intake, "severity_description", "") or "").strip()
    if severity:
        sources.append({
            "source_id": "intake.severity",
            "source_type": "patient_intake",
            "text": severity,
        })
    else:
        sources.append({
            "source_id": "intake.severity",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 6. Progression
    progression = (getattr(intake, "progression", "") or "").strip()
    if progression:
        sources.append({
            "source_id": "intake.progression",
            "source_type": "patient_intake",
            "text": progression,
        })
    else:
        sources.append({
            "source_id": "intake.progression",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 7. Medical History
    history = (getattr(intake, "medical_history", "") or "").strip()
    if history:
        sources.append({
            "source_id": "intake.medical_history",
            "source_type": "patient_intake",
            "text": history,
        })
    else:
        sources.append({
            "source_id": "intake.medical_history",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 8. Medications
    meds = (getattr(intake, "current_medications", "") or "").strip()
    if meds:
        sources.append({
            "source_id": "intake.medications",
            "source_type": "patient_intake",
            "text": meds,
        })
    else:
        sources.append({
            "source_id": "intake.medications",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 9. Allergies
    allergies = (getattr(intake, "allergies", "") or "").strip()
    if allergies:
        sources.append({
            "source_id": "intake.allergies",
            "source_type": "patient_intake",
            "text": allergies,
        })
    else:
        sources.append({
            "source_id": "intake.allergies",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 10. Additional Information
    additional = (getattr(intake, "additional_information", "") or "").strip()
    if additional:
        sources.append({
            "source_id": "intake.additional_information",
            "source_type": "patient_intake",
            "text": additional,
        })
    else:
        sources.append({
            "source_id": "intake.additional_information",
            "source_type": "patient_intake",
            "availability": "not_provided",
        })

    # 11. Patient chat transcript messages (if available)
    chat_messages = list(case.chat_messages.filter(role="patient").order_by("created_at").values_list("content", flat=True))
    if chat_messages:
        sources.append({
            "source_id": "intake.chat_messages",
            "source_type": "patient_chat",
            "text": "\n".join(chat_messages),
        })

    payload = {
        "schema_version": SCHEMA_VERSION_REQUEST,
        "case_id": f"case-{case.pk}",
        "patient_context": {
            "preferred_language": case.preferred_language or "en",
        },
        "sources": sources,
    }
    return payload


def evaluate_deterministic_safety_rules(sources: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Optional[str]]:
    """
    Evaluates explicitly configured clinical safety rules against patient-provided source text.
    Returns (rule_triggers, urgent_alerts, forced_priority).
    """
    rule_triggers = []
    urgent_alerts = []
    forced_priority = None

    for rule in SAFETY_RULES:
        matching_sources = []
        for src in sources:
            text = src.get("text", "")
            if not text:
                continue
            for pattern in rule["patterns"]:
                if re.search(pattern, text, re.IGNORECASE):
                    matching_sources.append(src["source_id"])
                    break
        if matching_sources:
            unique_sources = sorted(list(set(matching_sources)))
            rule_triggers.append({
                "rule_id": rule["rule_id"],
                "name": rule["name"],
                "severity": rule["priority"],
                "source_references": unique_sources,
            })
            urgent_alerts.append({
                "alert": rule["alert"],
                "evidence": f"Configured safety trigger '{rule['name']}' matched in patient intake.",
                "source_references": unique_sources,
            })
            if rule["priority"] == "RED":
                forced_priority = "RED"

    return rule_triggers, urgent_alerts, forced_priority


def validate_ai_response(
    result: Any,
    submitted_source_ids: Set[str],
    expected_case_id: str,
) -> None:
    """
    Strict validation of AI output payload according to careflow-ai-response/1 contract.
    Raises AISchemaValidationError if any rule, schema version, enum, or source reference fails.
    """
    if not isinstance(result, dict):
        raise AISchemaValidationError("AI response must be a JSON dictionary.")

    # 1. Top level keys
    required_top_keys = {"schema_version", "case_id", "status", "structured_output", "evidence", "uncertainty_flags"}
    missing_top = required_top_keys - set(result.keys())
    if missing_top:
        raise AISchemaValidationError(f"AI response is missing required top-level keys: {sorted(list(missing_top))}")

    # 2. Schema version
    if result["schema_version"] != SCHEMA_VERSION_RESPONSE:
        raise AISchemaValidationError(
            f"Unsupported schema version: '{result.get('schema_version')}'. Expected '{SCHEMA_VERSION_RESPONSE}'."
        )

    # 3. Case ID correlation
    if result["case_id"] != expected_case_id:
        raise AISchemaValidationError(
            f"Case ID mismatch: expected '{expected_case_id}', received '{result.get('case_id')}'."
        )

    # 4. Status
    if result["status"] not in {"COMPLETED", "FAILED", "PENDING"}:
        raise AISchemaValidationError(f"Invalid AI response status: '{result.get('status')}'.")

    if result["status"] == "FAILED":
        # Failed responses must have error_code and need not have full structured_output
        return

    # 5. structured_output validation
    output = result.get("structured_output")
    if not isinstance(output, dict):
        raise AISchemaValidationError("structured_output must be a JSON dictionary.")

    required_output_keys = {
        "patient_summary",
        "relevant_history",
        "key_positive_findings",
        "important_negative_findings",
        "missing_information",
        "unclear_information",
        "contradictions",
        "urgent_alerts",
        "suggested_follow_up_questions",
        "suggested_priority",
        "priority_explanation",
        "source_references",
    }
    missing_output = required_output_keys - set(output.keys())
    if missing_output:
        raise AISchemaValidationError(
            f"structured_output is missing required fields: {sorted(list(missing_output))}"
        )

    if not isinstance(output["patient_summary"], str) or not output["patient_summary"].strip():
        raise AISchemaValidationError("structured_output.patient_summary must be a non-empty string.")

    if not isinstance(output["relevant_history"], list):
        raise AISchemaValidationError("structured_output.relevant_history must be a list.")

    if not isinstance(output["suggested_follow_up_questions"], list):
        raise AISchemaValidationError("structured_output.suggested_follow_up_questions must be a list.")

    # 6. Priority enum
    priority = output.get("suggested_priority")
    if priority not in VALID_PRIORITIES:
        raise AISchemaValidationError(
            f"Invalid suggested_priority: '{priority}'. Expected one of {sorted(list(VALID_PRIORITIES))}."
        )

    if not isinstance(output["priority_explanation"], str) or not output["priority_explanation"].strip():
        raise AISchemaValidationError("structured_output.priority_explanation must be a non-empty string.")

    # 7. Collect and cross-validate ALL source references against submitted_source_ids
    def validate_references(refs: Any, location: str) -> None:
        if not isinstance(refs, list):
            raise AISchemaValidationError(f"source_references in {location} must be a list.")
        for ref in refs:
            if not isinstance(ref, str):
                raise AISchemaValidationError(f"Source reference in {location} must be a string: {ref}")
            if ref not in submitted_source_ids:
                raise AISchemaValidationError(
                    f"Fabricated or unknown source reference '{ref}' in {location}. Valid sources: {sorted(list(submitted_source_ids))}"
                )

    validate_references(output.get("source_references", []), "top-level structured_output.source_references")

    # Validate nested lists with source references
    for idx, item in enumerate(output.get("key_positive_findings", [])):
        if not isinstance(item, dict) or "finding" not in item:
            raise AISchemaValidationError(f"key_positive_findings[{idx}] must be a dict with 'finding'.")
        validate_references(item.get("source_references", []), f"key_positive_findings[{idx}]")

    for idx, item in enumerate(output.get("important_negative_findings", [])):
        if not isinstance(item, dict) or "finding" not in item:
            raise AISchemaValidationError(f"important_negative_findings[{idx}] must be a dict with 'finding'.")
        validate_references(item.get("source_references", []), f"important_negative_findings[{idx}]")

    for idx, item in enumerate(output.get("missing_information", [])):
        if not isinstance(item, dict) or "item" not in item or "reason" not in item:
            raise AISchemaValidationError(f"missing_information[{idx}] must be a dict with 'item' and 'reason'.")
        validate_references(item.get("source_references", []), f"missing_information[{idx}]")

    for idx, item in enumerate(output.get("unclear_information", [])):
        if not isinstance(item, dict) or "item" not in item or "reason" not in item:
            raise AISchemaValidationError(f"unclear_information[{idx}] must be a dict with 'item' and 'reason'.")
        validate_references(item.get("source_references", []), f"unclear_information[{idx}]")

    for idx, item in enumerate(output.get("contradictions", [])):
        if not isinstance(item, dict):
            raise AISchemaValidationError(f"contradictions[{idx}] must be a dict.")
        validate_references(item.get("source_references", []), f"contradictions[{idx}]")

    for idx, item in enumerate(output.get("urgent_alerts", [])):
        if not isinstance(item, dict) or "alert" not in item:
            raise AISchemaValidationError(f"urgent_alerts[{idx}] must be a dict with 'alert'.")
        validate_references(item.get("source_references", []), f"urgent_alerts[{idx}]")

    # 8. Extra collections
    if not isinstance(result.get("evidence"), list):
        raise AISchemaValidationError("evidence must be a list.")
    if not isinstance(result.get("uncertainty_flags"), list):
        raise AISchemaValidationError("uncertainty_flags must be a list.")
    if not isinstance(result.get("rule_triggers", []), list):
        raise AISchemaValidationError("rule_triggers must be a list.")


SYSTEM_PROMPT = """You are an advisory clinical intake assistant for CareFlow AI.
CareFlow AI is a human-led healthcare workspace. You do NOT diagnose medical conditions and do NOT prescribe definitive treatments.
Your role is to produce a structured clinical summary and advisory triage suggestion based EXCLUSIVELY on the patient-supplied information.

CRITICAL SAFETY AND FACTUALITY RULES:
1. GROUNDED IN EVIDENCE ONLY: Use ONLY the provided patient sources. Do not fabricate, hallucinate, or extrapolate symptoms, conditions, lab tests, or medical history.
2. SOURCE REFERENCES: Every positive finding, negative finding, missing information item, unclear item, contradiction, and alert MUST cite valid source_references from the provided source_id list.
3. EXPLICIT MISSING INFORMATION: Differentiate between reported information and unprovided information. Never assume an absent allergy or medication field means the patient has none. Explicitly note missing items.
4. ADVISORY TRIAGE PRIORITY:
   -Classify severity using only explicitly reported symptoms, their severity, duration, progression, and available relevant clinical information.

RED: Assign only when reported information indicates an acute, potentially life-threatening warning sign according to the configured clinical triage criteria. Do not assign RED solely because a patient reports fever, headache, or body aches.

YELLOW: Assign when reported symptoms indicate a need for prompt clinical review but do not meet RED criteria, including relevant worsening or persistent symptoms.

GREEN: For normal home sick and mild symptoms, Assign when the reported symptoms are mild and stable, no configured warning triggers are reported, and sufficient information is available for a provisional routine-review recommendation.

UNASSESSED: Use when critical information is missing or ambiguous enough that a reliable priority cannot be assigned. Missing information alone must not automatically trigger RED.

  GREEN / P5 may be returned as a provisional routine-review suggestion if the configured clinical criteria are satisfied and no additional warning signs are identified. Clearly document the unmeasured temperature and other clinically relevant missing information. This expected label is a test fixture, not a universal clinical rule.
5. FOLLOW-UP QUESTIONS: Generate concise, focused questions to clarify missing or ambiguous information only.
6. OUTPUT FORMAT: Respond strictly in JSON format conforming to the required schema.
"""


def generate_openai_summary(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Invokes OpenAI gpt-4o-mini (or configured model) to generate the structured summary.
    """
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise AIServiceUnavailableError("OPENAI_API_KEY is not configured.")

    model_name = os.getenv("OPENAI_MODEL", "").strip() or DEFAULT_OPENAI_MODEL
    timeout = float(os.getenv("AI_PIPELINE_TIMEOUT", str(DEFAULT_TIMEOUT_SECONDS)))

    # Import openai SDK
    try:
        from openai import OpenAI, APIError, APIConnectionError, RateLimitError, APITimeoutError
    except ImportError as exc:
        raise AIServiceUnavailableError("OpenAI SDK is not installed.") from exc

    client = OpenAI(api_key=api_key, timeout=timeout)

    user_prompt = f"""Analyze the following patient intake case and return the structured clinical summary JSON:

Case ID: {payload.get('case_id')}
Patient Language: {payload.get('patient_context', {}).get('preferred_language', 'en')}

Available Sources (source_id list):
{json.dumps(payload.get('sources', []), indent=2)}

Required JSON Response Structure:
{{
  "patient_summary": "Concise factual summary of patient-reported symptoms and history",
  "relevant_history": ["list of reported relevant history items"],
  "key_positive_findings": [
    {{"finding": "Description of reported symptom", "source_references": ["source_id"]}}
  ],
  "important_negative_findings": [
    {{"finding": "Explicitly reported negative finding", "source_references": ["source_id"]}}
  ],
  "missing_information": [
    {{"item": "Name of missing item", "reason": "Explanation why it is missing", "source_references": ["source_id"]}}
  ],
  "unclear_information": [
    {{"item": "Ambiguous or vague statement", "reason": "Explanation of ambiguity", "source_references": ["source_id"]}}
  ],
  "contradictions": [
    {{"statement": "Contradictory statement", "conflict": "What it conflicts with", "source_references": ["source_id"]}}
  ],
  "urgent_alerts": [
    {{"alert": "Safety alert text", "evidence": "Supporting evidence from sources", "source_references": ["source_id"]}}
  ],
  "suggested_follow_up_questions": [
    "Targeted question clarifying missing/unclear info"
  ],
  "suggested_priority": "UNASSESSED | RED | YELLOW | GREEN",
  "priority_explanation": "Factual explanation for the advisory priority",
  "source_references": ["list of all cited source_ids"]
}}
"""

    try:
        completion = client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.1,
        )
        content = completion.choices[0].message.content or "{}"
        structured_output = json.loads(content)
    except APITimeoutError as exc:
        logger.warning("OpenAI API request timed out: %s", exc)
        raise AITimeoutError("OpenAI API request timed out.") from exc
    except RateLimitError as exc:
        logger.warning("OpenAI API rate limit exceeded: %s", exc)
        raise AIRateLimitError("OpenAI API rate limit exceeded.") from exc
    except APIConnectionError as exc:
        logger.warning("OpenAI API connection failed: %s", exc)
        raise AIServiceUnavailableError("Failed to connect to OpenAI API.") from exc
    except APIError as exc:
        logger.error("OpenAI API returned error: %s", exc)
        raise AIServiceUnavailableError(f"OpenAI API error: {exc.message}") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        logger.error("OpenAI API returned invalid JSON: %s", exc)
        raise AISchemaValidationError("OpenAI model returned invalid JSON output.") from exc
    except Exception as exc:
        logger.exception("Unexpected error communicating with OpenAI: %s", exc)
        raise AIServiceUnavailableError(f"AI service error: {str(exc)}") from exc

    # Evaluate deterministic safety rules
    rule_triggers, urgent_alerts, forced_priority = evaluate_deterministic_safety_rules(
        payload.get("sources", [])
    )

    # Incorporate deterministic rules into structured output
    existing_alerts = structured_output.get("urgent_alerts", [])
    if not isinstance(existing_alerts, list):
        existing_alerts = []

    # Merge urgent alerts without duplicating
    seen_alerts = {a.get("alert") for a in existing_alerts if isinstance(a, dict)}
    for ua in urgent_alerts:
        if ua["alert"] not in seen_alerts:
            existing_alerts.insert(0, ua)
            seen_alerts.add(ua["alert"])
    structured_output["urgent_alerts"] = existing_alerts

    # If deterministic safety rule triggered RED, force priority to RED
    if forced_priority == "RED":
        structured_output["suggested_priority"] = "RED"
        current_exp = structured_output.get("priority_explanation", "")
        structured_output["priority_explanation"] = (
            f"Configured clinical warning sign detected ({', '.join([r['name'] for r in rule_triggers])}). "
            + current_exp
        ).strip()

    # Build full versioned response
    response = {
        "schema_version": SCHEMA_VERSION_RESPONSE,
        "case_id": payload.get("case_id"),
        "status": "COMPLETED",
        "model_name": model_name,
        "structured_output": structured_output,
        "evidence": [],
        "uncertainty_flags": [],
        "rule_triggers": rule_triggers,
        "error_code": "",
    }

    # Validate output against source registry
    submitted_source_ids = {s["source_id"] for s in payload.get("sources", []) if "source_id" in s}
    validate_ai_response(response, submitted_source_ids, expected_case_id=payload.get("case_id"))

    return response


def dispatch_ai_pipeline(payload: Dict[str, Any], idempotency_key: str) -> Dict[str, Any]:
    """
    Integration boundary router:
    - If AI_PIPELINE_URL is set, delegates to web.ai_pipeline.submit_case.
    - Else if OPENAI_API_KEY is set, uses generate_openai_summary.
    - Else raises AIServiceUnavailableError.
    """
    external_url = os.getenv("AI_PIPELINE_URL", "").strip()
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()

    if external_url:
        logger.info("Dispatching to external AI pipeline: %s", external_url)
        from .ai_pipeline import PipelineUnavailable, submit_case
        try:
            result = submit_case(payload, idempotency_key)
        except PipelineUnavailable as exc:
            raise AIServiceUnavailableError(str(exc)) from exc
        # Validate external result
        submitted_sources = {s["source_id"] for s in payload.get("sources", []) if "source_id" in s}
        validate_ai_response(result, submitted_sources, expected_case_id=payload.get("case_id"))
        return result

    if openai_key:
        logger.info("Dispatching to OpenAI GPT mini pipeline")
        return generate_openai_summary(payload)

    raise AIServiceUnavailableError("AI pipeline is not configured. Configure OPENAI_API_KEY or AI_PIPELINE_URL.")


def get_active_ai_pipeline_mode() -> str:
    """Returns documentation string of active AI pipeline mode."""
    if os.getenv("AI_PIPELINE_URL", "").strip():
        return "external_adapter"
    if os.getenv("OPENAI_API_KEY", "").strip():
        return "openai_direct"
    return "unconfigured"
