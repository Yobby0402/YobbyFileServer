"""The local ASR model folder control used by desktop settings."""

from pathlib import Path

from PyQt5.QtWidgets import QFileDialog, QHBoxLayout, QLineEdit, QMessageBox, QStyle, QToolButton, QWidget

from speech_service.model_selection import identify_model_folder


class SpeechModelFolderWidget(QWidget):
    def __init__(self, folder: str = "", parent=None):
        super().__init__(parent)
        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)
        self.path_edit = QLineEdit(str(folder or ""))
        self.path_edit.setReadOnly(True)
        self.path_edit.setToolTip(self.path_edit.text())
        self.path_edit.textChanged.connect(self.path_edit.setToolTip)
        self.path_edit.setPlaceholderText("SenseVoiceSmall（默认）")
        layout.addWidget(self.path_edit, 1)
        browse = QToolButton()
        browse.setIcon(self.style().standardIcon(QStyle.SP_DirOpenIcon))
        browse.setToolTip("选择语音模型文件夹")
        browse.clicked.connect(self.browse_folder)
        layout.addWidget(browse)
        reset = QToolButton()
        reset.setIcon(self.style().standardIcon(QStyle.SP_DialogResetButton))
        reset.setToolTip("恢复默认 SenseVoiceSmall")
        reset.clicked.connect(self.path_edit.clear)
        layout.addWidget(reset)

    def folder(self) -> str:
        return self.path_edit.text().strip()

    def validate_folder(self) -> bool:
        if not self.folder():
            return True
        try:
            identify_model_folder(self.folder())
        except ValueError as exc:
            QMessageBox.warning(self, "语音模型不可用", str(exc))
            return False
        return True

    def browse_folder(self):
        folder = QFileDialog.getExistingDirectory(
            self, "选择 Qwen3-ASR 或 SenseVoiceSmall 模型文件夹",
            self.folder() or str(Path.home()),
            QFileDialog.ShowDirsOnly | QFileDialog.DontResolveSymlinks,
        )
        if not folder:
            return
        try:
            identify_model_folder(folder)
        except ValueError as exc:
            QMessageBox.warning(self, "语音模型不可用", str(exc))
            return
        self.path_edit.setText(folder)
