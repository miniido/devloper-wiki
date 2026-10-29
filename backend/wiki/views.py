from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie

from rest_framework import generics
from rest_framework.exceptions import PermissionDenied

from .models import Menu, Document
from .serializers import MenuSerializer, DocumentSerializer
from .permissions import WikiModelPermission
from .access import accessible_menus, has_menu_access


@ensure_csrf_cookie
def csrf_token_view(request):
    return JsonResponse({"detail": "CSRF cookie issued"})


class MenuListView(generics.ListAPIView):
    serializer_class = MenuSerializer
    permission_classes = [WikiModelPermission]

    def get_queryset(self):
        return accessible_menus(
            self.request.user, "view"
        )


class DocumentListCreateView(generics.ListCreateAPIView):
    serializer_class = DocumentSerializer
    permission_classes = [WikiModelPermission]

    def get_queryset(self):
        queryset = Document.objects.select_related(
            "menu", "created_by"
        ).filter(
            menu__in=accessible_menus(
                self.request.user, "view"
            )
        ).order_by("-updated_at")

        menu_id = self.request.query_params.get("menu")

        if menu_id:
            queryset = queryset.filter(menu_id=menu_id)

        return queryset

    def perform_create(self, serializer):
        menu = serializer.validated_data["menu"]

        if not has_menu_access(
            self.request.user, menu.id, "create"
        ):
            raise PermissionDenied(
                "이 메뉴에 문서를 작성할 권한이 없습니다."
            )

        serializer.save(created_by=self.request.user)


class DocumentDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = DocumentSerializer
    permission_classes = [WikiModelPermission]

    def get_queryset(self):
        return Document.objects.select_related(
            "menu", "created_by"
        ).filter(
            menu__in=accessible_menus(
                self.request.user, "view"
            )
        )

    def perform_update(self, serializer):
        document = self.get_object()

        if not has_menu_access(
            self.request.user, document.menu_id, "edit"
        ):
            raise PermissionDenied(
                "이 문서를 수정할 권한이 없습니다."
            )

        target_menu = serializer.validated_data.get(
            "menu", document.menu
        )

        if not has_menu_access(
            self.request.user, target_menu.id, "create"
        ):
            raise PermissionDenied(
                "대상 메뉴에 문서를 등록할 권한이 없습니다."
            )

        serializer.save()