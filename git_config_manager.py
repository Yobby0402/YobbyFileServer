# git_config_manager.py
"""
Git配置管理器
负责管理Git服务器配置（SSH密钥、服务器地址等）
"""
import os
import sys
import json
from datetime import datetime
from typing import Dict, List, Optional

def get_data_path(relative_path=''):
    """获取data文件夹路径"""
    if getattr(sys, 'frozen', False):
        # 打包环境：exe 所在目录
        base_path = os.path.dirname(sys.executable)
    else:
        # 开发环境：.py 文件所在目录
        base_path = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_path, 'data')
    if relative_path:
        return os.path.join(data_dir, relative_path)
    return data_dir

def get_git_configs_path():
    """获取Git配置文件路径"""
    return get_data_path('file_server/git_configs.json')

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
            print(f"[错误] 加载Git配置失败: {e}")
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
            print(f"[错误] 保存Git配置失败: {e}")
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
