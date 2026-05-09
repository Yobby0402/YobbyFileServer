"""
产品对比数据管理器
管理产品对比文件的创建、读取、更新和删除
"""
import json
import logging
import os
import threading
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from .paths import get_data_path, project_base_dir

_product_compare_log = logging.getLogger('yobboy_file_server.product_compare')


def _get_base_dir() -> str:
    """获取程序运行的基础目录。"""
    return project_base_dir()


def _ensure_data_dir() -> str:
    """确保数据目录存在并返回路径"""
    return get_data_path("product_compare")


def _utc_now() -> str:
    """返回当前 UTC 时间的 ISO8601 字符串（秒级精度）"""
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _generate_color_for_belonging(belonging: str) -> str:
    """根据归属名称生成颜色（确定性哈希）"""
    import hashlib
    hash_obj = hashlib.md5(belonging.encode('utf-8'))
    hash_int = int(hash_obj.hexdigest()[:8], 16)
    
    # 生成柔和的颜色（茉莉飘雪主题色系）
    colors = [
        "#36aa97", "#5fbfae", "#1f8f7e", "#93d4c8", "#c1e7df",
        "#f4c95d", "#f58f6f", "#f07c82", "#a6c1ee", "#fbc2eb",
        "#a8edea", "#fed6e3", "#4facfe", "#00f2fe", "#fa709a"
    ]
    return colors[hash_int % len(colors)]


class ProductCompareManager:
    """管理产品对比数据的线程安全工具"""

    def __init__(self):
        self.data_dir = _ensure_data_dir()
        self._lock = threading.RLock()

    # ===== 文件管理 =====

    def list_files(self) -> List[Dict[str, Any]]:
        """列出所有产品对比文件"""
        with self._lock:
            files = []
            if not os.path.exists(self.data_dir):
                return files

            for filename in os.listdir(self.data_dir):
                if not filename.endswith('.json'):
                    continue

                filepath = os.path.join(self.data_dir, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read()
                    # 尝试修复常见的JSON格式错误
                    content = content.rstrip()
                    # 修复1: 如果末尾有多个}，只保留一个
                    while content.endswith('}}'):
                        content = content[:-1]
                    # 修复2: 尝试找到第一个完整的JSON对象
                    try:
                        data = json.loads(content)
                    except json.JSONDecodeError as e:
                        # 如果解析失败，尝试找到第一个完整的JSON对象
                        if e.msg == "Extra data":
                            first_brace = content.find('{')
                            if first_brace >= 0:
                                brace_count = 0
                                end_pos = first_brace
                                for i in range(first_brace, len(content)):
                                    if content[i] == '{':
                                        brace_count += 1
                                    elif content[i] == '}':
                                        brace_count -= 1
                                        if brace_count == 0:
                                            end_pos = i + 1
                                            break
                                if end_pos > first_brace:
                                    content = content[:end_pos]
                                    data = json.loads(content)
                                else:
                                    raise
                            else:
                                raise
                        else:
                            raise
                    # 修复问题7：确保正确计算产品数量
                    products = data.get('products', [])
                    if not isinstance(products, list):
                        products = []
                    attributes = data.get('attributes', [])
                    if not isinstance(attributes, list):
                        attributes = []
                    
                    files.append({
                        'file_id': filename[:-5],  # 去掉 .json 后缀
                        'name': data.get('name', '未命名对比'),
                        'created_at': data.get('created_at', ''),
                        'updated_at': data.get('updated_at', ''),
                        'product_count': len(products),
                        'attribute_count': len(attributes)
                    })
                except Exception as e:
                    # 如果修复后仍然无法解析，跳过该文件
                    _product_compare_log.warning("无法读取文件 %s: %s", filename, e)
                    continue

            # 按更新时间倒序排列
            files.sort(key=lambda x: x.get('updated_at', ''), reverse=True)
            return files

    def _get_file_path(self, file_id: str) -> str:
        """获取文件路径"""
        if not file_id or '/' in file_id or '\\' in file_id:
            raise ValueError("无效的文件ID")
        return os.path.join(self.data_dir, f"{file_id}.json")

    def _load_file(self, file_id: str) -> Dict[str, Any]:
        """加载文件数据"""
        filepath = self._get_file_path(file_id)
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"文件不存在: {file_id}")

        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            # 尝试修复常见的JSON格式错误
            original_content = content
            content = content.rstrip()
            fixed = False
            
            # 修复1: 如果末尾有多个}，只保留一个
            while content.endswith('}}'):
                content = content[:-1]
                fixed = True
            
            # 修复2: 尝试找到第一个完整的JSON对象
            # 如果文件中有多个JSON对象或额外数据，只解析第一个
            try:
                data = json.loads(content)
            except json.JSONDecodeError as e:
                # 如果解析失败，尝试找到第一个完整的JSON对象
                if e.msg == "Extra data":
                    # 找到第一个}的位置，截取到那里
                    first_brace = content.find('{')
                    if first_brace >= 0:
                        # 找到匹配的最后一个}
                        brace_count = 0
                        end_pos = first_brace
                        for i in range(first_brace, len(content)):
                            if content[i] == '{':
                                brace_count += 1
                            elif content[i] == '}':
                                brace_count -= 1
                                if brace_count == 0:
                                    end_pos = i + 1
                                    break
                        if end_pos > first_brace:
                            content = content[:end_pos]
                            fixed = True
                            data = json.loads(content)
                        else:
                            raise
                    else:
                        raise
                else:
                    raise
            
            # 如果修复了格式错误，保存修复后的文件
            if fixed:
                self._save_file(file_id, data)
            
            # 确保belonging_colors字段存在
            if 'belonging_colors' not in data:
                data['belonging_colors'] = {}
            
            # 兼容旧数据：添加链接默认属性（如果不存在）
            modified = False
            attributes = data.get('attributes', [])
            has_link_attr = any(attr.get('id') == 'attr_link' for attr in attributes)
            if not has_link_attr:
                # 获取最大 order 值
                max_order = max([attr.get('order', 0) for attr in attributes], default=-1)
                link_attr = {
                    "id": "attr_link",
                    "name": "链接",
                    "is_default": True,
                    "is_common": False,
                    "type": "text",
                    "order": max_order + 1
                }
                attributes.append(link_attr)
                data['attributes'] = attributes
                modified = True
            
            # 兼容旧数据：为所有产品添加 link 字段（如果不存在）
            # 这样编辑时就能显示链接输入框
            for product in data.get('products', []):
                if 'link' not in product:
                    product['link'] = ''
                    modified = True
            
            # 如果修改了数据，保存回去（兼容旧数据）
            if modified:
                self._save_file(file_id, data)
            
            return data
        except Exception as e:
            raise ValueError(f"读取文件失败: {str(e)}")

    def _save_file(self, file_id: str, data: Dict[str, Any]) -> None:
        """保存文件数据（原子写入）"""
        filepath = self._get_file_path(file_id)
        tmp_path = filepath + ".tmp"
        
        # 更新修改时间
        data['updated_at'] = _utc_now()
        
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, filepath)

    def create_file(self, name: str) -> Dict[str, Any]:
        """创建新的产品对比文件"""
        if not name or not name.strip():
            raise ValueError("文件名不能为空")

        with self._lock:
            file_id = str(uuid4())
            now = _utc_now()

            # 默认属性：品名、归属和链接
            default_attributes = [
                {
                    "id": "attr_name",
                    "name": "品名",
                    "is_default": True,
                    "is_common": False,
                    "type": "text",
                    "order": 0
                },
                {
                    "id": "attr_belonging",
                    "name": "归属",
                    "is_default": True,
                    "is_common": False,
                    "type": "text",
                    "order": 1
                },
                {
                    "id": "attr_link",
                    "name": "链接",
                    "is_default": True,
                    "is_common": False,
                    "type": "text",
                    "order": 2
                }
            ]

            data = {
                "version": "1.0",
                "name": name.strip(),
                "created_at": now,
                "updated_at": now,
                "attributes": default_attributes,
                "products": [],
                "belonging_colors": {}  # 初始化归属颜色映射
            }

            self._save_file(file_id, data)
            return {
                "file_id": file_id,
                **deepcopy(data)
            }

    def get_file(self, file_id: str) -> Dict[str, Any]:
        """获取文件数据"""
        with self._lock:
            data = self._load_file(file_id)
            return deepcopy(data)

    def update_file(self, file_id: str, name: Optional[str] = None) -> Dict[str, Any]:
        """更新文件基本信息"""
        with self._lock:
            data = self._load_file(file_id)
            
            if name is not None:
                if not name.strip():
                    raise ValueError("文件名不能为空")
                data['name'] = name.strip()
            
            self._save_file(file_id, data)
            return deepcopy(data)

    def delete_file(self, file_id: str) -> None:
        """删除文件"""
        with self._lock:
            filepath = self._get_file_path(file_id)
            if os.path.exists(filepath):
                os.remove(filepath)

    # ===== 属性管理 =====

    def add_attribute(self, file_id: str, name: str, is_common: bool = False, attr_type: str = "text") -> Dict[str, Any]:
        """添加属性"""
        if not name or not name.strip():
            raise ValueError("属性名称不能为空")

        with self._lock:
            data = self._load_file(file_id)
            
            # 检查属性名称是否已存在
            for attr in data.get('attributes', []):
                if attr.get('name', '').strip() == name.strip():
                    raise ValueError("属性名称已存在")

            # 获取最大 order 值
            max_order = max([attr.get('order', 0) for attr in data.get('attributes', [])], default=-1)

            new_attr = {
                "id": f"attr_{str(uuid4())}",
                "name": name.strip(),
                "is_default": False,
                "is_common": is_common,
                "type": attr_type if attr_type in ("text", "number") else "text",
                "order": max_order + 1,
                "unit": "",  # 单位
                "direction": "higher"  # higher=更大更好, lower=更小更好
            }

            data.setdefault('attributes', []).append(new_attr)
            self._save_file(file_id, data)
            return deepcopy(new_attr)

    def update_attribute(self, file_id: str, attr_id: str, name: Optional[str] = None, 
                        is_common: Optional[bool] = None, attr_type: Optional[str] = None,
                        order: Optional[int] = None, unit: Optional[str] = None,
                        direction: Optional[str] = None) -> Dict[str, Any]:
        """更新属性"""
        with self._lock:
            data = self._load_file(file_id)
            
            attr_index = None
            for idx, attr in enumerate(data.get('attributes', [])):
                if attr.get('id') == attr_id:
                    attr_index = idx
                    break

            if attr_index is None:
                raise ValueError("属性不存在")

            attr = data['attributes'][attr_index]

            # 默认属性不能删除，但可以修改部分属性
            if attr.get('is_default'):
                if name is not None and name.strip() != attr.get('name'):
                    raise ValueError("默认属性（品名、归属、链接）的名称不能修改")

            if name is not None:
                name = name.strip()
                if not name:
                    raise ValueError("属性名称不能为空")
                # 检查名称是否与其他属性冲突
                for other_attr in data.get('attributes', []):
                    if other_attr.get('id') != attr_id and other_attr.get('name', '').strip() == name:
                        raise ValueError("属性名称已存在")
                attr['name'] = name

            if is_common is not None:
                attr['is_common'] = is_common
                # 如果设置为通用参数，类型必须是 number
                if is_common and attr.get('type') != 'number':
                    attr['type'] = 'number'

            if attr_type is not None:
                if attr.get('is_common') and attr_type != 'number':
                    raise ValueError("通用参数的类型必须是 number")
                attr['type'] = attr_type if attr_type in ("text", "number") else attr['type']

            if order is not None:
                attr['order'] = order

            if unit is not None:
                attr['unit'] = unit.strip() if unit else ""

            if direction is not None:
                if direction in ("higher", "lower"):
                    attr['direction'] = direction

            self._save_file(file_id, data)
            return deepcopy(attr)

    def delete_attribute(self, file_id: str, attr_id: str) -> None:
        """删除属性"""
        with self._lock:
            data = self._load_file(file_id)
            
            attr_index = None
            for idx, attr in enumerate(data.get('attributes', [])):
                if attr.get('id') == attr_id:
                    attr_index = idx
                    break

            if attr_index is None:
                raise ValueError("属性不存在")

            attr = data['attributes'][attr_index]

            # 默认属性不能删除
            if attr.get('is_default'):
                raise ValueError("默认属性（品名、归属、链接）不能删除")

            # 从所有产品中删除该属性的值
            for product in data.get('products', []):
                product.get('attributes', {}).pop(attr_id, None)

            # 删除属性
            del data['attributes'][attr_index]
            self._save_file(file_id, data)

    def reorder_attributes(self, file_id: str, attr_orders: List[Dict[str, int]]) -> None:
        """重新排序属性（attr_orders: [{"id": "attr_xxx", "order": 0}, ...]）"""
        with self._lock:
            data = self._load_file(file_id)
            
            # 创建 order 映射
            order_map = {item['id']: item['order'] for item in attr_orders}
            
            # 更新所有属性的 order
            for attr in data.get('attributes', []):
                if attr.get('id') in order_map:
                    attr['order'] = order_map[attr.get('id')]
            
            # 按 order 排序
            data['attributes'].sort(key=lambda x: x.get('order', 0))
            self._save_file(file_id, data)

    # ===== 产品管理 =====

    def add_product(self, file_id: str, name: str, belonging: str, attributes: Optional[Dict[str, Any]] = None, link: Optional[str] = None) -> Dict[str, Any]:
        """添加产品"""
        if not name or not name.strip():
            raise ValueError("产品名称不能为空")
        if not belonging or not belonging.strip():
            raise ValueError("归属不能为空")

        with self._lock:
            data = self._load_file(file_id)
            
            # 检查产品名称是否已存在
            for product in data.get('products', []):
                if product.get('name', '').strip() == name.strip():
                    raise ValueError("产品名称已存在")

            # 验证属性值
            validated_attributes = {}
            if attributes:
                for attr_id, value in attributes.items():
                    # 查找属性定义
                    attr_def = None
                    for attr in data.get('attributes', []):
                        if attr.get('id') == attr_id:
                            attr_def = attr
                            break
                    
                    if attr_def:
                        # 如果是通用参数，必须是数值
                        if attr_def.get('is_common'):
                            try:
                                validated_attributes[attr_id] = float(value)
                            except (ValueError, TypeError):
                                raise ValueError(f"属性 '{attr_def.get('name')}' 是通用参数，必须输入数值")
                        else:
                            validated_attributes[attr_id] = str(value) if value is not None else ""

            belonging = belonging.strip()
            # 获取或生成归属颜色
            color = self._get_belonging_color(file_id, belonging)
            
            new_product = {
                "id": f"prod_{str(uuid4())}",
                "name": name.strip(),
                "belonging": belonging,
                "attributes": validated_attributes,
                "created_at": _utc_now(),
                "color": color  # 使用归属的颜色
            }
            
            # 添加链接（如果提供）
            if link and link.strip():
                new_product["link"] = link.strip()

            data.setdefault('products', []).append(new_product)
            
            self._save_file(file_id, data)
            return deepcopy(new_product)

    def update_product(self, file_id: str, product_id: str, name: Optional[str] = None,
                      belonging: Optional[str] = None, attributes: Optional[Dict[str, Any]] = None, link: Optional[str] = None) -> Dict[str, Any]:
        """更新产品"""
        with self._lock:
            data = self._load_file(file_id)
            
            product_index = None
            for idx, product in enumerate(data.get('products', [])):
                if product.get('id') == product_id:
                    product_index = idx
                    break

            if product_index is None:
                raise ValueError("产品不存在")

            product = data['products'][product_index]

            if name is not None:
                name = name.strip()
                if not name:
                    raise ValueError("产品名称不能为空")
                # 检查名称是否与其他产品冲突
                for other_product in data.get('products', []):
                    if other_product.get('id') != product_id and other_product.get('name', '').strip() == name:
                        raise ValueError("产品名称已存在")
                product['name'] = name

            if belonging is not None:
                belonging = belonging.strip()
                if not belonging:
                    raise ValueError("归属不能为空")
                product['belonging'] = belonging
                # 更新颜色（使用归属的颜色）
                product['color'] = self._get_belonging_color(file_id, belonging)

            if attributes is not None:
                # 验证属性值
                validated_attributes = product.get('attributes', {}).copy()
                for attr_id, value in attributes.items():
                    # 查找属性定义
                    attr_def = None
                    for attr in data.get('attributes', []):
                        if attr.get('id') == attr_id:
                            attr_def = attr
                            break
                    
                    if attr_def:
                        # 如果是通用参数，必须是数值
                        if attr_def.get('is_common'):
                            if value is None or value == "":
                                validated_attributes.pop(attr_id, None)
                            else:
                                try:
                                    validated_attributes[attr_id] = float(value)
                                except (ValueError, TypeError):
                                    raise ValueError(f"属性 '{attr_def.get('name')}' 是通用参数，必须输入数值")
                        else:
                            validated_attributes[attr_id] = str(value) if value is not None else ""
                    else:
                        # 属性不存在，忽略
                        continue
                
                product['attributes'] = validated_attributes

            if link is not None:
                if link and link.strip():
                    product['link'] = link.strip()
                else:
                    # 如果传入空字符串，删除链接
                    product.pop('link', None)

            self._save_file(file_id, data)
            return deepcopy(product)

    def _get_belonging_color(self, file_id: str, belonging: str) -> str:
        """获取归属对应的颜色（从文件数据中读取）"""
        with self._lock:
            data = self._load_file(file_id)
            belonging_colors = data.get('belonging_colors', {})
            if belonging in belonging_colors:
                return belonging_colors[belonging]
            # 如果没有保存的颜色，生成一个并保存
            color = _generate_color_for_belonging(belonging)
            self._set_belonging_color(file_id, belonging, color)
            return color
    
    def _set_belonging_color(self, file_id: str, belonging: str, color: str) -> None:
        """设置归属对应的颜色"""
        with self._lock:
            data = self._load_file(file_id)
            if 'belonging_colors' not in data:
                data['belonging_colors'] = {}
            data['belonging_colors'][belonging] = color
            self._save_file(file_id, data)

    def get_belongings(self, file_id: str) -> List[Dict[str, str]]:
        """获取文件中所有已使用的归属列表，包含颜色信息"""
        with self._lock:
            data = self._load_file(file_id)
            belongings_map = {}
            belonging_colors = data.get('belonging_colors', {})
            
            # 收集所有归属
            for product in data.get('products', []):
                belonging = product.get('belonging', '').strip()
                if belonging:
                    belongings_map[belonging] = {
                        'name': belonging,
                        'color': belonging_colors.get(belonging, _generate_color_for_belonging(belonging))
                    }
            
            # 返回排序后的列表
            return sorted([belongings_map[b] for b in belongings_map.keys()], key=lambda x: x['name'])

    def delete_product(self, file_id: str, product_id: str) -> None:
        """删除产品"""
        with self._lock:
            data = self._load_file(file_id)
            
            product_index = None
            for idx, product in enumerate(data.get('products', [])):
                if product.get('id') == product_id:
                    product_index = idx
                    break

            if product_index is None:
                raise ValueError("产品不存在")

            del data['products'][product_index]
            self._save_file(file_id, data)

    def reorder_products(self, file_id: str, product_orders: List[Dict[str, int]]) -> None:
        """重新排序产品（product_orders: [{"id": "prod_xxx", "order": 0}, ...]）"""
        with self._lock:
            data = self._load_file(file_id)
            
            # 创建 order 映射
            order_map = {item['id']: item['order'] for item in product_orders}
            
            # 为产品添加临时 order 字段并排序
            for product in data.get('products', []):
                if product.get('id') in order_map:
                    product['_temp_order'] = order_map[product.get('id')]
                else:
                    product['_temp_order'] = 9999
            
            data['products'].sort(key=lambda x: x.get('_temp_order', 9999))
            
            # 移除临时字段
            for product in data.get('products', []):
                product.pop('_temp_order', None)
            
            self._save_file(file_id, data)


# 单例管理：为 routes.init_app 提供方便的实例化方式
product_compare_manager = ProductCompareManager()

