
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

urlpatterns = [
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
]
