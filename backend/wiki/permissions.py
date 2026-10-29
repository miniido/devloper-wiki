
from rest_framework.permissions import BasePermission


class WikiModelPermission(BasePermission):
    """
    Django Group/Permission 기반 API 기능 권한 검사.

    메뉴·문서별 접근 범위는 추후 추가.
    """

    METHOD_PERMISSIONS = {
        "GET": "view",
        "HEAD": "view",
        "POST": "add",
        "PUT": "change",
        "PATCH": "change",
        "DELETE": "delete",
    }

    def has_permission(self, request, view):
        user = request.user

        if not user or not user.is_authenticated:
            return False

        if not user.is_active:
            return False

        action = self.METHOD_PERMISSIONS.get(request.method)

        if action is None:
            return request.method == "OPTIONS"

        queryset = view.get_queryset()
        model = queryset.model

        permission = (
            f"{model._meta.app_label}."
            f"{action}_{model._meta.model_name}"
        )

        return user.has_perm(permission)
