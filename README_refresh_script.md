# 订单库存信息自动刷新脚本使用说明

## 脚本功能

`refresh_stock_info.js` 脚本用于自动刷新数据库中缺少库存信息（`FSOStockId.FName`字段）的订单。

## 主要功能

1. **自动查找问题订单**：查询 `wecom.kingdee_orders` 表中缺少 `FSOStockId.FName` 字段的订单
2. **调用金蝶接口**：使用 `fetchOrderFromKingdee` 方法从金蝶系统重新获取完整订单信息
3. **更新订单数据**：使用 `saveKingdeeOrder` 方法将获取到的完整信息保存到数据库
4. **批量处理**：支持批量处理多个订单，并提供进度显示
5. **错误处理**：包含完善的错误处理和日志记录

## 使用方法

### 1. 直接运行脚本

```bash
# 进入项目目录
cd /home/zhengqiang/nwww

# 运行刷新脚本
node refresh_stock_info.js
```

### 2. 作为模块使用

```javascript
const { main, refreshOrderStockInfo, findOrdersWithMissingStockInfo } = require('./refresh_stock_info.js');

// 执行完整的批量刷新
await main();

// 或者只刷新特定订单
await refreshOrderStockInfo('SO001234');

// 或者只查找需要刷新的订单
const orders = await findOrdersWithMissingStockInfo();
```

### 3. 定时任务设置

可以通过 crontab 设置定时执行：

```bash
# 编辑定时任务
crontab -e

# 添加以下行（每天凌晨2点执行）
0 2 * * * cd /home/zhengqiang/nwww && node refresh_stock_info.js >> /var/log/refresh_stock.log 2>&1
```

## 脚本特性

### 安全特性
- **请求限流**：每次请求间隔1秒，避免对金蝶接口造成压力
- **超时控制**：接口请求设置15秒超时
- **错误恢复**：单个订单失败不影响其他订单的处理

### 日志功能
- **详细日志**：记录每个步骤的执行情况
- **进度显示**：显示当前处理进度
- **统计信息**：显示成功和失败的订单数量

### 数据处理
- **格式兼容**：支持数组和单对象格式的订单数据
- **字段映射**：自动映射金蝶系统字段到本地数据库字段
- **JSON处理**：安全处理JSON数据，避免解析错误

## 查询条件说明

脚本会查找以下情况的订单：
1. `items` 字段中不包含 `FSOStockId.FName` 的订单
2. `FSOStockId.FName` 值为 `null` 的订单
3. `FSOStockId.FName` 值为空字符串的订单

## 输出示例

```
=== 开始执行订单库存信息自动刷新脚本 ===
执行时间: 2024/1/15 14:30:25
查找缺少FSOStockId.FName字段的订单...
找到 5 个缺少库存信息的订单
准备刷新 5 个订单的库存信息

进度: 1/5
开始刷新订单 SO001234 的库存信息...
调用金蝶接口获取订单信息: SO001234
金蝶接口响应状态: 200
成功获取订单数据，包含 3 条记录
准备保存订单，订单号: SO001234 明细项数量: 3
金蝶订单保存成功: SO001234
订单 SO001234 库存信息刷新成功
等待1秒后继续...

=== 刷新完成 ===
总订单数: 5
成功刷新: 4
刷新失败: 1
完成时间: 2024/1/15 14:32:10
数据库连接已关闭
```

## 注意事项

1. **网络依赖**：脚本需要访问金蝶接口（`http://localhost:8000/kingdee/order/list`），确保网络连通
2. **数据库权限**：确保数据库用户有读写 `wecom.kingdee_orders` 表的权限
3. **接口限制**：金蝶接口可能有访问频率限制，脚本已内置1秒间隔
4. **数据备份**：建议在大批量执行前备份相关数据表

## 故障排除

### 常见问题

1. **数据库连接失败**
   - 检查数据库服务是否运行
   - 验证连接参数（用户名、密码、端口等）

2. **金蝶接口调用失败**
   - 检查金蝶服务是否运行在 `localhost:8000`
   - 验证接口路径是否正确
   - 检查网络连接

3. **订单数据格式错误**
   - 检查金蝶接口返回的数据格式
   - 查看日志中的具体错误信息

### 调试模式

可以修改脚本中的日志级别或添加更详细的调试信息来排查问题。

## 维护建议

1. **定期检查**：建议定期检查脚本执行日志
2. **性能监控**：监控脚本执行时间，如果订单量大可考虑分批处理
3. **版本更新**：根据金蝶接口变化及时更新脚本