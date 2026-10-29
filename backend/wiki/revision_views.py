
from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import (
    accessible_documents,
    has_document_access,
    has_menu_access,
)
from .models import Document, DocumentRevision
from .revisions import save_revision, ensure_baseline
from .utils import extract_block_text


def revision_data(revision, include_content=False):
    result = {
        "id": revision.id,
        "version": revision.version,
        "title": revision.title,
        "menu": revision.menu_id_snapshot,
        "changed_by": (
            revision.changed_by.username
            if revision.changed_by else None
        ),
        "created_at": revision.created_at.isoformat(),
    }

    if include_content:
        result["content"] = revision.content

    return result


def get_visible_document(request, document_id):
    return get_object_or_404(
        accessible_documents(request.user, "view"),
        pk=document_id,
    )


class DocumentRevisionListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, document_id):
        document = get_visible_document(request, document_id)

        revisions = document.revisions.select_related(
            "changed_by"
        ).all()

        return Response([
            revision_data(revision)
            for revision in revisions
        ])


class DocumentRevisionDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, document_id, version):
        document = get_visible_document(request, document_id)

        revision = get_object_or_404(
            DocumentRevision,
            document=document,
            version=version,
        )

        return Response(
            revision_data(revision, include_content=True)
        )


class DocumentRevisionRestoreView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, document_id, version):
        with transaction.atomic():
            get_visible_document(request, document_id)

            document = get_object_or_404(
                Document.objects.select_for_update(),
                pk=document_id,
            )

            if not (
                request.user.has_perm("wiki.change_document")
                and has_document_access(
                    request.user, document.id, "edit"
                )
            ):
                return Response(
                    {"detail": "문서 복구 권한이 없습니다."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            expected = request.data.get("version")

            try:
                expected = int(expected)
            except (TypeError, ValueError):
                return Response(
                    {"detail": "현재 문서 버전이 필요합니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if expected != document.version:
                return Response(
                    {
                        "detail": "문서가 변경되었습니다.",
                        "current_version": document.version,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            target = get_object_or_404(
                DocumentRevision,
                document=document,
                version=version,
            )

            # 과거에 다른 메뉴에 있었던 문서를 복구하는 경우
            if target.menu_id_snapshot != document.menu_id:
                if not has_menu_access(
                    request.user,
                    target.menu_id_snapshot,
                    "create",
                ):
                    return Response(
                        {"detail": "대상 메뉴 작성 권한이 없습니다."},
                        status=status.HTTP_403_FORBIDDEN,
                    )

            # 기존 문서는 첫 수정/복구 전에 기준 버전 생성
            ensure_baseline(document)

            document.title = target.title
            document.menu_id = target.menu_id_snapshot
            document.content = target.content
            document.content_text = extract_block_text(
                target.content
            )
            document.version += 1

            document.save(
                update_fields=[
                    "title",
                    "menu",
                    "content",
                    "content_text",
                    "version",
                    "updated_at",
                ]
            )

            save_revision(
                document,
                user=request.user,
            )

            return Response({
                "detail": f"v{version} 버전으로 복구했습니다.",
                "version": document.version,
            })
