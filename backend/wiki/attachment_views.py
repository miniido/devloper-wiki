
import logging
from pathlib import Path

from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404

from PIL import Image, UnidentifiedImageError

from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .access import accessible_documents, has_document_access
from .models import Attachment


logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 20 * 1024 * 1024
MAX_IMAGE_SIZE = 5 * 1024 * 1024

ALLOWED_EXTENSIONS = {
    ".pdf", ".doc", ".docx",
    ".xls", ".xlsx",
    ".ppt", ".pptx",
    ".txt", ".md", ".sql",
    ".json", ".xml", ".yaml", ".yml",
    ".png", ".jpg", ".jpeg", ".webp",
    ".zip",
}

IMAGE_FORMATS = {
    ".png": "PNG",
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".webp": "WEBP",
}

IMAGE_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def attachment_data(item):
    """첨부파일 API 응답 데이터"""

    return {
        "id": item.id,
        "document": item.document_id,
        "name": item.original_name,
        "size": item.file_size,
        "purpose": item.purpose,
        "uploaded_at": item.created_at.isoformat(),
        "download_url": (
            f"/api/attachments/{item.id}/download/"
        ),
    }


def can_edit_document(user, document_id):
    """문서 수정 권한 확인"""

    return (
        user.has_perm("wiki.change_document")
        and has_document_access(user, document_id, "edit")
    )


class DocumentAttachmentView(APIView):
    """문서 첨부파일 목록 조회 및 업로드"""

    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request, document_id):
        document = get_object_or_404(
            accessible_documents(request.user, "view"),
            pk=document_id,
        )

        # 일반 첨부파일만 목록에 표시
        items = document.attachments.filter(
            purpose=Attachment.Purpose.FILE,
        )

        return Response([
            attachment_data(item)
            for item in items
        ])

    def post(self, request, document_id):
        document = get_object_or_404(
            accessible_documents(request.user, "view"),
            pk=document_id,
        )

        # 문서 수정 권한 검사
        if not can_edit_document(request.user, document.id):
            return Response(
                {"detail": "파일 첨부 권한이 없습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        uploaded = request.FILES.get("file")

        if uploaded is None:
            return Response(
                {"detail": "파일을 선택해 주세요."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        extension = Path(uploaded.name).suffix.lower()

        # 파일 확장자 검사
        if extension not in ALLOWED_EXTENSIONS:
            return Response(
                {"detail": "허용되지 않는 파일 형식입니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 파일 크기 검사
        if uploaded.size == 0:
            return Response(
                {"detail": "빈 파일은 업로드할 수 없습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if uploaded.size > MAX_FILE_SIZE:
            return Response(
                {"detail": "파일은 최대 20MB까지 가능합니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 첨부파일 유형 검사
        purpose = request.data.get(
            "purpose",
            Attachment.Purpose.FILE,
        )

        if purpose not in Attachment.Purpose.values:
            return Response(
                {"detail": "올바르지 않은 파일 유형입니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 본문 이미지는 이미지 형식만 허용
        if (
            purpose == Attachment.Purpose.INLINE
            and extension not in IMAGE_FORMATS
        ):
            return Response(
                {"detail": "본문에는 이미지만 삽입할 수 있습니다."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 이미지 파일 검증
        if extension in IMAGE_FORMATS:
            if uploaded.size > MAX_IMAGE_SIZE:
                return Response(
                    {"detail": "이미지는 최대 5MB까지 가능합니다."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                with Image.open(uploaded) as image:
                    if image.format != IMAGE_FORMATS[extension]:
                        raise ValidationError(
                            "파일 확장자와 이미지 형식이 일치하지 않습니다."
                        )

                    image.verify()

            except (UnidentifiedImageError, OSError, ValueError):
                raise ValidationError(
                    "유효하지 않은 이미지 파일입니다."
                )

            finally:
                uploaded.seek(0)

        # 파일 저장
        item = Attachment.objects.create(
            document=document,
            file=uploaded,
            original_name=Path(uploaded.name).name[:255],
            file_size=uploaded.size,
            uploaded_by=request.user,
            purpose=purpose,
        )

        return Response(
            attachment_data(item),
            status=status.HTTP_201_CREATED,
        )


class AttachmentDownloadView(APIView):
    """첨부파일 다운로드"""

    permission_classes = [IsAuthenticated]

    def get(self, request, attachment_id):
        item = get_object_or_404(
            Attachment,
            pk=attachment_id,
            document__in=accessible_documents(
                request.user, "view"
            ),
        )

        try:
            file_handle = item.file.open("rb")
        except (FileNotFoundError, OSError):
            raise Http404("파일을 찾을 수 없습니다.")

        response = FileResponse(
            file_handle,
            as_attachment=True,
            filename=item.original_name,
        )

        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"

        return response


class AttachmentDeleteView(APIView):
    """첨부파일 삭제"""

    permission_classes = [IsAuthenticated]

    def delete(self, request, attachment_id):
        item = get_object_or_404(
            Attachment,
            pk=attachment_id,
            document__in=accessible_documents(
                request.user, "view"
            ),
        )

        if not can_edit_document(
            request.user,
            item.document_id,
        ):
            return Response(
                {"detail": "파일 삭제 권한이 없습니다."},
                status=status.HTTP_403_FORBIDDEN,
            )

        storage = item.file.storage
        file_name = item.file.name

        # DB 데이터 삭제
        item.delete()

        # 실제 파일 삭제
        try:
            storage.delete(file_name)
        except Exception:
            logger.exception(
                "첨부파일 삭제 실패: attachment_id=%s",
                attachment_id,
            )

        return Response(
            status=status.HTTP_204_NO_CONTENT
        )


class AttachmentPreviewView(APIView):
    """본문 이미지 미리보기"""

    permission_classes = [IsAuthenticated]

    def get(self, request, attachment_id):
        item = get_object_or_404(
            Attachment,
            pk=attachment_id,
            document__in=accessible_documents(
                request.user, "view"
            ),
            purpose=Attachment.Purpose.INLINE,
        )

        extension = Path(item.original_name).suffix.lower()
        content_type = IMAGE_CONTENT_TYPES.get(extension)

        if content_type is None:
            raise Http404(
                "미리보기를 지원하지 않는 파일입니다."
            )

        try:
            file_handle = item.file.open("rb")
        except (FileNotFoundError, OSError):
            raise Http404("파일을 찾을 수 없습니다.")

        response = FileResponse(
            file_handle,
            as_attachment=False,
            content_type=content_type,
        )

        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"

        return response
