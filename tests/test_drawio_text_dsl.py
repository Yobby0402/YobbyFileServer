import unittest
import xml.etree.ElementTree as ET

import drawio_text_dsl


def _style_map(style_text):
    result = {}
    for item in str(style_text or "").split(";"):
        if not item or "=" not in item:
            continue
        key, value = item.split("=", 1)
        result[key] = value
    return result


class DrawioTextDslRoutingTests(unittest.TestCase):
    def _vertex_geometry_by_label(self, body):
        xml_text = drawio_text_dsl.yobboy_flow_to_mxfile(body)
        root = ET.fromstring(xml_text)
        out = {}
        for cell in root.findall(".//mxCell[@vertex='1']"):
            label = cell.attrib.get("value", "")
            geometry = cell.find("./mxGeometry")
            out[label] = {
                "x": float(geometry.attrib.get("x", "0") or 0),
                "y": float(geometry.attrib.get("y", "0") or 0),
                "w": float(geometry.attrib.get("width", "0") or 0),
                "h": float(geometry.attrib.get("height", "0") or 0),
            }
        return out

    def _edge_styles_by_label(self, body):
        xml_text = drawio_text_dsl.yobboy_flow_to_mxfile(body)
        root = ET.fromstring(xml_text)
        out = {}
        for cell in root.findall(".//mxCell[@edge='1']"):
            out[cell.attrib.get("value", "")] = _style_map(cell.attrib.get("style", ""))
        return out

    def test_routes_choose_side_by_relative_position(self):
        styles = self._edge_styles_by_label(
            """
            node A "A" rect @ 200 200 120 60
            node B "B" rect @ 460 120 120 60
            node C "C" rect @ 460 320 120 60
            node D "D" rect @ 200 420 120 60
            node E "E" rect @ 200 40 120 60
            node F "F" rect @ 20 220 120 60
            edge A -> B "toB"
            edge A -> C "toC"
            edge A -> D "toD"
            edge A -> E "toE"
            edge A -> F "toF"
            """
        )

        self.assertEqual("1.0", styles["toB"]["exitX"])
        self.assertEqual("0.0", styles["toB"]["entryX"])
        self.assertEqual("1.0", styles["toD"]["exitY"])
        self.assertEqual("0.0", styles["toD"]["entryY"])
        self.assertEqual("0.0", styles["toE"]["exitY"])
        self.assertEqual("1.0", styles["toE"]["entryY"])
        self.assertEqual("0.0", styles["toF"]["exitX"])
        self.assertEqual("1.0", styles["toF"]["entryX"])

        self.assertNotEqual(styles["toB"]["exitY"], styles["toC"]["exitY"])

    def test_routes_spread_incoming_ports_on_same_side(self):
        styles = self._edge_styles_by_label(
            """
node L1 "L1" rect @ 20 120 120 60
node L2 "L2" rect @ 20 300 120 60
node T "T" rect @ 320 210 120 60
edge L1 -> T "in1"
edge L2 -> T "in2"
            """
        )

        self.assertEqual("0.0", styles["in1"]["entryX"])
        self.assertEqual("0.0", styles["in2"]["entryX"])
        self.assertNotEqual(styles["in1"]["entryY"], styles["in2"]["entryY"])

    def test_layout_centers_mainline_and_splits_branches(self):
        geom = self._vertex_geometry_by_label(
            """
node A "A"
node B "B"
node C "C"
node D "D"
node E "E"
edge A -> B
edge B -> C
edge B -> D
edge C -> E
            """
        )

        self.assertLess(geom["A"]["x"], geom["B"]["x"])
        self.assertLess(geom["B"]["x"], geom["C"]["x"])
        self.assertEqual(geom["C"]["x"], geom["D"]["x"])
        self.assertNotEqual(geom["C"]["y"], geom["D"]["y"])
        self.assertAlmostEqual(geom["B"]["y"] * 2.0, geom["C"]["y"] + geom["D"]["y"])

    def test_decision_node_prefers_yes_right_no_down(self):
        geom = self._vertex_geometry_by_label(
            """
node A "开始"
node Q "是否通过?" diamond
node Y "继续处理"
node N "结束"
edge A -> Q
edge Q -> Y "是"
edge Q -> N "否"
            """
        )
        styles = self._edge_styles_by_label(
            """
node A "开始"
node Q "是否通过?" diamond
node Y "继续处理"
node N "结束"
edge A -> Q
edge Q -> Y "是"
edge Q -> N "否"
            """
        )

        self.assertLess(geom["是否通过?"]["x"], geom["继续处理"]["x"])
        self.assertLess(geom["是否通过?"]["x"], geom["结束"]["x"])
        self.assertLess(geom["继续处理"]["y"], geom["结束"]["y"])

        self.assertEqual("1.0", styles["是"]["exitX"])
        self.assertEqual("0.0", styles["是"]["entryX"])
        self.assertEqual("1.0", styles["否"]["exitY"])
        self.assertEqual("0.0", styles["否"]["entryY"])


if __name__ == "__main__":
    unittest.main()
