from django.contrib import admin
from .models import Menu, Document, MenuAccess, DocumentAccess


class MenuAccessInline(admin.TabularInline):
    model = MenuAccess
    extra = 0


class DocumentAccessInline(admin.TabularInline):
    model = DocumentAccess
    extra = 0


@admin.register(Menu)
class MenuAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "parent", "is_public", "sort_order")
    search_fields = ("name",)
    inlines = [MenuAccessInline]


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = (
        "id", "title", "menu",
        "use_custom_permissions", "updated_at",
    )
    list_filter = ("menu", "use_custom_permissions")
    search_fields = ("title",)
    inlines = [DocumentAccessInline]