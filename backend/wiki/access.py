from .models import Menu, MenuAccess

from django.db.models import Exists, OuterRef, Q

from .models import Document, DocumentAccess

from django.db.models import Q

from .models import Menu, MenuAccess


def accessible_menus(user, action="view"):
    if not user.is_authenticated or not user.is_active:
        return Menu.objects.none()

    if user.is_superuser:
        return Menu.objects.all()

    if action not in ("view", "create", "edit"):
        raise ValueError(f"지원하지 않는 권한: {action}")

    field = {
        "view": "can_view",
        "create": "can_create",
        "edit": "can_edit",
    }[action]

    rules = MenuAccess.objects.filter(
        group__in=user.groups.all(),
        can_view=True,
    )

    if action != "view":
        rules = rules.filter(**{field: True})

    permitted_ids = rules.values("menu_id")

    if action == "view":
        return Menu.objects.filter(
            Q(is_public=True) | Q(id__in=permitted_ids)
        ).distinct()

    return Menu.objects.filter(
        id__in=permitted_ids
    )


def has_menu_access(user, menu_id, action="view"):
    return accessible_menus(user, action).filter(
        id=menu_id
    ).exists()

def accessible_documents(user, action="view"):
    """
    권한 있는 문서만 반환.

    - 기본: 메뉴 권한 상속
    - CUSTOM: 메뉴 권한 + 문서별 허용 권한
    - Superuser: 전체 접근
    """

    if not user.is_authenticated or not user.is_active:
        return Document.objects.none()

    if user.is_superuser:
        return Document.objects.all()

    if action not in ("view", "edit"):
        raise ValueError(f"지원하지 않는 권한: {action}")

    # 문서에 접근하려면 메뉴에서도 동일한 작업이 허용되어야 함
    menu_ids = accessible_menus(
        user,
        action,
    ).values("id")

    document_rules = DocumentAccess.objects.filter(
        document_id=OuterRef("pk"),
        group__in=user.groups.all(),
        can_view=True,
    )

    if action == "edit":
        document_rules = document_rules.filter(can_edit=True)

    return (
        Document.objects
        .filter(menu_id__in=menu_ids)
        .annotate(_has_document_access=Exists(document_rules))
        .filter(
            Q(use_custom_permissions=False)
            | Q(
                use_custom_permissions=True,
                _has_document_access=True,
            )
        )
    )

def has_document_access(user, document_id, action="view"):
    return accessible_documents(user, action).filter(
        pk=document_id
    ).exists()