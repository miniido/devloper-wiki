from django.contrib import admin
from .models import Menu, Document


@admin.register(Menu)
class MenuAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "parent", "sort_order")
    list_filter = ("parent",)
    search_fields = ("name",)


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "menu", "created_by", "updated_at")
    list_filter = ("menu",)
    search_fields = ("title",)