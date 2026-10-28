from __future__ import annotations

from typing import Dict, Optional


_PQ_WARNING_MARKERS = (
    'warning: connection is not using a post-quantum key exchange algorithm',
    'this session may be vulnerable to "store now, decrypt later" attacks',
    'the server may need to be upgraded',
    'see https://openssh.com/pq.html',
)


def clean_git_remote_output(output: str) -> str:
    lines = []
    for raw_line in (output or '').splitlines():
        normalized = raw_line.strip().lstrip('*').strip()
        if any(marker in normalized.lower() for marker in _PQ_WARNING_MARKERS):
            continue
        lines.append(raw_line.rstrip())
    return '\n'.join(line for line in lines if line.strip()).strip()


def format_git_remote_error(output: str, branch: Optional[str] = None) -> Dict:
    technical_details = clean_git_remote_output(output)
    lowered = technical_details.lower()

    if 'protected branch' in lowered or 'protected branches' in lowered:
        branch_name = branch or '当前分支'
        return {
            'success': False,
            'error_code': 'protected_branch',
            'branch': branch,
            'error': (
                f'当前分支 {branch_name} 是 GitLab 保护分支，当前 SSH 账号没有直接推送权限。'
                '请让项目管理员允许该角色推送保护分支，或切换到普通分支后推送并创建合并请求。'
            ),
            'technical_details': technical_details,
        }

    return {
        'success': False,
        'error': technical_details or 'Git 远程操作失败',
        'technical_details': technical_details or None,
    }
