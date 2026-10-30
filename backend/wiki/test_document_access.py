from copy import deepcopy
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth.models import Group, Permission, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from .models import Attachment, Document, DocumentAccess, Menu, MenuAccess
from .revisions import save_revision


@override_settings(STORAGES={"default": {"BACKEND": "django.core.files.storage.InMemoryStorage"}})
class DocumentAccessAPITests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = User.objects.create_superuser(username="root")
        cls.groups = {name: Group.objects.create(name=name) for name in ("WIKI_ADMIN", "AUTHOR", "VIEWER", "SYSTEM_ADMIN", "OTHER")}
        cls.members = {}
        for name in ("WIKI_ADMIN", "AUTHOR", "VIEWER"):
            permissions = ["view_menu", "view_document"]
            if name != "VIEWER":
                permissions += ["add_document", "change_document"]
            cls.groups[name].permissions.add(*Permission.objects.filter(codename__in=permissions))
            cls.members[name] = User.objects.create_user(username=name.lower())
            cls.members[name].groups.add(cls.groups[name])
        cls.menu = Menu.objects.create(name="Private")
        for name in cls.members:
            MenuAccess.objects.create(menu=cls.menu, group=cls.groups[name], can_view=True, can_create=name != "VIEWER", can_edit=name != "VIEWER")
        cls.doc = Document.objects.create(menu=cls.menu, title="Guide", created_by=cls.admin)
        cls.other = Document.objects.create(menu=cls.menu, title="Other", created_by=cls.admin)
        save_revision(cls.doc, user=cls.admin)

    def setUp(self):
        self.client = APIClient()
        self.client.force_login(self.admin)
        self.url = f"/api/documents/{self.doc.id}/access/"
        self.detail = f"/api/documents/{self.doc.id}/"
        self.file = Attachment.objects.create(document=self.doc, file=SimpleUploadedFile("guide.txt", b"knowledge"), original_name="guide.txt", file_size=9, uploaded_by=self.admin)
        image = BytesIO()
        Image.new("RGB", (2, 2)).save(image, format="PNG")
        self.image = Attachment.objects.create(document=self.doc, file=SimpleUploadedFile("image.png", image.getvalue()), original_name="image.png", file_size=len(image.getvalue()), uploaded_by=self.admin, purpose="INLINE")

    def payload(self, mode=True, **author):
        return {"use_custom_permissions": mode, "groups": [{"group_id": self.groups[name].id,
            "can_view": author.get("can_view", True) if name == "AUTHOR" else name == "WIKI_ADMIN",
            "can_edit": author.get("can_edit", True) if name == "AUTHOR" else name == "WIKI_ADMIN"}
            for name in ("WIKI_ADMIN", "AUTHOR", "VIEWER")]}

    def put(self, body):
        return self.client.put(self.url, body, format="json")

    def test_superuser_and_wiki_admin_get_and_put(self):
        for manager in (self.admin, self.members["WIKI_ADMIN"]):
            self.client.force_login(manager)
            result = self.client.get(self.url)
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result.json()["document_id"], self.doc.id)
            self.assertEqual([g["group_name"] for g in result.json()["groups"]], ["WIKI_ADMIN", "AUTHOR", "VIEWER"])
            self.assertEqual(self.put(self.payload()).status_code, 200)
            self.assertTrue(self.client.get(self.detail).json()["can_manage_access"])

    def test_author_viewer_anonymous_and_inactive_denied(self):
        for member in (self.members["AUTHOR"], self.members["VIEWER"]):
            self.client.force_login(member)
            self.assertEqual(self.client.get(self.url).status_code, 403)
            self.assertEqual(self.put(self.payload()).status_code, 403)
            self.assertFalse(self.client.get(self.detail).json()["can_manage_access"])
        self.client.logout()
        self.assertIn(self.client.get(self.url).status_code, (401, 403))
        self.assertIn(self.put(self.payload()).status_code, (401, 403))
        member = self.members["WIKI_ADMIN"]
        member.is_active = False
        member.save()
        self.client.force_login(member)
        self.assertIn(self.client.get(self.url).status_code, (401, 403))
        self.assertIn(self.put(self.payload()).status_code, (401, 403))

    def test_manager_needs_global_and_menu_edit_and_custom_edit(self):
        manager = self.members["WIKI_ADMIN"]
        self.groups["WIKI_ADMIN"].permissions.remove(Permission.objects.get(codename="change_document"))
        self.client.force_login(manager)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.put(self.payload()).status_code, 403)
        self.groups["WIKI_ADMIN"].permissions.add(Permission.objects.get(codename="change_document"))
        MenuAccess.objects.filter(group=self.groups["WIKI_ADMIN"]).update(can_edit=False)
        self.client.force_login(manager)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.put(self.payload()).status_code, 403)
        MenuAccess.objects.filter(group=self.groups["WIKI_ADMIN"]).update(can_edit=True)
        self.client.force_login(self.admin)
        body = self.payload()
        body["groups"][0]["can_edit"] = False
        self.assertEqual(self.put(body).status_code, 200)
        self.client.force_login(manager)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.put(self.payload()).status_code, 403)
        self.assertFalse(self.client.get(self.detail).json()["can_manage_access"])

    def test_custom_off_preserves_settings_and_restores_menu_access(self):
        self.assertEqual(self.put(self.payload(can_view=False, can_edit=False)).status_code, 200)
        self.client.force_login(self.members["AUTHOR"])
        self.assertEqual(self.client.get(self.detail).status_code, 404)
        self.assertEqual(self.client.get("/api/documents/?q=Guide").json(), [])
        self.client.force_login(self.admin)
        previous = list(DocumentAccess.objects.filter(document=self.doc).values().order_by("id"))
        self.assertEqual(self.put(self.payload(mode=False, can_view=False, can_edit=False)).status_code, 200)
        self.assertEqual(list(DocumentAccess.objects.filter(document=self.doc).values().order_by("id")), previous)
        self.client.force_login(self.members["AUTHOR"])
        response = self.client.get(self.detail)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["can_edit"])
        self.client.force_login(self.admin)
        self.assertEqual(self.put(self.payload(can_view=False, can_edit=False)).status_code, 200)
        self.client.force_login(self.members["AUTHOR"])
        self.assertEqual(self.client.get(self.detail).status_code, 404)

    def assert_read_endpoints_denied(self):
        paths = [self.detail, self.detail + "attachments/", self.detail + "revisions/", self.detail + "revisions/1/",
                 f"/api/attachments/{self.file.id}/download/", f"/api/attachments/{self.image.id}/preview/", f"/api/attachments/{self.image.id}/download/"]
        for url in paths:
            with self.subTest(url=url):
                self.assertIn(self.client.get(url).status_code, (403, 404))
        self.assertEqual(self.client.get("/api/documents/?q=Guide").json(), [])

    def test_custom_cannot_bypass_menu_restriction(self):
        self.assertEqual(self.put(self.payload()).status_code, 200)
        MenuAccess.objects.filter(group=self.groups["AUTHOR"], menu=self.menu).delete()
        self.client.force_login(self.members["AUTHOR"])
        self.assert_read_endpoints_denied()
        self.assertEqual(self.client.patch(self.detail, {"title": "Denied", "version": 1}, format="json").status_code, 404)
        self.assertEqual(self.client.post(self.detail + "attachments/", {"file": SimpleUploadedFile("no.txt", b"no")}, format="multipart").status_code, 404)
        self.assertEqual(self.client.delete(f"/api/attachments/{self.file.id}/").status_code, 404)
        self.assertEqual(self.client.post(self.detail + "revisions/1/restore/", {"version": 1}, format="json").status_code, 404)

    def test_custom_denial_covers_files_images_history_and_save(self):
        self.assertEqual(self.put(self.payload(can_view=False, can_edit=False)).status_code, 200)
        self.client.force_login(self.members["AUTHOR"])
        self.assert_read_endpoints_denied()
        self.assertEqual(self.client.patch(self.detail, {"title": "Denied", "version": 1}, format="json").status_code, 404)
        self.assertEqual(self.client.post(self.detail + "attachments/", {"file": SimpleUploadedFile("no.txt", b"no")}, format="multipart").status_code, 404)
        self.assertEqual(self.client.post(self.detail + "revisions/1/restore/", {"version": 1}, format="json").status_code, 404)

    def test_read_only_custom_can_read_but_cannot_write(self):
        self.assertEqual(self.put(self.payload(can_edit=False)).status_code, 200)
        self.client.force_login(self.members["AUTHOR"])
        self.assertEqual(self.client.get(self.detail).status_code, 200)
        self.assertFalse(self.client.get(self.detail).json()["can_edit"])
        for url in (f"/api/attachments/{self.file.id}/download/", f"/api/attachments/{self.image.id}/preview/"):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(b"".join(response.streaming_content))
        self.assertEqual(self.client.patch(self.detail, {"title": "Denied", "version": 1}, format="json").status_code, 403)
        self.assertEqual(self.client.post(self.detail + "attachments/", {"file": SimpleUploadedFile("no.txt", b"no")}, format="multipart").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/attachments/{self.file.id}/").status_code, 403)
        self.assertEqual(self.client.post(self.detail + "revisions/1/restore/", {"version": 1}, format="json").status_code, 403)

    def test_global_view_is_required_for_files_and_history(self):
        self.assertEqual(self.put(self.payload()).status_code, 200)
        self.groups["AUTHOR"].permissions.remove(Permission.objects.get(codename="view_document"))
        self.client.force_login(self.members["AUTHOR"])
        for url in (self.detail, self.detail + "attachments/", self.detail + "revisions/", self.detail + "revisions/1/", f"/api/attachments/{self.file.id}/download/", f"/api/attachments/{self.image.id}/preview/"):
            self.assertIn(self.client.get(url).status_code, (403, 404))
        self.assertEqual(self.client.get("/api/documents/").status_code, 403)

    def test_global_edit_still_required(self):
        self.assertEqual(self.put(self.payload()).status_code, 200)
        self.groups["AUTHOR"].permissions.remove(Permission.objects.get(codename="change_document"))
        self.client.force_login(self.members["AUTHOR"])
        self.assertFalse(self.client.get(self.detail).json()["can_edit"])
        self.assertEqual(self.client.patch(self.detail, {"title": "Denied", "version": 1}, format="json").status_code, 403)
        self.assertEqual(self.client.post(self.detail + "attachments/", {"file": SimpleUploadedFile("no.txt", b"no")}, format="multipart").status_code, 403)

    def test_custom_edit_positive(self):
        self.assertEqual(self.put(self.payload()).status_code, 200)
        self.client.force_login(self.members["AUTHOR"])
        self.assertEqual(self.client.patch(self.detail, {"title": "Updated", "version": 1}, format="json").status_code, 200)
        self.assertEqual(self.client.post(self.detail + "attachments/", {"file": SimpleUploadedFile("new.txt", b"new")}, format="multipart").status_code, 201)
        self.assertEqual(self.client.delete(f"/api/attachments/{self.file.id}/").status_code, 204)

    def test_unmanaged_groups_and_other_documents_preserved(self):
        for name in ("SYSTEM_ADMIN", "OTHER"):
            DocumentAccess.objects.create(document=self.doc, group=self.groups[name], can_view=True, can_edit=True)
        other_rule = DocumentAccess.objects.create(document=self.other, group=self.groups["AUTHOR"], can_view=True)
        self.assertEqual(self.put(self.payload()).status_code, 200)
        self.assertEqual(self.put(self.payload(mode=False)).status_code, 200)
        self.assertEqual(DocumentAccess.objects.filter(document=self.doc, group__name__in=["SYSTEM_ADMIN", "OTHER"], can_edit=True).count(), 2)
        self.assertTrue(DocumentAccess.objects.filter(pk=other_rule.pk, can_view=True, can_edit=False).exists())
        self.doc.refresh_from_db()
        self.assertEqual(self.doc.version, 1)
        self.assertEqual(self.doc.content, [])

    def test_invalid_data_is_rejected_without_partial_writes(self):
        self.assertEqual(self.put(self.payload()).status_code, 200)
        valid = self.payload(mode=False)
        bad = [[], None, "invalid", {}, {"use_custom_permissions": False, "groups": []}]
        for value in (0, 1, "true", None):
            body = deepcopy(valid); body["use_custom_permissions"] = value; bad.append(body)
        for value in (999999, self.groups["SYSTEM_ADMIN"].id, True, "1", None):
            body = deepcopy(valid); body["groups"][0]["group_id"] = value; bad.append(body)
        for value in (0, 1, "true", None, {}):
            body = deepcopy(valid); body["groups"][1]["can_edit"] = value; bad.append(body)
        duplicate = deepcopy(valid); duplicate["groups"][1] = duplicate["groups"][0]; bad.append(duplicate)
        missing = deepcopy(valid); del missing["groups"][0]["can_view"]; bad.append(missing)
        bad.append({"use_custom_permissions": False, "groups": [None] * 3})
        bad.append(self.payload(mode=False, can_view=False, can_edit=True))
        snapshot = list(DocumentAccess.objects.values().order_by("id"))
        for body in bad:
            with self.subTest(body=body):
                self.assertEqual(self.put(body).status_code, 400)
                self.doc.refresh_from_db()
                self.assertTrue(self.doc.use_custom_permissions)
                self.assertEqual(list(DocumentAccess.objects.values().order_by("id")), snapshot)

    def test_mode_and_group_rules_roll_back_together(self):
        with patch.object(Document, "save", side_effect=RuntimeError("test rollback")):
            with self.assertRaises(RuntimeError):
                self.put(self.payload())
        self.doc.refresh_from_db()
        self.assertFalse(self.doc.use_custom_permissions)
        self.assertFalse(DocumentAccess.objects.filter(document=self.doc).exists())

    def test_ordinary_document_patch_cannot_change_mode(self):
        self.client.force_login(self.members["AUTHOR"])
        response = self.client.patch(self.detail, {"use_custom_permissions": True, "version": 1}, format="json")
        self.assertEqual(response.status_code, 403)
        self.doc.refresh_from_db()
        self.assertFalse(self.doc.use_custom_permissions)

    def test_superuser_bypass_and_missing_document(self):
        self.assertEqual(self.put(self.payload(can_view=False, can_edit=False)).status_code, 200)
        MenuAccess.objects.all().delete()
        self.assertEqual(self.client.get(self.detail).status_code, 200)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        response = self.client.get(f"/api/attachments/{self.image.id}/preview/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(b"".join(response.streaming_content))
        self.assertEqual(self.client.get("/api/documents/999999/access/").status_code, 404)
        self.assertEqual(self.client.put("/api/documents/999999/access/", self.payload(), format="json").status_code, 404)

    def test_csrf_required(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.admin)
        self.assertEqual(client.put(self.url, self.payload(), format="json").status_code, 403)
        client.get("/api/csrf/")
        self.assertEqual(client.put(self.url, self.payload(), format="json", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value).status_code, 200)
