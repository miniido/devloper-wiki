from .registration_views import RegistrationRequestView, RegistrationManagementView, RegistrationReviewView
from .document_access_views import DocumentAccessManagementView, DocumentAccessOptionsView
from .revision_views import DocumentRevisionDeleteView

from django.urls import path

from .views import (
    MenuListView,
    DocumentListCreateView,
    DocumentDetailView,
    csrf_token_view,
)

from .auth_views import (
    me_view,
    login_view,
    logout_view,
)

from .attachment_views import (
    DocumentAttachmentView,
    AttachmentDownloadView,
)

from .attachment_views import (
    DocumentAttachmentView,
    AttachmentDownloadView,
    AttachmentDeleteView,
)

from .revision_views import (
    DocumentRevisionListView,
    DocumentRevisionDetailView,
    DocumentRevisionRestoreView,
)

from .attachment_views import AttachmentPreviewView

from .menu_management_views import (
    MenuManagementListView,
    MenuManagementDetailView,
)

from .user_management_views import (
    UserManagementListView,
    UserManagementDetailView,
    UserPasswordResetView,
)

from .menu_access_views import MenuAccessManagementView

urlpatterns = [
    path("auth/registration-requests/", RegistrationRequestView.as_view(), name="registration-request"),
    path("registration-management/", RegistrationManagementView.as_view(), name="registration-list"),
    path("registration-management/<int:request_id>/approve/", RegistrationReviewView.as_view(approve=True), name="registration-approve"),
    path("registration-management/<int:request_id>/reject/", RegistrationReviewView.as_view(), name="registration-reject"),
    path("documents/access-options/", DocumentAccessOptionsView.as_view(), name="document-access-options"),
    path("documents/<int:document_id>/revisions/by-id/<int:revision_id>/", DocumentRevisionDeleteView.as_view(), name="revision-delete"),
    path("documents/<int:document_id>/access/", DocumentAccessManagementView.as_view(), name="document-access-management"),
    path("csrf/", csrf_token_view, name="csrf-token"),

    path("auth/me/", me_view, name="auth-me"),
    path("auth/login/", login_view, name="auth-login"),
    path("auth/logout/", logout_view, name="auth-logout"),

    path("menus/", MenuListView.as_view(), name="menu-list"),
    path("documents/", DocumentListCreateView.as_view(), name="document-list"),
    path(
        "documents/<int:pk>/",
        DocumentDetailView.as_view(),
        name="document-detail",
    ),
    path(
        "documents/<int:document_id>/attachments/",
        DocumentAttachmentView.as_view(),
        name="document-attachments",
    ),
    path(
        "attachments/<int:attachment_id>/download/",
        AttachmentDownloadView.as_view(),
        name="attachment-download",
    ),
    path(
        "attachments/<int:attachment_id>/",
        AttachmentDeleteView.as_view(),
        name="attachment-delete",
    ),
    path(
        "attachments/<int:attachment_id>/preview/",
        AttachmentPreviewView.as_view(),
        name="attachment-preview",
    ),
    path(
        "documents/<int:document_id>/revisions/",
        DocumentRevisionListView.as_view(),
    ),
    path(
        "documents/<int:document_id>/revisions/<int:version>/",
        DocumentRevisionDetailView.as_view(),
    ),
    path(
        "documents/<int:document_id>/revisions/<int:version>/restore/",
        DocumentRevisionRestoreView.as_view(),
    ),
    path(
        "menu-management/",
        MenuManagementListView.as_view(),
    ),
    path(
        "menu-management/<int:menu_id>/",
        MenuManagementDetailView.as_view(),
    ),
    path(
        "user-management/",
        UserManagementListView.as_view(),
        name="user-management",
    ),
    path(
        "user-management/<int:user_id>/",
        UserManagementDetailView.as_view(),
        name="user-management-detail",
    ),
    path(
        "user-management/<int:user_id>/reset-password/",
        UserPasswordResetView.as_view(),
        name="user-password-reset",
    ),
    path(
        "menu-management/<int:menu_id>/access/",
        MenuAccessManagementView.as_view(),
        name="menu-access-management",
    ),
]
