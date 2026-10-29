
from .models import DocumentRevision


def save_revision(document, user=None):
    """현재 문서 상태를 수정 이력으로 저장한다."""

    return DocumentRevision.objects.create(
        document=document,
        version=document.version,
        title=document.title,
        menu_id_snapshot=document.menu_id,
        content=document.content,
        changed_by=user,
    )


def ensure_baseline(document):
    """
    기존 문서에 수정 이력이 없으면
    현재 상태를 최초 기준 버전으로 기록한다.
    """

    if not document.revisions.exists():
        save_revision(document, user=None)
