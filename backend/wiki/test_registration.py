from copy import deepcopy
from unittest.mock import patch
from unittest import skipUnless
from concurrent.futures import ThreadPoolExecutor
import threading

from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import Group, Permission
from django.core.cache import cache
from django.db import IntegrityError, OperationalError, close_old_connections, connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from .models import RegistrationRequest

User = get_user_model()
PUBLIC = "/api/auth/registration-requests/"
MANAGEMENT = "/api/registration-management/"
TEST_PASSWORD = "Zebra!Cloud-62-test-only"


def application(username="applicant"):
    return {"username": username, "first_name": "지수", "last_name": "김", "password": TEST_PASSWORD,
            "password_confirm": TEST_PASSWORD, "reason": "팀 개발 가이드를 열람하고 싶습니다."}


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "registration-tests"}},
    REGISTRATION_REQUESTS_PER_HOUR=1000, REGISTRATION_REQUESTS_PER_DAY=2000,
)
class RegistrationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.root = User.objects.create_superuser(username="root")
        cls.wiki = User.objects.create_user(username="wiki")
        cls.author = User.objects.create_user(username="author")
        cls.viewer = User.objects.create_user(username="viewer")
        for user, role in ((cls.wiki, "WIKI_ADMIN"), (cls.author, "AUTHOR"), (cls.viewer, "VIEWER")):
            group = Group.objects.create(name=role)
            user.groups.add(group)
        Group.objects.get(name="VIEWER").permissions.add(*Permission.objects.filter(codename__in=["view_menu", "view_document"]))

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def tearDown(self):
        cache.clear()

    def pending(self, username="applicant"):
        response = self.client.post(PUBLIC, application(username), format="json")
        self.assertEqual(response.status_code, 202)
        return RegistrationRequest.objects.get(username=username, status="PENDING")

    def review(self, item, action="approve", manager=None):
        client = APIClient()
        client.force_login(manager or self.root)
        return client.post(f"{MANAGEMENT}{item.pk}/{action}/", {}, format="json")

    def test_anonymous_submission_only_stores_hash(self):
        before = User.objects.count()
        item = self.pending()
        self.assertEqual(User.objects.count(), before)
        self.assertNotEqual(item.password_hash, TEST_PASSWORD)
        self.assertTrue(check_password(TEST_PASSWORD, item.password_hash))
        self.assertIsNone(item.reviewed_at)
        self.assertIsNone(item.reviewed_by)
        self.assertEqual(item.status, "PENDING")
        self.assertNotIn(TEST_PASSWORD, str(list(RegistrationRequest.objects.values())))

    def test_approve_creates_viewer_and_can_login(self):
        item = self.pending()
        encoded = item.password_hash
        self.assertEqual(self.client.post("/api/auth/login/", {"username": item.username, "password": TEST_PASSWORD}, format="json").status_code, 401)
        response = self.review(item)
        self.assertEqual(response.status_code, 200)
        user = User.objects.get(username=item.username)
        self.assertEqual(user.password, encoded)
        self.assertTrue(user.check_password(TEST_PASSWORD))
        self.assertEqual(list(user.groups.values_list("name", flat=True)), ["VIEWER"])
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertTrue(user.is_active)
        item.refresh_from_db()
        self.assertEqual(item.password_hash, "")
        self.assertEqual(item.status, "APPROVED")
        self.assertEqual(item.reviewed_by_id, self.root.pk)
        self.assertIsNotNone(item.reviewed_at)
        login = APIClient()
        self.assertEqual(login.post("/api/auth/login/", {"username": item.username, "password": TEST_PASSWORD}, format="json").status_code, 200)
        self.assertEqual(login.get("/api/auth/me/").json()["role"], "VIEWER")

    def test_wiki_manager_can_approve_and_reject(self):
        first = self.pending("first")
        second = self.pending("second")
        self.assertEqual(self.review(first, manager=self.wiki).status_code, 200)
        self.assertEqual(self.review(second, "reject", self.wiki).status_code, 200)
        for item in (first, second):
            item.refresh_from_db()
            self.assertEqual(item.reviewed_by_id, self.wiki.pk)
            self.assertEqual(item.password_hash, "")

    def test_non_managers_cannot_list_or_review(self):
        item = self.pending()
        staff = User.objects.create_user(username="staff", is_staff=True)
        for user in (self.author, self.viewer, staff):
            client = APIClient(); client.force_login(user)
            self.assertEqual(client.get(MANAGEMENT).status_code, 403)
            for action in ("approve", "reject"):
                self.assertEqual(client.post(f"{MANAGEMENT}{item.pk}/{action}/", {}, format="json").status_code, 403)
        self.assertIn(self.client.get(MANAGEMENT).status_code, (401, 403))
        self.assertIn(self.client.post(f"{MANAGEMENT}{item.pk}/approve/").status_code, (401, 403))
        item.refresh_from_db()
        self.assertEqual(item.status, "PENDING")
        self.assertFalse(User.objects.filter(username=item.username).exists())

    def test_duplicate_existing_and_pending_share_public_response(self):
        first = self.client.post(PUBLIC, application(), format="json")
        item = RegistrationRequest.objects.get(username="applicant")
        original_hash = item.password_hash
        duplicate = application(); duplicate["first_name"] = "다른이름"
        second = self.client.post(PUBLIC, duplicate, format="json")
        third = self.client.post(PUBLIC, application("viewer"), format="json")
        self.assertEqual(first.status_code, 202)
        self.assertEqual(first.json(), second.json())
        self.assertEqual(first.json(), third.json())
        self.assertEqual(RegistrationRequest.objects.count(), 1)
        item.refresh_from_db()
        self.assertEqual(item.first_name, "지수")
        self.assertEqual(item.password_hash, original_hash)

    def test_processed_requests_cannot_be_reviewed_again(self):
        item = self.pending()
        self.assertEqual(self.review(item).status_code, 200)
        self.assertEqual(self.review(item).status_code, 409)
        self.assertEqual(self.review(item, "reject").status_code, 409)
        self.assertEqual(User.objects.filter(username="applicant").count(), 1)

    def test_reject_then_reapply_preserves_audit(self):
        item = self.pending()
        self.assertEqual(self.review(item, "reject").status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.status, "REJECTED")
        self.assertEqual(item.password_hash, "")
        self.assertFalse(User.objects.filter(username=item.username).exists())
        self.assertEqual(self.client.post("/api/auth/login/", {"username": item.username, "password": TEST_PASSWORD}, format="json").status_code, 401)
        new = self.pending()
        self.assertNotEqual(new.pk, item.pk)
        self.assertEqual(RegistrationRequest.objects.filter(username=item.username).count(), 2)
        self.assertEqual(item.reviewed_by_id, self.root.pk)
        self.assertTrue(check_password(TEST_PASSWORD, new.password_hash))

    def test_existing_username_at_approval_is_conflict(self):
        item = self.pending()
        existing = User.objects.create_user(username=item.username)
        before = existing.password
        self.assertEqual(self.review(item).status_code, 409)
        existing.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(existing.password, before)
        self.assertEqual(item.status, "PENDING")
        self.assertNotEqual(item.password_hash, "")
        self.assertEqual(self.review(item, "reject").status_code, 200)

    def test_missing_viewer_group_does_not_create_account(self):
        item = self.pending()
        Group.objects.get(name="VIEWER").delete()
        self.assertEqual(self.review(item).status_code, 409)
        self.assertFalse(User.objects.filter(username=item.username).exists())
        item.refresh_from_db()
        self.assertEqual(item.status, "PENDING")

    def test_review_failure_rolls_back_account_and_request(self):
        item = self.pending()
        with patch.object(RegistrationRequest, "save", side_effect=RuntimeError("test rollback")):
            with self.assertRaises(RuntimeError):
                self.review(item)
        self.assertFalse(User.objects.filter(username=item.username).exists())
        item.refresh_from_db()
        self.assertEqual(item.status, "PENDING")
        self.assertNotEqual(item.password_hash, "")

    def test_input_validation_and_role_injection(self):
        invalid = []
        for field in ("username", "first_name", "last_name", "password", "password_confirm"):
            body = application(); body.pop(field); invalid.append(body)
            body = application(); body[field] = ""; invalid.append(body)
        for field, value in (("username", "a" * 151), ("first_name", "x" * 151), ("last_name", "x" * 151),
                             ("reason", "x" * 2001), ("password", "x" * 129), ("password_confirm", "different"),
                             ("username", "not allowed!"), ("first_name", 123), ("reason", None),
                             ("first_name", "bad\x00name")):
            body = application(); body[field] = value; invalid.append(body)
        for extra in ({"role": "WIKI_ADMIN"}, {"is_superuser": "true"}, {"status": "APPROVED"}):
            invalid.append({**application(), **extra})
        for password in ("12345678", "password", "short"):
            body = application(); body["password"] = body["password_confirm"] = password; invalid.append(body)
        invalid += [[], "invalid", None]
        for index, body in enumerate(invalid):
            with self.subTest(case=index):
                self.assertEqual(self.client.post(PUBLIC, body, format="json").status_code, 400)
        self.assertFalse(RegistrationRequest.objects.exists())

    def test_public_json_size_and_media_type(self):
        self.assertEqual(self.client.post(PUBLIC, {**application(), "reason": "x" * 20000}, format="json").status_code, 400)
        self.assertEqual(self.client.post(PUBLIC, application(), format="multipart").status_code, 415)

    def test_passwords_and_status_are_not_publicly_exposed(self):
        item = self.pending()
        self.assertEqual(self.client.get(PUBLIC).status_code, 405)
        self.assertEqual(self.client.get(PUBLIC + "status/?username=applicant").status_code, 404)
        client = APIClient(); client.force_login(self.root)
        result = client.get(MANAGEMENT).json()
        self.assertEqual(result["count"], 1)
        self.assertNotIn("password_hash", result["results"][0])
        self.assertNotIn("password", result["results"][0])
        self.assertNotIn(item.password_hash, str(result))
        self.assertNotIn(TEST_PASSWORD, str(result))

    def test_filter_pagination_and_reviewed_metadata(self):
        first = self.pending("first")
        second = self.pending("second")
        self.review(first)
        client = APIClient(); client.force_login(self.root)
        self.assertEqual(client.get(MANAGEMENT).json()["count"], 1)
        approved = client.get(MANAGEMENT + "?status=APPROVED").json()["results"][0]
        self.assertEqual(approved["reviewed_by"], "root")
        self.assertIsNotNone(approved["reviewed_at"])
        first_page = client.get(MANAGEMENT + "?status=ALL&page_size=1").json()
        second_page = client.get(MANAGEMENT + "?status=ALL&page_size=1&page=2").json()
        self.assertEqual(first_page["count"], 2)
        self.assertNotEqual(first_page["results"][0]["id"], second_page["results"][0]["id"])
        self.assertEqual(client.get(MANAGEMENT + "?status=INVALID").status_code, 400)
        self.assertEqual(client.post(MANAGEMENT + "999999/approve/").status_code, 404)

    def test_pending_unique_constraint_and_review_shape_constraint(self):
        item = self.pending()
        with self.assertRaises(IntegrityError), transaction.atomic():
            RegistrationRequest.objects.create(username=item.username, first_name="Other", last_name="Person", password_hash=item.password_hash)
        with self.assertRaises(IntegrityError), transaction.atomic():
            RegistrationRequest.objects.filter(pk=item.pk).update(status="APPROVED", reviewed_at=timezone.now(), reviewed_by=self.root)
        with self.assertRaises(IntegrityError), transaction.atomic():
            RegistrationRequest.objects.filter(pk=item.pk).update(password_hash="")

    def test_anonymous_post_requires_csrf_and_manager_review_requires_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post(PUBLIC, application(), format="json").status_code, 403)
        client.get("/api/csrf/")
        token = client.cookies["csrftoken"].value
        self.assertEqual(client.post(PUBLIC, application(), format="json", HTTP_X_CSRFTOKEN=token).status_code, 202)
        item = RegistrationRequest.objects.get(username="applicant")
        manager = APIClient(enforce_csrf_checks=True); manager.force_login(self.root)
        self.assertEqual(manager.post(f"{MANAGEMENT}{item.pk}/approve/").status_code, 403)
        manager.get("/api/csrf/")
        self.assertEqual(manager.post(f"{MANAGEMENT}{item.pk}/approve/", HTTP_X_CSRFTOKEN=manager.cookies["csrftoken"].value).status_code, 200)

    def test_public_database_failure_has_safe_response(self):
        with patch("wiki.registration_views.RegistrationRequest.objects.get_or_create", side_effect=OperationalError("test unavailable")):
            response = self.client.post(PUBLIC, application(), format="json")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(TEST_PASSWORD, str(response.json()))
        self.assertFalse(RegistrationRequest.objects.exists())

    def test_rate_store_failure_is_closed(self):
        with patch("wiki.registration_views.cache.add", side_effect=RuntimeError("test cache unavailable")):
            self.assertEqual(self.client.post(PUBLIC, application(), format="json").status_code, 429)
        self.assertFalse(RegistrationRequest.objects.exists())

    @override_settings(REGISTRATION_REQUESTS_PER_HOUR=2, REGISTRATION_REQUESTS_PER_DAY=100)
    def test_hourly_limit_and_spoofed_forwarded_address(self):
        self.assertEqual(self.client.post(PUBLIC, application(), format="json", HTTP_X_FORWARDED_FOR="1.1.1.1").status_code, 202)
        self.assertEqual(self.client.post(PUBLIC, application(), format="json", HTTP_X_FORWARDED_FOR="2.2.2.2").status_code, 202)
        response = self.client.post(PUBLIC, application(), format="json", HTTP_X_FORWARDED_FOR="3.3.3.3")
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response["Retry-After"]), 0)

    @override_settings(REGISTRATION_REQUESTS_PER_HOUR=100, REGISTRATION_REQUESTS_PER_DAY=2)
    def test_daily_limit(self):
        for _ in range(2):
            self.assertEqual(self.client.post(PUBLIC, application(), format="json").status_code, 202)
        self.assertEqual(self.client.post(PUBLIC, application(), format="json").status_code, 429)


@skipUnless(connection.vendor == "postgresql", "PostgreSQL row locks are required for concurrency tests")
class ConcurrentRegistrationReviews(TransactionTestCase):
    def setUp(self):
        self.root = User.objects.create_superuser(username="root")
        Group.objects.create(name="VIEWER")
        self.item = RegistrationRequest.objects.create(username="applicant", first_name="New", last_name="Member", password_hash=make_password(TEST_PASSWORD))

    def test_concurrent_approvals_only_create_one_user(self):
        barrier = threading.Barrier(2)
        def approve():
            close_old_connections()
            try:
                client = APIClient(); client.force_login(User.objects.get(pk=self.root.pk))
                barrier.wait(timeout=10)
                return client.post(f"{MANAGEMENT}{self.item.pk}/approve/").status_code
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = sorted(executor.map(lambda _: approve(), range(2)))
        self.assertEqual(statuses, [200, 409])
        self.assertEqual(User.objects.filter(username="applicant").count(), 1)
        self.item.refresh_from_db()
        self.assertEqual(self.item.password_hash, "")
