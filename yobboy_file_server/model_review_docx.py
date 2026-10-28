from __future__ import annotations

import copy
import io
import math
import sys
import zipfile
from pathlib import Path

from lxml import etree


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
AM3D_NS = "http://schemas.microsoft.com/office/drawing/2017/model3d"
PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture"
MODEL_REL_TYPE = "http://schemas.microsoft.com/office/2017/06/relationships/model3d"
IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
PLACEHOLDER = "[[MODEL_3D_PLACEHOLDER]]"


class Model3DEmbedError(RuntimeError):
    pass


def resolve_model3d_template_path(
    package_dir: str | Path | None = None,
    executable_dir: str | Path | None = None,
) -> Path:
    package_root = Path(package_dir) if package_dir is not None else Path(__file__).resolve().parent
    executable_root = (
        Path(executable_dir)
        if executable_dir is not None
        else Path(sys.executable).resolve().parent
    )
    candidates = (
        package_root / "resources" / "model_review_3d_template.docx",
        executable_root / "yobboy_file_server" / "resources" / "model_review_3d_template.docx",
        executable_root / "resources" / "model_review_3d_template.docx",
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise Model3DEmbedError("3D Word 模板文件缺失，请重新安装或重新打包服务器")


def _read_package(source: bytes | str | Path) -> dict[str, bytes]:
    stream = io.BytesIO(source) if isinstance(source, bytes) else source
    with zipfile.ZipFile(stream, "r") as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def _parse_xml(package: dict[str, bytes], name: str) -> etree._Element:
    try:
        return etree.fromstring(package[name])
    except (KeyError, etree.XMLSyntaxError) as exc:
        raise Model3DEmbedError(f"DOCX 缺少或损坏的 XML：{name}") from exc


def _next_relationship_id(relationships: etree._Element) -> str:
    used = {item.get("Id") for item in relationships}
    index = 1
    while f"rId{index}" in used:
        index += 1
    return f"rId{index}"


def _relationship(relationships: etree._Element, relationship_type: str) -> etree._Element:
    for item in relationships:
        if item.get("Type") == relationship_type:
            return item
    raise Model3DEmbedError(f"3D Word 模板缺少关系：{relationship_type}")


def _convert_anchors_to_inline(alternate: etree._Element, width: int, height: int) -> None:
    namespaces = {"wp": WP_NS, "a": A_NS}
    for anchor in list(alternate.xpath(".//wp:anchor", namespaces=namespaces)):
        inline = etree.Element(
            f"{{{WP_NS}}}inline",
            distT="0",
            distB="0",
            distL="0",
            distR="0",
        )
        wanted = {
            f"{{{WP_NS}}}extent",
            f"{{{WP_NS}}}effectExtent",
            f"{{{WP_NS}}}docPr",
            f"{{{WP_NS}}}cNvGraphicFramePr",
            f"{{{A_NS}}}graphic",
        }
        for child in list(anchor):
            if child.tag in wanted:
                inline.append(copy.deepcopy(child))
        anchor.getparent().replace(anchor, inline)

    for extent in alternate.xpath(".//wp:extent", namespaces=namespaces):
        extent.set("cx", str(width))
        extent.set("cy", str(height))
    for extent in alternate.xpath(".//a:xfrm/a:ext", namespaces=namespaces):
        extent.set("cx", str(width))
        extent.set("cy", str(height))


def _replace_placeholder(document: etree._Element, alternate: etree._Element) -> None:
    namespaces = {"w": W_NS}
    for paragraph in document.xpath(".//w:p", namespaces=namespaces):
        text = "".join(paragraph.xpath(".//w:t/text()", namespaces=namespaces))
        if PLACEHOLDER not in text:
            continue
        properties = paragraph.find(f"{{{W_NS}}}pPr")
        for child in list(paragraph):
            if child is not properties:
                paragraph.remove(child)
        run = etree.SubElement(paragraph, f"{{{W_NS}}}r")
        run.append(alternate)
        return
    raise Model3DEmbedError("生成的 Word 文档缺少 3D 模型占位符")


def _ensure_default(content_types: etree._Element, extension: str, content_type: str) -> None:
    for item in content_types.findall(f"{{{CT_NS}}}Default"):
        if item.get("Extension", "").lower() == extension.lower():
            item.set("ContentType", content_type)
            return
    etree.SubElement(
        content_types,
        f"{{{CT_NS}}}Default",
        Extension=extension,
        ContentType=content_type,
    )


def embed_model3d(
    docx_bytes: bytes,
    template_path: str | Path,
    glb_bytes: bytes,
    poster_bytes: bytes,
    max_dimension: float,
) -> bytes:
    return embed_models3d(
        docx_bytes,
        template_path,
        [(glb_bytes, poster_bytes, max_dimension)],
    )


def embed_models3d(
    docx_bytes: bytes,
    template_path: str | Path,
    models: list[tuple[bytes, bytes, float]],
) -> bytes:
    if not models:
        raise Model3DEmbedError("Word 文档缺少 3D 模型")
    for glb_bytes, _poster_bytes, max_dimension in models:
        if not glb_bytes.startswith(b"glTF"):
            raise Model3DEmbedError("浏览器生成的模型不是有效 GLB 文件")
        if not math.isfinite(max_dimension) or max_dimension <= 0:
            raise Model3DEmbedError("模型尺寸无效")
    template_file = Path(template_path)
    if not template_file.is_file():
        raise Model3DEmbedError("3D Word 模板文件缺失，请重新安装或重新打包服务器")

    package = _read_package(docx_bytes)
    template = _read_package(template_file)
    document = _parse_xml(package, "word/document.xml")
    relationships = _parse_xml(package, "word/_rels/document.xml.rels")
    content_types = _parse_xml(package, "[Content_Types].xml")
    template_document = _parse_xml(template, "word/document.xml")
    template_relationships = _parse_xml(template, "word/_rels/document.xml.rels")

    alternate_nodes = template_document.xpath(
        ".//mc:AlternateContent[.//am3d:model3d]",
        namespaces={"mc": MC_NS, "am3d": AM3D_NS},
    )
    if not alternate_nodes:
        raise Model3DEmbedError("3D Word 模板中没有可用的 Model3D 元素")
    template_model_rel = _relationship(template_relationships, MODEL_REL_TYPE)
    template_image_rel = _relationship(template_relationships, IMAGE_REL_TYPE)
    width = 8_961_120
    height = 5_040_630
    namespaces = {"am3d": AM3D_NS, "wp": WP_NS, "pic": PIC_NS}
    existing_ids = [
        int(value)
        for value in document.xpath(".//wp:docPr/@id", namespaces=namespaces)
        if str(value).isdigit()
    ]
    next_drawing_id = max(existing_ids, default=0) + 1

    for index, (glb_bytes, poster_bytes, max_dimension) in enumerate(models):
        number = index + 1
        model_name = "model-review.glb" if index == 0 else f"model-review-{number}.glb"
        poster_name = (
            "model-review-poster.jpg"
            if index == 0
            else f"model-review-poster-{number}.jpg"
        )
        alternate = copy.deepcopy(alternate_nodes[0])
        model_rel_id = _next_relationship_id(relationships)
        etree.SubElement(
            relationships,
            f"{{{REL_NS}}}Relationship",
            Id=model_rel_id,
            Type=MODEL_REL_TYPE,
            Target=f"media/{model_name}",
        )
        image_rel_id = _next_relationship_id(relationships)
        etree.SubElement(
            relationships,
            f"{{{REL_NS}}}Relationship",
            Id=image_rel_id,
            Type=IMAGE_REL_TYPE,
            Target=f"media/{poster_name}",
        )

        for element in alternate.xpath(".//*[@r:embed]", namespaces={"r": R_NS}):
            value = element.get(f"{{{R_NS}}}embed")
            if value == template_model_rel.get("Id"):
                element.set(f"{{{R_NS}}}embed", model_rel_id)
            elif value == template_image_rel.get("Id"):
                element.set(f"{{{R_NS}}}embed", image_rel_id)

        _convert_anchors_to_inline(alternate, width, height)
        numerator = max(1, min(2_000_000_000, round(1_000_000 / max_dimension)))
        for meter in alternate.xpath(".//am3d:meterPerModelUnit", namespaces=namespaces):
            meter.set("n", str(numerator))
            meter.set("d", "1000000")
        drawing_id = str(next_drawing_id)
        next_drawing_id += 1
        for item in alternate.xpath(".//wp:docPr | .//pic:cNvPr", namespaces=namespaces):
            item.set("id", drawing_id)

        _replace_placeholder(document, alternate)
        package[f"word/media/{model_name}"] = glb_bytes
        package[f"word/media/{poster_name}"] = poster_bytes

    _ensure_default(content_types, "glb", "model/gltf.binary")
    _ensure_default(content_types, "jpg", "image/jpeg")

    package["word/document.xml"] = etree.tostring(document, xml_declaration=True, encoding="UTF-8", standalone="yes")
    package["word/_rels/document.xml.rels"] = etree.tostring(
        relationships, xml_declaration=True, encoding="UTF-8", standalone="yes"
    )
    package["[Content_Types].xml"] = etree.tostring(
        content_types, xml_declaration=True, encoding="UTF-8", standalone="yes"
    )
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in package.items():
            archive.writestr(name, data)
    return output.getvalue()
