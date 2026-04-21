from .main import MainWindow, run_flask_app

import sys
from PyQt5.QtWidgets import QApplication


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == 'run':
        info_file_path = sys.argv[2] if len(sys.argv) > 2 else None
        run_flask_app(info_file_path)
    else:
        app = QApplication(sys.argv)
        window = MainWindow()
        window.show()
        sys.exit(app.exec_())


if __name__ == '__main__':
    main()
