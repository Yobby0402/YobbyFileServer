# git_manager.py
"""
Git操作管理器
负责执行Git相关操作（初始化、克隆、提交、同步等）
"""
import os
import sys
import platform
import subprocess
from typing import Dict, List, Optional, Tuple, Callable

# 尝试导入GitPython
try:
    from git import Repo, InvalidGitRepositoryError, GitCommandError
    from git.exc import GitError
    GIT_AVAILABLE = True
except ImportError:
    GIT_AVAILABLE = False
    print("[警告] GitPython未安装，Git功能不可用")

# 日志输出函数（统一输出到标准输出，GUI会捕获）
def log_message(message, level='INFO'):
    """输出日志消息到标准输出（会被GUI捕获）"""
    prefix = {
        'INFO': '[Git]',
        'DEBUG': '[Git-DEBUG]',
        'WARNING': '[Git-WARNING]',
        'ERROR': '[Git-ERROR]'
    }.get(level, '[Git]')
    
    # 确保输出到标准输出，使用UTF-8编码
    try:
        message_str = f"{prefix} {message}\n"
        sys.stdout.write(message_str)
        sys.stdout.flush()
    except Exception:
        # 如果编码失败，尝试使用错误替换
        try:
            message_str = f"{prefix} {message}\n".encode('utf-8', errors='replace').decode('utf-8', errors='replace')
            sys.stdout.write(message_str)
            sys.stdout.flush()
        except Exception:
            pass  # 如果都失败了，忽略

def _get_subprocess_kwargs():
    """
    获取subprocess.run的额外参数，用于在Windows下隐藏控制台窗口
    
    Returns:
        dict: 包含creationflags的字典（Windows）或空字典（其他平台）
    """
    kwargs = {}
    if platform.system() == 'Windows':
        kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
    return kwargs

def _run_subprocess(*args, **kwargs):
    """
    运行subprocess.run，在Windows下自动隐藏控制台窗口
    
    Args:
        *args: subprocess.run的位置参数
        **kwargs: subprocess.run的关键字参数
        
    Returns:
        subprocess.CompletedProcess: subprocess.run的返回值
    """
    # 合并Windows特定的参数
    kwargs.update(_get_subprocess_kwargs())
    return subprocess.run(*args, **kwargs)

def _force_remove_directory(path):
    """
    强制删除目录（处理Windows文件锁定问题）
    
    Args:
        path: 要删除的目录路径
        
    Returns:
        bool: 删除成功返回True，失败返回False
    """
    import shutil
    import stat
    import time
    
    if not os.path.exists(path):
        return True
    
    def handle_remove_readonly(func, path, exc):
        """
        处理只读文件的删除
        """
        # 更改文件权限为可写
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except Exception as e:
            # 如果还是失败，尝试多次重试
            for _ in range(3):
                try:
                    time.sleep(0.1)
                    os.chmod(path, stat.S_IWRITE)
                    func(path)
                    return
                except:
                    pass
            raise
    
    # 尝试多次删除（处理文件锁定问题）
    max_retries = 5  # 增加重试次数
    for attempt in range(max_retries):
        try:
            shutil.rmtree(path, onerror=handle_remove_readonly)
            log_message(f"成功删除目录: {path}", 'INFO')
            return True
        except PermissionError as e:
            if attempt < max_retries - 1:
                wait_time = 0.5 * (attempt + 1)  # 递增等待时间
                log_message(f"删除目录失败（尝试 {attempt + 1}/{max_retries}），等待 {wait_time:.1f} 秒后重试: {path}", 'WARNING')
                log_message(f"  错误: {e}", 'WARNING')
                time.sleep(wait_time)
            else:
                log_message(f"删除目录失败（已重试 {max_retries} 次）: {path}", 'ERROR')
                log_message(f"  错误: {e}", 'ERROR')
                log_message(f"  建议: 请关闭可能占用该目录的程序（如文件管理器、Git客户端等）后手动删除", 'ERROR')
                return False
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 0.5 * (attempt + 1)  # 递增等待时间
                log_message(f"删除目录失败（尝试 {attempt + 1}/{max_retries}），等待 {wait_time:.1f} 秒后重试: {path}", 'WARNING')
                log_message(f"  错误: {e}", 'WARNING')
                time.sleep(wait_time)
            else:
                log_message(f"删除目录失败（已重试 {max_retries} 次）: {path}", 'ERROR')
                log_message(f"  错误: {e}", 'ERROR')
                return False
    
    return False

class GitManager:
    """Git操作管理器"""
    
    def __init__(self):
        if not GIT_AVAILABLE:
            raise ImportError("GitPython未安装，无法使用Git功能")
    
    def _get_git_env(self, config: Optional[Dict] = None) -> Dict:
        """
        根据配置获取Git环境变量，主要用于SSH认证
        
        Args:
            config: Git配置字典
            
        Returns:
            环境变量字典
        """
        env = os.environ.copy()
        if config and config.get('auth_type') == 'ssh':
            ssh_key_path = config.get('ssh_key_path', '')
            if ssh_key_path and os.path.exists(ssh_key_path):
                # 使用GIT_SSH_COMMAND指定SSH密钥
                env['GIT_SSH_COMMAND'] = f'ssh -i "{ssh_key_path}" -o StrictHostKeyChecking=no'
        return env
    
    def check_repo(self, path: str) -> Dict:
        """
        检查路径是否为Git仓库
        
        Args:
            path: 要检查的路径
            
        Returns:
            {
                'is_repo': bool,
                'branch': str or None,
                'has_changes': bool,
                'untracked_files': List[str],
                'modified_files': List[str],
                'remote_url': str or None,
                'error': str or None
            }
        """
        if not GIT_AVAILABLE:
            return {
                'is_repo': False,
                'error': 'Git功能不可用，请安装GitPython'
            }
        
        try:
            if not os.path.exists(path):
                return {
                    'is_repo': False,
                    'error': '路径不存在'
                }
            
            # 检查是否为Git仓库
            try:
                # 先检查.git目录是否存在
                git_dir = os.path.join(path, '.git')
                if not os.path.exists(git_dir):
                    return {
                        'is_repo': False,
                        'branch': None,
                        'has_changes': False,
                        'untracked_files': [],
                        'modified_files': [],
                        'remote_url': None,
                        'error': '.git目录不存在'
                    }
                
                repo = Repo(path)
                # 验证仓库是否有效
                if not repo or not repo.git_dir:
                    return {
                        'is_repo': False,
                        'branch': None,
                        'has_changes': False,
                        'untracked_files': [],
                        'modified_files': [],
                        'remote_url': None,
                        'error': '仓库对象无效'
                    }
            except InvalidGitRepositoryError as e:
                error_msg = str(e)
                import sys
                try:
                    sys.stdout.write(f"[Git] InvalidGitRepositoryError: {path}, 错误: {error_msg}\n")
                    sys.stdout.flush()
                except:
                    pass
                return {
                    'is_repo': False,
                    'branch': None,
                    'has_changes': False,
                    'untracked_files': [],
                    'modified_files': [],
                    'remote_url': None,
                    'error': f'无效的Git仓库: {error_msg}'
                }
            except Exception as e:
                error_msg = str(e)
                import sys
                try:
                    sys.stdout.write(f"[Git] 初始化仓库时出错: {path}, 错误: {error_msg}\n")
                    sys.stdout.flush()
                    import traceback
                    traceback.print_exc(file=sys.stdout)
                except:
                    pass
                return {
                    'is_repo': False,
                    'branch': None,
                    'has_changes': False,
                    'untracked_files': [],
                    'modified_files': [],
                    'remote_url': None,
                    'error': f'初始化仓库失败: {error_msg}'
                }
            
            # 获取仓库信息
            branch = None
            try:
                branch = repo.active_branch.name
            except:
                pass
            
            # 检查是否有未提交的更改
            has_changes = False
            untracked_files = []
            modified_files = []
            
            try:
                # 检查是否是bare仓库
                if repo.bare:
                    log_message(f"这是一个bare仓库，跳过工作树检查", 'INFO')
                    has_changes = False
                else:
                    # 获取未跟踪的文件
                    try:
                        untracked = repo.untracked_files
                        untracked_files = untracked if untracked else []
                    except Exception as untracked_error:
                        log_message(f"获取未跟踪文件时出错（已忽略）: {untracked_error}", 'WARNING')
                        untracked_files = []
                    
                    # 获取已修改的文件 - 使用更可靠的方法
                    try:
                        # 方法1: 尝试使用git status命令（更可靠）
                        import subprocess
                        result = _run_subprocess(
                            ['git', 'status', '--porcelain'],
                            cwd=path,
                            capture_output=True,
                            text=True,
                            timeout=10
                        )
                        if result.returncode == 0:
                            status_lines = result.stdout.strip().split('\n') if result.stdout.strip() else []
                            modified_files = []
                            staged_files = []
                            for line in status_lines:
                                if len(line) >= 3:
                                    status_code = line[:2]
                                    file_path = line[3:].strip()
                                    # 状态码说明：
                                    # M - 已修改 (staged)
                                    # M - 已修改 (unstaged)
                                    # A - 已添加 (staged)
                                    # D - 已删除 (staged)
                                    # ?? - 未跟踪
                                    if status_code[0] in ['M', 'A', 'D']:  # 暂存区的更改
                                        if file_path not in staged_files:
                                            staged_files.append(file_path)
                                    if status_code[1] in ['M', 'D']:  # 工作区的更改
                                        if file_path not in modified_files:
                                            modified_files.append(file_path)
                            log_message(f"使用git status检测到: 修改={len(modified_files)}, 暂存={len(staged_files)}, 未跟踪={len(untracked_files)}", 'INFO')
                        else:
                            raise Exception(f"git status返回错误: {result.stderr}")
                    except Exception as status_error:
                        log_message(f"使用git status检查失败，尝试GitPython方法: {status_error}", 'WARNING')
                        # 方法2: 回退到GitPython方法
                        try:
                            modified = [item.a_path for item in repo.index.diff(None)]
                            modified_files = modified if modified else []
                        except Exception as diff_error:
                            log_message(f"GitPython diff方法也失败: {diff_error}", 'WARNING')
                            modified_files = []
                            staged_files = []
                            # 方法3: 使用is_dirty作为最后的回退
                            try:
                                if repo.is_dirty(untracked_files=False):
                                    log_message("检测到工作区有更改（使用is_dirty）", 'INFO')
                                    has_changes = True
                                    # 无法获取具体文件列表，但至少知道有更改
                                else:
                                    has_changes = len(untracked_files) > 0
                            except:
                                has_changes = len(untracked_files) > 0
                        else:
                            staged_files = []
                            try:
                                staged = [item.a_path for item in repo.index.diff('HEAD')]
                                staged_files = staged if staged else []
                            except:
                                staged_files = []
                    
                    # 计算是否有更改
                    # 确保staged_files变量存在
                    if 'staged_files' not in locals():
                        staged_files = []
                    has_changes = len(untracked_files) > 0 or len(modified_files) > 0 or len(staged_files) > 0
            except Exception as e:
                log_message(f"检查Git状态时出错: {e}", 'WARNING')
                has_changes = False
            
            # 获取远程URL
            remote_url = None
            try:
                if repo.remotes:
                    remote_url = repo.remotes.origin.url if 'origin' in [r.name for r in repo.remotes] else None
                    if not remote_url and repo.remotes:
                        remote_url = repo.remotes[0].url
            except:
                pass
            
            # 确保staged_files变量存在（即使之前检测失败）
            if 'staged_files' not in locals():
                staged_files = []
            
            return {
                'is_repo': True,
                'branch': branch,
                'has_changes': has_changes,
                'untracked_files': untracked_files,
                'modified_files': modified_files,
                'staged_files': staged_files,  # 添加暂存文件列表
                'remote_url': remote_url
            }
            
        except Exception as e:
            return {
                'is_repo': False,
                'error': str(e)
            }
    
    def init_repo(self, path: str) -> Dict:
        """
        初始化Git仓库
        
        Args:
            path: 要初始化的路径
            
        Returns:
            {'success': bool, 'error': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            if not os.path.exists(path):
                return {'success': False, 'error': '路径不存在'}
            
            if not os.path.isdir(path):
                return {'success': False, 'error': '路径不是目录'}
            
            # 检查是否已经是Git仓库
            repo_info = self.check_repo(path)
            if repo_info.get('is_repo'):
                return {'success': False, 'error': '该目录已经是Git仓库'}
            
            # 初始化仓库
            repo = Repo.init(path)
            
            return {'success': True}
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def clone_repo(self, remote_url: str, target_path: str, config: Optional[Dict] = None, progress_callback: Optional[Callable] = None) -> Dict:
        """
        克隆远程仓库
        
        Args:
            remote_url: 远程仓库URL
            target_path: 目标路径
            config: Git配置（用于认证）
            progress_callback: 进度回调函数，接收 (op_code, cur_count, max_count, message) 参数
            
        Returns:
            {'success': bool, 'error': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            # 检查目标路径（这个检查已经在git_routes.py中完成，这里保留作为双重检查）
            # 在执行克隆前，确保目录不存在或已被清理
            log_message(f"[clone_repo] 开始检查目标路径: {target_path}", 'INFO')
            if os.path.exists(target_path):
                log_message(f"[clone_repo] 目标路径存在: {target_path}", 'INFO')
                try:
                    dir_contents = os.listdir(target_path)
                    log_message(f"[clone_repo] 目录内容: {dir_contents}", 'INFO')
                    if dir_contents:
                        # 检查是否已经是Git仓库（有.git目录）
                        git_dir = os.path.join(target_path, '.git')
                        log_message(f"[clone_repo] 检查.git目录: {git_dir}, 存在: {os.path.exists(git_dir)}", 'INFO')
                        if os.path.exists(git_dir):
                            # 尝试验证是否是有效的Git仓库
                            try:
                                test_repo = Repo(target_path)
                                log_message(f"[clone_repo] 目录是有效的Git仓库", 'WARNING')
                                return {'success': False, 'error': f'目标目录 {target_path} 已经是一个有效的Git仓库'}
                            except Exception as e:
                                # GitPython无法打开，可能是不完整的仓库，尝试清理
                                log_message(f"[clone_repo] 检测到不完整的Git仓库（.git存在但无法打开），尝试清理: {target_path}, 错误: {e}", 'WARNING')
                                if not _force_remove_directory(target_path):
                                    log_message(f"[clone_repo] 清理目录失败: {target_path}", 'ERROR')
                                    return {'success': False, 'error': f'目标目录 {target_path} 存在但不完整。自动清理失败，请手动删除该目录后重试。如果文件被锁定，请关闭所有可能使用该目录的程序。'}
                                log_message(f"[clone_repo] 已清理不完整目录: {target_path}", 'INFO')
                                # 清理成功，继续执行
                        else:
                            # 不是Git仓库，但有其他文件，尝试清理（可能是不完整的克隆）
                            log_message(f"[clone_repo] 检测到非空目录（非Git仓库），尝试清理: {target_path}", 'WARNING')
                            try:
                                _force_remove_directory(target_path)
                                log_message(f"[clone_repo] 已清理非Git目录: {target_path}", 'INFO')
                                # 清理成功，继续执行
                            except Exception as cleanup_error:
                                log_message(f"[clone_repo] 清理目录失败: {cleanup_error}", 'ERROR')
                                return {'success': False, 'error': f'目标目录 {target_path} 已存在且不为空（非Git仓库）。自动清理失败，请手动删除该目录后重试。如果文件被锁定，请关闭所有可能使用该目录的程序。'}
                    else:
                        # 空目录，删除它（Git clone 会重新创建）
                        log_message(f"[clone_repo] 目录为空，删除: {target_path}", 'INFO')
                        try:
                            os.rmdir(target_path)
                            log_message(f"[clone_repo] 已删除空目录: {target_path}", 'INFO')
                        except Exception as e:
                            log_message(f"[clone_repo] 删除空目录失败: {e}", 'WARNING')
                except Exception as e:
                    log_message(f"[clone_repo] 检查目标目录时出错: {e}", 'WARNING')
                    return {'success': False, 'error': f'无法访问目标目录: {str(e)}'}
            else:
                log_message(f"[clone_repo] 目标路径不存在，可以继续: {target_path}", 'INFO')
            
            # 处理URL和认证
            final_url = remote_url
            clone_kwargs = {}
            env = None
            
            # 检测是否是完整URL
            is_full_url = remote_url.startswith(('http://', 'https://', 'git@', 'ssh://'))
            
            if is_full_url:
                # 完整URL，直接使用，不需要组合
                final_url = remote_url
                log_message(f"使用完整URL: {final_url}", 'INFO')
            elif config:
                # 相对路径，需要与服务器地址组合
                server_url = config.get('server_url', '').strip()
                
                if server_url:
                        # 清理服务器URL和仓库名
                        base_url = server_url.rstrip('/')
                        repo_path = remote_url.strip().lstrip('/')  # 仓库路径可能包含子路径，如 group/repo-name
                        
                        # 确保仓库路径以 .git 结尾
                        if not repo_path.endswith('.git'):
                            repo_path += '.git'
                        
                        # 组合URL
                        if base_url.startswith('git@'):
                            # git@hostname:path 格式
                            if ':' in base_url:
                                parts = base_url.split(':', 1)
                                if len(parts) == 2:
                                    hostname = parts[0]  # git@hostname
                                    base_path = parts[1].rstrip('/')  # 基础路径部分（如 username/）
                                    
                                    # 如果仓库路径已经包含完整路径（如 group/repo-name.git），直接使用
                                    # 如果仓库路径只是仓库名（如 repo-name.git），则使用基础路径
                                    if '/' in repo_path:
                                        # 仓库路径包含路径信息，直接使用
                                        final_url = f"{hostname}:{repo_path}"
                                    else:
                                        # 只是仓库名，需要与基础路径组合
                                        if base_path:
                                            final_url = f"{hostname}:{base_path}/{repo_path}"
                                        else:
                                            final_url = f"{hostname}:{repo_path}"
                                else:
                                    final_url = f"{base_url}/{repo_path}"
                            else:
                                final_url = f"{base_url}/{repo_path}"
                        elif base_url.startswith('ssh://'):
                            # ssh://git@hostname/path 格式
                            if base_url.endswith('/'):
                                final_url = base_url + repo_path
                            else:
                                final_url = base_url + '/' + repo_path
                        elif base_url.startswith(('http://', 'https://')):
                            # HTTP/HTTPS 格式
                            if base_url.endswith('/'):
                                final_url = base_url + repo_path
                            else:
                                final_url = base_url + '/' + repo_path
                        else:
                            # 默认处理
                            final_url = f"{base_url}/{repo_path}"
                
            # 处理认证（对于完整URL或相对路径都可能需要）
            if config:
                auth_type = config.get('auth_type', 'ssh')
                
                if auth_type == 'ssh':
                    # SSH认证（适用于完整SSH URL或相对路径）
                    ssh_key_path = config.get('ssh_key_path', '')
                    if ssh_key_path and os.path.exists(ssh_key_path):
                        # 设置SSH环境变量
                        import os as os_module
                        if env is None:
                            env = os_module.environ.copy()
                        # 使用GIT_SSH_COMMAND指定SSH密钥
                        env['GIT_SSH_COMMAND'] = f'ssh -i {ssh_key_path} -o StrictHostKeyChecking=no'
                elif auth_type == 'https':
                    # HTTPS认证（仅适用于HTTPS URL或相对路径）
                    if not is_full_url or final_url.startswith(('http://', 'https://')):
                        username = config.get('username', '')
                        password = config.get('password_encrypted', '')
                        
                        if username and password:
                            # 解码密码（如果是base64编码）
                            try:
                                import base64
                                password_decoded = base64.b64decode(password).decode('utf-8')
                            except:
                                password_decoded = password
                            
                            # 在URL中包含认证信息
                            if '://' in final_url:
                                # 如果URL中还没有认证信息，添加
                                if '@' not in final_url.split('://')[1]:
                                    url_parts = final_url.split('://')
                                    final_url = f"{url_parts[0]}://{username}:{password_decoded}@{url_parts[1]}"
            
            # 创建进度回调函数
            def git_progress(op_code, cur_count, max_count=None, message=''):
                """Git操作进度回调"""
                if progress_callback:
                    try:
                        # op_code: 
                        # - 0 = COUNTING (正在计数对象)
                        # - 1 = COMPRESSING (正在压缩对象)
                        # - 2 = RECEIVING (正在接收对象)
                        # - 3 = RESOLVING (正在解析增量)
                        op_names = {
                            0: '计数对象',
                            1: '压缩对象',
                            2: '接收对象',
                            3: '解析增量'
                        }
                        op_name = op_names.get(op_code, '处理中')
                        progress_callback(op_code, cur_count, max_count, f"{op_name}: {message}")
                    except:
                        pass
            
            # 在执行克隆之前，再次确保目标目录不存在（可能在检查后又有变化）
            log_message(f"克隆前最终检查目标目录: {target_path}", 'INFO')
            if os.path.exists(target_path):
                log_message(f"目录存在，检查内容: {target_path}", 'INFO')
                try:
                    dir_contents = os.listdir(target_path)
                    log_message(f"目录内容: {dir_contents}", 'INFO')
                    if dir_contents:
                        # 目录不为空，检查是否是有效的Git仓库
                        git_dir = os.path.join(target_path, '.git')
                        if os.path.exists(git_dir):
                            log_message(f"检测到.git目录: {git_dir}", 'INFO')
                            try:
                                # 尝试打开验证
                                test_repo = Repo(target_path)
                                # 如果成功打开，是有效的仓库
                                log_message(f"目录是有效的Git仓库", 'WARNING')
                                return {'success': False, 'error': f'目标目录 {target_path} 已经是一个有效的Git仓库'}
                            except Exception as e:
                                # 无法打开，可能是不完整的，清理它
                                log_message(f"克隆前检测到不完整目录（.git存在但无法打开），清理: {target_path}, 错误: {e}", 'WARNING')
                                if not _force_remove_directory(target_path):
                                    log_message(f"清理目录失败: {target_path}", 'ERROR')
                                    return {'success': False, 'error': f'无法清理目录 {target_path}，请手动删除后重试。如果文件被锁定，请关闭所有可能使用该目录的程序。'}
                                log_message(f"已清理目录: {target_path}", 'INFO')
                        else:
                            # 不是Git仓库，但有其他文件
                            log_message(f"克隆前检测到非空目录（非Git仓库），尝试清理: {target_path}", 'WARNING')
                            if not _force_remove_directory(target_path):
                                log_message(f"清理目录失败: {target_path}", 'ERROR')
                                return {'success': False, 'error': f'无法清理目录 {target_path}，请手动删除后重试。如果文件被锁定，请关闭所有可能使用该目录的程序。'}
                            log_message(f"已清理目录: {target_path}", 'INFO')
                    else:
                        # 空目录，删除它（Git clone 会重新创建）
                        log_message(f"目录为空，删除: {target_path}", 'INFO')
                        try:
                            os.rmdir(target_path)
                            log_message(f"已删除空目录: {target_path}", 'INFO')
                        except Exception as e:
                            log_message(f"删除空目录失败: {e}", 'WARNING')
                except Exception as e:
                    log_message(f"克隆前清理目录时出错: {e}", 'WARNING')
                    # 如果检查失败，尝试继续（可能是权限问题，让Git处理）
            else:
                log_message(f"目录不存在，可以继续克隆: {target_path}", 'INFO')
            
            # 执行克隆，使用进度回调
            log_message(f"开始克隆: {final_url} -> {target_path}", 'INFO')
            if env:
                log_message(f"使用SSH环境变量: GIT_SSH_COMMAND={env.get('GIT_SSH_COMMAND', 'N/A')}", 'INFO')
            
            clone_error = None
            last_error = None
            detailed_error_message = None  # 存储详细错误信息（用于最终返回）
            
            # 优先使用subprocess直接调用git clone（更可靠，避免GitPython的checkout问题）
            # 如果用户需要进度回调，再尝试GitPython
            use_gitpython_first = progress_callback is not None
            
            if not use_gitpython_first:
                # 直接使用subprocess（与测试脚本相同的方法）
                try:
                    import subprocess
                    log_message("使用subprocess直接克隆（推荐方法）...", 'INFO')
                    cmd = ['git', 'clone', '-v', '--progress', '--', final_url, target_path]
                    if env:
                        result = _run_subprocess(cmd, env=env, capture_output=True, text=True, timeout=120)
                    else:
                        result = _run_subprocess(cmd, capture_output=True, text=True, timeout=120)
                    
                    # 检查输出中是否包含checkout失败的信息
                    error_output = (result.stderr or '') + (result.stdout or '')
                    is_checkout_failed = result.returncode != 0 and ('checkout failed' in error_output.lower() or 'must be run in a work tree' in error_output.lower() or 'Clone succeeded, but checkout failed' in error_output)
                    
                    if result.returncode == 0 or is_checkout_failed:
                        # 克隆成功（即使checkout失败），验证并修复checkout（如果需要）
                        if is_checkout_failed:
                            log_message("克隆成功但checkout失败，尝试修复...", 'WARNING')
                        else:
                            log_message("subprocess克隆成功，验证工作树...", 'INFO')
                        
                        try:
                            repo = Repo(target_path)
                            current_branch = repo.active_branch.name
                            log_message(f"验证成功，当前分支: {current_branch}", 'INFO')
                            
                            # 重置索引状态，确保工作目录与HEAD完全一致
                            try:
                                import subprocess
                                reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                                if env:
                                    reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                                else:
                                    reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                                
                                if reset_result.returncode == 0:
                                    log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                                else:
                                    log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                            except Exception as reset_error:
                                log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                            
                            clone_error = None  # 重置错误，克隆成功
                        except Exception as verify_error:
                            # checkout可能失败，尝试修复
                            log_message(f"验证失败，尝试修复工作树: {verify_error}", 'WARNING')
                            try:
                                # 尝试使用 git restore 修复
                                restore_cmd = ['git', '-C', target_path, 'restore', '--source=HEAD', ':/']
                                if env:
                                    restore_result = _run_subprocess(restore_cmd, env=env, capture_output=True, text=True, timeout=30)
                                else:
                                    restore_result = _run_subprocess(restore_cmd, capture_output=True, text=True, timeout=30)
                                
                                if restore_result.returncode == 0:
                                    log_message(f"使用 git restore 修复成功", 'INFO')
                                    
                                    # 重置索引状态，确保工作目录与HEAD完全一致
                                    try:
                                        reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                                        if env:
                                            reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                                        else:
                                            reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                                        
                                        if reset_result.returncode == 0:
                                            log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                                        else:
                                            log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                                    except Exception as reset_error:
                                        log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                                    
                                    repo = Repo(target_path)
                                    current_branch = repo.active_branch.name
                                    log_message(f"修复后验证成功，当前分支: {current_branch}", 'INFO')
                                    clone_error = None  # 重置错误
                                else:
                                    # 如果 restore 失败，尝试 checkout
                                    log_message(f"git restore 失败，尝试 git checkout: {restore_result.stderr}", 'WARNING')
                                    checkout_cmd = ['git', '-C', target_path, 'checkout', '-f']
                                    if env:
                                        checkout_result = _run_subprocess(checkout_cmd, env=env, capture_output=True, text=True, timeout=30)
                                    else:
                                        checkout_result = _run_subprocess(checkout_cmd, capture_output=True, text=True, timeout=30)
                                    
                                    if checkout_result.returncode == 0:
                                        log_message(f"使用 git checkout 修复成功", 'INFO')
                                        repo = Repo(target_path)
                                        current_branch = repo.active_branch.name
                                        log_message(f"修复后验证成功，当前分支: {current_branch}", 'INFO')
                                        clone_error = None  # 重置错误
                                    else:
                                        log_message(f"git checkout 也失败: {checkout_result.stderr}", 'WARNING')
                                        # 即使修复失败，也认为克隆成功（仓库存在）
                                        clone_error = None
                            except Exception as fix_error:
                                log_message(f"修复工作树时出错: {fix_error}", 'WARNING')
                                # 即使修复失败，也认为克隆成功（仓库存在）
                                clone_error = None
                    else:
                        # 克隆失败
                        error_detail = result.stderr or result.stdout or '未知错误'
                        clone_error = Exception(f"Git克隆失败 (退出码 {result.returncode}): {error_detail}")
                        last_error = str(clone_error)
                        log_message(f"subprocess克隆失败: {last_error}", 'ERROR')
                except Exception as subprocess_error:
                    log_message(f"subprocess克隆异常: {subprocess_error}", 'WARNING')
                    clone_error = subprocess_error
                    last_error = str(subprocess_error)
            
            # 如果需要进度回调或subprocess失败，尝试GitPython
            if use_gitpython_first or clone_error:
                try:
                    if env:
                        repo = Repo.clone_from(final_url, target_path, env=env, progress=git_progress, **clone_kwargs)
                    else:
                        repo = Repo.clone_from(final_url, target_path, progress=git_progress, **clone_kwargs)
                    log_message(f"克隆成功: {target_path}", 'INFO')
                    
                    # 验证克隆是否完整（检查是否有工作树）
                    try:
                        # 尝试获取当前分支，验证工作树是否正常
                        current_branch = repo.active_branch.name
                        log_message(f"克隆验证成功，当前分支: {current_branch}", 'INFO')
                    except Exception as verify_error:
                        # 如果验证失败，可能是checkout失败，尝试修复
                        log_message(f"克隆后验证失败，尝试修复工作树: {verify_error}", 'WARNING')
                        try:
                            import subprocess
                            # 尝试使用 git restore 修复
                            restore_cmd = ['git', '-C', target_path, 'restore', '--source=HEAD', ':/']
                            if env:
                                restore_result = _run_subprocess(restore_cmd, env=env, capture_output=True, text=True, timeout=30)
                            else:
                                restore_result = _run_subprocess(restore_cmd, capture_output=True, text=True, timeout=30)
                            
                            if restore_result.returncode == 0:
                                log_message(f"使用 git restore 修复成功", 'INFO')
                                
                                # 重置索引状态，确保工作目录与HEAD完全一致
                                try:
                                    reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                                    if env:
                                        reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                                    else:
                                        reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                                    
                                    if reset_result.returncode == 0:
                                        log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                                    else:
                                        log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                                except Exception as reset_error:
                                    log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                                
                                # 重新打开仓库验证
                                repo = Repo(target_path)
                                current_branch = repo.active_branch.name
                                log_message(f"修复后验证成功，当前分支: {current_branch}", 'INFO')
                            else:
                                # 如果 restore 失败，尝试 checkout
                                log_message(f"git restore 失败，尝试 git checkout: {restore_result.stderr}", 'WARNING')
                                checkout_cmd = ['git', '-C', target_path, 'checkout', '-f']
                                if env:
                                    checkout_result = _run_subprocess(checkout_cmd, env=env, capture_output=True, text=True, timeout=30)
                                else:
                                    checkout_result = _run_subprocess(checkout_cmd, capture_output=True, text=True, timeout=30)
                                
                                if checkout_result.returncode == 0:
                                    log_message(f"使用 git checkout 修复成功", 'INFO')
                                    
                                    # 重置索引状态，确保工作目录与HEAD完全一致
                                    try:
                                        reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                                        if env:
                                            reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                                        else:
                                            reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                                        
                                        if reset_result.returncode == 0:
                                            log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                                        else:
                                            log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                                    except Exception as reset_error:
                                        log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                                    
                                    repo = Repo(target_path)
                                    current_branch = repo.active_branch.name
                                    log_message(f"修复后验证成功，当前分支: {current_branch}", 'INFO')
                                else:
                                    log_message(f"git checkout 也失败: {checkout_result.stderr}", 'WARNING')
                                    # 即使修复失败，也继续（仓库可能仍然可用）
                        except Exception as fix_error:
                            log_message(f"修复工作树时出错: {fix_error}", 'WARNING')
                            # 继续执行，仓库可能仍然可用
                    
                    clone_error = None  # 重置错误，克隆成功
                except Exception as e:
                    clone_error = e
                    last_error = str(e)
                    log_message(f"克隆失败（使用进度回调）: {last_error}", 'WARNING')
                
                # 如果第一次克隆失败，检查并清理可能创建的不完整目录
                if os.path.exists(target_path):
                    log_message(f"检测到克隆失败后残留目录，清理: {target_path}", 'WARNING')
                    if not _force_remove_directory(target_path):
                        log_message(f"清理残留目录失败: {target_path}", 'WARNING')
                    else:
                        log_message(f"已清理残留目录: {target_path}", 'INFO')
                
                # 如果克隆失败，尝试不使用进度回调（某些情况下可能不支持）
                if progress_callback:
                    try:
                        log_message("尝试不使用进度回调重新克隆...", 'INFO')
                        # 再次检查目录（可能在清理后又被创建）
                        if os.path.exists(target_path):
                            log_message(f"重新克隆前再次检查目录: {target_path}", 'INFO')
                            try:
                                dir_contents = os.listdir(target_path)
                                if dir_contents:
                                    log_message(f"目录不为空，清理: {target_path}", 'WARNING')
                                    if not _force_remove_directory(target_path):
                                        log_message(f"清理目录失败: {target_path}", 'WARNING')
                                    else:
                                        log_message(f"已清理目录: {target_path}", 'INFO')
                                else:
                                    log_message(f"目录为空，删除: {target_path}", 'INFO')
                                    try:
                                        os.rmdir(target_path)
                                    except Exception as e:
                                        log_message(f"删除空目录失败: {e}", 'WARNING')
                            except Exception as check_error:
                                log_message(f"检查目录时出错: {check_error}", 'WARNING')
                        
                        if env:
                            repo = Repo.clone_from(final_url, target_path, env=env, **clone_kwargs)
                        else:
                            repo = Repo.clone_from(final_url, target_path, **clone_kwargs)
                        log_message(f"克隆成功（不使用进度回调）: {target_path}", 'INFO')
                        
                        # 重置索引状态，确保工作目录与HEAD完全一致
                        try:
                            import subprocess
                            reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                            if env:
                                reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                            else:
                                reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                            
                            if reset_result.returncode == 0:
                                log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                            else:
                                log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                        except Exception as reset_error:
                            log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                        
                        clone_error = None  # 重置错误
                    except Exception as e2:
                        clone_error = e2
                        last_error = str(e2)
                        log_message(f"克隆失败（不使用进度回调）: {last_error}", 'ERROR')
                        
                        # 检查是否是checkout失败（克隆成功但checkout失败）
                        is_checkout_failed = 'checkout failed' in last_error.lower() or 'must be run in a work tree' in last_error.lower()
                        
                        if is_checkout_failed and os.path.exists(target_path):
                            # 克隆成功但checkout失败，尝试修复而不是清理
                            log_message(f"检测到checkout失败，尝试修复工作树: {target_path}", 'WARNING')
                            try:
                                import subprocess
                                # 尝试使用 git restore 修复
                                restore_cmd = ['git', '-C', target_path, 'restore', '--source=HEAD', ':/']
                                if env:
                                    restore_result = _run_subprocess(restore_cmd, env=env, capture_output=True, text=True, timeout=30)
                                else:
                                    restore_result = _run_subprocess(restore_cmd, capture_output=True, text=True, timeout=30)
                                
                                if restore_result.returncode == 0:
                                    log_message(f"使用 git restore 修复成功", 'INFO')
                                    
                                    # 重置索引状态，确保工作目录与HEAD完全一致
                                    try:
                                        reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                                        if env:
                                            reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                                        else:
                                            reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                                        
                                        if reset_result.returncode == 0:
                                            log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                                        else:
                                            log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                                    except Exception as reset_error:
                                        log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                                    
                                    # 验证修复结果
                                    try:
                                        repo = Repo(target_path)
                                        current_branch = repo.active_branch.name
                                        log_message(f"修复后验证成功，当前分支: {current_branch}", 'INFO')
                                        clone_error = None  # 重置错误，修复成功
                                    except Exception as verify_error:
                                        log_message(f"修复后验证失败: {verify_error}", 'WARNING')
                                else:
                                    # 如果 restore 失败，尝试 checkout
                                    log_message(f"git restore 失败，尝试 git checkout: {restore_result.stderr}", 'WARNING')
                                    checkout_cmd = ['git', '-C', target_path, 'checkout', '-f']
                                    if env:
                                        checkout_result = _run_subprocess(checkout_cmd, env=env, capture_output=True, text=True, timeout=30)
                                    else:
                                        checkout_result = _run_subprocess(checkout_cmd, capture_output=True, text=True, timeout=30)
                                    
                                    if checkout_result.returncode == 0:
                                        log_message(f"使用 git checkout 修复成功", 'INFO')
                                        
                                        # 重置索引状态，确保工作目录与HEAD完全一致
                                        try:
                                            reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                                            if env:
                                                reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                                            else:
                                                reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                                            
                                            if reset_result.returncode == 0:
                                                log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                                            else:
                                                log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                                        except Exception as reset_error:
                                            log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                                        
                                        # 验证修复结果
                                        try:
                                            repo = Repo(target_path)
                                            current_branch = repo.active_branch.name
                                            log_message(f"修复后验证成功，当前分支: {current_branch}", 'INFO')
                                            clone_error = None  # 重置错误，修复成功
                                        except Exception as verify_error:
                                            log_message(f"修复后验证失败: {verify_error}", 'WARNING')
                                    else:
                                        log_message(f"git checkout 也失败: {checkout_result.stderr}", 'WARNING')
                            except Exception as fix_error:
                                log_message(f"修复工作树时出错: {fix_error}", 'WARNING')
                        
                        # 如果修复成功，不再尝试subprocess克隆
                        if clone_error is None:
                            log_message(f"克隆成功（通过修复checkout）: {target_path}", 'INFO')
                        else:
                            # 如果修复失败或不是checkout失败，清理目录
                            if clone_error and os.path.exists(target_path):
                                log_message(f"克隆失败后清理目录: {target_path}", 'WARNING')
                                if not _force_remove_directory(target_path):
                                    log_message(f"清理目录失败: {target_path}", 'WARNING')
                                else:
                                    log_message(f"已清理目录: {target_path}", 'INFO')
                            
                            # 尝试使用subprocess直接克隆（如果GitPython失败且未修复）
                            try:
                                import subprocess
                                log_message("尝试使用subprocess直接克隆...", 'INFO')
                                cmd = ['git', 'clone', '-v', '--', final_url, target_path]
                                if env:
                                    result = _run_subprocess(cmd, env=env, capture_output=True, text=True, timeout=120)
                                else:
                                    result = _run_subprocess(cmd, capture_output=True, text=True, timeout=120)
                                
                                # 检查输出中是否包含checkout失败的信息（克隆成功但checkout失败）
                                error_output = (result.stderr or '') + (result.stdout or '')
                                is_checkout_failed = result.returncode != 0 and ('checkout failed' in error_output.lower() or 'must be run in a work tree' in error_output.lower() or 'Clone succeeded, but checkout failed' in error_output)
                                
                                if result.returncode == 0 or is_checkout_failed:
                                    # 克隆成功（即使checkout失败），验证并修复checkout（如果需要）
                                    if is_checkout_failed:
                                        log_message("subprocess克隆成功但checkout失败，尝试修复...", 'WARNING')
                                    else:
                                        log_message("subprocess克隆成功，验证工作树...", 'INFO')
                                    try:
                                        repo = Repo(target_path)
                                        current_branch = repo.active_branch.name
                                        log_message(f"验证成功，当前分支: {current_branch}", 'INFO')
                                        clone_error = None  # 重置错误，克隆成功
                                    except Exception as verify_error:
                                        # checkout可能失败，尝试修复
                                        log_message(f"验证失败，尝试修复工作树: {verify_error}", 'WARNING')
                                        try:
                                            # 尝试使用 git restore 修复
                                            restore_cmd = ['git', '-C', target_path, 'restore', '--source=HEAD', ':/']
                                            if env:
                                                restore_result = _run_subprocess(restore_cmd, env=env, capture_output=True, text=True, timeout=30)
                                            else:
                                                restore_result = _run_subprocess(restore_cmd, capture_output=True, text=True, timeout=30)
                                            
                                            if restore_result.returncode == 0:
                                                log_message(f"使用 git restore 修复成功", 'INFO')
                                                
                                                # 重置索引状态，确保工作目录与HEAD完全一致
                                                try:
                                                    reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                                                    if env:
                                                        reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                                                    else:
                                                        reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                                                    
                                                    if reset_result.returncode == 0:
                                                        log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                                                    else:
                                                        log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                                                except Exception as reset_error:
                                                    log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                                                
                                                repo = Repo(target_path)
                                                current_branch = repo.active_branch.name
                                                log_message(f"修复后验证成功，当前分支: {current_branch}", 'INFO')
                                                clone_error = None  # 重置错误
                                            else:
                                                # 如果 restore 失败，尝试 checkout
                                                log_message(f"git restore 失败，尝试 git checkout: {restore_result.stderr}", 'WARNING')
                                                checkout_cmd = ['git', '-C', target_path, 'checkout', '-f']
                                                if env:
                                                    checkout_result = _run_subprocess(checkout_cmd, env=env, capture_output=True, text=True, timeout=30)
                                                else:
                                                    checkout_result = _run_subprocess(checkout_cmd, capture_output=True, text=True, timeout=30)
                                                
                                                if checkout_result.returncode == 0:
                                                    log_message(f"使用 git checkout 修复成功", 'INFO')
                                                    
                                                    # 重置索引状态，确保工作目录与HEAD完全一致
                                                    try:
                                                        reset_cmd = ['git', '-C', target_path, 'reset', '--hard', 'HEAD']
                                                        if env:
                                                            reset_result = _run_subprocess(reset_cmd, env=env, capture_output=True, text=True, timeout=30)
                                                        else:
                                                            reset_result = _run_subprocess(reset_cmd, capture_output=True, text=True, timeout=30)
                                                        
                                                        if reset_result.returncode == 0:
                                                            log_message(f"已重置索引状态，确保工作目录与HEAD一致", 'INFO')
                                                        else:
                                                            log_message(f"重置索引状态失败（可忽略）: {reset_result.stderr}", 'WARNING')
                                                    except Exception as reset_error:
                                                        log_message(f"重置索引状态时出错（可忽略）: {reset_error}", 'WARNING')
                                                    
                                                    repo = Repo(target_path)
                                                    current_branch = repo.active_branch.name
                                                    log_message(f"修复后验证成功，当前分支: {current_branch}", 'INFO')
                                                    clone_error = None  # 重置错误
                                                else:
                                                    log_message(f"git checkout 也失败: {checkout_result.stderr}", 'WARNING')
                                                    # 即使修复失败，也认为克隆成功（仓库存在）
                                                    clone_error = None
                                        except Exception as fix_error:
                                            log_message(f"修复工作树时出错: {fix_error}", 'WARNING')
                                            # 即使修复失败，也认为克隆成功（仓库存在）
                                            clone_error = None
                                elif result.returncode != 0:
                                    error_detail = result.stderr or result.stdout or '未知错误'
                                    log_message(f"Git命令错误详情: {error_detail}", 'ERROR')
                                    
                                    # 分析错误类型，提供更友好的错误信息
                                    detailed_suggestions = []
                                    if 'Could not read from remote repository' in error_detail:
                                        if 'permission' in error_detail.lower() or 'access' in error_detail.lower() or "don't have permission" in error_detail.lower() or "The project you were looking for could not be found" in error_detail:
                                            detailed_suggestions = [
                                                '仓库不存在或无权访问',
                                                '请检查：',
                                                '1. 仓库名称是否正确（注意大小写，如 group/repo-name 而不是 group/reponame）',
                                                '2. 仓库路径是否正确',
                                                '3. SSH密钥是否正确配置',
                                                '4. 公钥是否已添加到Git服务器',
                                                '5. 是否有访问该仓库的权限'
                                            ]
                                        else:
                                            detailed_suggestions = [
                                                '无法从远程仓库读取',
                                                '可能的原因：',
                                                '1. 仓库不存在或无权访问',
                                                '2. SSH认证失败',
                                                '3. 网络连接问题',
                                                '4. 仓库名称或路径错误（注意大小写）'
                                            ]
                                    
                                    if detailed_suggestions:
                                        suggestion_text = '\n'.join(detailed_suggestions)
                                        detailed_error_message = f"{suggestion_text}\n\n详细错误: {error_detail}"
                                    else:
                                        detailed_error_message = f"Git错误 (退出码 {result.returncode}): {error_detail}"
                            except Exception as subprocess_error:
                                log_message(f"获取详细错误信息失败: {subprocess_error}", 'WARNING')
                
                # 如果设置了详细错误信息，创建一个包含详细信息的异常
                if detailed_error_message:
                    raise Exception(detailed_error_message)
                elif clone_error:
                    raise clone_error
            
            # 如果配置中有Git用户信息，设置它
            if config:
                git_user_name = config.get('git_user_name')
                git_user_email = config.get('git_user_email')
                
                if git_user_name:
                    repo.config_writer().set_value('user', 'name', git_user_name).release()
            if git_user_email:
                repo.config_writer().set_value('user', 'email', git_user_email).release()
            
            return {'success': True}
            
        except Exception as e:
            error_msg = str(e)
            # 尝试从异常对象中提取更详细的信息
            if hasattr(e, 'stderr') and e.stderr:
                error_msg = f"{error_msg}\n详细错误: {e.stderr}"
            elif hasattr(e, 'stdout') and e.stdout:
                error_msg = f"{error_msg}\n输出: {e.stdout}"
            
            log_message(f"克隆操作失败: {error_msg}", 'ERROR')
            
            # 提供更友好的错误信息
            if 'exit code(128)' in error_msg or '128' in error_msg:
                if 'Permission denied' in error_msg or 'permission' in error_msg.lower():
                    error_msg = f"SSH认证失败或权限不足。请检查：\n1. SSH密钥是否正确配置\n2. 公钥是否已添加到Git服务器\n3. 仓库URL是否正确\n\n原始错误: {error_msg}"
                elif 'Could not resolve hostname' in error_msg or 'Host key verification failed' in error_msg:
                    error_msg = f"无法连接到Git服务器。请检查：\n1. 服务器地址是否正确\n2. 网络连接是否正常\n3. SSH密钥配置是否正确\n\n原始错误: {error_msg}"
                elif 'repository not found' in error_msg.lower() or 'does not exist' in error_msg.lower():
                    error_msg = f"仓库不存在或无法访问。请检查：\n1. 仓库名称是否正确\n2. 是否有访问权限\n3. 仓库URL是否正确\n\n原始错误: {error_msg}"
                else:
                    error_msg = f"Git操作失败（错误码128）。可能的原因：\n1. SSH认证失败\n2. 仓库不存在或无权访问\n3. 网络连接问题\n\n原始错误: {error_msg}"
            
            return {'success': False, 'error': error_msg}
    
    def pull(self, path: str, config: Optional[Dict] = None) -> Dict:
        """
        从远程拉取更新
        
        Args:
            path: 仓库路径
            config: Git配置
            
        Returns:
            {'success': bool, 'error': str or None, 'changes': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            repo = Repo(path)
            
            # 检查是否有远程仓库
            if not repo.remotes:
                return {'success': False, 'error': '仓库没有配置远程地址'}
            
            origin = repo.remotes.origin
            
            # 如果提供了配置，设置Git用户信息
            if config:
                git_user_name = config.get('git_user_name')
                git_user_email = config.get('git_user_email')
                
                if git_user_name:
                    repo.config_writer().set_value('user', 'name', git_user_name).release()
                if git_user_email:
                    repo.config_writer().set_value('user', 'email', git_user_email).release()
            
            # 获取Git环境变量（用于SSH认证等）
            env = self._get_git_env(config)
            
            # 拉取更新 - GitPython的pull方法不支持env参数，需要使用git命令
            try:
                if env:
                    # 使用git命令拉取，以便传递环境变量
                    import subprocess
                    result = _run_subprocess(
                        ['git', 'pull', 'origin', repo.active_branch.name],
                        cwd=path,
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=60
                    )
                    if result.returncode != 0:
                        error_msg = result.stderr or result.stdout or '拉取失败'
                        log_message(f"拉取失败: {error_msg}", 'ERROR')
                        return {'success': False, 'error': error_msg}
                    log_message(f"拉取成功: {result.stdout}", 'INFO')
                else:
                    # 没有环境变量，使用GitPython的pull方法
                    origin.pull()
                    log_message("拉取成功", 'INFO')
            except Exception as pull_error:
                error_msg = str(pull_error)
                log_message(f"拉取异常: {error_msg}", 'ERROR')
                return {'success': False, 'error': error_msg}
            
            return {'success': True}
            
        except Exception as e:
            error_msg = str(e)
            log_message(f"拉取失败: {error_msg}", 'ERROR')
            return {'success': False, 'error': error_msg}
    
    def push(self, path: str, config: Optional[Dict] = None) -> Dict:
        """
        推送到远程仓库
        
        Args:
            path: 仓库路径
            config: Git配置
            
        Returns:
            {'success': bool, 'error': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            repo = Repo(path)
            
            # 检查是否有远程仓库
            if not repo.remotes:
                return {'success': False, 'error': '仓库没有配置远程地址'}
            
            origin = repo.remotes.origin
            
            # 如果提供了配置，设置Git用户信息
            if config:
                git_user_name = config.get('git_user_name')
                git_user_email = config.get('git_user_email')
                
                if git_user_name:
                    repo.config_writer().set_value('user', 'name', git_user_name).release()
                if git_user_email:
                    repo.config_writer().set_value('user', 'email', git_user_email).release()
            
            # 获取Git环境变量（用于SSH认证等）
            env = self._get_git_env(config)
            
            # 检查是否有未提交的更改（只有在工作树中才检查）
            try:
                # 检查是否是bare仓库（没有工作树）
                if repo.bare:
                    log_message("这是一个bare仓库，跳过工作树检查", 'INFO')
                else:
                    try:
                        if repo.is_dirty(untracked_files=True):
                            log_message("警告: 有未提交的更改，推送前建议先提交", 'WARNING')
                    except Exception as dirty_error:
                        # 某些情况下is_dirty可能失败（如bare仓库、权限问题等）
                        log_message(f"检查工作树状态时出错（已忽略）: {dirty_error}", 'WARNING')
            except Exception as e:
                log_message(f"检查仓库状态时出错（已忽略）: {e}", 'WARNING')
            
            # 检查是否有未推送的提交
            try:
                # 获取当前分支
                current_branch = repo.active_branch.name
                # 检查本地分支是否领先远程分支
                remote_ref = f'origin/{current_branch}'
                remote_refs = [ref.name for ref in repo.refs]
                if remote_ref in remote_refs:
                    try:
                        local_commit = repo.head.commit
                        remote_commit = repo.refs[remote_ref].commit
                        if local_commit == remote_commit:
                            log_message("本地和远程已同步，没有需要推送的提交", 'INFO')
                            return {'success': True, 'message': '本地和远程已同步，没有需要推送的提交'}
                    except Exception as ref_error:
                        log_message(f"比较提交时出错（继续推送）: {ref_error}", 'WARNING')
            except Exception as e:
                log_message(f"检查远程分支状态时出错（继续推送）: {e}", 'WARNING')
            
            # 推送 - GitPython的push方法不支持env参数，需要使用git命令
            try:
                current_branch = repo.active_branch.name
                
                if env:
                    # 使用git命令推送，以便传递环境变量
                    import subprocess
                    log_message(f"执行推送: git push origin {current_branch}", 'INFO')
                    result = _run_subprocess(
                        ['git', 'push', 'origin', current_branch],
                        cwd=path,
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=60
                    )
                    if result.returncode != 0:
                        error_msg = result.stderr or result.stdout or '推送失败'
                        log_message(f"推送失败 (退出码 {result.returncode}): {error_msg}", 'ERROR')
                        return {'success': False, 'error': error_msg}
                    output_msg = result.stdout or result.stderr or '推送成功'
                    log_message(f"推送成功: {output_msg}", 'INFO')
                else:
                    # 没有环境变量，使用GitPython的push方法
                    log_message(f"执行推送: git push origin {current_branch}", 'INFO')
                    origin.push()
                    log_message("推送成功", 'INFO')
            except Exception as push_error:
                error_msg = str(push_error)
                log_message(f"推送异常: {error_msg}", 'ERROR')
                return {'success': False, 'error': error_msg}
            
            return {'success': True}
            
        except Exception as e:
            error_msg = str(e)
            log_message(f"推送失败: {error_msg}", 'ERROR')
            return {'success': False, 'error': error_msg}
    
    def commit(self, path: str, message: str, files: Optional[List[str]] = None) -> Dict:
        """
        提交更改
        
        Args:
            path: 仓库路径
            message: 提交信息
            files: 要提交的文件列表（None表示提交所有更改）
            
        Returns:
            {'success': bool, 'error': str or None, 'commit_hash': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            repo = Repo(path)
            
            # 添加文件到暂存区
            if files:
                # 添加指定的文件
                for file in files:
                    # 确保路径是相对于仓库根目录的
                    if os.path.isabs(file):
                        # 如果是绝对路径，转换为相对路径
                        try:
                            file = os.path.relpath(file, path)
                        except:
                            pass
                    try:
                        repo.index.add([file])
                        log_message(f"已添加到暂存区: {file}", 'INFO')
                    except Exception as e:
                        log_message(f"添加文件到暂存区失败: {file}, 错误: {e}", 'WARNING')
            else:
                # 添加所有更改（包括修改、删除、新增）
                try:
                    # 先添加所有修改和新增的文件
                    repo.index.add(['*'])
                    # 也添加删除的文件（使用 git add -u）
                    repo.index.add(['-u'])
                    log_message("已添加所有更改到暂存区", 'INFO')
                except Exception as add_error:
                    log_message(f"添加所有更改时出错: {add_error}", 'WARNING')
                    # 尝试使用git命令添加文件（更可靠的方法）
                    try:
                        import subprocess
                        # 使用git add -A添加所有更改（包括修改、新增、删除）
                        result = _run_subprocess(
                            ['git', 'add', '-A'],
                            cwd=path,
                            capture_output=True,
                            text=True,
                            timeout=30
                        )
                        if result.returncode == 0:
                            log_message("使用git add -A添加所有更改成功", 'INFO')
                        else:
                            raise Exception(f"git add -A失败: {result.stderr or result.stdout}")
                    except Exception as manual_add_error:
                        log_message(f"git add -A失败: {manual_add_error}", 'ERROR')
                        return {'success': False, 'error': f'无法添加文件到暂存区: {manual_add_error}'}
            
            # 检查是否有已暂存的更改
            commit = None
            try:
                # 检查暂存区是否有更改
                if repo.is_dirty(index=True) or len(repo.index.diff('HEAD')) > 0:
                    # 提交
                    commit = repo.index.commit(message)
                    log_message(f"提交成功: {commit.hexsha[:8]}", 'INFO')
                else:
                    # 如果没有暂存的更改，尝试检查工作区的更改
                    if repo.is_dirty(untracked_files=True):
                        log_message("警告: 检测到更改但暂存区为空，尝试使用git add -A", 'WARNING')
                        # 使用git命令强制添加所有更改
                        import subprocess
                        result = _run_subprocess(
                            ['git', 'add', '-A'],
                            cwd=path,
                            capture_output=True,
                            text=True,
                            timeout=30
                        )
                        if result.returncode == 0:
                            commit = repo.index.commit(message)
                            log_message(f"提交成功（使用git add -A）: {commit.hexsha[:8]}", 'INFO')
                        else:
                            error_msg = result.stderr or result.stdout or '无法添加文件到暂存区'
                            log_message(f"git add -A失败: {error_msg}", 'ERROR')
                            return {'success': False, 'error': f'无法添加文件到暂存区: {error_msg}'}
                    else:
                        return {'success': False, 'error': '没有需要提交的更改'}
            except Exception as commit_error:
                log_message(f"提交失败: {commit_error}", 'ERROR')
                return {'success': False, 'error': str(commit_error)}
            
            return {
                'success': True,
                'commit_hash': commit.hexsha[:8]
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def get_commit_history(self, path: str, limit: int = 50) -> Dict:
        """
        获取Git仓库的提交历史
        
        Args:
            path: Git仓库路径
            limit: 返回的提交数量限制
            
        Returns:
            {
                'success': bool,
                'commits': List[Dict] or None,
                'error': str or None
            }
        """
        if not GIT_AVAILABLE:
            return {
                'success': False,
                'error': 'Git功能不可用，请安装GitPython'
            }
        
        try:
            if not os.path.exists(path):
                return {
                    'success': False,
                    'error': '路径不存在'
                }
            
            repo = Repo(path)
            commits = []
            
            # 获取提交历史
            for commit in repo.iter_commits(max_count=limit):
                commit_info = {
                    'hash': commit.hexsha[:8],  # 短哈希
                    'full_hash': commit.hexsha,  # 完整哈希
                    'author': commit.author.name,
                    'author_email': commit.author.email,
                    'message': commit.message.strip(),
                    'date': commit.committed_datetime.isoformat() if commit.committed_datetime else '',
                    'timestamp': int(commit.committed_datetime.timestamp()) if commit.committed_datetime else 0,
                    'stats': {
                        'files_changed': len(commit.stats.files) if commit.stats else 0,
                        'insertions': commit.stats.total['insertions'] if commit.stats else 0,
                        'deletions': commit.stats.total['deletions'] if commit.stats else 0,
                    }
                }
                commits.append(commit_info)
            
            return {
                'success': True,
                'commits': commits,
                'total': len(commits)
            }
            
        except InvalidGitRepositoryError:
            return {
                'success': False,
                'error': '指定的路径不是Git仓库'
            }
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def get_status(self, path: str) -> Dict:
        """
        获取仓库状态
        
        Args:
            path: 仓库路径
            
        Returns:
            详细的仓库状态信息
        """
        return self.check_repo(path)
    
    def create_tag(self, path: str, tag_name: str, message: Optional[str] = None) -> Dict:
        """
        创建标签
        
        Args:
            path: 仓库路径
            tag_name: 标签名称
            message: 标签信息（可选）
            
        Returns:
            {'success': bool, 'error': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            repo = Repo(path)
            
            if message:
                repo.create_tag(tag_name, message=message)
            else:
                repo.create_tag(tag_name)
            
            return {'success': True}
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def list_tags(self, path: str) -> Dict:
        """
        列出所有标签
        
        Args:
            path: 仓库路径
            
        Returns:
            {'success': bool, 'tags': List[str], 'error': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            repo = Repo(path)
            tags = [tag.name for tag in repo.tags]
            
            return {
                'success': True,
                'tags': tags
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def list_branches(self, path: str) -> Dict:
        """
        列出所有分支
        
        Args:
            path: 仓库路径
            
        Returns:
            {'success': bool, 'branches': List[str], 'current': str, 'error': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            repo = Repo(path)
            branches = [branch.name for branch in repo.branches]
            current = repo.active_branch.name if repo.active_branch else None
            
            return {
                'success': True,
                'branches': branches,
                'current': current
            }
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def checkout_branch(self, path: str, branch_name: str) -> Dict:
        """
        切换分支
        
        Args:
            path: 仓库路径
            branch_name: 分支名称
            
        Returns:
            {'success': bool, 'error': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        try:
            repo = Repo(path)
            repo.git.checkout(branch_name)
            
            return {'success': True}
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def list_remote_repos(self, config: Dict, base_path: str = '') -> Dict:
        """
        列出远程服务器上的仓库
        
        Args:
            config: Git配置
            base_path: 基础路径（如 'username/', 'group/'），空字符串表示根路径
            
        Returns:
            {'success': bool, 'repos': List[Dict], 'error': str or None, 'message': str or None}
        """
        if not GIT_AVAILABLE:
            return {'success': False, 'error': 'Git功能不可用，请安装GitPython'}
        
        repos = []
        
        try:
            server_url = config.get('server_url', '').strip()
            if not server_url:
                return {'success': False, 'error': '服务器地址未配置'}
            
            auth_type = config.get('auth_type', 'ssh')
            
            if auth_type == 'ssh':
                # SSH方式：尝试使用SSH命令列出仓库
                ssh_key_path = config.get('ssh_key_path', '')
                
                # 解析服务器地址
                if server_url.startswith('git@'):
                    if ':' in server_url:
                        hostname_part = server_url.split(':')[0]  # git@hostname
                        hostname = hostname_part.replace('git@', '')
                        server_base_path = server_url.split(':', 1)[1].rstrip('/')  # 基础路径
                    else:
                        return {'success': False, 'error': '无效的服务器地址格式'}
                else:
                    return {'success': False, 'error': 'SSH方式需要git@格式的地址'}
                
                # 如果指定了base_path，使用它；否则使用配置中的基础路径
                if base_path:
                    search_path = base_path.rstrip('/')
                else:
                    search_path = server_base_path
                
                import subprocess
                env = os.environ.copy()
                
                # 构建SSH命令基础部分
                # SSH命令需要完整的 git@hostname 格式
                ssh_user_host = f"git@{hostname}"
                ssh_base_cmd = ['ssh']
                if ssh_key_path and os.path.exists(ssh_key_path):
                    ssh_base_cmd.extend(['-i', ssh_key_path])
                    env['GIT_SSH_COMMAND'] = f'ssh -i "{ssh_key_path}" -o StrictHostKeyChecking=no'
                ssh_base_cmd.extend(['-o', 'StrictHostKeyChecking=no', ssh_user_host])
                
                # 方法1: 尝试Gitolite命令 (ssh git@hostname info)
                try:
                    cmd = ssh_base_cmd + ['info']
                    log_message(f"尝试Gitolite命令: {' '.join(cmd)}", 'DEBUG')
                    
                    result = _run_subprocess(
                        cmd,
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=10
                    )
                    
                    if result.returncode == 0:
                        # Gitolite格式输出，解析仓库列表
                        for line in result.stdout.split('\n'):
                            line = line.strip()
                            # 跳过标题行和权限行
                            if line and not line.startswith('hello') and not line.startswith('R W') and not line.startswith('===='):
                                # 解析仓库路径 (格式可能是: R W repo_name 或 repo_name)
                                parts = line.split()
                                repo_path = None
                                
                                # 查找以.git结尾的路径
                                for part in parts:
                                    if part.endswith('.git'):
                                        repo_path = part
                                        break
                                
                                # 如果没有找到，尝试最后一个部分
                                if not repo_path and parts:
                                    last_part = parts[-1]
                                    if '/' in last_part or last_part:
                                        repo_path = last_part
                                        if not repo_path.endswith('.git'):
                                            repo_path += '.git'
                                
                                if repo_path:
                                    # 过滤：如果指定了base_path，只包含匹配的仓库
                                    if not base_path or repo_path.startswith(base_path):
                                        repo_name = repo_path
                                        if repo_path.endswith('.git'):
                                            repo_name = repo_path[:-4]
                                        
                                        repos.append({
                                            'name': repo_name,
                                            'path': repo_path,
                                            'full_url': f"git@{hostname}:{repo_path}"
                                        })
                        
                        if repos:
                            log_message(f"通过Gitolite找到 {len(repos)} 个仓库", 'INFO')
                            return {'success': True, 'repos': repos}
                        else:
                            log_message("Gitolite命令成功但未找到仓库", 'INFO')
                except subprocess.TimeoutExpired:
                    log_message("Gitolite命令超时", 'WARNING')
                except Exception as e:
                    log_message(f"Gitolite方式失败: {e}", 'DEBUG')
                
                # 方法2: 尝试通过git ls-remote测试常见路径下的仓库
                # 由于Git本身不提供列表API，我们只能通过测试已知路径来发现仓库
                # 这里提供一个提示，让用户知道需要手动输入或使用其他方式
                
                return {
                    'success': True, 
                    'repos': repos,
                    'message': 'Git服务器可能不支持自动列出仓库。如果上面的列表为空，请使用"手动输入"标签页输入仓库名称或路径。'
                }
                
            else:
                # HTTPS方式：可能需要使用GitLab/GitHub API
                return {'success': False, 'error': 'HTTPS方式的仓库列表功能尚未实现，请使用SSH方式'}
                
        except Exception as e:
            error_msg = str(e)
            log_message(f"列出远程仓库失败: {error_msg}", 'ERROR')
            return {'success': False, 'error': error_msg}
    
    def test_config(self, config: Dict) -> Dict:
        """
        测试Git配置是否有效
        
        Args:
            config: Git配置字典
            
        Returns:
            {
                'success': bool,
                'message': str,
                'error': str or None
            }
        """
        if not GIT_AVAILABLE:
            return {
                'success': False,
                'error': 'Git功能不可用，请安装GitPython'
            }
        
        auth_type = config.get('auth_type', 'ssh')
        server_url = config.get('server_url', '').strip()
        
        if not server_url:
            return {
                'success': False,
                'error': '服务器地址不能为空'
            }
        
        # 检查URL格式与认证方式是否匹配
        is_http_url = server_url.startswith(('http://', 'https://'))
        is_ssh_url = server_url.startswith(('git@', 'ssh://'))
        
        if auth_type == 'ssh' and is_http_url:
            return {
                'success': False,
                'error': f'配置错误：您选择了SSH认证方式，但提供的URL是HTTP/HTTPS格式 ({server_url})\n\n'
                        f'SSH认证需要使用SSH格式的URL，例如：\n'
                        f'  - git@example.com:username/repo.git\n'
                        f'  - ssh://git@example.com/username/repo.git\n\n'
                        f'如果您需要使用HTTP/HTTPS URL，请将认证方式改为HTTPS'
            }
        
        if auth_type == 'https' and is_ssh_url:
            return {
                'success': False,
                'error': f'配置错误：您选择了HTTPS认证方式，但提供的URL是SSH格式 ({server_url})\n\n'
                        f'HTTPS认证需要使用HTTP/HTTPS格式的URL，例如：\n'
                        f'  - http://example.com/username/repo.git\n'
                        f'  - https://example.com/username/repo.git\n\n'
                        f'如果您需要使用SSH URL，请将认证方式改为SSH'
            }
        
        try:
            import subprocess
            
            # 测试SSH连接
            if auth_type == 'ssh':
                ssh_key_path = config.get('ssh_key_path', '')
                if not ssh_key_path:
                    return {
                        'success': False,
                        'error': 'SSH密钥路径不能为空'
                    }
                
                if not os.path.exists(ssh_key_path):
                    return {
                        'success': False,
                        'error': f'SSH密钥文件不存在: {ssh_key_path}'
                    }
                
                def parse_ssh_target(url: str):
                    if url.startswith('git@'):
                        parts = url.split(':', 1)
                        target = parts[0]
                        path = parts[1] if len(parts) == 2 else ''
                        return {
                            'target': target,
                            'path': path.strip('/'),
                            'port': None
                        }
                    if url.startswith('ssh://'):
                        try:
                            from urllib.parse import urlparse
                            parsed = urlparse(url)
                            if not parsed.hostname:
                                return None
                            user = parsed.username or 'git'
                            return {
                                'target': f'{user}@{parsed.hostname}',
                                'path': parsed.path.strip('/'),
                                'port': parsed.port
                            }
                        except Exception:
                            return None
                    return None

                target_info = parse_ssh_target(server_url)
                is_base_url = bool(target_info and not target_info.get('path', '').endswith('.git'))
                env = self._get_git_env(config)

                # 对基础URL，直接测试SSH主机认证，避免使用伪造仓库名导致误报失败
                if is_base_url and target_info:
                    ssh_cmd = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no']
                    if ssh_key_path and os.path.exists(ssh_key_path):
                        ssh_cmd.extend(['-i', ssh_key_path])
                    if target_info.get('port'):
                        ssh_cmd.extend(['-p', str(target_info['port'])])
                    ssh_cmd.extend(['-T', target_info['target']])

                    try:
                        result = _run_subprocess(
                            ssh_cmd,
                            capture_output=True,
                            text=True,
                            timeout=10
                        )
                        output = '\n'.join(filter(None, [result.stdout.strip(), result.stderr.strip()])).strip()
                        output_lower = output.lower()
                        success_markers = [
                            'successfully authenticated',
                            'welcome to',
                            'does not provide shell access',
                            'shell access is disabled',
                            'authenticated'
                        ]
                        failure_markers = [
                            'permission denied',
                            'publickey',
                            'could not resolve hostname',
                            'connection timed out',
                            'connection refused',
                            'host key verification failed',
                            'no route to host'
                        ]

                        if result.returncode == 0 or any(marker in output_lower for marker in success_markers):
                            message = 'SSH连接测试成功（基础地址认证成功）'
                            message += '\n\n当前配置的是基础URL，后续克隆时可以继续只输入仓库名或相对路径。'
                            return {
                                'success': True,
                                'message': message
                            }

                        if any(marker in output_lower for marker in failure_markers):
                            return {
                                'success': False,
                                'error': f'SSH连接失败: {output or "认证未通过"}'
                            }

                        return {
                            'success': False,
                            'error': f'SSH连接测试未通过: {output or "服务器没有返回可识别的认证结果"}'
                        }
                    except subprocess.TimeoutExpired:
                        return {
                            'success': False,
                            'error': 'SSH连接超时'
                        }
                    except Exception as e:
                        return {
                            'success': False,
                            'error': f'SSH连接测试失败: {str(e)}'
                        }

                # 对完整仓库URL，继续使用 git ls-remote 测试
                test_url = server_url
                try:
                    result = _run_subprocess(
                        ['git', 'ls-remote', '--heads', test_url],
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=10
                    )
                    
                    if result.returncode == 0:
                        return {
                            'success': True,
                            'message': 'SSH连接测试成功'
                        }
                    else:
                        error_msg = result.stderr.strip() or result.stdout.strip()
                        # 检查是否是重定向错误
                        if 'redirect' in error_msg.lower() or 'sign_in' in error_msg.lower() or 'users/sign_in' in error_msg:
                            return {
                                'success': False,
                                'error': f'SSH连接失败：URL格式不正确或需要认证\n\n'
                                        f'错误详情：{error_msg}\n\n'
                                        f'提示：\n'
                                        f'1. 如果您的服务器地址是 HTTP/HTTPS 格式，请将认证方式改为 HTTPS\n'
                                        f'2. 如果使用 SSH 认证，URL 格式应为：git@hostname:path/to/repo.git\n'
                                        f'3. 确保 SSH 密钥有访问权限'
                            }
                        return {
                            'success': False,
                            'error': f'SSH连接失败: {error_msg}'
                        }
                except subprocess.TimeoutExpired:
                    return {
                        'success': False,
                        'error': 'SSH连接超时'
                    }
                except Exception as e:
                    return {
                        'success': False,
                        'error': f'SSH连接测试失败: {str(e)}'
                    }
            
            # 测试HTTPS连接
            else:  # https
                username = config.get('username', '')
                password_encrypted = config.get('password_encrypted', '')
                
                if not username:
                    return {
                        'success': False,
                        'error': '用户名不能为空'
                    }
                
                if not password_encrypted:
                    return {
                        'success': False,
                        'error': '密码不能为空'
                    }
                
                # 解码密码
                try:
                    import base64
                    password = base64.b64decode(password_encrypted).decode('utf-8')
                except:
                    password = password_encrypted
                
                # 测试HTTPS连接（使用git ls-remote）
                try:
                    # 构建带认证的URL
                    if '://' in server_url:
                        protocol, rest = server_url.split('://', 1)
                        if '@' not in rest.split('/', 1)[0]:
                            test_url = f"{protocol}://{username}:{password}@{rest}"
                        else:
                            test_url = server_url
                    else:
                        test_url = server_url
                    
                    env = self._get_git_env(config)
                    # 使用git ls-remote测试连接
                    result = _run_subprocess(
                        ['git', 'ls-remote', '--heads', test_url],
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=10
                    )
                    
                    if result.returncode == 0:
                        return {
                            'success': True,
                            'message': 'HTTPS连接测试成功'
                        }
                    else:
                        error_msg = result.stderr.strip() or result.stdout.strip()
                        # 隐藏密码信息
                        error_msg = error_msg.replace(password, '***')
                        
                        # 检查是否是重定向到登录页面的错误
                        if 'redirect' in error_msg.lower() or 'sign_in' in error_msg.lower() or 'users/sign_in' in error_msg:
                            return {
                                'success': False,
                                'error': f'HTTPS连接失败：服务器重定向到登录页面\n\n'
                                        f'错误详情：{error_msg}\n\n'
                                        f'可能的原因：\n'
                                        f'1. 用户名或密码不正确\n'
                                        f'2. 需要使用访问令牌（Token）而不是密码\n'
                                        f'3. 服务器需要额外的认证步骤\n'
                                        f'4. URL格式不正确，可能需要包含完整的仓库路径'
                            }
                        
                        return {
                            'success': False,
                            'error': f'HTTPS连接失败: {error_msg}'
                        }
                except subprocess.TimeoutExpired:
                    return {
                        'success': False,
                        'error': 'HTTPS连接超时'
                    }
                except Exception as e:
                    return {
                        'success': False,
                        'error': f'HTTPS连接测试失败: {str(e)}'
                    }
        
        except Exception as e:
            return {
                'success': False,
                'error': f'配置测试失败: {str(e)}'
            }
