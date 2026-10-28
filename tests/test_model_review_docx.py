from pathlib import Path

import pytest

from yobboy_file_server.model_review_docx import (
    Model3DEmbedError,
    resolve_model3d_template_path,
)


def test_model3d_template_uses_external_distribution_fallback(tmp_path: Path):
    package_dir = tmp_path / "_MEI123" / "yobboy_file_server"
    executable_dir = tmp_path / "dist"
    external = executable_dir / "yobboy_file_server" / "resources" / "model_review_3d_template.docx"
    external.parent.mkdir(parents=True)
    external.write_bytes(b"template")

    resolved = resolve_model3d_template_path(
        package_dir=package_dir,
        executable_dir=executable_dir,
    )

    assert resolved == external


def test_model3d_template_missing_has_clear_error(tmp_path: Path):
    with pytest.raises(Model3DEmbedError, match="3D Word 模板文件缺失"):
        resolve_model3d_template_path(
            package_dir=tmp_path / "missing-package",
            executable_dir=tmp_path / "missing-dist",
        )


def test_pyinstaller_spec_bundles_model3d_template():
    spec = (Path(__file__).resolve().parents[1] / "YobboyFileServer.spec").read_text(encoding="utf-8")

    assert "yobboy_file_server/resources/model_review_3d_template.docx" in spec
