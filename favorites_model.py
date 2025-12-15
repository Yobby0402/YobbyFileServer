
import json
import os
import logging
from datetime import datetime

class FavoritesModel:
    def __init__(self, data_file='favorites.json'):
        self.data_file = data_file
        self.logger = logging.getLogger("favorites_model")
        self._ensure_file_exists()

    def _ensure_file_exists(self):
        if not os.path.exists(self.data_file):
            self.save_data({"groups": ["默认收藏"], "items": []})

    def load_data(self):
        try:
            with open(self.data_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data
        except Exception as e:
            self.logger.error(f"Failed to load favorites: {e}")
            return {"groups": ["默认收藏"], "items": []}

    def save_data(self, data):
        try:
            with open(self.data_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=4)
            return True
        except Exception as e:
            self.logger.error(f"Failed to save favorites: {e}")
            return False

    def get_favorites(self):
        return self.load_data()

    def add_group(self, group_name):
        data = self.load_data()
        if group_name not in data['groups']:
            data['groups'].append(group_name)
            self.save_data(data)
            return True, "分组创建成功"
        return False, "分组已存在"

    def delete_group(self, group_name):
        data = self.load_data()
        if group_name in data['groups']:
            # Check if any items are in this group
            if any(item['group'] == group_name for item in data['items']):
                return False, "该分组下有收藏项，无法删除"
            if group_name == "默认收藏":
                return False, "默认分组无法删除"
            
            data['groups'].remove(group_name)
            self.save_data(data)
            return True, "分组删除成功"
        return False, "分组不存在"

    def add_favorite(self, filepath, group_name="默认收藏", remark=""):
        data = self.load_data()
        
        # Check if already exists
        for item in data['items']:
            if item['filepath'] == filepath:
                # Update existing
                item['group'] = group_name
                item['remark'] = remark
                self.save_data(data)
                return True, "收藏更新成功"

        new_item = {
            "id": str(int(datetime.now().timestamp() * 1000)),
            "filepath": filepath,
            "group": group_name,
            "remark": remark or os.path.basename(filepath),
            "added_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        data['items'].append(new_item)
        self.save_data(data)
        return True, "收藏添加成功"

    def remove_favorite(self, filepath):
        data = self.load_data()
        original_count = len(data['items'])
        data['items'] = [item for item in data['items'] if item['filepath'] != filepath]
        
        if len(data['items']) < original_count:
            self.save_data(data)
            return True, "取消收藏成功"
        return False, "未找到该收藏"

favorites_model = FavoritesModel()
