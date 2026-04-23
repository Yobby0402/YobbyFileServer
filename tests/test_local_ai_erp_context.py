from yobboy_file_server import local_ai_routes


def test_message_suggests_erp_context_for_business_terms():
    assert local_ai_routes._message_suggests_erp_context("知识库里结合库存和BOM说明一下")
    assert local_ai_routes._message_suggests_erp_context("这个工单的领料情况如何")
    assert local_ai_routes._message_suggests_erp_context("批次追溯链路是什么")


def test_message_suggests_erp_context_ignores_unrelated_text():
    assert not local_ai_routes._message_suggests_erp_context("总结一下 README 的安装方式")
