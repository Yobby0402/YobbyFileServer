# git_config_manager.py
"""
Git配置管理器
负责管理Git服务器配置（SSH密钥、服务器地址等）
"""
import logging
import os
import re
import shutil
import stat
import subprocess
import tempfile
import json
from datetime import datetime
from typing import Dict, List, Optional

from .paths import get_data_path as runtime_data_path

_git_cfg_logger = logging.getLogger('yobboy_file_server.git_config')


def get_data_path(relative_path=''):
    """鑾峰彇data鏂囦欢澶硅矾寰?"""
    if relative_path:
        return runtime_data_path(*relative_path.split('/'), create_parent=True)
    return runtime_data_path()

def get_git_configs_path():
    """获取Git配置文件路径"""
    return get_data_path('file_server/git_configs.json')

def get_git_ssh_keys_dir():
    """获取程序托管的SSH密钥目录"""
    return get_data_path('file_server/ssh_keys')

def sanitize_ssh_key_name(name: str) -> str:
    """将用户输入的密钥名称清洗为安全文件名"""
    cleaned = re.sub(r'[^A-Za-z0-9._-]+', '_', (name or '').strip())
    cleaned = cleaned.strip('._')
    if not cleaned:
        cleaned = f"id_rsa_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    return cleaned

class GitConfigManager:
    """Git配置管理器"""
    
    def __init__(self):
        self.configs_path = get_git_configs_path()
        self.configs = self.load_configs()
    
    def load_configs(self) -> Dict:
        """加载Git配置"""
        try:
            os.makedirs(os.path.dirname(self.configs_path), exist_ok=True)
            if os.path.exists(self.configs_path):
                with open(self.configs_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    return data
            else:
                # 创建默认配置结构
                default_config = {
                    'configs': [],
                    'default_config_id': None
                }
                self.save_configs(default_config)
                return default_config
        except Exception as e:
            _git_cfg_logger.error("加载Git配置失败: %s", e)
            return {
                'configs': [],
                'default_config_id': None
            }
    
    def save_configs(self, configs: Optional[Dict] = None):
        """保存Git配置"""
        try:
            os.makedirs(os.path.dirname(self.configs_path), exist_ok=True)
            data = configs if configs is not None else self.configs
            with open(self.configs_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            return True
        except Exception as e:
            _git_cfg_logger.error("保存Git配置失败: %s", e)
            return False
    
    def get_all_configs(self) -> List[Dict]:
        """获取所有配置"""
        return self.configs.get('configs', [])
    
    def get_config(self, config_id: str) -> Optional[Dict]:
        """根据ID获取配置"""
        configs = self.get_all_configs()
        for config in configs:
            if config.get('id') == config_id:
                return config
        return None
    
    def get_default_config(self) -> Optional[Dict]:
        """获取默认配置"""
        default_id = self.configs.get('default_config_id')
        if default_id:
            return self.get_config(default_id)
        return None
    
    def add_config(self, config: Dict) -> str:
        """添加新配置"""
        import uuid
        config_id = f"config_{uuid.uuid4().hex[:8]}"
        config['id'] = config_id
        config['created_at'] = datetime.now().isoformat()
        config['updated_at'] = datetime.now().isoformat()
        
        configs = self.get_all_configs()
        configs.append(config)
        self.configs['configs'] = configs
        
        # 如果是第一个配置，设为默认
        if len(configs) == 1:
            self.configs['default_config_id'] = config_id
        
        self.save_configs()
        return config_id
    
    def update_config(self, config_id: str, config: Dict) -> bool:
        """更新配置"""
        configs = self.get_all_configs()
        for i, cfg in enumerate(configs):
            if cfg.get('id') == config_id:
                config['id'] = config_id
                config['created_at'] = cfg.get('created_at', datetime.now().isoformat())
                config['updated_at'] = datetime.now().isoformat()
                
                # 如果密码字段为空，保留原有密码
                if config.get('auth_type') == 'https':
                    if 'password_encrypted' not in config or not config.get('password_encrypted'):
                        config['password_encrypted'] = cfg.get('password_encrypted', '')
                    if 'username' not in config or not config.get('username'):
                        config['username'] = cfg.get('username', '')
                
                configs[i] = config
                self.configs['configs'] = configs
                self.save_configs()
                return True
        return False
    
    def delete_config(self, config_id: str) -> bool:
        """删除配置"""
        configs = self.get_all_configs()
        new_configs = [cfg for cfg in configs if cfg.get('id') != config_id]
        
        if len(new_configs) < len(configs):
            self.configs['configs'] = new_configs
            
            # 如果删除的是默认配置，重新设置默认
            if self.configs.get('default_config_id') == config_id:
                if new_configs:
                    self.configs['default_config_id'] = new_configs[0].get('id')
                else:
                    self.configs['default_config_id'] = None
            
            self.save_configs()
            return True
        return False
    
    def set_default_config(self, config_id: str) -> bool:
        """设置默认配置"""
        if self.get_config(config_id):
            self.configs['default_config_id'] = config_id
            self.save_configs()
            return True
        return False

    def generate_ssh_key_pair(self, key_name: str = '', comment: str = '') -> Dict:
        """生成并保存一对程序托管的SSH密钥"""
        try:
            os.makedirs(get_git_ssh_keys_dir(), exist_ok=True)

            safe_name = sanitize_ssh_key_name(key_name)
            private_key_path = os.path.normpath(os.path.join(get_git_ssh_keys_dir(), safe_name))
            public_key_path = f"{private_key_path}.pub"

            if os.path.exists(private_key_path) or os.path.exists(public_key_path):
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                private_key_path = os.path.normpath(os.path.join(get_git_ssh_keys_dir(), f"{safe_name}_{timestamp}"))
                public_key_path = f"{private_key_path}.pub"

            comment = (comment or '').strip()

            public_key_text = ''
            try:
                from cryptography.hazmat.primitives import serialization
                from cryptography.hazmat.primitives.asymmetric import rsa

                private_key = rsa.generate_private_key(
                    public_exponent=65537,
                    key_size=4096
                )
                private_key_bytes = private_key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.TraditionalOpenSSL,
                    encryption_algorithm=serialization.NoEncryption()
                )

                public_key_text = private_key.public_key().public_bytes(
                    encoding=serialization.Encoding.OpenSSH,
                    format=serialization.PublicFormat.OpenSSH
                ).decode('utf-8')

                if comment:
                    public_key_text = f"{public_key_text} {comment}"

                with open(private_key_path, 'wb') as private_file:
                    private_file.write(private_key_bytes)

                with open(public_key_path, 'w', encoding='utf-8') as public_file:
                    public_file.write(public_key_text + '\n')
            except Exception as crypto_error:
                ssh_keygen = shutil.which('ssh-keygen')
                if not ssh_keygen:
                    return {
                        'success': False,
                        'error': f'无法生成SSH密钥。cryptography 不可用，且系统未找到 ssh-keygen。原始错误: {crypto_error}'
                    }

                temp_dir = tempfile.mkdtemp(prefix='yobboy_ssh_')
                temp_private_path = os.path.join(temp_dir, 'generated_key')
                command = [ssh_keygen, '-t', 'rsa', '-b', '4096', '-N', '', '-f', temp_private_path]
                if comment:
                    command.extend(['-C', comment])

                run_kwargs = {
                    'capture_output': True,
                    'text': True,
                    'check': True
                }
                if sys.platform.startswith('win'):
                    run_kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW

                try:
                    subprocess.run(command, **run_kwargs)
                    with open(temp_private_path, 'rb') as private_file:
                        private_bytes = private_file.read()
                    with open(f"{temp_private_path}.pub", 'r', encoding='utf-8') as public_file:
                        public_key_text = public_file.read().strip()

                    with open(private_key_path, 'wb') as private_file:
                        private_file.write(private_bytes)
                    with open(public_key_path, 'w', encoding='utf-8') as public_file:
                        public_file.write(public_key_text + '\n')
                except subprocess.CalledProcessError as keygen_error:
                    error_output = (keygen_error.stderr or keygen_error.stdout or '').strip()
                    return {
                        'success': False,
                        'error': f'ssh-keygen 执行失败: {error_output or keygen_error}'
                    }
                finally:
                    shutil.rmtree(temp_dir, ignore_errors=True)

            try:
                os.chmod(private_key_path, stat.S_IRUSR | stat.S_IWUSR)
                os.chmod(public_key_path, stat.S_IRUSR | stat.S_IWUSR)
            except Exception:
                pass

            return {
                'success': True,
                'private_key_path': private_key_path,
                'public_key_path': public_key_path,
                'public_key': public_key_text,
                'comment': comment,
                'key_type': 'rsa'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'生成SSH密钥失败: {e}'
            }
