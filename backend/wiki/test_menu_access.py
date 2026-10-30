from copy import deepcopy

from django.contrib.auth.models import Group, Permission, User
from django.test import TestCase
from rest_framework.test import APIClient

from .access import accessible_menus, has_menu_access
from .models import Document, Menu, MenuAccess


class MenuAccessAPITests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.groups = {name: Group.objects.create(name=name) for name in
                      ("WIKI_ADMIN", "AUTHOR", "VIEWER", "SYSTEM_ADMIN", "EXTERNAL")}
        cls.groups["WIKI_ADMIN"].permissions.add(Permission.objects.get(codename="change_menu"))
        cls.groups["AUTHOR"].permissions.add(*Permission.objects.filter(
            codename__in=["view_menu", "view_document", "add_document", "change_document"]))
        cls.groups["VIEWER"].permissions.add(*Permission.objects.filter(
            codename__in=["view_menu", "view_document"]))
        cls.admin = User.objects.create_superuser(username="root")
        cls.members = {}
        for role in ("WIKI_ADMIN", "AUTHOR", "VIEWER"):
            user = User.objects.create_user(username=role.lower())
            user.groups.add(cls.groups[role])
            cls.members[role] = user
        cls.menu = Menu.objects.create(name="Private")
        cls.child = Menu.objects.create(name="Child", parent=cls.menu)
        cls.other = Menu.objects.create(name="Other")
        cls.document = Document.objects.create(menu=cls.menu, title="Guide", created_by=cls.admin)

    def setUp(self):
        self.client = APIClient()
        self.client.force_login(self.admin)
        self.url = f"/api/menu-management/{self.menu.id}/access/"

    def payload(self, **author_permissions):
        return {"groups": [{"group_id": self.groups[name].id,
                            "can_view": author_permissions.get("can_view", False) if name == "AUTHOR" else False,
                            "can_create": author_permissions.get("can_create", False) if name == "AUTHOR" else False,
                            "can_edit": author_permissions.get("can_edit", False) if name == "AUTHOR" else False}
                           for name in ("WIKI_ADMIN", "AUTHOR", "VIEWER")]}

    def put(self, data):
        return self.client.put(self.url, data, format="json")

    def test_superuser_and_authorized_wiki_admin_get_put(self):
        for manager in (self.admin, self.members["WIKI_ADMIN"]):
            with self.subTest(manager=manager.username):
                self.client.force_login(manager)
                response = self.client.get(self.url)
                self.assertEqual(response.status_code, 200)
                self.assertEqual([g["group_name"] for g in response.json()["groups"]], ["WIKI_ADMIN", "AUTHOR", "VIEWER"])
                self.assertEqual({g["group_id"] for g in response.json()["groups"]},
                                 {self.groups[n].id for n in ("WIKI_ADMIN", "AUTHOR", "VIEWER")})
                self.assertEqual(self.put(self.payload(can_view=True)).status_code, 200)
                self.assertTrue(self.client.get("/api/menu-management/").json()["can_manage_access"])

    def test_author_viewer_and_anonymous_cannot_manage(self):
        for member in (self.members["AUTHOR"], self.members["VIEWER"]):
            self.client.force_login(member)
            self.assertEqual(self.client.get(self.url).status_code, 403)
            self.assertEqual(self.put(self.payload()).status_code, 403)
            self.assertFalse(self.client.get("/api/menu-management/").json()["can_manage_access"])
        self.client.logout()
        self.assertIn(self.client.get(self.url).status_code, (401, 403))
        self.assertIn(self.put(self.payload()).status_code, (401, 403))

    def test_group_name_and_global_permission_are_both_required(self):
        self.groups["WIKI_ADMIN"].permissions.clear()
        self.client.force_login(self.members["WIKI_ADMIN"])
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.put(self.payload()).status_code, 403)
        self.members["AUTHOR"].user_permissions.add(Permission.objects.get(codename="change_menu"))
        self.client.force_login(self.members["AUTHOR"])
        self.assertFalse(self.client.get("/api/menu-management/").json()["can_manage_access"])
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.assertEqual(self.put(self.payload()).status_code, 403)

    def test_saved_access_controls_menu_create_and_edit(self):
        author = self.members["AUTHOR"]
        self.client.force_login(author)
        self.assertNotIn(self.menu.id, [m["id"] for m in self.client.get("/api/menus/").json()])
        self.assertEqual(self.client.post("/api/documents/", {"menu": self.menu.id, "title": "Denied"}, format="json").status_code, 403)
        self.client.force_login(self.admin)
        self.assertEqual(self.put(self.payload(can_view=True, can_create=True, can_edit=True)).status_code, 200)
        self.client.force_login(author)
        menus = self.client.get("/api/menus/").json()
        self.assertEqual([m["id"] for m in menus], [self.menu.id])
        self.assertTrue(menus[0]["can_create"])
        created = self.client.post("/api/documents/", {"menu": self.menu.id, "title": "Created", "content": []}, format="json")
        self.assertEqual(created.status_code, 201)
        url = f"/api/documents/{created.json()['id']}/"
        self.assertEqual(self.client.patch(url, {"title": "Edited", "version": 1}, format="json").status_code, 200)
        self.client.force_login(self.admin)
        self.assertEqual(self.put(self.payload(can_view=True)).status_code, 200)
        self.client.force_login(author)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertFalse(self.client.get(url).json()["can_edit"])
        self.assertEqual(self.client.patch(url, {"title": "Denied", "version": 2}, format="json").status_code, 403)

    def test_global_model_permissions_remain_required(self):
        self.assertEqual(self.put(self.payload(can_view=True, can_create=True, can_edit=True)).status_code, 200)
        self.groups["AUTHOR"].permissions.remove(*Permission.objects.filter(codename__in=["add_document", "change_document"]))
        self.client.force_login(self.members["AUTHOR"])
        menu = self.client.get("/api/menus/").json()[0]
        self.assertFalse(menu["can_create"])
        self.assertEqual(self.client.post("/api/documents/", {"menu": self.menu.id, "title": "Denied"}, format="json").status_code, 403)
        url = f"/api/documents/{self.document.id}/"
        self.assertFalse(self.client.get(url).json()["can_edit"])
        self.assertEqual(self.client.patch(url, {"title": "Denied", "version": 1}, format="json").status_code, 403)

    def test_global_view_permissions_remain_required(self):
        self.assertEqual(self.put(self.payload(can_view=True)).status_code, 200)
        self.groups["AUTHOR"].permissions.clear()
        self.client.force_login(self.members["AUTHOR"])
        self.assertTrue(has_menu_access(self.members["AUTHOR"], self.menu.id))
        self.assertEqual(self.client.get("/api/menus/").status_code, 403)
        self.assertEqual(self.client.get("/api/documents/").status_code, 403)

    def test_public_view_does_not_grant_create_or_edit(self):
        self.menu.is_public = True
        self.menu.save()
        self.assertEqual(self.put(self.payload()).status_code, 200)
        self.client.force_login(self.members["AUTHOR"])
        self.assertEqual([m["id"] for m in self.client.get("/api/menus/").json()], [self.menu.id])
        self.assertFalse(has_menu_access(self.members["AUTHOR"], self.menu.id, "create"))
        self.assertFalse(has_menu_access(self.members["AUTHOR"], self.menu.id, "edit"))
        self.assertEqual(self.client.post("/api/documents/", {"menu": self.menu.id, "title": "Denied"}, format="json").status_code, 403)
        self.assertEqual(self.client.patch(f"/api/documents/{self.document.id}/", {"title": "Denied", "version": 1}, format="json").status_code, 403)
        self.menu.is_public = False
        self.menu.save()
        self.assertFalse(accessible_menus(self.members["AUTHOR"]).filter(pk=self.menu.id).exists())

    def test_unmanaged_groups_other_menus_and_children_unchanged(self):
        for name in ("SYSTEM_ADMIN", "EXTERNAL"):
            MenuAccess.objects.create(menu=self.menu, group=self.groups[name], can_view=True, can_edit=True)
        child_rule = MenuAccess.objects.create(menu=self.child, group=self.groups["VIEWER"], can_view=True)
        other_rule = MenuAccess.objects.create(menu=self.other, group=self.groups["AUTHOR"], can_view=True)
        self.assertEqual(self.put(self.payload(can_view=True, can_create=True)).status_code, 200)
        self.assertEqual(self.put(self.payload()).status_code, 200)
        self.assertEqual(MenuAccess.objects.filter(menu=self.menu, group__name__in=["SYSTEM_ADMIN", "EXTERNAL"], can_edit=True).count(), 2)
        self.assertTrue(MenuAccess.objects.filter(pk=child_rule.pk, can_view=True).exists())
        self.assertTrue(MenuAccess.objects.filter(pk=other_rule.pk, can_view=True).exists())
        self.assertFalse(has_menu_access(self.members["AUTHOR"], self.child.id))

    def test_invalid_payloads_are_atomic(self):
        valid = self.payload(can_view=True)
        self.assertEqual(self.put(valid).status_code, 200)
        invalid = [[], None, "invalid", {}, {"groups": {}}, {"groups": []}]
        for bad_id in (999999, self.groups["SYSTEM_ADMIN"].id, True, "1", None, 1.2):
            body = deepcopy(valid)
            body["groups"][0]["group_id"] = bad_id
            invalid.append(body)
        duplicate = deepcopy(valid)
        duplicate["groups"][1] = duplicate["groups"][0]
        invalid.append(duplicate)
        for value in (0, 1, "true", None, [], {}):
            body = deepcopy(valid)
            body["groups"][1]["can_edit"] = value
            invalid.append(body)
        missing = deepcopy(valid)
        del missing["groups"][0]["can_view"]
        invalid.append(missing)
        invalid.append({"groups": [None] * 3})
        inconsistent = self.payload(can_create=True)
        invalid.append(inconsistent)
        before = list(MenuAccess.objects.values().order_by("id"))
        for body in invalid:
            with self.subTest(body=body):
                self.assertEqual(self.put(body).status_code, 400)
                self.assertEqual(list(MenuAccess.objects.values().order_by("id")), before)

    def test_missing_menu(self):
        self.url = "/api/menu-management/999999/access/"
        self.assertEqual(self.client.get(self.url).status_code, 404)
        self.assertEqual(self.put(self.payload()).status_code, 404)

    def test_csrf_required_for_session_put(self):
        client = APIClient(enforce_csrf_checks=True)
        client.force_login(self.admin)
        self.assertEqual(client.put(self.url, self.payload(), format="json").status_code, 403)
        client.get("/api/csrf/")
        self.assertEqual(client.put(self.url, self.payload(), format="json", HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value).status_code, 200)
