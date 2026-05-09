import os
import tempfile
import unittest

try:
    from main import read_runtime_settings, save_runtime_settings
    IMPORT_ERROR = None
except Exception as exc:  # pragma: no cover - environment dependent
    read_runtime_settings = None
    save_runtime_settings = None
    IMPORT_ERROR = exc


@unittest.skipIf(IMPORT_ERROR is not None, f"runtime dependency missing: {IMPORT_ERROR}")
class RuntimeSettingsTests(unittest.TestCase):
    def test_read_defaults_when_file_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, "config.ini")
            settings = read_runtime_settings(create_if_missing=False, config_file=config_path)
            self.assertEqual(settings["PORT"], 5000)
            self.assertEqual(settings["PASSWORD"], "password")
            self.assertFalse(os.path.exists(config_path))

    def test_save_and_read_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, "config.ini")
            expected = {
                "CONFIG_FILE": config_path,
                "ROOT_DIR": tmpdir,
                "DATA_DIR": os.path.join(tmpdir, "workspace_data"),
                "LOG_DIR": os.path.join(tmpdir, "workspace_logs"),
                "PASSWORD": "p@ss",
                "ADMIN_PASSWORD": "admin@123",
                "CLOSE_TO_TRAY": True,
                "PORT": 17890,
                "GIT_ENABLED": True,
                "GIT_WORKDIR": tmpdir,
                "GIT_EXTERNAL_APP_PATH": "C:\\tool\\code.exe",
                "LOG_LEVEL": "WARNING",
            }
            save_runtime_settings(expected, config_file=config_path)
            actual = read_runtime_settings(create_if_missing=False, config_file=config_path)
            self.assertEqual(actual["ROOT_DIR"], expected["ROOT_DIR"])
            self.assertEqual(actual["DATA_DIR"], expected["DATA_DIR"])
            self.assertEqual(actual["LOG_DIR"], expected["LOG_DIR"])
            self.assertEqual(actual["PASSWORD"], expected["PASSWORD"])
            self.assertEqual(actual["ADMIN_PASSWORD"], expected["ADMIN_PASSWORD"])
            self.assertEqual(actual["CLOSE_TO_TRAY"], expected["CLOSE_TO_TRAY"])
            self.assertEqual(actual["PORT"], expected["PORT"])
            self.assertEqual(actual["GIT_ENABLED"], expected["GIT_ENABLED"])
            self.assertEqual(actual["GIT_WORKDIR"], expected["GIT_WORKDIR"])
            self.assertEqual(actual["GIT_EXTERNAL_APP_PATH"], expected["GIT_EXTERNAL_APP_PATH"])
            self.assertEqual(actual["LOG_LEVEL"], "WARNING")

    def test_create_default_file_when_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = os.path.join(tmpdir, "config.ini")
            settings = read_runtime_settings(create_if_missing=True, config_file=config_path)
            self.assertTrue(os.path.exists(config_path))
            self.assertEqual(settings["PORT"], 5000)


if __name__ == "__main__":
    unittest.main()
