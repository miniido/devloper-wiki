from .models import Menu, MenuAccess


def accessible_menus(user, action="view"):
    """사용자가 action을 수행할 수 있는 메뉴 QuerySet"""

    if not user.is_authenticated or not user.is_active:
        return Menu.objects.none()

    if user.is_superuser:
        return Menu.objects.all()

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

    return Menu.objects.filter(
        id__in=rules.values("menu_id")
    )


def has_menu_access(user, menu_id, action="view"):
    return accessible_menus(user, action).filter(
        id=menu_id
    ).exists()