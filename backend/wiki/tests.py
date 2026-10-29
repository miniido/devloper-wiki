import tempfile
from io import BytesIO
from django.contrib.auth.models import Group, Permission, User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient
from .models import Menu, MenuAccess, Document, DocumentAccess


class WikiRegressionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_superuser(username="admin", password="test-only")
        self.author = User.objects.create_user(username="author", password="test-only")
        self.viewer = User.objects.create_user(username="viewer", password="test-only")
        for user, name in [(self.author, "AUTHOR"), (self.viewer, "VIEWER")]:
            group = Group.objects.create(name=name)
            user.groups.add(group)
            group.permissions.add(*Permission.objects.filter(codename__in=["view_menu", "view_document"]))
        self.author.user_permissions.add(*Permission.objects.filter(codename__in=["add_document", "change_document"]))
        self.menu = Menu.objects.create(name="Engineering", is_public=True)
        self.private = Menu.objects.create(name="Private")
        MenuAccess.objects.create(menu=self.menu, group=self.author.groups.first(), can_view=True, can_create=True, can_edit=True)
        self.doc = Document.objects.create(menu=self.menu, title="Guide", content=[], created_by=self.admin)

    def test_auth_roles_and_anonymous(self):
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 401)
        for user, label in [(self.admin, "관리자"), (self.author, "작성자"), (self.viewer, "열람자")]:
            self.client.force_login(user)
            data = self.client.get("/api/auth/me/").json()
            self.assertEqual(data["role_label"], label)
            self.assertEqual(data["can_manage_menus"], user == self.admin)

    def test_administration_uses_actual_permissions(self):
        for user in [self.author, self.viewer]:
            self.client.force_login(user)
            data = self.client.get("/api/menu-management/").json()
            self.assertFalse(data["can_add"])
            self.assertEqual(data["menus"], [])
            self.assertEqual(self.client.post("/api/menu-management/", {"name": "Forbidden"}).status_code, 403)
            self.assertEqual(self.client.patch(f"/api/menu-management/{self.menu.id}/", {"name": "Forbidden"}).status_code, 403)
            self.assertEqual(self.client.delete(f"/api/menu-management/{self.menu.id}/").status_code, 403)

    def test_menu_visibility_and_creation_scope(self):
        self.client.force_login(self.author)
        menus = self.client.get("/api/menus/").json()
        self.assertEqual([menu["id"] for menu in menus], [self.menu.id])
        self.assertTrue(menus[0]["can_create"])
        response = self.client.post("/api/documents/", {"menu": self.private.id, "title": "Denied", "content": []}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Document.objects.filter(title="Denied").exists())

    def test_create_edit_search_restore_and_conflict(self):
        self.client.force_login(self.author)
        response = self.client.post("/api/documents/", {"menu": self.menu.id, "title": "Original", "content": []}, format="json")
        self.assertEqual(response.status_code, 201)
        doc_id = response.json()["id"]
        url = f"/api/documents/{doc_id}/"
        content = [{"type": "paragraph", "content": [{"type": "text", "text": "searchable-body", "styles": {}}]}]
        response = self.client.patch(url, {"title": "Updated", "content": content, "version": 1}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["version"], 2)
        self.assertEqual(self.client.patch(url, {"title": "Stale", "version": 1}, format="json").status_code, 409)
        self.assertEqual(len(self.client.get("/api/documents/?q=searchable-body").json()), 1)
        revisions = self.client.get(f"{url}revisions/").json()
        self.assertEqual(len(revisions), 2)
        self.assertEqual(self.client.get(f"{url}revisions/1/").json()["title"], "Original")
        self.assertEqual(self.client.post(f"{url}revisions/1/restore/", {"version": 2}, format="json").status_code, 200)
        self.assertEqual(self.client.get(url).json()["title"], "Original")
        self.assertEqual(self.client.get(url).json()["version"], 3)

    def test_viewer_cannot_mutate(self):
        self.client.force_login(self.viewer)
        self.assertEqual(self.client.post("/api/documents/", {"menu": self.menu.id, "title": "Denied"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/documents/{self.doc.id}/", {"title": "Denied", "version": 1}, format="json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/documents/{self.doc.id}/revisions/1/restore/", {"version": 1}, format="json").status_code, 403)

    def test_attachments_and_inline_images(self):
        with tempfile.TemporaryDirectory() as folder, override_settings(MEDIA_ROOT=folder):
            self.client.force_login(self.author)
            url = f"/api/documents/{self.doc.id}/attachments/"
            response = self.client.post(url, {"file": SimpleUploadedFile("guide.txt", b"knowledge", "text/plain")}, format="multipart")
            self.assertEqual(response.status_code, 201)
            attachment = response.json()
            download = self.client.get(attachment["download_url"])
            self.assertEqual(download.status_code, 200)
            self.assertEqual(b"".join(download.streaming_content), b"knowledge")
            image = BytesIO()
            Image.new("RGB", (2, 2)).save(image, format="PNG")
            response = self.client.post(url, {"file": SimpleUploadedFile("image.png", image.getvalue(), "image/png"), "purpose": "INLINE"}, format="multipart")
            self.assertEqual(response.status_code, 201)
            preview = self.client.get(f"/api/attachments/{response.json()['id']}/preview/")
            self.assertEqual(preview.status_code, 200)
            preview.close()
            self.assertEqual(len(self.client.get(url).json()), 1)
            self.client.force_login(self.viewer)
            self.assertEqual(self.client.delete(f"/api/attachments/{attachment['id']}/").status_code, 403)
            self.assertEqual(self.client.post(url, {"file": SimpleUploadedFile("no.txt", b"no")}, format="multipart").status_code, 403)
            self.client.force_login(self.author)
            self.assertEqual(self.client.delete(f"/api/attachments/{attachment['id']}/").status_code, 204)

    def test_menu_hierarchy_validation(self):
        self.client.force_login(self.admin)
        child = self.client.post("/api/menu-management/", {"name": "Child", "parent": self.menu.id, "sort_order": 2}, format="json")
        self.assertEqual(child.status_code, 201)
        url = f"/api/menu-management/{self.menu.id}/"
        self.assertEqual(self.client.patch(url, {"parent": child.json()["id"]}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(url).status_code, 409)

    def test_login_logout_and_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post("/api/auth/login/", {"username": "author", "password": "test-only"}, format="json").status_code, 403)
        client.get("/api/csrf/")
        token = client.cookies["csrftoken"].value
        self.assertEqual(client.post("/api/auth/login/", {"username": "author", "password": "test-only"}, format="json", HTTP_X_CSRFTOKEN=token).status_code, 200)
        token = client.cookies["csrftoken"].value
        self.assertEqual(client.post("/api/auth/logout/", HTTP_X_CSRFTOKEN=token).status_code, 200)
        self.assertEqual(client.get("/api/auth/me/").status_code, 401)

    def test_wiki_admin_without_superuser(self):
        user = User.objects.create_user(username="wiki-admin")
        group = Group.objects.create(name="WIKI_ADMIN")
        group.permissions.add(*Permission.objects.filter(codename__in=["add_menu", "change_menu", "delete_menu"]))
        user.groups.add(group)
        self.client.force_login(user)
        data = self.client.get("/api/auth/me/").json()
        self.assertEqual(data["role"], "WIKI_ADMIN")
        self.assertTrue(data["can_manage_menus"])
        self.assertEqual(self.client.post("/api/menu-management/", {"name": "Allowed"}).status_code, 201)

    def test_document_specific_permissions_are_preserved(self):
        self.doc.use_custom_permissions = True
        self.doc.save()
        self.client.force_login(self.author)
        url = f"/api/documents/{self.doc.id}/"
        self.assertEqual(self.client.get(url).status_code, 404)
        DocumentAccess.objects.create(document=self.doc, group=self.author.groups.first(), can_view=True, can_edit=False)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertFalse(self.client.get(url).json()["can_edit"])
        self.assertEqual(self.client.patch(url, {"title": "Denied", "version": 1}, format="json").status_code, 403)
