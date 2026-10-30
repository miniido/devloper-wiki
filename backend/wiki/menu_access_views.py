
from django.contrib.auth.models import Group
from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Menu, MenuAccess


MANAGED_GROUPS = ("WIKI_ADMIN", "AUTHOR", "VIEWER")
ACCESS_FIELDS = ("can_view", "can_create", "can_edit")


def can_manage_access(user):
    """메뉴 접근 권한을 관리할 수 있는 사용자"""

    if not user.is_authenticated or not user.is_active:
        return False

    if user.is_superuser:
        return True

    return (
        user.has_perm("wiki.change_menu")
        and user.groups.filter(name="WIKI_ADMIN").exists()
    )


def access_data(menu, groups):
    """메뉴별 그룹 접근 권한 응답"""

    rules = {
        rule.group_id: rule
        for rule in MenuAccess.objects.filter(
            menu=menu,
            group__in=groups,
        )
    }

    return {
        "menu_id": menu.id,
        "menu_name": menu.name,
        "is_public": menu.is_public,
        "groups": [
            {
                "group_id": group.id,
                "group_name": group.name,
                "can_view": (
                    rules[group.id].can_view
                    if group.id in rules else False
                ),
                "can_create": (
                    rules[group.id].can_create
                    if group.id in rules else False
                ),
                "can_edit": (
                    rules[group.id].can_edit
                    if group.id in rules else False
                ),
            }
            for group in groups
        ],
    }


class MenuAccessManagementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, menu_id):
        if not can_manage_access(request.user):
            return Response(
                {"detail": "권한 관리 접근이 거부되었습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        menu = get_object_or_404(Menu, pk=menu_id)

        groups = list(
            Group.objects.filter(name__in=MANAGED_GROUPS)
            .order_by("name")
        )

        return Response(access_data(menu, groups))

    def put(self, request, menu_id):
        if not can_manage_access(request.user):
            return Response(
                {"detail": "권한 변경 권한이 없습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        incoming = request.data.get("groups")

        if not isinstance(incoming, list):
            return Response(
                {"detail": "groups는 배열이어야 합니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        groups = list(
            Group.objects.filter(name__in=MANAGED_GROUPS)
            .order_by("name")
        )
        group_map = {group.id: group for group in groups}

        # 기존 그룹 설정을 덮어쓰는 전체 저장 방식
        if len(incoming) != len(groups):
            return Response(
                {"detail": "모든 관리 대상 그룹을 전달해야 합니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        validated = {}
        for item in incoming:
            if not isinstance(item, dict):
                return Response(
                    {"detail": "그룹 데이터가 잘못되었습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            group_id = item.get("group_id")

            if type(group_id) is not int or group_id not in group_map:
                return Response(
                    {"detail": "허용되지 않는 그룹입니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if group_id in validated:
                return Response(
                    {"detail": "중복된 그룹이 있습니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            values = {}
            for field in ACCESS_FIELDS:
                value = item.get(field)

                if type(value) is not bool:
                    return Response(
                        {"detail": f"{field} 값이 잘못되었습니다."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                values[field] = value

            # 수정·작성은 조회 권한이 있어야 가능
            if not values["can_view"]:
                if values["can_create"] or values["can_edit"]:
                    return Response(
                        {
                            "detail":
                            "작성·수정 권한에는 조회 권한이 필요합니다."
                        },
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            validated[group_id] = values

        with transaction.atomic():
            menu = get_object_or_404(
                Menu.objects.select_for_update(),
                pk=menu_id,
            )

            for group_id, values in validated.items():
                # 모두 false라면 권한 레코드를 제거
                if not any(values.values()):
                    MenuAccess.objects.filter(
                        menu=menu,
                        group_id=group_id,
                    ).delete()
                    continue

                MenuAccess.objects.update_or_create(
                    menu=menu,
                    group_id=group_id,
                    defaults=values,
                )

        return Response(access_data(menu, groups))
