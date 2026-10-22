
import logging
from django.db import DatabaseError, transaction
from django.db.models import Q, ProtectedError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.contrib.auth import authenticate, login, logout, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.contrib.auth.models import Group
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST
import json
import os
from pathlib import Path
from .storage import store_medical_report
from .serializers import MedicalReportUploadSerializer
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Case,
    PatientIntake,
    Appointment,
    CaseAttachment,
    ConsentRecord,
    AIResult,
    ClinicianReview,
    CaseActivity,
    IntakeChatMessage,
    ClinicianRegistration,
)
from .serializers import (
    CaseSerializer,
    PatientIntakeSerializer,
    AppointmentSerializer,
    CaseAttachmentSerializer,
    ConsentRecordSerializer,
    AIResultSerializer,
    ClinicianReviewSerializer,
    PatientReviewSerializer,
    PatientAIResultSerializer,
    CaseActivitySerializer,
)
from .permissions import HasValidRole, IsClinician

logger = logging.getLogger(__name__)


def is_clinician(user):
    return user.groups.filter(name="Clinician").exists()


@ensure_csrf_cookie
@require_GET
def current_user(request):
    if not request.user.is_authenticated:
        return JsonResponse({"authenticated": False})
    return JsonResponse({
        "authenticated": True,
        "id": request.user.pk,
        "username": request.user.get_username(),
        "full_name": request.user.get_full_name(),
        "email": request.user.email,
        "role": "pending_clinician" if hasattr(request.user, "clinician_registration") and request.user.clinician_registration.status == "PENDING" else ("admin" if request.user.is_staff else ("clinician" if is_clinician(request.user) else "patient")),
        "approval_status": request.user.clinician_registration.status.lower() if hasattr(request.user, "clinician_registration") else None,
        "is_staff": request.user.is_staff,
    })


@csrf_protect
@require_POST
def patient_registration(request):
    try:
        data = json.loads(request.body or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    username = str(data.get("username", "")).strip()
    full_name = str(data.get("full_name", "")).strip()
    email = str(data.get("email", "")).strip()
    password = data.get("password", "")
    confirmation = data.get("password_confirmation", "")
    errors = {}
    User = get_user_model()
    candidate = User(username=username, email=email, first_name=full_name[:150])
    if not username: errors["username"] = ["Username is required."]
    elif User.objects.filter(username__iexact=username).exists(): errors["username"] = ["This username is already in use."]
    else:
        try: User._meta.get_field("username").clean(username, candidate)
        except DjangoValidationError as exc: errors["username"] = list(exc.messages)
    if not full_name: errors["full_name"] = ["Full name is required."]
    if email and User.objects.filter(email__iexact=email).exists(): errors["email"] = ["This email is already in use."]
    elif email:
        try: validate_email(email)
        except DjangoValidationError as exc: errors["email"] = list(exc.messages)
    if password != confirmation: errors["password_confirmation"] = ["Passwords do not match."]
    if password:
        try: validate_password(password, candidate)
        except DjangoValidationError as exc: errors["password"] = list(exc.messages)
    else: errors["password"] = ["Password is required."]
    account_type = data.get("account_type", "patient")
    if account_type not in ("patient", "clinician"):
        errors["account_type"] = ["Choose patient or clinician registration."]
    elif account_type == "clinician" and not email:
        errors["email"] = ["Email is required for clinician registration."]
    if errors: return JsonResponse(errors, status=400)
    user = User.objects.create_user(username=username, email=email, password=password, first_name=full_name[:150])
    if account_type == "clinician":
        ClinicianRegistration.objects.create(user=user)
        login(request, user)
        return JsonResponse({"authenticated": True, "id": user.pk, "username": username, "full_name": user.get_full_name(), "email": email, "role": "pending_clinician", "approval_status": "pending"}, status=201)
    patient_group, _ = Group.objects.get_or_create(name="Patient")
    user.groups.add(patient_group)
    # Public registration never accepts a role or admin privilege from payload.
    login(request, user)
    return JsonResponse({"authenticated": True, "id": user.pk, "username": username, "full_name": user.get_full_name(), "email": email, "role": "patient"}, status=201)


@csrf_protect
@require_POST
def session_login(request):
    try:
        data = json.loads(request.body or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    user = authenticate(request, username=data.get("username", ""), password=data.get("password", ""))
    if user is None:
        return JsonResponse({"detail": "Invalid username or password."}, status=400)
    registration = getattr(user, "clinician_registration", None)
    if registration and registration.status == ClinicianRegistration.Status.PENDING:
        login(request, user)
        return JsonResponse({"authenticated": True, "id": user.pk, "username": user.get_username(), "full_name": user.get_full_name(), "email": user.email, "role": "pending_clinician", "approval_status": "pending"})
    if registration and registration.status == ClinicianRegistration.Status.REJECTED:
        return JsonResponse({"detail": "This clinician registration was not approved."}, status=403)
    if not user.is_staff and not user.groups.filter(name__in=["Patient", "Clinician"]).exists():
        return JsonResponse({"detail": "This account has no CareFlow role."}, status=403)
    login(request, user)
    return JsonResponse({
        "authenticated": True,
        "id": user.pk,
        "username": user.get_username(),
        "role": "admin" if user.is_staff else ("clinician" if is_clinician(user) else "patient"),
        "is_staff": user.is_staff,
    })


@require_GET
def pending_clinicians(request):
    if not request.user.is_authenticated or not request.user.is_staff:
        return JsonResponse({"detail": "Administrator access required."}, status=403)
    items = ClinicianRegistration.objects.filter(status=ClinicianRegistration.Status.PENDING).select_related("user").order_by("created_at")
    return JsonResponse([{"id": item.id, "user_id": item.user_id, "username": item.user.username, "full_name": item.user.get_full_name(), "email": item.user.email, "created_at": item.created_at} for item in items], safe=False)


@csrf_protect
@require_POST
def review_clinician_registration(request, registration_id):
    if not request.user.is_authenticated or not request.user.is_staff:
        return JsonResponse({"detail": "Administrator access required."}, status=403)
    try:
        data = json.loads(request.body or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse({"detail": "Invalid JSON."}, status=400)
    decision = data.get("decision")
    if decision not in ("approve", "reject"):
        return JsonResponse({"decision": ["Choose approve or reject."]}, status=400)
    registration = get_object_or_404(ClinicianRegistration, pk=registration_id, status=ClinicianRegistration.Status.PENDING)
    registration.status = ClinicianRegistration.Status.APPROVED if decision == "approve" else ClinicianRegistration.Status.REJECTED
    registration.reviewed_by = request.user
    registration.reviewed_at = timezone.now()
    registration.save(update_fields=["status", "reviewed_by", "reviewed_at"])
    if decision == "approve":
        clinician_group, _ = Group.objects.get_or_create(name="Clinician")
        registration.user.groups.add(clinician_group)
    return JsonResponse({"id": registration.id, "status": registration.status.lower()})


@csrf_protect
@require_POST
def session_logout(request):
    logout(request)
    return JsonResponse({"authenticated": False})


@csrf_protect
@require_POST
def transcribe_audio(request):
    if not request.user.is_authenticated:
        return JsonResponse({"detail": "Authentication required."}, status=401)

    audio_file = request.FILES.get("audio") or request.FILES.get("file")
    if not audio_file:
        return JsonResponse({"detail": "No audio file provided."}, status=400)

    if audio_file.size > 25 * 1024 * 1024:
        return JsonResponse({"detail": "Audio file is too large (max 25MB)."}, status=400)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return JsonResponse({"detail": "Speech-to-text service is not configured."}, status=503)

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, timeout=float(os.getenv("AI_PIPELINE_TIMEOUT", "25")))
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=(audio_file.name or "speech.webm", audio_file.read(), audio_file.content_type or "audio/webm"),
        )
        return JsonResponse({"text": transcript.text})
    except Exception as exc:
        logger.exception("Audio transcription failed: %s", exc)
        return JsonResponse({"detail": "Audio transcription failed. Please try again or use text input."}, status=500)


class CaseViewSet(viewsets.ModelViewSet):
    serializer_class = CaseSerializer
    permission_classes = [IsAuthenticated, HasValidRole]

    def get_serializer_class(self):
        if getattr(self, "action", None) == "intake":
            return PatientIntakeSerializer
        return super().get_serializer_class()
  
    def get_queryset(self):
        queryset = Case.objects.select_related(
            "owner", "assigned_clinician"
        )
        if is_clinician(self.request.user):
            queryset = queryset.filter(Q(assigned_clinician=self.request.user) | Q(assigned_clinician__isnull=True))
        else:
            queryset = queryset.filter(owner=self.request.user)

        # Archive filtering: default to active cases (is_archived=False) unless ?archived=true or ?include_archived=true
        if self.action == "unarchive":
            return queryset

        archived_filter = self.request.query_params.get("archived")
        include_archived = self.request.query_params.get("include_archived", "false").lower() == "true"
        if archived_filter is not None:
            queryset = queryset.filter(is_archived=archived_filter.lower() == "true")
        elif not include_archived:
            queryset = queryset.filter(is_archived=False)

        return queryset


    
    @action(detail=True, methods=["post"], url_path="attachments")
    def upload_attachment(self, request, pk=None):
        case = self.get_object()

        if is_clinician(request.user):
            raise PermissionDenied("Only patients can upload reports.")

        if not case.owner_id or case.owner_id != request.user.id:
            raise PermissionDenied("You can only upload reports to your own case.")

        # Require active consent before storing medical information.
        has_consent = ConsentRecord.objects.filter(
            case=case,
            user=request.user,
            granted=True,
            withdrawn_at__isnull=True,
        ).exists()

        if not has_consent:
            raise PermissionDenied("Active consent is required before uploading reports.")

        serializer = MedicalReportUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["file"]

        # Validate file signatures, not only the client-supplied MIME type.
        header = upload.read(8)
        upload.seek(0)

        is_pdf = header.startswith(b"%PDF-")
        is_jpeg = header.startswith(b"\xff\xd8\xff")
        is_png = header.startswith(b"\x89PNG\r\n\x1a\n")

        if not (is_pdf or is_jpeg or is_png):
            raise ValidationError({"file": "File contents do not match an allowed format."})

        stored = store_medical_report(upload)

        attachment = CaseAttachment.objects.create(
            case=case,
            uploaded_by=request.user,
            original_filename=Path(upload.name).name,
            content_type=upload.content_type,
            size_bytes=stored["size_bytes"],
            storage_key=stored["storage_key"],
            sha256=stored["sha256"],
        )

        CaseActivity.objects.create(
            case=case,
            actor=request.user,
            action="ATTACHMENT_UPLOADED",
        )

        return Response(
            CaseAttachmentSerializer(attachment).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        if not is_clinician(request.user):
            raise PermissionDenied("Patients cannot edit cases.")
        if self.get_object().assigned_clinician_id != request.user.id:
            raise PermissionDenied("Assign the case to yourself before editing it.")
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not is_clinician(request.user):
            raise PermissionDenied("Patients cannot edit cases.")
        if self.get_object().assigned_clinician_id != request.user.id:
            raise PermissionDenied("Assign the case to yourself before editing it.")
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        case = self.get_object()

        # Enforce patient ownership or clinician role/assignment permissions
        if is_clinician(request.user):
            if case.assigned_clinician_id not in (None, request.user.id):
                raise PermissionDenied("You cannot delete a case assigned to another clinician.")
        else:
            if case.owner_id != request.user.id:
                raise PermissionDenied("You can only delete your own cases.")

        hard_delete = request.query_params.get("hard", "false").lower() == "true"
        has_protected_records = (
            case.consent_records.exists()
            or case.reviews.exists()
            or case.attachments.exists()
            or case.ai_results.exists()
        )

        if hard_delete and not has_protected_records:
            try:
                case.delete()
                return Response(status=status.HTTP_204_NO_CONTENT)
            except ProtectedError:
                pass  # Fall through to soft deletion / archival

        # Soft deletion / archiving to safely preserve medical records, clinical notes, and audit history
        case.is_archived = True
        case.archived_at = timezone.now()
        case.save(update_fields=["is_archived", "archived_at", "updated_at"])
        CaseActivity.objects.create(
            case=case,
            actor=request.user,
            action="CASE_ARCHIVED",
        )
        return Response({"status": "archived", "id": case.id}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post", "patch"], url_path="archive")
    def archive(self, request, pk=None):
        case = self.get_object()
        if is_clinician(request.user):
            if case.assigned_clinician_id not in (None, request.user.id):
                raise PermissionDenied("You cannot archive a case assigned to another clinician.")
        else:
            if case.owner_id != request.user.id:
                raise PermissionDenied("You can only archive your own cases.")

        case.is_archived = True
        case.archived_at = timezone.now()
        case.save(update_fields=["is_archived", "archived_at", "updated_at"])
        CaseActivity.objects.create(
            case=case,
            actor=request.user,
            action="CASE_ARCHIVED",
        )
        return Response({"status": "archived", "id": case.id})

    @action(detail=True, methods=["post", "patch"], url_path="unarchive")
    def unarchive(self, request, pk=None):
        case = self.get_object()
        if is_clinician(request.user):
            if case.assigned_clinician_id not in (None, request.user.id):
                raise PermissionDenied("You cannot restore a case assigned to another clinician.")
        else:
            if case.owner_id != request.user.id:
                raise PermissionDenied("You can only restore your own cases.")

        case.is_archived = False
        case.archived_at = None
        case.save(update_fields=["is_archived", "archived_at", "updated_at"])
        CaseActivity.objects.create(
            case=case,
            actor=request.user,
            action="CASE_RESTORED",
        )
        return Response({"status": "active", "id": case.id})

    def perform_create(self, serializer):
        if is_clinician(self.request.user):
            raise PermissionDenied("Clinicians cannot create patient cases here.")
        case = serializer.save(owner=self.request.user)
        CaseActivity.objects.create(case=case, actor=self.request.user, action="CASE_SUBMITTED")

    @action(detail=True, methods=["patch"], permission_classes=[IsAuthenticated, IsClinician])
    def assign(self, request, pk=None):
        case = self.get_object()
        clinician_id = request.data.get("clinician_id", request.user.pk)
        from django.contrib.auth import get_user_model
        clinician = get_object_or_404(get_user_model(), pk=clinician_id)
        if not clinician.groups.filter(name="Clinician").exists():
            raise ValidationError({"clinician_id": "The selected user is not a clinician."})
        case.assigned_clinician = clinician
        case.save(update_fields=["assigned_clinician", "updated_at"])
        CaseActivity.objects.create(case=case, actor=request.user, action="CLINICIAN_ASSIGNED")
        return Response(self.get_serializer(case).data)

    @action(detail=True, methods=["post", "patch"], permission_classes=[IsAuthenticated, IsClinician], url_path="set-priority")
    def set_priority(self, request, pk=None):
        case = self.get_object()
        if case.assigned_clinician_id not in (None, request.user.id):
            raise PermissionDenied("This case is assigned to another clinician.")
        if case.assigned_clinician_id is None:
            case.assigned_clinician = request.user

        new_priority = request.data.get("priority")
        if new_priority not in Case.Priority.values:
            raise ValidationError({"priority": f"Invalid priority. Choose from {Case.Priority.values}"})

        rationale = str(request.data.get("rationale", "")).strip()
        is_override = bool(request.data.get("is_override", False))
        if is_override and not rationale:
            raise ValidationError({"rationale": "A rationale is required when overriding the suggested priority."})

        old_priority = case.priority
        case.priority = new_priority
        case.save(update_fields=["priority", "assigned_clinician", "updated_at"])

        action_name = "PRIORITY_OVERRIDDEN" if is_override else "PRIORITY_CONFIRMED"
        CaseActivity.objects.create(
            case=case,
            actor=request.user,
            action=action_name,
            old_status=f"Priority:{old_priority}",
            new_status=f"Priority:{new_priority}" + (f" - {rationale[:40]}" if rationale else ""),
        )
        return Response(self.get_serializer(case).data)

    @action(detail=True, methods=["patch"], permission_classes=[IsAuthenticated, HasValidRole])
    def update_status(self, request, pk=None):
        case = self.get_object()

        if not is_clinician(request.user):
            raise PermissionDenied("Only clinicians can change case status.")
        if case.assigned_clinician_id != request.user.id:
            raise PermissionDenied("Assign the case to yourself before changing its status.")

        new_status = request.data.get("status")
        if new_status not in Case.Status.values:
            raise ValidationError({"status": "Invalid status."})
        if new_status == Case.Status.ESCALATED:
            raise ValidationError({"status": "Use Escalate Case and record a handoff reason."})
        if new_status == Case.Status.NEEDS_INFORMATION:
            raise ValidationError({"status": "Use Request More Information so the patient receives the request."})
        if new_status == Case.Status.APPROVED:
            raise ValidationError({"status": "Use Finalize Review to complete a clinical review."})

        transitions = {
            Case.Status.NEEDS_REVIEW: {Case.Status.IN_REVIEW, Case.Status.NEEDS_INFORMATION, Case.Status.ESCALATED},
            Case.Status.PROCESSING: {Case.Status.NEEDS_REVIEW, Case.Status.IN_REVIEW, Case.Status.NEEDS_INFORMATION, Case.Status.ESCALATED},
            Case.Status.IN_REVIEW: {Case.Status.NEEDS_INFORMATION, Case.Status.ESCALATED, Case.Status.APPROVED},
            Case.Status.NEEDS_INFORMATION: {Case.Status.IN_REVIEW, Case.Status.ESCALATED},
            Case.Status.ESCALATED: {Case.Status.IN_REVIEW},
            Case.Status.APPROVED: set(),
        }

        if new_status not in transitions.get(case.status, []):
            raise ValidationError({
                "status": f"Transition from {case.status} to {new_status} is not allowed."
            })

        old_status = case.status
        with transaction.atomic():
            case.status = new_status
            case.save(update_fields=["status", "updated_at"])
            CaseActivity.objects.create(
                case=case,
                actor=request.user,
                action="STATUS_CHANGED",
                old_status=old_status,
                new_status=new_status,
            )

        return Response(self.get_serializer(case).data)

    @action(detail=True, methods=["get", "put", "patch"])
    def intake(self, request, pk=None):
        case = self.get_object()

        if request.method == "GET":
            if is_clinician(request.user) and case.assigned_clinician_id != request.user.id:
                raise PermissionDenied("Only the assigned clinician can view intake details.")
            intake = PatientIntake.objects.filter(case=case).first()

            if not intake:
                return Response(
                    {"detail": "No intake submitted yet."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            return Response(PatientIntakeSerializer(intake).data)

        if is_clinician(request.user):
            raise PermissionDenied("Patients must submit intake details.")
        if case.owner_id != request.user.id:
            raise PermissionDenied("You can only submit intake for your own case.")

        intake, _ = PatientIntake.objects.get_or_create(case=case)
        serializer = PatientIntakeSerializer(
            intake,
            data=request.data,
            partial=request.method == "PATCH",
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(PatientIntakeSerializer(intake).data)

    @action(detail=True, methods=["get", "post"], url_path="chat")
    def chat(self, request, pk=None):
        from .intake_agent import generate_intake_reply, IntakeAgentUnavailable

        case = self.get_object()
        if request.method == "POST":
            if is_clinician(request.user) or case.owner_id != request.user.id:
                raise PermissionDenied("Only the patient who owns this case can use intake chat.")
        else:
            if is_clinician(request.user):
                if case.assigned_clinician_id not in (None, request.user.id):
                    raise PermissionDenied("You can only view chat history for cases in your triage queue.")
            elif case.owner_id != request.user.id:
                raise PermissionDenied("Only the patient who owns this case can view intake chat history.")

        if request.method == "GET":
            messages = [
                {
                    "role": m.role,
                    "content": m.content,
                    "mode": m.assistant_mode,
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                }
                for m in case.chat_messages.order_by("created_at")
            ]
            if not messages:
                try:
                    intake = getattr(case, "intake", None)
                    if intake and isinstance(intake.original_answers, dict):
                        raw = intake.original_answers.get("chat_messages", [])
                        if isinstance(raw, list):
                            for item in raw:
                                if isinstance(item, dict) and "content" in item:
                                    messages.append({
                                        "role": item.get("role", "patient"),
                                        "content": item["content"],
                                        "created_at": item.get("created_at"),
                                    })
                                elif isinstance(item, str):
                                    messages.append({
                                        "role": "patient",
                                        "content": item,
                                        "created_at": None,
                                    })
                except Exception:
                    pass
            return Response(messages)

        consent_active = case.consent_records.filter(
            user=request.user, granted=True, withdrawn_at__isnull=True
        ).exists()

        if request.data.get("confirm") is True:
            if not consent_active:
                raise PermissionDenied("Active consent is required to confirm intake.")
            intake_data = request.data.get("intake", {})
            intake, _ = PatientIntake.objects.get_or_create(case=case)
            serializer = PatientIntakeSerializer(intake, data=intake_data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save(original_answers={
                **intake.original_answers,
                "chat_messages": list(case.chat_messages.filter(role="patient").values_list("content", flat=True)),
            })
            CaseActivity.objects.create(case=case, actor=request.user, action="INTAKE_CONFIRMED")
            return Response({"confirmed": True, "intake": PatientIntakeSerializer(intake).data})

        if not consent_active:
            raise PermissionDenied("Active consent is required before using the AI intake chat.")

        is_start = request.data.get("start") is True
        message = str(request.data.get("message", "")).strip()
        if not is_start and (not message or len(message) > 4000):
            raise ValidationError({"message": "Enter a message of up to 4000 characters."})

        intake, _ = PatientIntake.objects.get_or_create(case=case)
        prior_messages = list(case.chat_messages.order_by("created_at").values("role", "content"))

        # Starting a chat should be idempotent if the browser retries the request.
        if is_start and prior_messages:
            latest_assistant = next((m for m in reversed(prior_messages) if m["role"] == "assistant"), None)
            if latest_assistant:
                return Response({"mode": "openai_agent", "message": latest_assistant["content"], "safety": "AI intake support only; not a diagnosis or emergency service."})

        try:
            result = generate_intake_reply(
                case=case,
                intake=intake,
                history=prior_messages,
                new_message=message if not is_start else None,
                start=is_start,
            )
        except IntakeAgentUnavailable as exc:
            return Response({"detail": str(exc), "mode": "openai_agent_unavailable"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        # Save patient and assistant messages only after the provider returns a usable reply.
        if not is_start:
            IntakeChatMessage.objects.create(case=case, role="patient", content=message, assistant_mode="openai_agent")

        updates = result.get("intake_updates", {})
        changed_fields = []
        for field, value in updates.items():
            if field == "symptoms" and isinstance(value, list):
                existing = intake.symptoms if isinstance(intake.symptoms, list) else []
                merged = list(dict.fromkeys([*existing, *value]))
                if merged != existing:
                    intake.symptoms = merged
                    changed_fields.append("symptoms")
            elif field in {
                "symptom_onset", "duration", "severity_description", "progression",
                "medical_history", "current_medications", "allergies", "additional_information",
            } and isinstance(value, str) and value.strip() and getattr(intake, field) != value:
                setattr(intake, field, value)
                changed_fields.append(field)
        if changed_fields:
            intake.save(update_fields=list(dict.fromkeys([*changed_fields, "updated_at"])))

        IntakeChatMessage.objects.create(
            case=case,
            role="assistant",
            content=result["message"],
            assistant_mode="openai_agent",
        )
        return Response({
            "mode": "openai_agent",
            "message": result["message"],
            "safety": "AI intake support only; not a diagnosis or emergency service. If this may be an emergency, contact local emergency services now.",
            "intake_updates": changed_fields,
        })

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsClinician])
    def activities(self, request, pk=None):
        case = self.get_object()
        if case.assigned_clinician_id != request.user.id:
            raise PermissionDenied("Only the assigned clinician can view case activity.")
        activities = case.activities.select_related("actor").order_by("-timestamp")
        return Response(CaseActivitySerializer(activities, many=True).data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsClinician])
    def ai_results(self, request, pk=None):
        case = self.get_object()
        if case.assigned_clinician_id not in (None, request.user.id):
            raise PermissionDenied("Only the assigned clinician can view AI results.")
        results = case.ai_results.order_by("-created_at")
        return Response(AIResultSerializer(results, many=True).data)

    @action(detail=True, methods=["get", "post"])
    def consent(self, request, pk=None):
        case = self.get_object()

        if request.method == "GET":
            if is_clinician(request.user):
                if case.assigned_clinician_id != request.user.id:
                    raise PermissionDenied("Only the assigned clinician can view consent details.")
                records = case.consent_records.order_by("-created_at")
            else:
                records = case.consent_records.filter(user=request.user).order_by("-created_at")
            return Response(ConsentRecordSerializer(records, many=True).data)

        if is_clinician(request.user):
            raise PermissionDenied("Consent must be recorded by the patient.")
        if case.owner_id != request.user.id:
            raise PermissionDenied("You can only manage consent for your own case.")

        if request.data.get("granted") is not True:
            raise ValidationError({"granted": "Explicit consent must be true."})

        record = ConsentRecord.objects.create(
            case=case,
            user=request.user,
            purpose=request.data.get("purpose", "CareFlow case processing"),
            notice_version=request.data.get("notice_version", "1.0"),
            granted=True,
            granted_at=timezone.now(),
        )
        CaseActivity.objects.create(case=case, actor=request.user, action="CONSENT_GRANTED")
        return Response(
            ConsentRecordSerializer(record).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, IsClinician])
    def reviews(self, request, pk=None):
        case = self.get_object()
        if case.assigned_clinician_id != request.user.id:
            raise PermissionDenied("Only the assigned clinician can view case reviews.")
        reviews = case.reviews.select_related("reviewer").order_by("-created_at")
        return Response(ClinicianReviewSerializer(reviews, many=True).data)

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, HasValidRole], url_path="patient-review")
    def patient_review(self, request, pk=None):
        case = self.get_object()
        if is_clinician(request.user) or case.owner_id != request.user.id:
            raise PermissionDenied("Only the patient who owns this case can view its review.")
        try:
            latest_review = case.reviews.order_by("-created_at").first()
        except DatabaseError:
            logger.exception("Unable to load patient-visible review for case_id=%s user_id=%s", case.pk, request.user.pk)
            return Response(
                {"status": "error", "detail": "Review information is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if not latest_review:
            return Response({"status": "in_progress", "request": None, "review": None})
        if not latest_review.is_finalized:
            return Response({
                "status": "in_progress",
                "request": latest_review.patient_request or None
                if latest_review.decision == Case.Status.NEEDS_INFORMATION
                else None,
                "review": None,
            })
        return Response({"status": "completed", "review": PatientReviewSerializer(latest_review).data})

    @action(detail=True, methods=["get"], permission_classes=[IsAuthenticated, HasValidRole], url_path="patient-ai-suggestions")
    def patient_ai_suggestions(self, request, pk=None):
        case = self.get_object()
        if is_clinician(request.user) or case.owner_id != request.user.id:
            raise PermissionDenied("Only the patient who owns this case can view its AI suggestions.")
        try:
            result = case.ai_results.order_by("-created_at").first()
        except DatabaseError:
            logger.exception("Unable to load patient AI suggestions for case_id=%s user_id=%s", case.pk, request.user.pk)
            return Response({"status": "error", "detail": "AI suggestions are temporarily unavailable."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if result is None:
            is_configured = bool(os.getenv("AI_PIPELINE_URL", "").strip() or os.getenv("OPENAI_API_KEY", "").strip())
            state = "not_started" if is_configured else "not_configured"
            return Response({"status": state, "result": None})
        if result.status == AIResult.ProcessingStatus.PENDING:
            return Response({"status": "in_progress", "result": None})
        if result.status == AIResult.ProcessingStatus.FAILED:
            return Response({"status": "failed", "result": None})
        if result.status != AIResult.ProcessingStatus.COMPLETED or not result.is_validated:
            return Response({"status": "unavailable", "result": None})
        return Response({"status": "completed", "result": PatientAIResultSerializer(result).data})

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, HasValidRole], url_path="submit-ai")
    def submit_ai(self, request, pk=None):
        case = self.get_object()

        # 1. Require an authenticated patient who owns the case
        if is_clinician(request.user):
            raise PermissionDenied("Only patients can submit their case for AI analysis.")
        if not case.owner_id or case.owner_id != request.user.id:
            raise PermissionDenied("You can only submit AI analysis for your own case.")

        # 2. Verify active consent before sending patient information to external AI service
        has_consent = ConsentRecord.objects.filter(
            case=case,
            user=request.user,
            granted=True,
            withdrawn_at__isnull=True,
        ).exists()
        if not has_consent:
            raise PermissionDenied("Active consent is required before submitting to AI analysis.")

        # 3. Confirm the case and intake are valid and available for processing
        intake = getattr(case, "intake", None)
        if not intake and not (case.description or "").strip():
            raise ValidationError({"detail": "No intake or symptom description available to process."})

        # 4. Check whether AI service is configured
        is_configured = bool(os.getenv("AI_PIPELINE_URL", "").strip() or os.getenv("OPENAI_API_KEY", "").strip())
        if not is_configured:
            return Response(
                {"status": "not_configured", "detail": "AI pipeline service is not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # 5. Idempotency and in-progress duplicate submission protection
        recent_pending = case.ai_results.filter(status=AIResult.ProcessingStatus.PENDING).order_by("-created_at").first()
        if recent_pending:
            age_seconds = (timezone.now() - recent_pending.created_at).total_seconds()
            if age_seconds < 60:
                return Response(
                    {"status": "in_progress", "detail": "AI analysis is already in progress for this case."},
                    status=status.HTTP_409_CONFLICT,
                )

        from .ai_service import (
            build_ai_request_payload,
            dispatch_ai_pipeline,
            AIProcessingError,
            AIServiceUnavailableError,
            AITimeoutError,
            AIRateLimitError,
            AISchemaValidationError,
        )

        payload = build_ai_request_payload(case)
        idempotency_key = request.headers.get("Idempotency-Key") or f"case-{case.pk}-{int(timezone.now().timestamp())}"

        # 6. Create and persist PENDING AIResult before calling the service
        ai_result = AIResult.objects.create(
            case=case,
            status=AIResult.ProcessingStatus.PENDING,
            schema_version="careflow-ai-response/1",
            is_validated=False,
        )
        CaseActivity.objects.create(
            case=case,
            actor=request.user,
            action="AI_ANALYSIS_REQUESTED",
        )

        try:
            response_data = dispatch_ai_pipeline(payload, idempotency_key=idempotency_key)
            ai_result.status = AIResult.ProcessingStatus.COMPLETED
            ai_result.schema_version = response_data.get("schema_version", "careflow-ai-response/1")
            ai_result.model_name = response_data.get("model_name", "gpt-4o-mini")
            ai_result.structured_output = response_data.get("structured_output", {})
            ai_result.evidence = response_data.get("evidence", [])
            ai_result.uncertainty_flags = response_data.get("uncertainty_flags", [])
            ai_result.rule_triggers = response_data.get("rule_triggers", [])
            ai_result.error_code = ""
            ai_result.is_validated = True
            ai_result.save()

            # Assign priority to case based on OpenAI GPT evaluation
            raw_priority = str(ai_result.structured_output.get("suggested_priority", "")).strip().upper()
            priority_map = {
                "RED": Case.Priority.RED,
                "HIGH": Case.Priority.RED,
                "URGENT": Case.Priority.RED,
                "EMERGENCY": Case.Priority.RED,
                "YELLOW": Case.Priority.YELLOW,
                "MEDIUM": Case.Priority.YELLOW,
                "MODERATE": Case.Priority.YELLOW,
                "GREEN": Case.Priority.GREEN,
                "LOW": Case.Priority.GREEN,
                "ROUTINE": Case.Priority.GREEN,
            }
            suggested_priority = priority_map.get(raw_priority)
            if suggested_priority in (Case.Priority.RED, Case.Priority.YELLOW, Case.Priority.GREEN):
                old_priority = case.priority
                case.priority = suggested_priority
                case.save(update_fields=["priority", "updated_at"])
                CaseActivity.objects.create(
                    case=case,
                    actor=request.user,
                    action="AI_PRIORITY_ASSIGNED",
                    old_status=f"Priority:{old_priority}",
                    new_status=f"Priority:{suggested_priority}",
                )

            CaseActivity.objects.create(
                case=case,
                actor=request.user,
                action="AI_ANALYSIS_COMPLETED",
            )
            return Response(PatientAIResultSerializer(ai_result).data, status=status.HTTP_201_CREATED)

        except (AITimeoutError, TimeoutError) as exc:
            logger.warning("AI processing timeout for case %s: %s", case.pk, exc)
            ai_result.status = AIResult.ProcessingStatus.FAILED
            ai_result.is_validated = False
            ai_result.error_code = "TIMEOUT"
            ai_result.save()
            CaseActivity.objects.create(case=case, actor=request.user, action="AI_ANALYSIS_FAILED")
            return Response(
                {"status": "failed", "error_code": "TIMEOUT", "detail": "AI processing timed out. Please try again later."},
                status=status.HTTP_504_GATEWAY_TIMEOUT,
            )

        except AIRateLimitError as exc:
            logger.warning("AI rate limit for case %s: %s", case.pk, exc)
            ai_result.status = AIResult.ProcessingStatus.FAILED
            ai_result.is_validated = False
            ai_result.error_code = "RATE_LIMIT_EXCEEDED"
            ai_result.save()
            CaseActivity.objects.create(case=case, actor=request.user, action="AI_ANALYSIS_FAILED")
            return Response(
                {"status": "failed", "error_code": "RATE_LIMIT_EXCEEDED", "detail": "AI service rate limit reached. Please retry shortly."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )

        except AISchemaValidationError as exc:
            logger.warning("AI schema validation failed for case %s: %s", case.pk, exc)
            ai_result.status = AIResult.ProcessingStatus.FAILED
            ai_result.is_validated = False
            ai_result.error_code = "VALIDATION_FAILED"
            ai_result.save()
            CaseActivity.objects.create(case=case, actor=request.user, action="AI_ANALYSIS_FAILED")
            return Response(
                {"status": "failed", "error_code": "VALIDATION_FAILED", "detail": "AI output failed technical validation."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        except Exception as exc:
            logger.exception("AI processing failed for case %s: %s", case.pk, exc)
            ai_result.status = AIResult.ProcessingStatus.FAILED
            ai_result.is_validated = False
            ai_result.error_code = getattr(exc, "error_code", "SERVICE_UNAVAILABLE")
            ai_result.save()
            CaseActivity.objects.create(case=case, actor=request.user, action="AI_ANALYSIS_FAILED")
            return Response(
                {"status": "failed", "error_code": ai_result.error_code, "detail": "AI analysis service is temporarily unavailable."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, HasValidRole], url_path="ai-triage")
    def ai_triage(self, request, pk=None):
        return self.submit_ai(request, pk=pk)

    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated, IsClinician])
    def add_review(self, request, pk=None):
        case = self.get_object()
        if case.assigned_clinician_id != request.user.id:
            raise PermissionDenied("Assign the case to yourself before reviewing it.")
        serializer = ClinicianReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        action_name = request.data.get("workflow_action", "save_draft")
        if action_name not in {"save_draft", "request_information", "escalate", "finalize"}:
            raise ValidationError({"workflow_action": "Choose a supported review action."})
        is_finalized = action_name == "finalize"
        requested_status = {
            "save_draft": Case.Status.IN_REVIEW,
            "request_information": Case.Status.NEEDS_INFORMATION,
            "escalate": Case.Status.ESCALATED,
            "finalize": Case.Status.APPROVED,
        }[action_name]
        if action_name == "request_information" and not request.data.get("patient_request", "").strip():
            raise ValidationError({"patient_request": "Enter the information request that the patient will see."})
        if action_name == "escalate" and not request.data.get("escalation_reason", "").strip():
            raise ValidationError({"escalation_reason": "Record a reason for escalating this case."})
        if is_finalized and not serializer.validated_data.get("patient_comments", "").strip():
            raise ValidationError({"patient_comments": "Patient-facing comments are required to finalize a review."})
        if is_finalized and serializer.validated_data.get("decision") != ClinicianReview.Decision.APPROVED:
            raise ValidationError({"decision": "Choose the supported completed review outcome before finalizing."})
        if not is_finalized and serializer.validated_data.get("decision") == ClinicianReview.Decision.APPROVED:
            raise ValidationError({"decision": "A completed review outcome can only be saved when finalizing."})
        ai_result = serializer.validated_data.get("ai_result")
        if ai_result and ai_result.case_id != case.pk:
            raise ValidationError({"ai_result": "The AI result must belong to this case."})
        if case.status == Case.Status.APPROVED:
            raise ValidationError({"status": "A finalized case cannot be changed."})
        if requested_status not in {
            Case.Status.NEEDS_REVIEW: {Case.Status.IN_REVIEW, Case.Status.NEEDS_INFORMATION, Case.Status.ESCALATED, Case.Status.APPROVED},
            Case.Status.PROCESSING: {Case.Status.NEEDS_REVIEW, Case.Status.IN_REVIEW, Case.Status.NEEDS_INFORMATION, Case.Status.ESCALATED, Case.Status.APPROVED},
            Case.Status.IN_REVIEW: {Case.Status.IN_REVIEW, Case.Status.NEEDS_INFORMATION, Case.Status.ESCALATED, Case.Status.APPROVED},
            Case.Status.NEEDS_INFORMATION: {Case.Status.IN_REVIEW, Case.Status.NEEDS_INFORMATION, Case.Status.ESCALATED, Case.Status.APPROVED},
            Case.Status.ESCALATED: {Case.Status.IN_REVIEW, Case.Status.ESCALATED, Case.Status.APPROVED},
        }.get(case.status, set()):
            raise ValidationError({"status": f"Transition from {case.status} to {requested_status} is not allowed."})

        with transaction.atomic():
            review = case.reviews.filter(is_finalized=False).order_by("-created_at").first()
            values = serializer.validated_data.copy()
            values.update(
                decision=requested_status,
                case=case,
                reviewer=request.user,
                is_finalized=is_finalized,
                patient_request=request.data.get("patient_request", ""),
                escalation_reason=request.data.get("escalation_reason", ""),
                approved_at=timezone.now() if is_finalized else None,
            )
            if review:
                for field, value in values.items():
                    setattr(review, field, value)
                review.save()
            else:
                review = ClinicianReview.objects.create(**values)
            old_status = case.status
            case.status = requested_status
            update_fields = ["status", "updated_at"]
            if action_name == "escalate":
                # Return the escalated case to the unassigned queue so another
                # clinician can claim the recorded handoff.
                case.assigned_clinician = None
                update_fields.append("assigned_clinician")
            case.save(update_fields=update_fields)
            activity_records = [CaseActivity.objects.create(
                case=case,
                actor=request.user,
                action={"save_draft": "REVIEW_DRAFT_SAVED", "request_information": "INFORMATION_REQUESTED", "escalate": "CASE_ESCALATED", "finalize": "REVIEW_FINALIZED"}[action_name],
                old_status=old_status,
                new_status=requested_status,
            )]
            if action_name == "escalate":
                activity_records.append(CaseActivity.objects.create(
                    case=case,
                    actor=request.user,
                    action="ESCALATION_HANDED_OFF",
                    old_status=old_status,
                    new_status=requested_status,
                ))

        response_data = ClinicianReviewSerializer(review).data
        response_data["case_state"] = {
            "id": case.pk,
            "status": case.status,
            "assigned_clinician": case.assigned_clinician_id,
            "updated_at": case.updated_at,
        }
        response_data["case_activities"] = CaseActivitySerializer(activity_records, many=True).data
        return Response(response_data, status=status.HTTP_201_CREATED)


class AppointmentViewSet(viewsets.ModelViewSet):
    serializer_class = AppointmentSerializer
    permission_classes = [IsAuthenticated, HasValidRole]

    def get_queryset(self):
        user = self.request.user
        queryset = Appointment.objects.select_related("patient", "clinician", "case")
        if is_clinician(user):
            return queryset.filter(Q(clinician=user) | Q(clinician__isnull=True))
        return queryset.filter(patient=user)

    def perform_create(self, serializer):
        if is_clinician(self.request.user):
            raise PermissionDenied("Patients create appointment requests.")
        case = serializer.validated_data.get("case")
        if case and case.owner_id != self.request.user.id:
            raise PermissionDenied("You can only request appointments for your own case.")
        serializer.save(patient=self.request.user, clinician=None, status="REQUESTED")

    def update(self, request, *args, **kwargs):
        if not is_clinician(request.user):
            raise PermissionDenied("Only clinicians can update appointment requests.")
        appointment = self.get_object()
        if appointment.clinician_id not in (None, request.user.id):
            raise PermissionDenied("This appointment belongs to another clinician.")
        if request.data.get("clinician") not in (None, str(request.user.pk), request.user.pk):
            raise ValidationError({"clinician": "An appointment can only be assigned to you."})
        response = super().update(request, *args, **kwargs)
        if appointment.clinician_id is None:
            appointment.clinician = request.user
            appointment.save(update_fields=["clinician"])
            response.data["clinician"] = request.user.pk
        return response

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)


class CaseAttachmentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = CaseAttachmentSerializer
    permission_classes = [IsAuthenticated, HasValidRole]

    def get_queryset(self):
        user = self.request.user
        queryset = CaseAttachment.objects.select_related(
            "case", "uploaded_by"
        )

        if is_clinician(user):
            return queryset.filter(case__assigned_clinician=user)

        return queryset.filter(case__owner=user)


class ConsentRecordViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ConsentRecordSerializer
    permission_classes = [IsAuthenticated, HasValidRole]

    def get_queryset(self):
        queryset = ConsentRecord.objects.select_related("case", "user")
        if is_clinician(self.request.user):
            return queryset.filter(case__assigned_clinician=self.request.user)
        return queryset.filter(user=self.request.user)

    @action(detail=True, methods=["post"])
    def withdraw(self, request, pk=None):
        record = self.get_object()

        if record.user_id != request.user.id:
            raise PermissionDenied("Only the consenting user can withdraw consent.")

        if record.withdrawn_at is None:
            record.withdrawn_at = timezone.now()
            record.save(update_fields=["withdrawn_at"])
            CaseActivity.objects.create(case=record.case, actor=request.user, action="CONSENT_WITHDRAWN")

        return Response(ConsentRecordSerializer(record).data)


class ClinicianReviewViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ClinicianReviewSerializer
    permission_classes = [IsAuthenticated, IsClinician]

    def get_queryset(self):
        return ClinicianReview.objects.select_related("case", "reviewer", "ai_result").filter(case__assigned_clinician=self.request.user)


class AIResultViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = AIResultSerializer
    permission_classes = [IsAuthenticated, IsClinician]

    def get_queryset(self):
        return AIResult.objects.select_related("case").filter(
            Q(case__assigned_clinician=self.request.user) | Q(case__assigned_clinician__isnull=True)
        ).order_by("-created_at")
