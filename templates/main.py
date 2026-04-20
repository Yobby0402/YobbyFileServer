# 历史遗留：本文件曾为旧版 main 的副本，已与根目录 main.py 严重不同步。
# 唯一支持的入口为项目根目录的 main.py；请勿在此添加业务逻辑。
import sys


def _main():
    sys.stderr.write(
        "错误: 请从项目根目录运行应用程序（python main.py），不要使用 templates/main.py。\n"
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(_main())
