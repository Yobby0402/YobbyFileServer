# Optimization TodoList

## In Progress
- [x] 避免 GUI 仅读配置时重复初始化 Flask/SocketIO（已改为轻量配置读取）
- [x] 去除服务启动日志中的明文密码输出（仅保留密码长度）
- [x] 调整 `create_app` 的 debug 控制逻辑（由启动参数决定）
- [x] 访问日志过滤高频静态与 socket 路径，降低日志 I/O 压力
- [x] 将 `open_help/open_settings/closeEvent` 中的阻塞式等待改为事件循环等待
- [x] 为串口 `serial_sessions` 增加锁，降低 threading 模式竞态风险

## Next
- [ ] 将串口数据从 `list(bytes)` 改为 `hex/base64` 传输，降低序列化开销（已按要求跳过）
- [x] 为访问日志增加按大小/日期轮转，防止日志文件无限增长
- [x] 将散落 `print` 收敛到 `logging`（分级：debug/info/warning/error）

## Nice to Have
- [x] 合并配置写入路径，统一使用一个配置保存函数
- [x] 为关键路径添加最小回归测试（配置读取、服务启动、串口事件）

## Theme System
- [x] 新增玻璃拟态主题（Glassmorphism）
- [x] 新增粘土拟态主题（Claymorphism）
- [x] 全局提升字体对比度（标题/正文/弱化文本分层）
- [x] 修复复选框勾选可见性问题（勾选态/未勾选态明显区分）
- [x] 更新主题菜单与浮动主题选择器，加入新主题并支持滚动
- [x] 重构为“颜色主题 + 拟态效果”双层系统（颜色与拟态解耦）
