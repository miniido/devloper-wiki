from django.conf import settings
from django.db import models
    
import uuid
from pathlib import Path

class Menu(models.Model):
    name = models.CharField(max_length=100)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="children",
    )
    sort_order = models.PositiveIntegerField(default=0)
    is_public = models.BooleanField(
        default=False,
        verbose_name="전체 사용자 열람 허용",
        help_text="로그인한 모든 사용자가 이 메뉴를 조회할 수 있습니다.",
    )

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self):
        return self.name


class Document(models.Model):
    menu = models.ForeignKey(
        Menu,
        on_delete=models.PROTECT,
        related_name="documents",
    )
    title = models.CharField(max_length=200)
    content = models.JSONField(default=list, blank=True) 
    use_custom_permissions = models.BooleanField(
        default=False,
        verbose_name="문서별 권한 사용",
    )
    content_text = models.TextField(
        default="",
        blank=True,
        editable=False,
    )
    version = models.PositiveIntegerField(default=1)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_documents",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    

    def __str__(self):
        return self.title

class MenuAccess(models.Model):
    menu = models.ForeignKey(
        Menu,
        on_delete=models.CASCADE,
        related_name="access_rules",
    )
    group = models.ForeignKey(
        "auth.Group",
        on_delete=models.CASCADE,
        related_name="wiki_menu_access",
    )

    can_view = models.BooleanField(default=False)
    can_create = models.BooleanField(default=False)
    can_edit = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["menu", "group"],
                name="unique_menu_group_access",
            )
        ]

    def __str__(self):
        return f"{self.menu.name} / {self.group.name}"

class DocumentAccess(models.Model):
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name="access_rules",
    )

    group = models.ForeignKey(
        "auth.Group",
        on_delete=models.CASCADE,
        related_name="wiki_document_access",
    )

    can_view = models.BooleanField(default=False)
    can_edit = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["document", "group"],
                name="unique_document_group_access",
            )
        ]

    def __str__(self):
        return f"{self.document.title} / {self.group.name}"

def attachment_upload_path(instance, filename):
    # 원본 파일명을 저장 경로에 사용하지 않음
    extension = Path(filename).suffix.lower()
    return (
        f"attachments/{instance.document_id}/"
        f"{uuid.uuid4().hex}{extension}"
    )


class Attachment(models.Model):
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name="attachments",
    )

    file = models.FileField(
        upload_to=attachment_upload_path,
    )

    original_name = models.CharField(max_length=255)
    file_size = models.PositiveBigIntegerField()
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.original_name

    class Purpose(models.TextChoices):
        FILE = "FILE", "일반 첨부파일"
        INLINE = "INLINE", "본문 이미지"

    purpose = models.CharField(
        max_length=10,
        choices=Purpose.choices,
        default=Purpose.FILE,
    )


class DocumentRevision(models.Model):
    document = models.ForeignKey(
        Document,
        on_delete=models.CASCADE,
        related_name="revisions",
    )

    version = models.PositiveIntegerField()

    title = models.CharField(max_length=255)
    menu_id_snapshot = models.PositiveBigIntegerField()
    content = models.JSONField(default=list)

    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-version"]
        constraints = [
            models.UniqueConstraint(
                fields=["document", "version"],
                name="unique_document_revision_version",
            )
        ]

    def __str__(self):
        return f"{self.document_id} - v{self.version}"
