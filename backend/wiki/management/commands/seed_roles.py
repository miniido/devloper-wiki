
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction


ROLE_PERMISSIONS = {
    "SYSTEM_ADMIN": [],
    "WIKI_ADMIN": [
        "wiki.view_menu",
        "wiki.add_menu",
        "wiki.change_menu",
        "wiki.delete_menu",
        "wiki.view_document",
        "wiki.add_document",
        "wiki.change_document",
        "wiki.delete_document",
    ],
    "AUTHOR": [
        "wiki.view_menu",
        "wiki.view_document",
        "wiki.add_document",
        "wiki.change_document",
    ],
    "VIEWER": [
        "wiki.view_menu",
        "wiki.view_document",
    ],
}


class Command(BaseCommand):
    help = "Developer Wiki 기본 역할을 생성합니다."

    @transaction.atomic
    def handle(self, *args, **options):
        for role_name, permission_codes in ROLE_PERMISSIONS.items():
            group, created = Group.objects.get_or_create(
                name=role_name,
            )

            if created:
                permissions = []

                for code in permission_codes:
                    app_label, codename = code.split(".")

                    permission = Permission.objects.get(
                        content_type__app_label=app_label,
                        codename=codename,
                    )
                    permissions.append(permission)

                group.permissions.set(permissions)

            status = "생성" if created else "기존 역할 유지"
            self.stdout.write(
                self.style.SUCCESS(f"{role_name}: {status}")
            )

        self.stdout.write(
            "SYSTEM_ADMIN은 별도 superuser 계정으로 운영합니다."
        )
