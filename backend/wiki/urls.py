from django.urls import path

from .views import (
    MenuListView,
    DocumentListCreateView,
    DocumentDetailView,
    csrf_token_view,
)

urlpatterns = [
    path("csrf/", csrf_token_view, name="csrf-token"),
    path("menus/", MenuListView.as_view(), name="menu-list"),
    path(
        "documents/",
        DocumentListCreateView.as_view(),
        name="document-list",
    ),
    path(
        "documents/<int:pk>/",
        DocumentDetailView.as_view(),
        name="document-detail",
    ),
]