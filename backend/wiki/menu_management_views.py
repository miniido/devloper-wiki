
from django.db import transaction
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Menu, Document

def menu_data(menu):
    return {
        "id": menu.id,
        "name": menu.name,
        "parent": menu.parent_id,
        "sort_order": menu.sort_order,
        "is_public": menu.is_public,
    }


def menu_permissions(user):
    return {
        "can_add": user.has_perm("wiki.add_menu"),
        "can_change": user.has_perm("wiki.change_menu"),
        "can_delete": user.has_perm("wiki.delete_menu"),
    }


def validate_menu_data(data, instance=None):
    name = data.get("name", instance.name if instance else "")
    name = name.strip() if isinstance(name, str) else ""

    if not name:
        return None, "메뉴 이름을 입력해 주세요."

    if len(name) > 100:
        return None, "메뉴 이름은 100자 이하로 입력해 주세요."

    raw_parent = data.get(
        "parent",
        instance.parent_id if instance else None,
    )

    if raw_parent in (None, ""):
        parent = None
    else:
        try:
            parent_id = int(raw_parent)
        except (TypeError, ValueError):
            return None, "상위 메뉴가 올바르지 않습니다."

        parent = Menu.objects.filter(pk=parent_id).first()

        if parent is None:
            return None, "상위 메뉴를 찾을 수 없습니다."

        # 자기 자신이나 자신의 하위 메뉴 선택 방지
        if instance is not None:
            current = parent
            while current is not None:
                if current.pk == instance.pk:
                    return None, "메뉴를 자기 하위로 이동할 수 없습니다."
                current = current.parent

    is_public = data.get(
        "is_public",
        instance.is_public if instance else False,
    )

    if not isinstance(is_public, bool):
        return None, "전체 공개 여부가 올바르지 않습니다."

    raw_order = data.get(
        "sort_order",
        instance.sort_order if instance else 0,
    )

    try:
        if isinstance(raw_order, bool):
            raise ValueError
        sort_order = int(raw_order)
        if sort_order < 0:
            raise ValueError
    except (TypeError, ValueError):
        return None, "정렬 순서는 0 이상의 정수여야 합니다."

    return {
        "name": name,
        "parent": parent,
        "is_public": is_public,
        "sort_order": sort_order,
    }, None


class MenuManagementListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        permissions = menu_permissions(request.user)

        can_manage = any(permissions.values())

        menus = (
            Menu.objects.all().order_by("sort_order", "id")
            if can_manage else Menu.objects.none()
        )

        return Response({
            **permissions,
            "menus": [menu_data(menu) for menu in menus],
        })

    def post(self, request):
        if not request.user.has_perm("wiki.add_menu"):
            return Response(
                {"detail": "메뉴 생성 권한이 없습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        values, error = validate_menu_data(request.data)
        if error:
            return Response(
                {"detail": error},
                status=status.HTTP_400_BAD_REQUEST,
            )

        menu = Menu.objects.create(**values)

        return Response(
            menu_data(menu),
            status=status.HTTP_201_CREATED,
        )


class MenuManagementDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, menu_id):
        if not request.user.has_perm("wiki.change_menu"):
            return Response(
                {"detail": "메뉴 수정 권한이 없습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            menu = get_object_or_404(
                Menu.objects.select_for_update(),
                pk=menu_id,
            )

            values, error = validate_menu_data(
                request.data,
                instance=menu,
            )

            if error:
                return Response(
                    {"detail": error},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            for field, value in values.items():
                setattr(menu, field, value)

            menu.save()

        return Response(menu_data(menu))

    def delete(self, request, menu_id):
        if not request.user.has_perm("wiki.delete_menu"):
            return Response(
                {"detail": "메뉴 삭제 권한이 없습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            menu = get_object_or_404(
                Menu.objects.select_for_update(),
                pk=menu_id,
            )

            # 하위 메뉴가 있으면 삭제 불가
            if Menu.objects.filter(parent_id=menu.id).exists():
                return Response(
                    {"detail": "하위 메뉴가 있어 삭제할 수 없습니다."},
                    status=status.HTTP_409_CONFLICT,
                )

            # 연결된 문서가 있으면 삭제 불가
            if Document.objects.filter(menu_id=menu.id).exists():
                return Response(
                    {"detail": "문서가 있어 삭제할 수 없습니다."},
                    status=status.HTTP_409_CONFLICT,
                )

            try:
                menu.delete()
            except ProtectedError:
                return Response(
                    {"detail": "연결된 데이터가 있어 삭제할 수 없습니다."},
                    status=status.HTTP_409_CONFLICT,
                )

        return Response(status=status.HTTP_204_NO_CONTENT)
