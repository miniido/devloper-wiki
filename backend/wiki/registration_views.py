from io import BytesIO
import time
import unicodedata

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password, identify_hasher, is_password_usable
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import DatabaseError, IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac
from django.views.decorators.debug import sensitive_variables
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import ParseError, PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from .models import RegistrationRequest
from .user_management_views import is_manager

User = get_user_model()
COMPLETE_MESSAGE = "회원가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다."


class CsrfRequiredSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        # DRF 기본 SessionAuthentication과 달리 익명 POST에도 CSRF를 검사한다.
        self.enforce_csrf(request)
        return super().authenticate(request)


class RegistrationJSONParser(JSONParser):
    def parse(self, stream, media_type=None, parser_context=None):
        body = stream.read(16 * 1024 + 1)
        if len(body) > 16 * 1024:
            raise ParseError("신청 내용이 너무 큽니다.")
        return super().parse(BytesIO(body), media_type, parser_context)


class RegistrationThrottle(BaseThrottle):
    def allow_request(self, request, view):
        try:
            return self.check_limits(request)
        except Exception:
            # 제한 저장소 장애 시 공개 요청을 무제한 허용하지 않는다.
            self.retry_after = 60
            return False

    def check_limits(self, request):
        now = time.time()
        # 임의 X-Forwarded-For를 신뢰하지 않는다. 주소는 DB에 보관하지 않는다.
        address = request.META.get("REMOTE_ADDR", "unknown")
        identity = salted_hmac("registration-throttle", address).hexdigest()
        self.retry_after = 0
        for duration, limit in ((3600, getattr(settings, "REGISTRATION_REQUESTS_PER_HOUR", 5)),
                                (86400, getattr(settings, "REGISTRATION_REQUESTS_PER_DAY", 20))):
            window = int(now // duration)
            key = f"registration:{identity}:{duration}:{window}"
            expiry = duration - int(now % duration) + 1
            if cache.add(key, 1, timeout=expiry):
                count = 1
            else:
                try:
                    count = cache.incr(key)
                except ValueError:  # 만료 경계에서 키가 사라지면 새 창으로 계산한다.
                    if cache.add(key, 1, timeout=expiry):
                        count = 1
                    else:
                        count = cache.incr(key)
            if count > limit:
                self.retry_after = expiry
                return False
        return True

    def wait(self):
        return self.retry_after


class RegistrationInput(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
    password_confirm = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
    reason = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")

    def to_internal_value(self, data):
        if isinstance(data, dict):
            if set(data) - set(self.fields):
                raise ValidationError({"detail": "지원하지 않는 입력 항목입니다."})
            if any(not isinstance(value, str) for value in data.values()):
                raise ValidationError({"detail": "입력 항목은 문자열이어야 합니다."})
        return super().to_internal_value(data)

    @sensitive_variables()
    def validate(self, attrs):
        for field, value in attrs.items():
            permitted = "\n\r\t" if field == "reason" else ""
            if any(unicodedata.category(char) in ("Cc", "Cs") and char not in permitted for char in value):
                raise ValidationError({field: "허용되지 않는 문자가 포함되어 있습니다."})
        attrs["username"] = User.normalize_username(attrs["username"])
        try:
            User._meta.get_field("username").run_validators(attrs["username"])
        except DjangoValidationError as exc:
            raise ValidationError({"username": exc.messages})
        if not constant_time_compare(attrs["password"], attrs["password_confirm"]):
            raise ValidationError({"password_confirm": "비밀번호 확인이 일치하지 않습니다."})
        candidate = User(username=attrs["username"], first_name=attrs["first_name"], last_name=attrs["last_name"])
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as exc:
            raise ValidationError({"password": exc.messages})
        return attrs


class RegistrationRequestView(APIView):
    authentication_classes = [CsrfRequiredSessionAuthentication]
    permission_classes = [AllowAny]
    parser_classes = [RegistrationJSONParser]
    throttle_classes = [RegistrationThrottle]

    @sensitive_variables()
    def post(self, request):
        serializer = RegistrationInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        # 중복 여부와 무관하게 같은 해시 작업/응답을 사용한다.
        encoded = make_password(data.pop("password"))
        data.pop("password_confirm")
        try:
            with transaction.atomic():
                if not User.objects.filter(username=data["username"]).exists():
                    RegistrationRequest.objects.get_or_create(
                        username=data["username"], status=RegistrationRequest.Status.PENDING,
                        defaults={**{key: value for key, value in data.items() if key != "username"}, "password_hash": encoded},
                    )
        except IntegrityError:
            # 동시 신청의 unique 충돌에도 공개 응답으로 계정/신청 존재 여부를 노출하지 않는다.
            pass
        except DatabaseError:
            return Response({"detail": "현재 신청을 접수할 수 없습니다. 잠시 후 다시 시도해 주세요."}, status=503)
        return Response({"detail": COMPLETE_MESSAGE}, status=202)


def registration_data(item):
    return {
        "id": item.pk, "username": item.username, "first_name": item.first_name,
        "last_name": item.last_name, "reason": item.reason, "status": item.status,
        "requested_at": item.requested_at, "reviewed_at": item.reviewed_at,
        "reviewed_by": item.reviewed_by.get_username() if item.reviewed_by else None,
    }


def require_manager(user):
    if not is_manager(user):
        raise PermissionDenied("가입 신청 관리 권한이 없습니다.")


class RegistrationPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = "page_size"
    max_page_size = 100


class RegistrationManagementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_manager(request.user)
        status = request.query_params.get("status", "PENDING")
        if status not in (*RegistrationRequest.Status.values, "ALL"):
            raise ValidationError({"detail": "올바르지 않은 신청 상태입니다."})
        queryset = RegistrationRequest.objects.select_related("reviewed_by").defer("password_hash")
        if status != "ALL":
            queryset = queryset.filter(status=status)
        paginator = RegistrationPagination()
        items = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response([registration_data(item) for item in items])


class RegistrationReviewView(APIView):
    permission_classes = [IsAuthenticated]
    approve = False

    @sensitive_variables()
    def post(self, request, request_id):
        require_manager(request.user)
        try:
            with transaction.atomic():
                item = get_object_or_404(RegistrationRequest.objects.select_for_update(), pk=request_id)
                if item.status != RegistrationRequest.Status.PENDING:
                    return Response({"detail": "이미 처리된 신청입니다."}, status=409)
                if self.approve:
                    if User.objects.filter(username=item.username).exists():
                        return Response({"detail": "같은 아이디의 계정이 이미 있어 승인할 수 없습니다. 신청을 거절해 주세요."}, status=409)
                    viewer = Group.objects.filter(name="VIEWER").first()
                    if viewer is None:
                        return Response({"detail": "VIEWER 그룹이 설정되지 않았습니다. 역할 설정을 확인해 주세요."}, status=409)
                    try:
                        if not is_password_usable(item.password_hash):
                            raise ValueError()
                        identify_hasher(item.password_hash)
                    except ValueError:
                        return Response({"detail": "신청 비밀번호 정보가 유효하지 않습니다. 거절 후 재신청이 필요합니다."}, status=409)
                    user = User(username=item.username, first_name=item.first_name, last_name=item.last_name,
                                password=item.password_hash, is_active=True, is_staff=False, is_superuser=False)
                    user.save(force_insert=True)
                    user.groups.set([viewer])
                    item.status = RegistrationRequest.Status.APPROVED
                else:
                    item.status = RegistrationRequest.Status.REJECTED
                item.password_hash = ""
                item.reviewed_at = timezone.now()
                item.reviewed_by = request.user
                item.save(update_fields=["status", "password_hash", "reviewed_at", "reviewed_by"])
        except IntegrityError:
            return Response({"detail": "계정 생성 중 충돌이 발생했습니다. 목록을 새로고침해 주세요."}, status=409)
        except DatabaseError:
            return Response({"detail": "현재 신청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요."}, status=503)
        return Response(registration_data(item))
