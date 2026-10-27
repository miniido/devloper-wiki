from rest_framework import serializers
from .models import Menu, Document


class MenuSerializer(serializers.ModelSerializer):
    class Meta:
        model = Menu
        fields = ["id", "name", "parent", "sort_order"]


class DocumentSerializer(serializers.ModelSerializer):
    created_by = serializers.CharField(
        source="created_by.username",
        read_only=True,
    )

    class Meta:
        model = Document
        fields = [
            "id",
            "menu",
            "title",
            "content",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "created_at",
            "updated_at",
        ]