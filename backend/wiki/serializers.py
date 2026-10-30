from rest_framework import serializers

from .models import Menu, Document
from .access import has_menu_access, has_document_access, can_manage_document_access, can_configure_document_creation
from .utils import extract_block_text
from rest_framework.exceptions import PermissionDenied
from .document_access_views import ensure_manager_role, managed_groups, validate_payload, apply_access_settings

class MenuSerializer(serializers.ModelSerializer):
    can_create = serializers.SerializerMethodField()
    can_manage_document_access = serializers.SerializerMethodField()

    class Meta:
        model = Menu
        fields = [
            "id",
            "name",
            "parent",
            "sort_order",
            "can_create",
            "can_manage_document_access",
        ]

    def get_can_create(self, obj):
        user = self.context["request"].user

        return (
            user.has_perm("wiki.add_document")
            and has_menu_access(user, obj.id, "create")
        )

    def get_can_manage_document_access(self, obj):
        return can_configure_document_creation(self.context["request"].user, obj.pk)


class DocumentSerializer(serializers.ModelSerializer):
    created_by = serializers.CharField(
        source="created_by.username",
        read_only=True,
    )

    can_edit = serializers.SerializerMethodField()
    can_manage_access = serializers.SerializerMethodField()
    can_delete_revisions = serializers.SerializerMethodField()
    can_view = serializers.SerializerMethodField()
    use_custom_permissions = serializers.BooleanField(required=False)
    access_groups = serializers.JSONField(write_only=True, required=False)

    def to_internal_value(self, data):
        if isinstance(data, dict) and ("use_custom_permissions" in data or "access_groups" in data):
            ensure_manager_role(self.context["request"].user)
        return super().to_internal_value(data)

    def validate(self, attrs):
        if "use_custom_permissions" in self.initial_data or "access_groups" in self.initial_data:
            user = self.context["request"].user
            if self.instance is not None:
                allowed = can_manage_document_access(user, self.instance)
            else:
                allowed = can_configure_document_creation(user, attrs["menu"].pk)
            if not allowed:
                raise PermissionDenied("문서 권한 설정을 변경할 수 없습니다.")
            mode, rules = validate_payload({
                "use_custom_permissions": self.initial_data.get("use_custom_permissions"),
                "groups": self.initial_data.get("access_groups"),
            }, managed_groups())
            attrs["use_custom_permissions"] = mode
            attrs["access_groups"] = rules
        return attrs

    def create(self, validated_data):
        rules = validated_data.pop("access_groups", None)
        validated_data["content_text"] = extract_block_text(
            validated_data.get("content", [])
        )
        document = super().create(validated_data)
        if rules is not None:
            apply_access_settings(document, document.use_custom_permissions, rules)
        return document


    def update(self, instance, validated_data):
        rules = validated_data.pop("access_groups", None)
        if "content" in validated_data:
            validated_data["content_text"] = extract_block_text(
                validated_data["content"]
            )

        document = super().update(instance, validated_data)
        if rules is not None:
            apply_access_settings(document, document.use_custom_permissions, rules)
        return document


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
            "can_manage_access",
            "can_delete_revisions",
            "can_view",
            "access_groups",
            "use_custom_permissions",
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
    def get_can_manage_access(self, obj):
        return can_manage_document_access(self.context["request"].user, obj)

    def get_can_view(self, obj):
        return has_document_access(self.context["request"].user, obj.pk)

    def get_can_delete_revisions(self, obj):
        return can_manage_document_access(self.context["request"].user, obj)
