from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from .models import Menu, Document
from .serializers import MenuSerializer, DocumentSerializer
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie

class MenuListView(generics.ListAPIView):
    queryset = Menu.objects.all()
    serializer_class = MenuSerializer
    permission_classes = [IsAuthenticated]


class DocumentListCreateView(generics.ListCreateAPIView):
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = Document.objects.select_related(
            "menu", "created_by"
        ).order_by("-updated_at")

        menu_id = self.request.query_params.get("menu")

        if menu_id:
            queryset = queryset.filter(menu_id=menu_id)

        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)


class DocumentDetailView(generics.RetrieveUpdateAPIView):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated]

@ensure_csrf_cookie
def csrf_token_view(request):
    return JsonResponse({"detail": "CSRF cookie issued"})