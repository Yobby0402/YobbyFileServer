# share_links.py
"""
分享链接功能模块
提供文件/文件夹的临时分享链接功能
"""

import sqlite3
import os
import secrets
import string
from datetime import datetime, timedelta
from typing import Optional, Dict, List

class ShareLinkManager:
    """分享链接管理器"""
    
    def __init__(self, db_path='share_links.db'):
        """初始化数据库连接"""
        self.db_path = db_path
        self.init_database()
    
    def init_database(self):
        """初始化数据库表"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 创建分享链接表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS share_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                share_code TEXT UNIQUE NOT NULL,
                file_path TEXT NOT NULL,
                is_directory INTEGER DEFAULT 0,
                password TEXT,
                max_visits INTEGER DEFAULT -1,
                current_visits INTEGER DEFAULT 0,
                expire_time TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT,
                description TEXT
            )
        ''')
        
        # 创建访问记录表
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS share_visits (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                share_code TEXT NOT NULL,
                visit_ip TEXT,
                visit_time TEXT NOT NULL,
                user_agent TEXT,
                FOREIGN KEY (share_code) REFERENCES share_links(share_code)
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def generate_share_code(self, length=8):
        """生成唯一的分享码"""
        chars = string.ascii_letters + string.digits
        while True:
            code = ''.join(secrets.choice(chars) for _ in range(length))
            # 检查是否已存在
            if not self.get_share_link(code):
                return code
    
    def create_share_link(self, file_path: str, is_directory: bool = False,
                         password: Optional[str] = None,
                         expire_hours: Optional[int] = None,
                         max_visits: int = -1,
                         created_by: str = 'anonymous',
                         description: str = '') -> Dict:
        """
        创建分享链接
        
        Args:
            file_path: 文件或文件夹路径
            is_directory: 是否为文件夹
            password: 访问密码（可选）
            expire_hours: 过期时间（小时），None表示永不过期
            max_visits: 最大访问次数，-1表示无限制
            created_by: 创建者
            description: 描述
        
        Returns:
            包含分享码和其他信息的字典
        """
        share_code = self.generate_share_code()
        created_at = datetime.now().isoformat()
        
        # 计算过期时间
        expire_time = None
        if expire_hours:
            expire_time = (datetime.now() + timedelta(hours=expire_hours)).isoformat()
        
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            INSERT INTO share_links 
            (share_code, file_path, is_directory, password, max_visits, 
             expire_time, created_at, created_by, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (share_code, file_path, 1 if is_directory else 0, password,
              max_visits, expire_time, created_at, created_by, description))
        
        conn.commit()
        conn.close()
        
        return {
            'share_code': share_code,
            'file_path': file_path,
            'is_directory': is_directory,
            'has_password': bool(password),
            'expire_time': expire_time,
            'max_visits': max_visits,
            'created_at': created_at,
            'description': description
        }
    
    def get_share_link(self, share_code: str) -> Optional[Dict]:
        """获取分享链接信息"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        cursor.execute('SELECT * FROM share_links WHERE share_code = ?', (share_code,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return dict(row)
        return None
    
    def verify_share_link(self, share_code: str, password: Optional[str] = None) -> Dict:
        """
        验证分享链接是否有效
        
        Returns:
            {'valid': bool, 'reason': str, 'data': dict}
        """
        link = self.get_share_link(share_code)
        
        if not link:
            return {'valid': False, 'reason': '分享链接不存在', 'data': None}
        
        # 检查是否过期
        if link['expire_time']:
            expire_time = datetime.fromisoformat(link['expire_time'])
            if datetime.now() > expire_time:
                return {'valid': False, 'reason': '分享链接已过期', 'data': None}
        
        # 检查访问次数
        if link['max_visits'] > 0 and link['current_visits'] >= link['max_visits']:
            return {'valid': False, 'reason': '访问次数已达上限', 'data': None}
        
        # 检查密码
        if link['password']:
            if not password or password != link['password']:
                return {'valid': False, 'reason': '密码错误', 'data': None}
        
        return {'valid': True, 'reason': '', 'data': link}
    
    def record_visit(self, share_code: str, ip: str, user_agent: str = ''):
        """记录访问"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 更新访问次数
        cursor.execute('''
            UPDATE share_links 
            SET current_visits = current_visits + 1 
            WHERE share_code = ?
        ''', (share_code,))
        
        # 记录访问日志
        cursor.execute('''
            INSERT INTO share_visits (share_code, visit_ip, visit_time, user_agent)
            VALUES (?, ?, ?, ?)
        ''', (share_code, ip, datetime.now().isoformat(), user_agent))
        
        conn.commit()
        conn.close()
    
    def delete_share_link(self, share_code: str) -> bool:
        """删除分享链接"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # 删除访问记录
        cursor.execute('DELETE FROM share_visits WHERE share_code = ?', (share_code,))
        
        # 删除分享链接
        cursor.execute('DELETE FROM share_links WHERE share_code = ?', (share_code,))
        
        affected = cursor.rowcount
        conn.commit()
        conn.close()
        
        return affected > 0
    
    def get_all_share_links(self, created_by: Optional[str] = None) -> List[Dict]:
        """获取所有分享链接"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        if created_by:
            cursor.execute('''
                SELECT * FROM share_links 
                WHERE created_by = ? 
                ORDER BY created_at DESC
            ''', (created_by,))
        else:
            cursor.execute('SELECT * FROM share_links ORDER BY created_at DESC')
        
        rows = cursor.fetchall()
        conn.close()
        
        return [dict(row) for row in rows]
    
    def cleanup_expired_links(self) -> int:
        """清理过期的分享链接"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        now = datetime.now().isoformat()
        
        # 获取过期的分享码
        cursor.execute('''
            SELECT share_code FROM share_links 
            WHERE expire_time IS NOT NULL AND expire_time < ?
        ''', (now,))
        
        expired_codes = [row[0] for row in cursor.fetchall()]
        
        # 删除过期链接及其访问记录
        for code in expired_codes:
            cursor.execute('DELETE FROM share_visits WHERE share_code = ?', (code,))
            cursor.execute('DELETE FROM share_links WHERE share_code = ?', (code,))
        
        conn.commit()
        conn.close()
        
        return len(expired_codes)
    
    def get_visit_stats(self, share_code: str) -> Dict:
        """获取分享链接的访问统计"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # 获取访问记录
        cursor.execute('''
            SELECT * FROM share_visits 
            WHERE share_code = ? 
            ORDER BY visit_time DESC
        ''', (share_code,))
        
        visits = [dict(row) for row in cursor.fetchall()]
        
        # 获取链接信息
        cursor.execute('SELECT * FROM share_links WHERE share_code = ?', (share_code,))
        link = dict(cursor.fetchone()) if cursor.fetchone() else None
        
        conn.close()
        
        return {
            'link': link,
            'visits': visits,
            'total_visits': len(visits)
        }

