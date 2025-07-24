# PostgreSQL URL解析函数使用指南

本文档介绍如何使用在PostgreSQL中创建的URL解析函数。

## 函数列表

### 1. wecom.parse_url(url_text TEXT)
返回表格格式的URL解析结果，包含以下字段：
- `protocol`: 协议（如 https, http, ftp）
- `host`: 主机名
- `port`: 端口号（整数）
- `path`: 路径
- `query`: 查询参数
- `fragment`: 片段（锚点）
- `username`: 用户名
- `password`: 密码

### 2. wecom.parse_url_json(url_text TEXT)
返回JSON格式的URL解析结果。

### 3. wecom.get_url_part(url_text TEXT, part_name TEXT)
获取URL的特定部分。

## 使用示例

### 基本用法

```sql
-- 解析完整URL
SELECT * FROM wecom.parse_url('https://user:pass@api.example.com:8080/v1/users?limit=10&offset=0#results');

-- 结果：
-- protocol | host            | port | path      | query              | fragment | username | password
-- https    | api.example.com | 8080 | /v1/users | limit=10&offset=0  | results  | user     | pass
```

### JSON格式返回

```sql
-- 获取JSON格式结果
SELECT wecom.parse_url_json('https://www.example.com/path?query=value#section');

-- 结果：
-- {
--   "protocol": "https",
--   "host": "www.example.com",
--   "port": null,
--   "path": "/path",
--   "query": "query=value",
--   "fragment": "section",
--   "username": null,
--   "password": null
-- }
```

### 获取特定部分

```sql
-- 获取主机名
SELECT wecom.get_url_part('https://api.example.com:8080/users', 'host');
-- 结果: api.example.com

-- 获取协议
SELECT wecom.get_url_part('https://api.example.com:8080/users', 'protocol');
-- 结果: https

-- 获取端口
SELECT wecom.get_url_part('https://api.example.com:8080/users', 'port');
-- 结果: 8080

-- 获取路径
SELECT wecom.get_url_part('https://api.example.com:8080/users', 'path');
-- 结果: /users
```

### 实际应用场景

#### 1. 分析访问日志中的URL

```sql
-- 假设有一个访问日志表
CREATE TABLE access_logs (
    id SERIAL PRIMARY KEY,
    url TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 分析访问的主机分布
SELECT 
    wecom.get_url_part(url, 'host') as host,
    COUNT(*) as visit_count
FROM access_logs 
WHERE url IS NOT NULL
GROUP BY wecom.get_url_part(url, 'host')
ORDER BY visit_count DESC;

-- 分析访问的路径分布
SELECT 
    wecom.get_url_part(url, 'path') as path,
    COUNT(*) as visit_count
FROM access_logs 
WHERE url IS NOT NULL
GROUP BY wecom.get_url_part(url, 'path')
ORDER BY visit_count DESC;
```

#### 2. 验证URL格式

```sql
-- 检查URL是否有有效的协议
SELECT 
    url,
    CASE 
        WHEN wecom.get_url_part(url, 'protocol') IS NOT NULL THEN '有效'
        ELSE '无效'
    END as url_status
FROM your_table;

-- 检查是否为HTTPS协议
SELECT 
    url,
    wecom.get_url_part(url, 'protocol') = 'https' as is_secure
FROM your_table;
```

#### 3. 提取查询参数

```sql
-- 提取特定查询参数（需要进一步解析query字符串）
WITH parsed_urls AS (
    SELECT 
        url,
        wecom.get_url_part(url, 'query') as query_string
    FROM your_table
)
SELECT 
    url,
    query_string,
    -- 这里可以进一步解析query_string来提取特定参数
    CASE 
        WHEN query_string LIKE '%utm_source=%' THEN 
            split_part(split_part(query_string, 'utm_source=', 2), '&', 1)
        ELSE NULL
    END as utm_source
FROM parsed_urls;
```

## Node.js中的使用

在Node.js应用中，可以通过数据库连接使用这些函数：

```javascript
const { parseUrlJson, getUrlPart } = require('./db');

// 解析URL并获取JSON结果
async function analyzeUrl(url) {
    try {
        const result = await parseUrlJson(url);
        console.log('URL解析结果:', result);
        
        // 获取特定部分
        const host = await getUrlPart(url, 'host');
        const protocol = await getUrlPart(url, 'protocol');
        
        console.log(`主机: ${host}, 协议: ${protocol}`);
        
        return result;
    } catch (error) {
        console.error('URL解析失败:', error);
        throw error;
    }
}

// 使用示例
analyzeUrl('https://api.example.com:8080/v1/users?limit=10');
```

## 支持的URL格式

- 完整URL: `https://user:pass@example.com:8080/path?query=value#fragment`
- 简单URL: `https://example.com/path`
- 带端口: `http://localhost:3000/api`
- FTP URL: `ftp://files.example.com/downloads/file.zip`
- 相对路径: `/relative/path?query=value`
- 带查询参数和片段: `https://example.com/path?param1=value1&param2=value2#section`

## 注意事项

1. 函数会正确处理URL编码的字符
2. 对于相对路径（不包含协议），只会解析路径、查询参数和片段
3. 端口号必须是有效的数字，否则返回NULL
4. 用户名和密码的解析支持标准的HTTP基本认证格式
5. 函数对空值和无效输入具有容错性

## 性能考虑

- 这些函数使用字符串操作而非正则表达式，性能较好
- 适合在大量数据的查询中使用
- 建议在需要频繁解析URL的场景中创建索引

```sql
-- 为经常查询的URL部分创建函数索引
CREATE INDEX idx_url_host ON your_table (wecom.get_url_part(url, 'host'));
CREATE INDEX idx_url_protocol ON your_table (wecom.get_url_part(url, 'protocol'));
```