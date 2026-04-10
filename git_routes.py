# git_routes.py
"""
Git相关路由
仅在Git功能启用时注册
"""
import os
import sys
import platform
import subprocess
import threading
from typing import Optional, Dict
from flask import request, jsonify, current_app, session
from routes import is_logged_in
from git_manager import _git_base_cmd

# 全局字典存储克隆进度（线程安全）
# 使用字典存储进度信息，格式：{progress_id: {'status': ..., 'progress': ..., ...}}
_git_clone_progress: Dict[str, dict] = {}
_progress_lock = threading.Lock()

# 日志输出函数（统一输出到标准输出，GUI会捕获）
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


def register_git_routes(app):
    """注册Git相关路由（仅在Git功能启用时调用）"""
    
    def check_git_enabled():
        """检查Git功能是否启用"""
        if not app.config.get('GIT_ENABLED', False):
            return False
        if 'GIT_MANAGER' not in app.config:
            return False
        return True
    
    def get_git_manager():
        """获取Git管理器"""
        return app.config.get('GIT_MANAGER')
    
    def get_git_config_manager():
        """获取Git配置管理器"""
        return app.config.get('GIT_CONFIG_MANAGER')
    
    def validate_path(path_str: str) -> Optional[str]:
        """验证路径是否在允许的根目录内"""
        root_dir = current_app.config.get('ROOT_DIR')
        if not root_dir:
            return None
        
        try:
            if path_str:
                full_path = os.path.join(root_dir, path_str)
            else:
                full_path = root_dir
            
            full_path = os.path.normpath(full_path)
            root_dir_norm = os.path.normpath(root_dir)
            
            if not full_path.startswith(root_dir_norm):
                return None
            
            return full_path
        except:
            return None
    
    @app.route('/api/git/check', methods=['GET'])
    def git_check():
        """检查路径是否为Git仓库"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用', 'git_enabled': False}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        path = request.args.get('path', '')
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        try:
            manager = get_git_manager()
            result = manager.check_repo(full_path)
            result['git_enabled'] = True
            return jsonify({'success': True, **result})
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/init', methods=['POST'])
    def git_init():
        """初始化Git仓库"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        path = data.get('path', '')
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        try:
            manager = get_git_manager()
            result = manager.init_repo(full_path)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/clone', methods=['POST'])
    def git_clone():
        """克隆远程仓库"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        path = data.get('path', '')
        remote_url = data.get('remote_url', '')
        config_id = data.get('config_id')
        
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        if not remote_url:
            return jsonify({'success': False, 'error': '远程URL不能为空'}), 400
        
        # 获取配置
        config = None
        if config_id:
            config_manager = get_git_config_manager()
            config = config_manager.get_config(config_id)
        
        try:
            manager = get_git_manager()
            result = manager.clone_repo(remote_url, full_path, config)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/pull', methods=['POST'])
    def git_pull():
        """从远程拉取更新"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        path = data.get('path', '')
        config_id = data.get('config_id')
        
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        # 获取配置（如果没有指定config_id，使用默认配置）
        config = None
        config_manager = get_git_config_manager()
        if config_id:
            config = config_manager.get_config(config_id)
        else:
            # 使用默认配置
            config = config_manager.get_default_config()
        
        try:
            manager = get_git_manager()
            result = manager.pull(full_path, config)
            return jsonify(result)
        except Exception as e:
            import traceback
            log_message(f"拉取操作失败: {str(e)}\n{traceback.format_exc()}", 'ERROR')
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/execute', methods=['POST'])
    def git_execute():
        """执行Git命令（调试工具）"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        path = data.get('path', '')
        command = data.get('command', '').strip()
        
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        if not command:
            return jsonify({'success': False, 'error': '命令不能为空'}), 400
        
        # 安全检查：禁止执行危险命令
        dangerous_commands = ['reset --hard', 'clean -fd', 'push --force', 'push -f', 'branch -D', 'checkout -f']
        command_lower = command.lower()
        for dangerous in dangerous_commands:
            if dangerous.lower() in command_lower:
                return jsonify({'success': False, 'error': f'禁止执行危险命令: {dangerous}'}), 400
        
        try:
            import subprocess
            manager = get_git_manager()
            
            # 获取Git环境变量
            config_manager = get_git_config_manager()
            default_config = config_manager.get_default_config()
            env = manager._get_git_env(default_config) if hasattr(manager, '_get_git_env') else None
            
            git_cmd = _git_base_cmd() + command.split()
            result = _run_subprocess(
                git_cmd,
                cwd=full_path,
                capture_output=True,
                text=True,
                timeout=30,
                env=env
            )
            
            output = result.stdout
            error = result.stderr
            
            # 如果命令失败，返回错误信息
            if result.returncode != 0:
                return jsonify({
                    'success': False,
                    'error': error or f'命令执行失败 (退出码: {result.returncode})',
                    'output': output
                }), 400
            
            return jsonify({
                'success': True,
                'output': output,
                'error': error if error else None
            })
            
        except subprocess.TimeoutExpired:
            return jsonify({'success': False, 'error': '命令执行超时'}), 400
        except Exception as e:
            import traceback
            log_message(f"执行Git命令失败: {str(e)}\n{traceback.format_exc()}", 'ERROR')
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/push', methods=['POST'])
    def git_push():
        """推送到远程仓库"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        path = data.get('path', '')
        config_id = data.get('config_id')
        
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        # 获取配置（如果没有指定config_id，使用默认配置）
        config = None
        config_manager = get_git_config_manager()
        if config_id:
            config = config_manager.get_config(config_id)
        else:
            # 使用默认配置
            config = config_manager.get_default_config()
        
        try:
            manager = get_git_manager()
            result = manager.push(full_path, config)
            return jsonify(result)
        except Exception as e:
            import traceback
            log_message(f"推送操作失败: {str(e)}\n{traceback.format_exc()}", 'ERROR')
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/commit', methods=['POST'])
    def git_commit():
        """提交更改"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        path = data.get('path', '')
        message = data.get('message', '')
        files = data.get('files', None)
        
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        if not message:
            return jsonify({'success': False, 'error': '提交信息不能为空'}), 400
        
        try:
            manager = get_git_manager()
            result = manager.commit(full_path, message, files)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/status', methods=['GET'])
    def git_status():
        """获取仓库状态"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        path = request.args.get('path', '').strip()
        
        # 如果路径中包含URL编码的反斜杠或其他特殊字符，先解码
        import urllib.parse
        try:
            path = urllib.parse.unquote(path)
        except:
            pass
        
        log_message(f"获取仓库状态: path={path}")
        
        # 先尝试使用validate_path（适用于ROOT_DIR内的路径）
        full_path = validate_path(path)
        
        # 如果validate_path失败，尝试使用Git工作目录
        if not full_path:
            git_workdir = current_app.config.get('GIT_WORKDIR', '')
            if git_workdir and os.path.exists(git_workdir):
                if os.path.isabs(path):
                    full_path = os.path.normpath(path)
                else:
                    full_path = os.path.normpath(os.path.join(git_workdir, path))
                
                # 验证路径在Git工作目录内
                git_workdir_norm = os.path.normpath(git_workdir)
                if not full_path.startswith(git_workdir_norm):
                    full_path = None
        
        if not full_path:
            log_message(f"错误: 无效的路径: {path}", 'ERROR')
            return jsonify({'success': False, 'error': f'无效的路径: {path}'}), 400
        
        log_message(f"解析后的路径: {full_path}")
        
        try:
            manager = get_git_manager()
            result = manager.get_status(full_path)
            log_message(f"仓库状态检查完成: is_repo={result.get('is_repo', False)}")
            return jsonify({'success': True, 'status': result})
        except Exception as e:
            log_message(f"获取仓库状态时出错: {str(e)}", 'ERROR')
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/history', methods=['GET'])
    def git_history():
        """获取提交历史"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        path = request.args.get('path', '')
        limit = request.args.get('limit', '50')
        
        try:
            limit = int(limit)
            if limit < 1 or limit > 500:
                limit = 50
        except ValueError:
            limit = 50
        
        # 验证路径（支持Git工作目录）
        git_workdir = current_app.config.get('GIT_WORKDIR', '')
        if git_workdir:
            if os.path.isabs(path):
                full_path = os.path.normpath(path)
            else:
                full_path = os.path.normpath(os.path.join(git_workdir, path))
            
            # 验证路径在Git工作目录内
            git_workdir_norm = os.path.normpath(git_workdir)
            if not full_path.startswith(git_workdir_norm):
                # 尝试使用ROOT_DIR验证
                root_dir = current_app.config.get('ROOT_DIR', '')
                if root_dir:
                    full_path = validate_path(path)
        else:
            full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        try:
            manager = get_git_manager()
            result = manager.get_commit_history(full_path, limit)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/tag/create', methods=['POST'])
    def git_tag_create():
        """创建标签"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        path = data.get('path', '')
        tag_name = data.get('tag_name', '')
        message = data.get('message', None)
        
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        if not tag_name:
            return jsonify({'success': False, 'error': '标签名称不能为空'}), 400
        
        try:
            manager = get_git_manager()
            result = manager.create_tag(full_path, tag_name, message)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/tag/list', methods=['GET'])
    def git_tag_list():
        """列出所有标签"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        path = request.args.get('path', '')
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        try:
            manager = get_git_manager()
            result = manager.list_tags(full_path)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/branch/list', methods=['GET'])
    def git_branch_list():
        """列出所有分支"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        path = request.args.get('path', '')
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        try:
            manager = get_git_manager()
            result = manager.list_branches(full_path)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/branch/checkout', methods=['POST'])
    def git_branch_checkout():
        """切换分支"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        path = data.get('path', '')
        branch_name = data.get('branch_name', '')
        
        full_path = validate_path(path)
        
        if not full_path:
            return jsonify({'success': False, 'error': '无效的路径'}), 400
        
        if not branch_name:
            return jsonify({'success': False, 'error': '分支名称不能为空'}), 400
        
        try:
            manager = get_git_manager()
            result = manager.checkout_branch(full_path, branch_name)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/config/list', methods=['GET'])
    def git_config_list():
        """获取所有Git配置"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        try:
            config_manager = get_git_config_manager()
            configs = config_manager.get_all_configs()
            default_config = config_manager.get_default_config()
            return jsonify({
                'success': True,
                'configs': configs,
                'default_config_id': config_manager.configs.get('default_config_id')
            })
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/config/save', methods=['POST'])
    def git_config_save():
        """保存Git配置"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        config = data.get('config', {})
        config_id = data.get('config_id')
        
        try:
            config_manager = get_git_config_manager()
            
            if config_id:
                # 更新配置
                success = config_manager.update_config(config_id, config)
            else:
                # 添加新配置
                config_id = config_manager.add_config(config)
                success = True
            
            if success:
                return jsonify({'success': True, 'config_id': config_id})
            else:
                return jsonify({'success': False, 'error': '保存配置失败'}), 500
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/git/ssh-key/generate', methods=['POST'])
    def git_generate_ssh_key():
        """生成程序托管的SSH密钥"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403

        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401

        data = request.json or {}
        key_name = data.get('key_name', '')
        comment = data.get('comment', '')

        try:
            config_manager = get_git_config_manager()
            result = config_manager.generate_ssh_key_pair(
                key_name=key_name,
                comment=comment
            )
            status_code = 200 if result.get('success') else 500
            return jsonify(result), status_code
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/config/delete', methods=['POST'])
    def git_config_delete():
        """删除Git配置"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        config_id = data.get('config_id')
        
        if not config_id:
            return jsonify({'success': False, 'error': '配置ID不能为空'}), 400
        
        try:
            config_manager = get_git_config_manager()
            success = config_manager.delete_config(config_id)
            
            if success:
                return jsonify({'success': True})
            else:
                return jsonify({'success': False, 'error': '删除配置失败'}), 500
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/git/repos/delete', methods=['POST'])
    def git_repos_delete():
        """删除Git仓库（删除本地目录）"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        try:
            data = request.json or {}
            repo_path = data.get('repo_path', '').strip()
            
            if not repo_path:
                return jsonify({'success': False, 'error': '仓库路径不能为空'}), 400
            
            # 验证路径在Git工作目录内
            git_workdir = current_app.config.get('GIT_WORKDIR', '')
            if not git_workdir:
                return jsonify({'success': False, 'error': 'Git工作目录未设置'}), 400
            
            # 标准化路径
            repo_path_norm = os.path.normpath(repo_path)
            git_workdir_norm = os.path.normpath(git_workdir)
            
            # 验证路径在Git工作目录内（防止路径遍历攻击）
            if not repo_path_norm.startswith(git_workdir_norm):
                log_message(f"拒绝删除：路径不在Git工作目录内: {repo_path_norm}", 'WARNING')
                return jsonify({'success': False, 'error': '仓库路径不在Git工作目录内'}), 403
            
            # 验证路径存在
            if not os.path.exists(repo_path_norm):
                return jsonify({'success': False, 'error': '仓库路径不存在'}), 404
            
            # 验证是目录
            if not os.path.isdir(repo_path_norm):
                return jsonify({'success': False, 'error': '路径不是目录'}), 400
            
            # 执行删除（使用改进的删除函数处理Windows文件锁定问题）
            try:
                log_message(f"删除Git仓库: {repo_path_norm}", 'INFO')
                _force_remove_directory(repo_path_norm)
                log_message(f"成功删除Git仓库: {repo_path_norm}", 'INFO')
                return jsonify({'success': True, 'message': '仓库已删除'})
            except Exception as e:
                error_msg = str(e)
                log_message(f"删除Git仓库失败: {repo_path_norm}, 错误: {error_msg}", 'ERROR')
                return jsonify({'success': False, 'error': f'删除失败: {error_msg}\n\n提示：如果文件被锁定，请关闭所有可能使用该仓库的程序（如Git客户端、文件管理器等），然后重试。'}), 500
                
        except Exception as e:
            import traceback
            log_message(f"删除仓库时发生异常: {str(e)}\n{traceback.format_exc()}", 'ERROR')
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/repos/open_explorer', methods=['POST'])
    def git_repos_open_explorer():
        """在文件浏览器中打开仓库目录（仅支持本机访问）"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        # 检查是否为本机访问（仅允许localhost）
        remote_addr = request.remote_addr
        import socket
        is_localhost = False
        
        # 检查是否是localhost的标准地址
        if remote_addr in ('127.0.0.1', 'localhost', '::1'):
            is_localhost = True
        else:
            # 尝试检查是否是本机IP
            try:
                hostname = socket.gethostname()
                local_ips = [socket.gethostbyname(hostname)]
                # 获取所有本机IP地址
                import socket
                local_ips = []
                for info in socket.getaddrinfo(hostname, None):
                    local_ips.append(info[4][0])
                # 添加localhost标准地址
                local_ips.extend(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])
                
                if remote_addr in local_ips:
                    is_localhost = True
            except:
                pass
        
        if not is_localhost:
            log_message(f"拒绝非本机访问打开文件浏览器: {remote_addr}", 'WARNING')
            return jsonify({'success': False, 'error': '此功能仅支持本机访问（localhost）'}), 403
        
        try:
            data = request.json or {}
            repo_path = data.get('repo_path', '').strip()
            
            if not repo_path:
                return jsonify({'success': False, 'error': '仓库路径不能为空'}), 400
            
            # 验证路径在Git工作目录内
            git_workdir = current_app.config.get('GIT_WORKDIR', '')
            if not git_workdir:
                return jsonify({'success': False, 'error': 'Git工作目录未设置'}), 400
            
            # 标准化路径
            repo_path_norm = os.path.normpath(repo_path)
            git_workdir_norm = os.path.normpath(git_workdir)
            
            # 验证路径在Git工作目录内（防止路径遍历攻击）
            if not repo_path_norm.startswith(git_workdir_norm):
                log_message(f"拒绝打开：路径不在Git工作目录内: {repo_path_norm}", 'WARNING')
                return jsonify({'success': False, 'error': '仓库路径不在Git工作目录内'}), 403
            
            # 验证路径存在
            if not os.path.exists(repo_path_norm):
                return jsonify({'success': False, 'error': '仓库路径不存在'}), 404
            
            # 验证是目录
            if not os.path.isdir(repo_path_norm):
                return jsonify({'success': False, 'error': '路径不是目录'}), 400
            
            # 使用系统默认方式打开文件浏览器
            try:
                import platform
                import subprocess
                
                system = platform.system()
                if system == 'Windows':
                    os.startfile(repo_path_norm)
                elif system == 'Darwin':  # macOS
                    _run_subprocess(['open', repo_path_norm])
                else:  # Linux
                    _run_subprocess(['xdg-open', repo_path_norm])
                
                log_message(f"已在文件浏览器中打开: {repo_path_norm}", 'INFO')
                return jsonify({'success': True, 'message': '已在文件浏览器中打开'})
            except Exception as e:
                error_msg = str(e)
                log_message(f"打开文件浏览器失败: {repo_path_norm}, 错误: {error_msg}", 'ERROR')
                return jsonify({'success': False, 'error': f'打开文件浏览器失败: {error_msg}'}), 500
                
        except Exception as e:
            error_msg = str(e)
            log_message(f"打开文件浏览器时出错: {error_msg}", 'ERROR')
            return jsonify({'success': False, 'error': f'操作失败: {error_msg}'}), 500
    
    @app.route('/api/git/repos/open_with_app', methods=['POST'])
    def git_repos_open_with_app():
        """用指定软件打开仓库目录（仅支持本机访问）"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        # 检查是否为本机访问（仅允许localhost）
        remote_addr = request.remote_addr
        import socket
        is_localhost = False
        
        # 检查是否是localhost的标准地址
        if remote_addr in ('127.0.0.1', 'localhost', '::1'):
            is_localhost = True
        else:
            # 尝试检查是否是本机IP
            try:
                hostname = socket.gethostname()
                # 获取所有本机IP地址
                local_ips = []
                for info in socket.getaddrinfo(hostname, None):
                    local_ips.append(info[4][0])
                # 添加localhost标准地址
                local_ips.extend(['127.0.0.1', 'localhost', '::1', '0.0.0.0'])
                
                if remote_addr in local_ips:
                    is_localhost = True
            except:
                pass
        
        if not is_localhost:
            log_message(f"拒绝非本机访问用软件打开: {remote_addr}", 'WARNING')
            return jsonify({'success': False, 'error': '此功能仅支持本机访问（localhost）'}), 403
        
        try:
            data = request.json or {}
            repo_path = data.get('repo_path', '').strip()
            app_path = data.get('app_path', '').strip()  # 软件路径（可选，如果为空则使用配置中的默认值）
            
            if not repo_path:
                return jsonify({'success': False, 'error': '仓库路径不能为空'}), 400
            
            # 验证路径在Git工作目录内
            git_workdir = current_app.config.get('GIT_WORKDIR', '')
            if not git_workdir:
                return jsonify({'success': False, 'error': 'Git工作目录未设置'}), 400
            
            # 标准化路径
            repo_path_norm = os.path.normpath(repo_path)
            git_workdir_norm = os.path.normpath(git_workdir)
            
            # 验证路径在Git工作目录内（防止路径遍历攻击）
            if not repo_path_norm.startswith(git_workdir_norm):
                log_message(f"拒绝打开：路径不在Git工作目录内: {repo_path_norm}", 'WARNING')
                return jsonify({'success': False, 'error': '仓库路径不在Git工作目录内'}), 403
            
            # 验证路径存在
            if not os.path.exists(repo_path_norm):
                return jsonify({'success': False, 'error': '仓库路径不存在'}), 404
            
            # 验证是目录
            if not os.path.isdir(repo_path_norm):
                return jsonify({'success': False, 'error': '路径不是目录'}), 400
            
            # 如果没有提供软件路径，尝试从配置中获取
            if not app_path:
                app_path = current_app.config.get('GIT_EXTERNAL_APP_PATH', '')
                # 如果配置中没有，尝试从配置文件直接读取（用于运行时配置更新）
                if not app_path:
                    try:
                        import configparser
                        config_file = current_app.config.get('CONFIG_FILE', '')
                        if config_file and os.path.exists(config_file):
                            config = configparser.ConfigParser()
                            config.read(config_file, encoding='utf-8')
                            if 'settings' in config:
                                app_path = config['settings'].get('git_external_app_path', '')
                                # 更新app.config以便后续使用
                                if app_path:
                                    current_app.config['GIT_EXTERNAL_APP_PATH'] = app_path
                    except Exception as e:
                        log_message(f"从配置文件读取外部软件路径失败: {e}", 'WARNING')
            
            if not app_path:
                log_message(f"外部软件路径未配置，当前app.config['GIT_EXTERNAL_APP_PATH']: {current_app.config.get('GIT_EXTERNAL_APP_PATH', 'None')}", 'WARNING')
                return jsonify({'success': False, 'error': '未配置外部软件路径，请在设置中配置（如VSCode路径）\n\n提示：配置后需要重启服务器才能生效。'}), 400
            
            # 验证软件路径存在
            if not os.path.exists(app_path):
                return jsonify({'success': False, 'error': f'软件路径不存在: {app_path}'}), 404
            
            # 根据软件类型调用相应命令
            try:
                import platform
                import subprocess
                
                system = platform.system()
                app_name = os.path.basename(app_path).lower()
                
                # 检测常见的IDE/编辑器
                if 'code' in app_name or 'vscode' in app_name:
                    # VSCode: code <path>
                    subprocess.Popen([app_path, repo_path_norm])
                elif 'idea' in app_name or 'intellij' in app_name:
                    # IntelliJ IDEA: idea <path>
                    subprocess.Popen([app_path, repo_path_norm])
                elif 'sublime' in app_name:
                    # Sublime Text: sublime_text <path>
                    subprocess.Popen([app_path, repo_path_norm])
                elif 'atom' in app_name:
                    # Atom: atom <path>
                    subprocess.Popen([app_path, repo_path_norm])
                else:
                    # 通用方式：直接启动软件，将路径作为参数
                    if system == 'Windows':
                        subprocess.Popen([app_path, repo_path_norm])
                    elif system == 'Darwin':  # macOS
                        subprocess.Popen(['open', '-a', app_path, repo_path_norm])
                    else:  # Linux
                        subprocess.Popen([app_path, repo_path_norm])
                
                log_message(f"已用软件打开: {app_path} -> {repo_path_norm}", 'INFO')
                return jsonify({'success': True, 'message': f'已用 {os.path.basename(app_path)} 打开'})
            except Exception as e:
                error_msg = str(e)
                log_message(f"用软件打开失败: {app_path} -> {repo_path_norm}, 错误: {error_msg}", 'ERROR')
                return jsonify({'success': False, 'error': f'打开失败: {error_msg}'}), 500
                
        except Exception as e:
            error_msg = str(e)
            log_message(f"用软件打开时出错: {error_msg}", 'ERROR')
            return jsonify({'success': False, 'error': f'操作失败: {error_msg}'}), 500
                
        except Exception as e:
            import traceback
            log_message(f"删除仓库时发生异常: {str(e)}\n{traceback.format_exc()}", 'ERROR')
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/repos/list', methods=['GET'])
    def git_repos_list():
        """获取Git工作目录下的所有Git仓库列表"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用', 'git_enabled': False}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        try:
            git_workdir = current_app.config.get('GIT_WORKDIR', '')
            if not git_workdir or not os.path.exists(git_workdir):
                return jsonify({
                    'success': False,
                    'error': 'Git工作目录未设置或不存在',
                    'workdir': git_workdir,
                    'git_enabled': True
                }), 400
            
            manager = get_git_manager()
            config_manager = get_git_config_manager()
            
            # 获取默认Git配置，用于生成远程地址
            default_config = config_manager.get_default_config()
            base_server_url = default_config.get('server_url', '').strip() if default_config else ''
            
            repos = []
            
            # 扫描工作目录下的所有Git仓库
            git_workdir_norm = os.path.normpath(git_workdir)
            log_message(f"开始扫描Git工作目录: {git_workdir_norm}")
            
            for root, dirs, files in os.walk(git_workdir_norm):
                # 检查是否是Git仓库（包含.git目录）
                if '.git' in dirs:
                    repo_path = os.path.normpath(root)
                    repo_name = os.path.basename(repo_path) if os.path.basename(repo_path) else repo_path
                    
                    log_message(f"找到可能的Git仓库: {repo_path}")
                    
                    # 先检查.git目录是否真的存在且有效
                    git_dir = os.path.join(repo_path, '.git')
                    if not os.path.exists(git_dir):
                        log_message(f"警告: .git目录不存在: {git_dir}", 'WARNING')
                        continue
                    
                    # 检查是否是有效的Git仓库目录（.git可以是文件或目录）
                    if os.path.isfile(git_dir):
                        # 处理.git文件（子模块等情况）
                        try:
                            with open(git_dir, 'r') as f:
                                git_file_content = f.read().strip()
                                if git_file_content.startswith('gitdir:'):
                                    actual_git_dir = git_file_content[7:].strip()
                                    if not os.path.isabs(actual_git_dir):
                                        actual_git_dir = os.path.join(repo_path, actual_git_dir)
                                    if not os.path.exists(actual_git_dir):
                                        log_message(f"警告: .git文件指向的目录不存在: {actual_git_dir}", 'WARNING')
                                        continue
                        except Exception as e:
                            log_message(f"读取.git文件失败: {e}", 'WARNING')
                            continue
                    elif not os.path.isdir(git_dir):
                        log_message(f"警告: .git既不是文件也不是目录: {git_dir}", 'WARNING')
                        continue
                    
                    # 检查仓库状态
                    try:
                        log_message(f"检查仓库状态: {repo_path}")
                        status = manager.check_repo(repo_path)
                        
                        # 检查check_repo返回的结果
                        if not status.get('is_repo', False):
                            error_msg = status.get('error', '未知错误')
                            log_message(f"仓库检查失败，不是有效的Git仓库: {repo_path}, 错误: {error_msg}", 'WARNING')
                            # 即使检查失败，只要.git目录存在，仍然添加到列表
                            repos.append({
                                'name': repo_name,
                                'path': repo_path,
                                'is_repo': False,  # 标记为不是有效仓库
                                'has_changes': False,
                                'branch': 'unknown',
                                'remote': None,
                                'remote_detected': False,
                                'error': error_msg or '仓库检查失败'
                            })
                        else:
                            remote_url = status.get('remote_url', None)
                            
                            # 如果没有远程地址，尝试使用默认配置生成
                            if not remote_url and base_server_url:
                                # 检查是否是基础URL（末尾带斜杠或不是完整仓库路径）
                                is_base_url = base_server_url.endswith('/') or not base_server_url.endswith('.git')
                                
                                if is_base_url:
                                    # 使用基础URL + 仓库名生成远程地址
                                    base_url = base_server_url.rstrip('/')
                                    repo_name_for_url = repo_name
                                    if not repo_name_for_url.endswith('.git'):
                                        repo_name_for_url += '.git'
                                    
                                    if base_url.startswith('git@'):
                                        # git@hostname:path 格式
                                        if ':' in base_url:
                                            parts = base_url.split(':', 1)
                                            if len(parts) == 2:
                                                hostname = parts[0]
                                                path = parts[1]
                                                if path:
                                                    remote_url = f"{hostname}:{path}/{repo_name_for_url}"
                                                else:
                                                    remote_url = f"{hostname}:{repo_name_for_url}"
                                        else:
                                            remote_url = f"{base_url}/{repo_name_for_url}"
                                    elif base_url.startswith('ssh://'):
                                        # ssh://git@hostname/path 格式
                                        remote_url = f"{base_url}/{repo_name_for_url}" if base_url.endswith('/') else f"{base_url}/{repo_name_for_url}"
                                    elif base_url.startswith(('http://', 'https://')):
                                        # HTTP/HTTPS 格式
                                        remote_url = f"{base_url}/{repo_name_for_url}" if base_url.endswith('/') else f"{base_url}/{repo_name_for_url}"
                            
                            log_message(f"成功识别仓库: {repo_name}, 分支: {status.get('branch')}, 远程: {remote_url}")
                            repos.append({
                                'name': repo_name,
                                'path': repo_path,
                                'is_repo': True,
                                'has_changes': status.get('has_changes', False),
                                'branch': status.get('branch', 'unknown'),
                                'remote': remote_url,  # 使用检测到的或生成的远程地址
                                'remote_detected': status.get('remote_url') is not None  # 标记是否是从仓库检测到的
                            })
                    except Exception as e:
                        # 如果检查失败，仍然添加到列表，但标记为有问题
                        error_msg = str(e)
                        log_message(f"检查仓库时发生异常: {repo_path}, 错误: {error_msg}", 'ERROR')
                        import traceback
                        try:
                            traceback.print_exc(file=sys.stdout)
                        except:
                            pass
                        repos.append({
                            'name': repo_name,
                            'path': repo_path,
                            'is_repo': False,  # 标记为不是有效仓库
                            'has_changes': False,
                            'branch': 'unknown',
                            'remote': None,
                            'remote_detected': False,
                            'error': error_msg
                        })
                    
                    # 跳过.git目录的子目录（避免重复扫描）
                    dirs.remove('.git')
                    dirs[:] = []  # 不继续扫描子目录
            
            log_message(f"扫描完成，找到 {len(repos)} 个仓库")
            
            return jsonify({
                'success': True,
                'repos': repos,
                'workdir': git_workdir,
                'git_enabled': True,
                'has_default_config': default_config is not None,
                'base_server_url': base_server_url
            })
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/clone_from_remote', methods=['POST'])
    def git_clone_from_remote():
        """从远程服务器克隆仓库"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        try:
            data = request.json or {}
            repo_input = data.get('repo_name', '').strip()
            
            if not repo_input:
                return jsonify({'success': False, 'error': '仓库路径不能为空'}), 400
            
            # 检测是否是完整URL（以 http://, https://, git@, ssh:// 开头）
            is_full_url = repo_input.startswith(('http://', 'https://', 'git@', 'ssh://'))
            
            # 如果输入的是完整URL，直接使用；否则需要配置
            config_manager = get_git_config_manager()
            default_config = config_manager.get_default_config()
            
            if not is_full_url:
                # 相对路径需要默认配置
                if not default_config:
                    return jsonify({'success': False, 'error': '未配置Git服务器，请先在设置中配置Git服务器，或输入完整的Git仓库URL'}), 400
            else:
                # 完整URL可以使用默认配置的SSH密钥（如果有）
                # 如果用户提供了完整URL但想使用默认配置的密钥，可以使用默认配置
                pass
            
            # 获取Git工作目录
            git_workdir = current_app.config.get('GIT_WORKDIR', '')
            if not git_workdir or not os.path.exists(git_workdir):
                return jsonify({'success': False, 'error': 'Git工作目录未设置或不存在'}), 400
            
            # 构建目标路径
            # 从输入的仓库路径中提取目录名
            repo_name_for_path = repo_input
            
            if is_full_url:
                # 完整URL格式：git@hostname:group/repo.git 或 http://hostname/group/repo.git
                if repo_input.startswith('git@') and ':' in repo_input:
                    # git@hostname:path/repo.git -> repo
                    path_part = repo_input.split(':', 1)[1]
                    repo_name_for_path = path_part.split('/')[-1]
                elif repo_input.startswith(('http://', 'https://')):
                    # http://hostname/group/repo.git -> repo
                    path_part = repo_input.split('://', 1)[1].split('/', 1)[1] if '/' in repo_input.split('://', 1)[1] else ''
                    repo_name_for_path = path_part.split('/')[-1] if path_part else repo_input
                elif repo_input.startswith('ssh://'):
                    # ssh://git@hostname/path/repo.git -> repo
                    path_part = repo_input.split('://', 1)[1].split('/', 1)[1] if '/' in repo_input.split('://', 1)[1] else ''
                    repo_name_for_path = path_part.split('/')[-1] if path_part else repo_input
            else:
                # 相对路径：group/repo-name -> repo-name
                repo_name_for_path = repo_input.replace('\\', '/').split('/')[-1]
            
            # 移除.git后缀和清理
            if repo_name_for_path.endswith('.git'):
                repo_name_for_path = repo_name_for_path[:-4]
            
            # 如果目录名仍然包含特殊字符，进行清理
            repo_name_for_path = repo_name_for_path.strip('/').strip('\\')
            if not repo_name_for_path:
                repo_name_for_path = 'repo'
            
            target_path = os.path.normpath(os.path.join(git_workdir, repo_name_for_path))
            
            log_message(f"克隆目标路径: {target_path} (输入: {repo_input}, 完整URL: {is_full_url})", 'INFO')
            
            # 检查目标目录是否已存在
            if os.path.exists(target_path):
                try:
                    dir_contents = os.listdir(target_path)
                    if dir_contents:
                        # 目录不为空，检查是否是有效的Git仓库
                        git_dir = os.path.join(target_path, '.git')
                        is_git_repo = os.path.exists(git_dir)
                        
                        if is_git_repo:
                            # 尝试验证是否是有效的Git仓库
                            try:
                                from git import Repo
                                test_repo = Repo(target_path)
                                # 如果成功打开，说明是有效的Git仓库
                                return jsonify({
                                    'success': False, 
                                    'error': f'目录 {repo_name_for_path} 已经是一个有效的Git仓库。如果确实需要重新克隆，请先删除或重命名该目录。'
                                }), 400
                            except Exception:
                                # GitPython无法打开，可能是不完整的仓库
                                log_message(f"检测到不完整的Git仓库，尝试清理: {target_path}", 'WARNING')
                                from git_manager import _force_remove_directory
                                if not _force_remove_directory(target_path):
                                    log_message(f"清理目录失败: {target_path}", 'ERROR')
                                    return jsonify({
                                        'success': False, 
                                        'error': f'目录 {repo_name_for_path} 存在但不完整。自动清理失败，请手动删除该目录后重试。如果文件被锁定，请关闭所有可能使用该目录的程序。'
                                    }), 400
                                log_message(f"已清理不完整目录: {target_path}", 'INFO')
                                # 清理成功，继续执行
                        else:
                            # 不是Git仓库，但有其他文件，尝试清理（可能是不完整的克隆）
                            log_message(f"检测到非空目录（非Git仓库），尝试清理: {target_path}", 'WARNING')
                            from git_manager import _force_remove_directory
                            if not _force_remove_directory(target_path):
                                log_message(f"清理目录失败: {target_path}", 'ERROR')
                                return jsonify({
                                    'success': False, 
                                    'error': f'目录 {repo_name_for_path} 已存在且包含文件（非Git仓库）。自动清理失败，请手动删除该目录后重试。如果文件被锁定，请关闭所有可能使用该目录的程序。'
                                }), 400
                            log_message(f"已清理非Git目录: {target_path}", 'INFO')
                            # 清理成功，继续执行
                    else:
                        # 目录为空，可以继续
                        log_message(f"目标目录已存在但为空，将使用该目录: {target_path}", 'INFO')
                except Exception as e:
                    log_message(f"检查目标目录时出错: {e}", 'WARNING')
                    return jsonify({'success': False, 'error': f'无法访问目录 {repo_name_for_path}: {str(e)}'}), 400
            
            # 创建进度ID
            import uuid
            progress_id = str(uuid.uuid4())
            
            # 初始化进度信息（存储在全局字典中，线程安全）
            with _progress_lock:
                _git_clone_progress[progress_id] = {
                    'repo_name': repo_input,
                    'status': 'starting',
                    'progress': 0,
                    'message': '开始克隆...',
                    'error': None
                }
            
            # 定义进度回调函数
            def progress_callback(op_code, cur_count, max_count, message):
                """进度回调"""
                try:
                    with _progress_lock:
                        if progress_id in _git_clone_progress:
                            progress_info = _git_clone_progress[progress_id]
                            progress_info['status'] = 'cloning'
                            
                            # 计算进度百分比
                            if max_count and max_count > 0:
                                progress = int((cur_count / max_count) * 100)
                                progress_info['progress'] = progress
                            else:
                                progress_info['progress'] = 0
                            
                            progress_info['message'] = message or '克隆中...'
                except:
                    pass
            
            # 在后台线程中执行克隆
            # 需要在线程外部获取app引用
            app_instance = current_app._get_current_object()
            
            def clone_in_thread():
                # 使用应用上下文
                with app_instance.app_context():
                    try:
                        manager = get_git_manager()
                        # 如果输入是完整URL，可以直接使用；否则使用默认配置组合
                        # 对于完整URL，如果提供了默认配置（用于SSH密钥），仍然可以使用
                        use_config = default_config if default_config else None
                        
                        result = manager.clone_repo(
                            remote_url=repo_input,  # 使用原始输入（可能是完整URL或相对路径）
                            target_path=target_path,
                            config=use_config,  # 如果有配置，可以用于SSH密钥认证
                            progress_callback=progress_callback
                        )
                        
                        # 更新进度信息
                        with _progress_lock:
                            if progress_id in _git_clone_progress:
                                progress_info = _git_clone_progress[progress_id]
                                if result.get('success'):
                                    progress_info['status'] = 'completed'
                                    progress_info['progress'] = 100
                                    progress_info['message'] = '克隆完成！'
                                else:
                                    progress_info['status'] = 'failed'
                                    progress_info['error'] = result.get('error', '克隆失败')
                    except Exception as e:
                        # 更新错误信息
                        import traceback
                        error_trace = traceback.format_exc()
                        log_message(f"克隆线程异常: {str(e)}\n{error_trace}", 'ERROR')
                        with _progress_lock:
                            if progress_id in _git_clone_progress:
                                progress_info = _git_clone_progress[progress_id]
                                progress_info['status'] = 'failed'
                                progress_info['error'] = str(e)
            
            # 启动克隆线程
            clone_thread = threading.Thread(target=clone_in_thread)
            clone_thread.daemon = True
            clone_thread.start()
            
            return jsonify({
                'success': True,
                'progress_id': progress_id,
                'message': '克隆任务已启动'
            })
            
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/repo/files', methods=['GET'])
    def git_repo_files():
        """获取Git仓库内的文件列表"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        try:
            repo_path = request.args.get('repo_path', '').strip()
            sub_path = request.args.get('sub_path', '').strip()
            
            # 如果路径中包含URL编码的字符，先解码
            import urllib.parse
            try:
                repo_path = urllib.parse.unquote(repo_path)
                sub_path = urllib.parse.unquote(sub_path) if sub_path else ''
            except:
                pass
            
            log_message(f"获取仓库文件列表: repo_path={repo_path}, sub_path={sub_path}")
            
            if not repo_path:
                return jsonify({'success': False, 'error': '仓库路径不能为空'}), 400
            
            # 验证路径
            git_workdir = current_app.config.get('GIT_WORKDIR', '')
            if not git_workdir:
                return jsonify({'success': False, 'error': 'Git工作目录未设置'}), 400
            
            # 构建完整路径 - 优先使用绝对路径，如果是相对路径则相对于Git工作目录
            if os.path.isabs(repo_path):
                full_repo_path = os.path.normpath(repo_path)
            else:
                full_repo_path = os.path.normpath(os.path.join(git_workdir, repo_path))
            
            log_message(f"解析后的仓库路径: {full_repo_path}")
            
            # 验证仓库路径在Git工作目录内
            git_workdir_norm = os.path.normpath(git_workdir)
            if not full_repo_path.startswith(git_workdir_norm):
                log_message(f"错误: 仓库路径不在Git工作目录内: {full_repo_path} (工作目录: {git_workdir_norm})", 'ERROR')
                return jsonify({'success': False, 'error': f'仓库路径不在Git工作目录内: {full_repo_path}'}), 403
            
            # 检查是否是Git仓库
            git_dir = os.path.join(full_repo_path, '.git')
            if not os.path.exists(git_dir):
                log_message(f"错误: .git目录不存在: {git_dir}", 'ERROR')
                # 尝试使用GitManager检查
                manager = get_git_manager()
                check_result = manager.check_repo(full_repo_path)
                if not check_result.get('is_repo', False):
                    error_msg = check_result.get('error', '未知错误')
                    return jsonify({'success': False, 'error': f'指定的路径不是Git仓库: {error_msg}'}), 400
            
            log_message(f"验证成功，仓库路径有效: {full_repo_path}")
            
            # 构建要列出的目录路径
            if sub_path:
                target_path = os.path.normpath(os.path.join(full_repo_path, sub_path))
                # 再次验证路径安全性
                if not target_path.startswith(full_repo_path):
                    return jsonify({'success': False, 'error': '无效的子路径'}), 400
            else:
                target_path = full_repo_path
            
            if not os.path.exists(target_path) or not os.path.isdir(target_path):
                return jsonify({'success': False, 'error': '路径不存在或不是目录'}), 404
            
            # 列出目录内容
            items = []
            try:
                entries = os.listdir(target_path)
            except PermissionError:
                return jsonify({'success': False, 'error': '没有权限访问该目录'}), 403
            except Exception as e:
                return jsonify({'success': False, 'error': f'列出目录失败: {str(e)}'}), 500
            
            # 过滤掉.git目录
            entries = [e for e in entries if e != '.git']
            
            for entry in entries:
                entry_path = os.path.join(target_path, entry)
                entry_rel_path = os.path.join(sub_path, entry) if sub_path else entry
                
                try:
                    is_dir = os.path.isdir(entry_path)
                    items.append({
                        'name': entry,
                        'path': entry_rel_path.replace('\\', '/'),  # 统一使用正斜杠
                        'is_dir': is_dir
                    })
                except Exception:
                    continue  # 跳过无法访问的条目
            
            # 排序：目录在前
            items.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))
            
            return jsonify({
                'success': True,
                'items': items,
                'repo_path': repo_path,
                'sub_path': sub_path
            })
            
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/clone/progress/<progress_id>', methods=['GET'])
    def git_clone_progress(progress_id):
        """获取克隆进度"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        try:
            with _progress_lock:
                if progress_id not in _git_clone_progress:
                    return jsonify({'success': False, 'error': '进度信息不存在'}), 404
                
                progress_info = _git_clone_progress[progress_id].copy()
                
                # 如果已完成或失败，10分钟后自动清理
                if progress_info.get('status') in ['completed', 'failed']:
                    import time
                    # 这里可以添加清理逻辑，但为了简化，暂时保留所有进度记录
                    # 如果需要清理，可以记录时间戳并在一定时间后删除
                
                return jsonify({
                    'success': True,
                    'progress': progress_info
                })
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/remote/repos/list', methods=['POST'])
    def git_remote_repos_list():
        """从远程服务器获取仓库列表"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        try:
            data = request.json or {}
            base_path = data.get('base_path', '').strip()
            
            # 获取默认Git配置
            config_manager = get_git_config_manager()
            default_config = config_manager.get_default_config()
            
            if not default_config:
                return jsonify({'success': False, 'error': '未配置Git服务器'}), 400
            
            manager = get_git_manager()
            result = manager.list_remote_repos(default_config, base_path)
            return jsonify(result)
        except Exception as e:
            import traceback
            log_message(f"获取远程仓库列表失败: {str(e)}\n{traceback.format_exc()}", 'ERROR')
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/git/config/test', methods=['POST'])
    def git_config_test():
        """测试Git配置是否有效"""
        if not check_git_enabled():
            return jsonify({'success': False, 'error': 'Git功能未启用'}), 403
        
        if not is_logged_in():
            return jsonify({'success': False, 'error': '未登录'}), 401
        
        data = request.json or {}
        config_id = data.get('config_id')
        
        if not config_id:
            return jsonify({'success': False, 'error': '配置ID不能为空'}), 400
        
        try:
            config_manager = get_git_config_manager()
            config = config_manager.get_config(config_id)
            
            if not config:
                return jsonify({'success': False, 'error': '配置不存在'}), 404
            
            manager = get_git_manager()
            result = manager.test_config(config)
            return jsonify(result)
        except Exception as e:
            return jsonify({'success': False, 'error': str(e)}), 500
