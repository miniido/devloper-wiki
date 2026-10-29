
import json

from django.contrib.auth import authenticate, login, logout
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST


def user_data(user):
    groups = set(user.groups.values_list("name", flat=True))
    role = next((name for name in ("SYSTEM_ADMIN", "WIKI_ADMIN", "AUTHOR", "VIEWER") if name in groups), "VIEWER")
    if user.is_superuser:
        role = "SYSTEM_ADMIN"
    can_manage = any(user.has_perm(f"wiki.{action}_menu") for action in ("add", "change", "delete"))
    return {
        "role": role,
        "role_label": {"SYSTEM_ADMIN": "관리자", "WIKI_ADMIN": "관리자", "AUTHOR": "작성자", "VIEWER": "열람자"}[role],
        "can_manage_menus": can_manage,
        "id": user.id,
        "username": user.get_username(),
        "is_staff": user.is_staff,
        "is_superuser": user.is_superuser,
    }


@require_GET
def me_view(request):
    if not request.user.is_authenticated:
        return JsonResponse(
            {"detail": "로그인이 필요합니다."},
            status=401,
        )

    return JsonResponse(user_data(request.user))


@require_POST
@csrf_protect
def login_view(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse(
            {"detail": "잘못된 요청입니다."},
            status=400,
        )

    username = data.get("username", "")
    password = data.get("password", "")

    if not isinstance(username, str) or not isinstance(password, str):
        return JsonResponse(
            {"detail": "잘못된 요청입니다."},
            status=400,
        )

    user = authenticate(
        request,
        username=username,
        password=password,
    )

    if user is None:
        return JsonResponse(
            {"detail": "아이디 또는 비밀번호를 확인해 주세요."},
            status=401,
        )

    login(request, user)

    return JsonResponse(user_data(user))


@require_POST
@csrf_protect
def logout_view(request):
    logout(request)
    return JsonResponse({"detail": "로그아웃되었습니다."})
