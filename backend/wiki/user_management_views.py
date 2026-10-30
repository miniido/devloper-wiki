
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import (
    validate_password,
)
from django.core.exceptions import ValidationError
from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView


User = get_user_model()

MANAGED_ROLES = {"WIKI_ADMIN", "AUTHOR", "VIEWER"}
STAFF_ROLES = {"AUTHOR", "VIEWER"}


def is_manager(user):
    return (
        user.is_authenticated
        and user.is_active
        and (
            user.is_superuser
            or user.groups.filter(name="WIKI_ADMIN").exists()
        )
    )


def can_manage_target(manager, target):
    if manager.pk == target.pk:
        return False

    if manager.is_superuser:
        return True

    # 일반 위키 관리자는 일반 사용자만 관리
    if target.is_superuser or target.is_staff:
        return False

    if target.groups.filter(
        name__in=["WIKI_ADMIN", "SYSTEM_ADMIN"]
    ).exists():
        return False

    return True


def user_data(user):
    role_names = list(
        user.groups.filter(name__in=MANAGED_ROLES)
        .order_by("name")
        .values_list("name", flat=True)
    )

    return {
        "id": user.pk,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "is_active": user.is_active,
        "is_superuser": user.is_superuser,
        "roles": role_names,
    }


def error_response(message, code=400):
    return Response(
        {"detail": message},
        status=code,
    )


def get_role(name, manager):
    allowed = MANAGED_ROLES if manager.is_superuser else STAFF_ROLES

    if name not in allowed:
        return None

    return Group.objects.filter(name=name).first()


def validate_new_password(password, user):
    if not isinstance(password, str) or not password:
        return "비밀번호를 입력해 주세요."

    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        return " ".join(exc.messages)

    return None


class UserManagementListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not is_manager(request.user):
            return error_response("접근 권한이 없습니다.", 403)

        users = User.objects.prefetch_related("groups").order_by(
            "username"
        )

        if not request.user.is_superuser:
            users = (
                users.filter(is_superuser=False, is_staff=False)
                .exclude(
                    groups__name__in=["WIKI_ADMIN", "SYSTEM_ADMIN"]
                )
                .distinct()
            )

        return Response({
            "users": [user_data(user) for user in users],
            "roles": sorted(
                MANAGED_ROLES
                if request.user.is_superuser
                else STAFF_ROLES
            ),
        })

    def post(self, request):
        if not is_manager(request.user):
            return error_response("접근 권한이 없습니다.", 403)

        username = request.data.get("username")
        password = request.data.get("password")
        role_name = request.data.get("role")
        first_name = request.data.get("first_name", "")
        last_name = request.data.get("last_name", "")

        if not isinstance(username, str) or not username.strip():
            return error_response("아이디를 입력해 주세요.")

        username = username.strip()

        if len(username) > User._meta.get_field("username").max_length:
            return error_response("아이디가 너무 깁니다.")

        if User.objects.filter(username=username).exists():
            return error_response("이미 사용 중인 아이디입니다.", 409)

        if not isinstance(first_name, str) or not isinstance(last_name, str):
            return error_response("이름 형식이 올바르지 않습니다.")

        if (
            len(first_name) > User._meta.get_field("first_name").max_length
            or len(last_name) > User._meta.get_field("last_name").max_length
        ):
            return error_response("이름이 너무 깁니다.")

        role = get_role(role_name, request.user)

        if role is None:
            return error_response("허용되지 않은 역할입니다.")

        user = User(
            username=username,
            first_name=first_name,
            last_name=last_name,
            is_active=True,
            is_staff=False,
            is_superuser=False,
        )

        password_error = validate_new_password(password, user)

        if password_error:
            return error_response(password_error)

        user.set_password(password)

        with transaction.atomic():
            if User.objects.filter(username=username).exists():
                return error_response(
                    "이미 사용 중인 아이디입니다.", 409
                )

            user.save()
            user.groups.set([role])

        return Response(
            user_data(user),
            status=status.HTTP_201_CREATED,
        )


class UserManagementDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, user_id):
        if not is_manager(request.user):
            return error_response("접근 권한이 없습니다.", 403)

        with transaction.atomic():
            target = get_object_or_404(
                User.objects.select_for_update(),
                pk=user_id,
            )

            if not can_manage_target(request.user, target):
                return error_response(
                    "해당 계정을 수정할 수 없습니다.", 403
                )

            for field in ("first_name", "last_name"):
                if field in request.data:
                    value = request.data[field]

                    if not isinstance(value, str):
                        return error_response(
                            "이름 형식이 올바르지 않습니다."
                        )

                    if len(value) > User._meta.get_field(field).max_length:
                        return error_response("이름이 너무 깁니다.")

                    setattr(target, field, value)

            if "is_active" in request.data:
                value = request.data["is_active"]

                if not isinstance(value, bool):
                    return error_response(
                        "활성 상태가 올바르지 않습니다."
                    )

                target.is_active = value

            if "role" in request.data:
                role = get_role(
                    request.data["role"],
                    request.user,
                )

                if role is None:
                    return error_response(
                        "허용되지 않은 역할입니다."
                    )

                # 기존 관리 역할을 제외한 기타 그룹 권한이
                # 남지 않도록 전체 그룹을 교체
                target.groups.set([role])

            target.save()

        return Response(user_data(target))


class UserPasswordResetView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, user_id):
        if not is_manager(request.user):
            return error_response("접근 권한이 없습니다.", 403)

        with transaction.atomic():
            target = get_object_or_404(
                User.objects.select_for_update(),
                pk=user_id,
            )

            if not can_manage_target(request.user, target):
                return error_response(
                    "해당 계정의 비밀번호를 변경할 수 없습니다.",
                    403,
                )

            password = request.data.get("password")

            password_error = validate_new_password(
                password,
                target,
            )

            if password_error:
                return error_response(password_error)

            target.set_password(password)
            target.save(update_fields=["password"])

        return Response({
            "detail": "비밀번호가 변경되었습니다."
        })
