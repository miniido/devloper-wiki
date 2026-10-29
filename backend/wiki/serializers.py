from rest_framework import serializers

from .models import Menu, Document
from .access import has_menu_access, has_document_access
from .utils import extract_block_text

class MenuSerializer(serializers.ModelSerializer):
    can_create = serializers.SerializerMethodField()

    class Meta:
        model = Menu
        fields = [
            "id",
            "name",
            "parent",
            "sort_order",
            "can_create",
        ]

    def get_can_create(self, obj):
        user = self.context["request"].user

        return (
            user.has_perm("wiki.add_document")
            and has_menu_access(user, obj.id, "create")
        )


class DocumentSerializer(serializers.ModelSerializer):
    created_by = serializers.CharField(
        source="created_by.username",
        read_only=True,
    )

    can_edit = serializers.SerializerMethodField()

    def create(self, validated_data):
        validated_data["content_text"] = extract_block_text(
            validated_data.get("content", [])
        )
        return super().create(validated_data)


    def update(self, instance, validated_data):
        if "content" in validated_data:
            validated_data["content_text"] = extract_block_text(
                validated_data["content"]
            )

        return super().update(instance, validated_data)


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
            "can_edit",
            "version",
        ]

        read_only_fields = [
            "id",
            "created_by",
            "created_at",
            "updated_at",
        ]

    def get_can_edit(self, obj):
        user = self.context["request"].user

        return (
            user.has_perm("wiki.change_document")
            and has_document_access(user, obj.id, "edit")
        )