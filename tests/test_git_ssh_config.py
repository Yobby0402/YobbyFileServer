import json
import os
import subprocess

import pytest

from yobboy_file_server import git_config_manager
from yobboy_file_server.git_manager import GitManager


def test_load_configs_migrates_managed_key_after_project_move(tmp_path, monkeypatch):
    config_path = tmp_path / 'data' / 'file_server' / 'git_configs.json'
    current_key_dir = tmp_path / 'current' / 'data' / 'file_server' / 'ssh_keys'
    current_key_dir.mkdir(parents=True)
    current_key = current_key_dir / 'YFS'
    current_key.write_text('private key', encoding='utf-8')

    old_key = tmp_path / 'old' / 'data' / 'file_server' / 'ssh_keys' / 'YFS'
    old_key.parent.mkdir(parents=True)
    old_key.write_text('old private key', encoding='utf-8')
    config_path.parent.mkdir(parents=True)
    config_path.write_text(json.dumps({
        'configs': [{
            'id': 'config_1',
            'auth_type': 'ssh',
            'ssh_key_path': str(old_key),
        }],
        'default_config_id': 'config_1',
    }), encoding='utf-8')

    monkeypatch.setattr(git_config_manager, 'get_git_configs_path', lambda: str(config_path))
    monkeypatch.setattr(git_config_manager, 'get_git_ssh_keys_dir', lambda: str(current_key_dir))

    manager = git_config_manager.GitConfigManager()

    assert manager.get_default_config()['ssh_key_path'] == os.path.normpath(current_key)
    saved = json.loads(config_path.read_text(encoding='utf-8'))
    assert saved['configs'][0]['ssh_key_path'] == os.path.normpath(current_key)


def test_git_env_rejects_missing_configured_private_key(tmp_path):
    manager = GitManager()

    with pytest.raises(FileNotFoundError, match='SSH 私钥文件不存在'):
        manager._get_git_env({
            'auth_type': 'ssh',
            'ssh_key_path': str(tmp_path / 'missing_key'),
        })


def test_git_env_secures_key_and_forces_selected_identity(tmp_path, monkeypatch):
    private_key = tmp_path / 'key'
    private_key.write_text('private key', encoding='utf-8')
    secured = []
    monkeypatch.setattr(
        'yobboy_file_server.git_manager.secure_ssh_private_key',
        lambda path: secured.append(path),
    )

    env = GitManager()._get_git_env({
        'auth_type': 'ssh',
        'ssh_key_path': str(private_key),
    })

    assert secured == [str(private_key)]
    assert f'-i "{private_key}"' in env['GIT_SSH_COMMAND']
    assert '-o IdentitiesOnly=yes' in env['GIT_SSH_COMMAND']
    assert '-o BatchMode=yes' in env['GIT_SSH_COMMAND']


def test_secure_private_key_applies_windows_acl_commands(tmp_path, monkeypatch):
    private_key = tmp_path / 'key'
    private_key.write_text('private key', encoding='utf-8')
    commands = []

    monkeypatch.setattr(git_config_manager.sys, 'platform', 'win32')
    monkeypatch.setattr(git_config_manager.getpass, 'getuser', lambda: 'tester')

    def fake_run(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, '', '')

    monkeypatch.setattr(git_config_manager.subprocess, 'run', fake_run)

    git_config_manager.secure_ssh_private_key(str(private_key))

    assert commands == [
        ['icacls', str(private_key), '/reset'],
        ['icacls', str(private_key), '/inheritance:r'],
        ['icacls', str(private_key), '/grant:r', 'tester:(F)'],
    ]


def test_list_remote_repos_returns_configured_gitlab_repo(tmp_path, monkeypatch):
    private_key = tmp_path / 'key'
    private_key.write_text('private key', encoding='utf-8')
    monkeypatch.setattr(
        'yobboy_file_server.git_manager.secure_ssh_private_key',
        lambda path: None,
    )
    monkeypatch.setattr(
        'yobboy_file_server.git_manager._run_subprocess',
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, 'hash refs/heads/main\n', ''),
    )

    result = GitManager().list_remote_repos({
        'auth_type': 'ssh',
        'server_url': 'git@example.com:project/repo.git',
        'ssh_key_path': str(private_key),
    })

    assert result == {
        'success': True,
        'repos': [{
            'name': 'project/repo',
            'path': 'project/repo.git',
            'full_url': 'git@example.com:project/repo.git',
        }],
    }


def test_clone_repo_preserves_quoted_windows_key_path(tmp_path, monkeypatch):
    target_path = tmp_path / 'repo'
    private_key = tmp_path / 'keys with spaces' / 'YFS'
    private_key.parent.mkdir()
    private_key.write_text('private key', encoding='utf-8')
    captured = {}

    monkeypatch.setattr(
        'yobboy_file_server.git_manager.secure_ssh_private_key',
        lambda path: None,
    )

    def fake_run(command, **kwargs):
        captured['env'] = kwargs.get('env')
        target_path.mkdir()
        (target_path / '.git').mkdir()
        return subprocess.CompletedProcess(command, 0, '', '')

    monkeypatch.setattr('yobboy_file_server.git_manager._run_subprocess', fake_run)
    monkeypatch.setattr(
        GitManager,
        'check_repo',
        lambda self, path: {'is_repo': True, 'branch': 'main'},
    )

    result = GitManager().clone_repo(
        'git@example.com:project/repo.git',
        str(target_path),
        {
            'auth_type': 'ssh',
            'ssh_key_path': str(private_key),
        },
    )

    assert result['success'] is True
    assert f'-i "{private_key}"' in captured['env']['GIT_SSH_COMMAND']
