import io
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from flask import Flask

from yobboy_file_server import routes
from werkzeug.exceptions import RequestEntityTooLarge


class UploadFilesRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.secret_key = "test-secret"
        self.app.config.update(
            ROOT_DIR=self.temp_dir.name,
            MAX_CONTENT_LENGTH=None,
        )
        self.app.add_url_rule(
            "/upload_files",
            view_func=routes.handle_upload_files_request,
            methods=["POST"],
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session["logged_in"] = True

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_upload_file_to_current_directory(self):
        response = self.client.post(
            "/upload_files",
            data={
                "path": "",
                "files": (io.BytesIO(b"hello"), "测试.txt"),
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["count"], 1)
        with open(os.path.join(self.temp_dir.name, "测试.txt"), "rb") as f:
            self.assertEqual(f.read(), b"hello")

    def test_upload_rejects_path_traversal_target(self):
        response = self.client.post(
            "/upload_files",
            data={
                "path": "../outside",
                "files": (io.BytesIO(b"hello"), "file.txt"),
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 403)
        payload = response.get_json()
        self.assertFalse(payload["success"])
        self.assertFalse(os.path.exists(os.path.join(self.temp_dir.name, "outside")))

    def test_upload_rejects_invalid_filename(self):
        response = self.client.post(
            "/upload_files",
            data={
                "path": "",
                "files": (io.BytesIO(b"hello"), "bad:name.txt"),
            },
            content_type="multipart/form-data",
        )

        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload["success"])
        self.assertEqual(payload["count"], 0)
        self.assertFalse(os.path.exists(os.path.join(self.temp_dir.name, "bad:name.txt")))

    def test_upload_returns_413_when_request_entity_too_large_is_raised(self):
        fake_request = SimpleNamespace(
            files=SimpleNamespace(getlist=mock.Mock(side_effect=RequestEntityTooLarge())),
            form=SimpleNamespace(get=mock.Mock(return_value="")),
        )

        with self.app.app_context():
            with mock.patch("yobboy_file_server.routes.is_logged_in", return_value=True), mock.patch(
                "yobboy_file_server.routes.request", fake_request
            ):
                response, status_code = routes.handle_upload_files_request()

        self.assertEqual(status_code, 413)
        payload = response.get_json()
        self.assertFalse(payload["success"])
        self.assertIn("上传文件过大", payload["error"])


if __name__ == "__main__":
    unittest.main()
