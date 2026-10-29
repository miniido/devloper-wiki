from django.contrib import admin
from .models import Menu, Document, MenuAccess


class MenuAccessInline(admin.TabularInline):
    model = MenuAccess
    extra = 1


@admin.register(Menu)
class MenuAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "parent", "sort_order")
    search_fields = ("name",)
    list_filter = ("parent",)
    inlines = [MenuAccessInline]


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = (
        "id", "title", "menu",
        "created_by", "updated_at",
    )
    list_filter = ("menu",)
    search_fields = ("title",)