from copy import deepcopy
from unittest.mock import patch
from django.contrib.auth.models import Group, Permission, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from .models import Attachment, Document, DocumentAccess, DocumentRevision, Menu, MenuAccess
from .revisions import save_revision


class FeatureFixtures:
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser(username="root")
        cls.groups = {name: Group.objects.create(name=name) for name in ("WIKI_ADMIN", "AUTHOR", "VIEWER", "SYSTEM_ADMIN")}
        cls.users = {}
        for name in ("WIKI_ADMIN", "AUTHOR", "VIEWER"):
            user = User.objects.create_user(username=name.lower())
            user.groups.add(cls.groups[name])
            cls.users[name] = user
            cls.groups[name].permissions.add(*Permission.objects.filter(codename__in=["view_menu", "view_document"] + ([] if name == "VIEWER" else ["add_document", "change_document"])))
        cls.menu = Menu.objects.create(name="Engineering")
        for name in cls.users:
            MenuAccess.objects.create(menu=cls.menu, group=cls.groups[name], can_view=True, can_create=name != "VIEWER", can_edit=name != "VIEWER")
        cls.doc = Document.objects.create(menu=cls.menu, title="Guide", created_by=cls.admin)
        save_revision(cls.doc, user=cls.admin)

    def setUp(self):
        self.client = APIClient()
        self.client.force_login(self.admin)
        self.url = f"/api/documents/{self.doc.id}/"

    def permissions(self, mode=True, author_view=True, author_edit=True):
        return {"use_custom_permissions": mode, "access_groups": [{"group_id": self.groups[name].pk,
            "can_view": author_view if name == "AUTHOR" else name == "WIKI_ADMIN",
            "can_edit": author_edit if name == "AUTHOR" else name == "WIKI_ADMIN"} for name in ("WIKI_ADMIN", "AUTHOR", "VIEWER")]}


@override_settings(STORAGES={"default": {"BACKEND": "django.core.files.storage.InMemoryStorage"}})
class CombinedDocumentSaveTests(FeatureFixtures, TestCase):
    def create(self, **extra):
        return self.client.post("/api/documents/", {"menu": self.menu.pk, "title": "Created", "content": [], **extra}, format="json")

    def test_legacy_default_creation_and_options(self):
        self.client.force_login(self.users["AUTHOR"])
        response = self.create()
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.json()["use_custom_permissions"])
        self.assertFalse(DocumentAccess.objects.filter(document_id=response.json()["id"]).exists())
        self.client.force_login(self.admin)
        response = self.client.get(f"/api/documents/access-options/?menu={self.menu.pk}")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["document_id"])
        self.assertFalse(response.json()["use_custom_permissions"])
        self.assertEqual({row["group_id"] for row in response.json()["groups"]}, {self.groups[n].pk for n in ("WIKI_ADMIN", "AUTHOR", "VIEWER")})
        for user in (self.admin, self.users["WIKI_ADMIN"]):
            self.client.force_login(user)
            self.assertTrue(self.client.get("/api/menus/").json()[0]["can_manage_document_access"])
        for role in ("AUTHOR", "VIEWER"):
            self.client.force_login(self.users[role])
            self.assertEqual(self.client.get(f"/api/documents/access-options/?menu={self.menu.pk}").status_code, 403)
            self.assertFalse(self.client.get("/api/menus/").json()[0]["can_manage_document_access"])

    def test_admin_creation_with_custom_rules_and_initial_revision(self):
        for user in (self.admin, self.users["WIKI_ADMIN"]):
            self.client.force_login(user)
            response = self.create(**self.permissions())
            self.assertEqual(response.status_code, 201)
            document = Document.objects.get(pk=response.json()["id"])
            self.assertTrue(document.use_custom_permissions)
            self.assertEqual(document.access_rules.count(), 3)
            self.assertEqual(document.revisions.count(), 1)
            self.assertEqual(document.revisions.get().version, 1)

    def test_creation_failure_rolls_back_document_rules_and_history(self):
        before = Document.objects.count()
        with patch("wiki.views.save_revision", side_effect=RuntimeError("test failure")):
            with self.assertRaises(RuntimeError):
                self.create(**self.permissions())
        self.assertEqual(Document.objects.count(), before)
        self.assertFalse(DocumentAccess.objects.exists())
        self.assertEqual(DocumentRevision.objects.count(), 1)

    def test_unauthorized_fields_are_explicitly_rejected(self):
        for role in ("AUTHOR", "VIEWER"):
            self.client.force_login(self.users[role])
            for payload in ({"use_custom_permissions": False}, {"access_groups": []}, self.permissions()):
                self.assertEqual(self.create(**payload).status_code, 403)
                response = self.client.patch(self.url, {"version": 1, **payload}, format="json")
                self.assertEqual(response.status_code, 403)
        self.doc.refresh_from_db()
        self.assertFalse(self.doc.use_custom_permissions)
        self.assertEqual(self.doc.title, "Guide")

    def test_content_and_access_update_together(self):
        self.client.force_login(self.users["WIKI_ADMIN"])
        response = self.client.patch(self.url, {"version": 1, "title": "Updated", **self.permissions(author_edit=False)}, format="json")
        self.assertEqual(response.status_code, 200)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.title, "Updated")
        self.assertEqual(self.doc.version, 2)
        self.assertTrue(self.doc.use_custom_permissions)
        self.assertEqual(self.doc.revisions.count(), 2)
        self.client.force_login(self.users["AUTHOR"])
        self.assertFalse(self.client.get(self.url).json()["can_edit"])
        self.assertEqual(self.client.patch(self.url, {"version": 2, "title": "Denied"}, format="json").status_code, 403)

    def test_update_failure_rolls_back_everything(self):
        before = (self.doc.title, self.doc.version, self.doc.updated_at, self.doc.revisions.count())
        with patch("wiki.views.save_revision", side_effect=RuntimeError("test failure")):
            with self.assertRaises(RuntimeError):
                self.client.patch(self.url, {"version": 1, "title": "Rollback", **self.permissions()}, format="json")
        self.doc.refresh_from_db()
        self.assertEqual((self.doc.title, self.doc.version, self.doc.updated_at, self.doc.revisions.count()), before)
        self.assertFalse(self.doc.use_custom_permissions)
        self.assertFalse(DocumentAccess.objects.exists())

    def test_permissions_only_update_preserves_content_metadata(self):
        previous = (self.doc.title, self.doc.content, self.doc.version, self.doc.updated_at)
        self.assertEqual(self.client.patch(self.url, {"version": 1, **self.permissions()}, format="json").status_code, 200)
        rows = list(DocumentAccess.objects.values().order_by("id"))
        self.assertEqual(self.client.patch(self.url, {"version": 1, **self.permissions(mode=False)}, format="json").status_code, 200)
        self.doc.refresh_from_db()
        self.assertEqual((self.doc.title, self.doc.content, self.doc.version, self.doc.updated_at), previous)
        self.assertEqual(list(DocumentAccess.objects.values().order_by("id")), rows)
        self.assertEqual(self.doc.revisions.count(), 1)

    def test_invalid_or_stale_save_does_not_write(self):
        bad = [{"use_custom_permissions": True}, {"access_groups": []}]
        for mode in ("true", 0, None):
            body = self.permissions(); body["use_custom_permissions"] = mode; bad.append(body)
        body = self.permissions(); body["access_groups"][0]["group_id"] = 99999; bad.append(body)
        body = self.permissions(); body["access_groups"][1] = deepcopy(body["access_groups"][0]); bad.append(body)
        for body in bad:
            self.assertEqual(self.create(**body).status_code, 400)
            self.assertEqual(self.client.patch(self.url, {"version": 1, "title": "Invalid", **body}, format="json").status_code, 400)
        self.assertEqual(self.client.patch(self.url, {"version": 99, "title": "Stale", **self.permissions()}, format="json").status_code, 409)
        self.assertEqual(Document.objects.count(), 1)
        self.assertFalse(DocumentAccess.objects.exists())
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.title, "Guide")

    def test_custom_cannot_override_menu_or_direct_file_access(self):
        response = self.create(**self.permissions(author_view=False, author_edit=False))
        document = Document.objects.get(pk=response.json()["id"])
        attachment = Attachment.objects.create(document=document, uploaded_by=self.admin, file=SimpleUploadedFile("a.txt", b"a"), original_name="a.txt", file_size=1)
        image = Attachment.objects.create(document=document, uploaded_by=self.admin, file=SimpleUploadedFile("a.png", b"fixture"), original_name="a.png", file_size=7, purpose="INLINE")
        self.client.force_login(self.users["AUTHOR"])
        url = f"/api/documents/{document.pk}/"
        for path in (url, url + "attachments/", f"/api/attachments/{attachment.pk}/download/", f"/api/attachments/{image.pk}/preview/"):
            self.assertEqual(self.client.get(path).status_code, 404)
        self.client.force_login(self.admin)
        self.assertEqual(self.client.patch(url, {"version": 1, **self.permissions()}, format="json").status_code, 200)
        MenuAccess.objects.filter(menu=self.menu, group=self.groups["AUTHOR"]).delete()
        self.client.force_login(self.users["AUTHOR"])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.patch(url, {"version": 1, "title": "No"}, format="json").status_code, 404)
        self.client.force_login(self.users["WIKI_ADMIN"])
        MenuAccess.objects.filter(menu=self.menu, group=self.groups["WIKI_ADMIN"]).delete()
        self.assertEqual(self.create(**self.permissions()).status_code, 403)

    def test_legacy_content_save_preserves_custom_and_unmanaged_group(self):
        DocumentAccess.objects.create(document=self.doc, group=self.groups["SYSTEM_ADMIN"], can_view=True)
        self.assertEqual(self.client.patch(self.url, {"version": 1, **self.permissions()}, format="json").status_code, 200)
        self.client.force_login(self.users["AUTHOR"])
        self.assertEqual(self.client.patch(self.url, {"version": 1, "title": "Legacy"}, format="json").status_code, 200)
        self.doc.refresh_from_db()
        self.assertTrue(self.doc.use_custom_permissions)
        self.assertEqual(self.doc.access_rules.count(), 4)
        self.assertTrue(self.doc.access_rules.get(group=self.groups["SYSTEM_ADMIN"]).can_view)


class RevisionDeleteTests(FeatureFixtures, TestCase):
    def setUp(self):
        super().setUp()
        # 이력 DB ID와 버전이 다르도록 다른 문서 이력을 사이에 생성한다.
        other = Document.objects.create(menu=self.menu, title="Other", created_by=self.admin)
        self.foreign = save_revision(other, user=self.admin)
        self.doc.version = 2
        self.doc.save()
        self.past = save_revision(self.doc, user=self.admin)
        self.doc.version = 4
        self.doc.save()
        self.current = save_revision(self.doc, user=self.admin)

    def delete_url(self, revision):
        return f"{self.url}revisions/by-id/{revision.pk}/"

    def test_manager_delete_by_id_and_document_unchanged(self):
        before = (self.doc.title, self.doc.content, self.doc.version, self.doc.updated_at)
        self.client.force_login(self.users["WIKI_ADMIN"])
        self.assertNotEqual(self.past.pk, self.past.version)
        self.assertEqual(self.client.delete(self.delete_url(self.past)).status_code, 204)
        self.doc.refresh_from_db()
        self.assertEqual((self.doc.title, self.doc.content, self.doc.version, self.doc.updated_at), before)
        self.assertEqual(list(self.doc.revisions.values_list("version", flat=True)), [4, 1])
        self.assertEqual(self.client.get(self.url + "revisions/2/").status_code, 404)
        self.assertEqual(self.client.post(self.url + "revisions/2/restore/", {"version": 4}, format="json").status_code, 404)

    def test_author_viewer_and_unauthenticated_delete_denied(self):
        for role in ("AUTHOR", "VIEWER"):
            self.client.force_login(self.users[role])
            self.assertEqual(self.client.delete(self.delete_url(self.past)).status_code, 403)
            self.assertFalse(self.client.get(self.url).json()["can_delete_revisions"])
            self.assertTrue(all(not row["can_delete"] for row in self.client.get(self.url + "revisions/").json()))
        self.client.logout()
        self.assertIn(self.client.delete(self.delete_url(self.past)).status_code, (401, 403))
        self.assertTrue(DocumentRevision.objects.filter(pk=self.past.pk).exists())

    def test_current_future_and_last_history_protected(self):
        self.assertEqual(self.client.delete(self.delete_url(self.current)).status_code, 409)
        future = DocumentRevision.objects.create(document=self.doc, version=99, title="Future", content=[], menu_id_snapshot=self.menu.pk, changed_by=self.admin)
        self.assertEqual(self.client.delete(self.delete_url(future)).status_code, 409)
        future.delete()
        self.doc.revisions.exclude(pk=self.past.pk).delete()
        self.assertEqual(self.client.delete(self.delete_url(self.past)).status_code, 409)
        self.assertEqual(self.doc.revisions.count(), 1)
        # 최신의 의미는 목록의 최대값이 아닌 실제 document.version이다.
        rows = self.client.get(self.url + "revisions/").json()
        self.assertFalse(rows[0]["can_delete"])

    def test_foreign_and_missing_revision_return_404(self):
        self.assertEqual(self.client.delete(self.delete_url(self.foreign)).status_code, 404)
        self.assertEqual(self.client.delete(self.url + "revisions/by-id/999999/").status_code, 404)
        self.assertTrue(DocumentRevision.objects.filter(pk=self.foreign.pk).exists())
        self.assertEqual(self.client.delete(self.delete_url(self.past)).status_code, 204)
        self.assertEqual(self.client.delete(self.delete_url(self.past)).status_code, 404)

    def test_menu_and_custom_access_are_required(self):
        self.client.force_login(self.users["WIKI_ADMIN"])
        MenuAccess.objects.filter(group=self.groups["WIKI_ADMIN"], menu=self.menu).update(can_edit=False)
        self.assertEqual(self.client.delete(self.delete_url(self.past)).status_code, 403)
        MenuAccess.objects.filter(group=self.groups["WIKI_ADMIN"], menu=self.menu).update(can_edit=True)
        self.doc.use_custom_permissions = True
        self.doc.save()
        self.assertEqual(self.client.delete(self.delete_url(self.past)).status_code, 403)

    def test_remaining_restore_creates_new_current_history(self):
        self.assertEqual(self.client.delete(self.delete_url(self.past)).status_code, 204)
        self.assertEqual(self.client.post(self.url + "revisions/1/restore/", {"version": 4}, format="json").status_code, 200)
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.version, 5)
        new_current = self.doc.revisions.get(version=5)
        self.assertEqual(self.client.delete(self.delete_url(new_current)).status_code, 409)
        self.assertEqual(self.client.delete(self.delete_url(self.current)).status_code, 204)
        self.assertEqual(list(self.doc.revisions.values_list("version", flat=True)), [5, 1])

    def test_delete_rolls_back_on_failure(self):
        original = DocumentRevision.delete
        def fail_after_delete(instance, *args, **kwargs):
            original(instance, *args, **kwargs)
            raise RuntimeError("test rollback")
        with patch.object(DocumentRevision, "delete", fail_after_delete):
            with self.assertRaises(RuntimeError):
                self.client.delete(self.delete_url(self.past))
        self.assertTrue(DocumentRevision.objects.filter(pk=self.past.pk).exists())

    def test_csrf_delete_required(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.admin)
        self.assertEqual(client.delete(self.delete_url(self.past)).status_code, 403)
        client.get("/api/csrf/")
        self.assertEqual(client.delete(self.delete_url(self.past), HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value).status_code, 204)
