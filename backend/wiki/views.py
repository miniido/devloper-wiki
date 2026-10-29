from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie

from rest_framework import generics
from rest_framework.exceptions import PermissionDenied

from .models import Menu, Document
from .serializers import MenuSerializer, DocumentSerializer
from .permissions import WikiModelPermission
from .access import accessible_menus, has_menu_access

from rest_framework import generics
from rest_framework.exceptions import PermissionDenied

from django.db.models import Q

from .models import Document
from .serializers import DocumentSerializer
from .permissions import WikiModelPermission
from .access import (
    accessible_documents,
    has_menu_access,
    has_document_access,
)

from django.db import transaction
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import Document
from .access import (
    accessible_documents,
    has_document_access,
    has_menu_access,
)
from .revisions import save_revision, ensure_baseline

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
        queryset = (
            accessible_documents(self.request.user, "view")
            .select_related("menu", "created_by")
            .order_by("-updated_at")
        )

        menu_id = self.request.query_params.get("menu")
        keyword = self.request.query_params.get("q", "").strip()

        if menu_id:
            queryset = queryset.filter(menu_id=menu_id)

        if keyword:
            queryset = queryset.filter(
                Q(title__icontains=keyword)
                | Q(content_text__icontains=keyword)
            )

        return queryset

    def perform_create(self, serializer):
        menu = serializer.validated_data["menu"]

        if not has_menu_access(
            self.request.user,
            menu.id,
            "create",
        ):
            raise PermissionDenied(
                "해당 메뉴에 문서 작성 권한이 없습니다."
            )

        with transaction.atomic():
            document = serializer.save(
                created_by=self.request.user
            )

            save_revision(
                document,
                user=self.request.user,
            )

class DocumentDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = DocumentSerializer
    permission_classes = [WikiModelPermission]

    def get_queryset(self):
        return (
            accessible_documents(self.request.user, "view")
            .select_related("menu", "created_by")
        )


    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)

        with transaction.atomic():
            # 현재 조회 권한 검사
            document = self.get_object()

            # PostgreSQL 행 잠금
            locked = Document.objects.select_for_update().get(
                pk=document.pk
            )

            # 실제 수정 권한 검사
            if not (
                request.user.has_perm("wiki.change_document")
                and has_document_access(
                    request.user, locked.pk, "edit"
                )
            ):
                raise PermissionDenied(
                    "문서 수정 권한이 없습니다."
                )

            # 클라이언트가 편집을 시작한 버전 검사
            expected_version = request.data.get("version")

            try:
                expected_version = int(expected_version)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "문서 버전이 필요합니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if expected_version != locked.version:
                return Response(
                    {
                        "detail": (
                            "다른 사용자가 문서를 수정했습니다. "
                            "새로고침 후 다시 확인해 주세요."
                        ),
                        "current_version": locked.version,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            serializer = self.get_serializer(
                locked,
                data=request.data,
                partial=partial,
            )
            serializer.is_valid(raise_exception=True)

            # 메뉴 이동 시 대상 메뉴 작성 권한 확인
            target_menu = serializer.validated_data.get(
                "menu",
                locked.menu,
            )

            if target_menu.id != locked.menu_id:
                if not has_menu_access(
                    request.user, target_menu.id, "create"
                ):
                    raise PermissionDenied(
                        "대상 메뉴에 문서 작성 권한이 없습니다."
                    )

            # 실제 내용이 바뀌었는지 확인
            changed = any([
                serializer.validated_data.get(
                    "title", locked.title
                ) != locked.title,
                serializer.validated_data.get(
                    "content", locked.content
                ) != locked.content,
                target_menu.id != locked.menu_id,
            ])

            if changed:
                ensure_baseline(locked)

                locked.version += 1

                # 기존 serializer.update()로 content_text도 갱신
                document = serializer.save(
                    version=locked.version
                )

                save_revision(
                    document,
                    user=request.user,
                )
            else:
                document = locked

            return Response(
                self.get_serializer(document).data
            )

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

        document = self.get_object()

        if not has_document_access(
            self.request.user, document.id, "edit"
        ):
            raise PermissionDenied(
                "이 문서를 수정할 권한이 없습니다."
            )

        target_menu = serializer.validated_data.get(
            "menu", document.menu
        )

        if target_menu.id != document.menu_id:
            if not has_menu_access(
                self.request.user, target_menu.id, "create"
            ):
                raise PermissionDenied(
                    "대상 메뉴에 문서를 등록할 권한이 없습니다."
                )

        serializer.save()
