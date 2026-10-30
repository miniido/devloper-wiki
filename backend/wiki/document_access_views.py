from django.contrib.auth.models import Group
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import accessible_documents, can_manage_document_access, can_configure_document_creation
from .models import Document, DocumentAccess

MANAGED_GROUPS = ("WIKI_ADMIN", "AUTHOR", "VIEWER")


def managed_groups():
    return sorted(Group.objects.filter(name__in=MANAGED_GROUPS),
                  key=lambda group: MANAGED_GROUPS.index(group.name))


def access_data(document, groups):
    rules = {rule.group_id: rule for rule in document.access_rules.filter(group__in=groups)}
    return {
        "document_id": document.pk,
        "title": document.title,
        "use_custom_permissions": document.use_custom_permissions,
        "groups": [{
            "group_id": group.pk,
            "group_name": group.name,
            "can_view": rules[group.pk].can_view if group.pk in rules else False,
            "can_edit": rules[group.pk].can_edit if group.pk in rules else False,
        } for group in groups],
    }


def validate_payload(data, groups):
    if not isinstance(data, dict):
        raise ValidationError({"detail": "요청 본문은 객체여야 합니다."})
    mode = data.get("use_custom_permissions")
    if type(mode) is not bool:
        raise ValidationError({"detail": "use_custom_permissions는 boolean이어야 합니다."})
    incoming = data.get("groups")
    if not isinstance(incoming, list) or len(incoming) != len(groups):
        raise ValidationError({"detail": "모든 관리 대상 그룹을 배열로 전달해야 합니다."})
    allowed_ids = {group.pk for group in groups}
    validated = {}
    for item in incoming:
        if not isinstance(item, dict):
            raise ValidationError({"detail": "그룹 데이터가 잘못되었습니다."})
        group_id = item.get("group_id")
        if type(group_id) is not int or group_id not in allowed_ids:
            raise ValidationError({"detail": "허용되지 않는 그룹입니다."})
        if group_id in validated:
            raise ValidationError({"detail": "중복된 그룹입니다."})
        values = {field: item.get(field) for field in ("can_view", "can_edit")}
        if any(type(value) is not bool for value in values.values()):
            raise ValidationError({"detail": "권한 값은 boolean이어야 합니다."})
        if values["can_edit"] and not values["can_view"]:
            raise ValidationError({"detail": "수정 권한에는 조회 권한이 필요합니다."})
        validated[group_id] = values
    return mode, validated


def ensure_manager_role(user):
    if not user.is_active or not (
        user.is_superuser or (
            user.groups.filter(name="WIKI_ADMIN").exists()
            and user.has_perms(["wiki.view_document", "wiki.change_document"])
        )
    ):
        raise PermissionDenied("문서 권한 관리가 허용되지 않습니다.")


def apply_access_settings(document, mode, rules):
    """호출자가 문서 잠금/트랜잭션을 소유하며 관리 대상 그룹만 저장한다."""
    for group_id, values in rules.items():
        DocumentAccess.objects.update_or_create(
            document=document, group_id=group_id, defaults=values,
        )
    document.use_custom_permissions = mode
    document.save(update_fields=["use_custom_permissions"])


class DocumentAccessOptionsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        ensure_manager_role(request.user)
        raw_menu = request.query_params.get("menu", "")
        try:
            menu_id = int(raw_menu)
        except (TypeError, ValueError):
            raise ValidationError({"detail": "메뉴 ID가 필요합니다."})
        if not can_configure_document_creation(request.user, menu_id):
            raise PermissionDenied("이 메뉴에서 문서 권한을 설정할 수 없습니다.")
        return Response({
            "document_id": None, "title": "", "use_custom_permissions": False,
            "groups": [{"group_id": group.pk, "group_name": group.name,
                        "can_view": False, "can_edit": False} for group in managed_groups()],
        })


class DocumentAccessManagementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, document_id):
        ensure_manager_role(request.user)
        document = get_object_or_404(accessible_documents(request.user), pk=document_id)
        if not can_manage_document_access(request.user, document):
            raise PermissionDenied("문서 권한 관리에는 해당 문서의 수정 권한이 필요합니다.")
        return Response(access_data(document, managed_groups()))

    def put(self, request, document_id):
        ensure_manager_role(request.user)
        groups = managed_groups()
        mode, rules = validate_payload(request.data, groups)
        with transaction.atomic():
            document = get_object_or_404(Document.objects.select_for_update(), pk=document_id)
            # 잠금을 획득한 뒤 현재 메뉴/CUSTOM 범위를 다시 검사한다.
            if not accessible_documents(request.user).filter(pk=document.pk).exists():
                raise PermissionDenied("문서에 접근할 수 없습니다.")
            if not can_manage_document_access(request.user, document):
                raise PermissionDenied("문서 권한 관리에는 해당 문서의 수정 권한이 필요합니다.")
            apply_access_settings(document, mode, rules)
        return Response(access_data(document, groups))
