from yobboy_file_server.git_error_utils import clean_git_remote_output, format_git_remote_error


def test_clean_git_remote_output_removes_post_quantum_warning():
    output = '''** WARNING: connection is not using a post-quantum key exchange algorithm.
** This session may be vulnerable to "store now, decrypt later" attacks.
** The server may need to be upgraded. See https://openssh.com/pq.html
remote: GitLab: push rejected
'''

    assert clean_git_remote_output(output) == 'remote: GitLab: push rejected'


def test_format_git_remote_error_identifies_protected_branch():
    result = format_git_remote_error(
        'remote: GitLab: You are not allowed to push code to protected branches on this project.\n'
        '! [remote rejected] main -> main (pre-receive hook declined)',
        'main',
    )

    assert result['success'] is False
    assert result['error_code'] == 'protected_branch'
    assert result['branch'] == 'main'
    assert '保护分支' in result['error']
    assert 'pre-receive hook declined' in result['technical_details']
