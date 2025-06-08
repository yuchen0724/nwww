# 企业微信应用

一个基于企业微信的二维码扫描和订单管理应用，支持移动端扫码、数据记录和后台管理功能。

## 📋 项目简介

本项目是一个企业微信应用，主要用于：
- 企业微信用户身份验证
- 二维码扫描功能
- 订单数据管理
- 扫码记录统计
- 移动端友好的管理界面

## ✨ 功能特性

### 🔐 用户认证
- 企业微信OAuth2.0身份验证
- 自动获取用户信息（姓名、部门、职位等）
- 用户信息本地存储

### 📱 扫码功能
- 企业微信JSAPI扫码
- 支持二维码和条形码
- 实时扫码结果显示
- 扫码历史记录

### 📊 数据管理
- 扫码记录存储
- 金蝶订单数据集成
- 用户扫码统计
- 数据筛选和排序

### 🎨 界面特性
- 响应式设计，支持移动端
- Bootstrap 5 UI框架
- 左滑删除功能
- 实时数据更新
- 友好的用户体验

### 🛠️ 管理功能
- 后台管理界面
- 扫码记录管理
- 用户数据查看
- 批量操作支持

## 🚀 技术栈

### 后端技术
- **Node.js** - 服务器运行环境
- **Express.js** - Web应用框架
- **PostgreSQL** - 数据库
- **EJS** - 模板引擎
- **Express-Session** - 会话管理

### 前端技术
- **Bootstrap 5** - UI框架
- **Bootstrap Icons** - 图标库
- **企业微信JSAPI** - 扫码功能
- **原生JavaScript** - 交互逻辑

### 第三方集成
- **企业微信API** - 用户认证和扫码
- **金蝶API** - 订单数据获取
- **Axios** - HTTP请求库

## 📦 安装部署

### 环境要求
- Node.js >= 14.0.0
- PostgreSQL >= 12.0
- 企业微信应用配置

### 1. 克隆项目
```bash
git clone <repository-url>
cd nwww
```

### 2. 安装依赖
```bash
npm install
```

### 3. 数据库配置

创建PostgreSQL数据库和相关表：

```sql
-- 创建schema
CREATE SCHEMA IF NOT EXISTS wecom;

-- 创建用户表
CREATE TABLE wecom.wework_users (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    dept_id INTEGER,
    dept_name VARCHAR(200),
    position VARCHAR(100),
    mobile VARCHAR(20),
    email VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建扫码记录表
CREATE TABLE wecom.scan_records (
    id SERIAL PRIMARY KEY,
    userid VARCHAR(100) NOT NULL,
    scan_type VARCHAR(50) DEFAULT 'qrcode',
    scan_result TEXT NOT NULL,
    status VARCHAR(20) DEFAULT '成功',
    quantity INTEGER DEFAULT 0,
    scan_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建订单表
CREATE TABLE wecom.kingdee_orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(100) UNIQUE NOT NULL,
    customer_name VARCHAR(200),
    order_date DATE,
    total_amount DECIMAL(15,2),
    currency VARCHAR(10) DEFAULT 'CNY',
    status VARCHAR(50) DEFAULT 'active',
    items JSONB,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4. 配置文件

修改 `app.js` 中的配置信息：

```javascript
// 企业微信配置
const config = {
  corpid: 'your_corp_id',           // 企业ID
  corpsecret: 'your_corp_secret',   // 应用密钥
  agentid: 'your_agent_id',         // 应用ID
  baseUrl: 'your_domain_url'        // 应用域名
};
```

修改 `db.js` 中的数据库配置：

```javascript
const pool = new Pool({
  user: 'your_db_user',
  host: 'localhost',
  database: 'your_database',
  password: 'your_password',
  port: 5432
});
```

### 5. 启动应用

开发模式：
```bash
npm run dev
```

生产模式：
```bash
npm start
```

应用将在 `http://localhost:27273` 启动

## 📱 使用说明

### 用户端功能

1. **登录认证**
   - 在企业微信中打开应用
   - 自动完成OAuth认证
   - 获取用户基本信息

2. **扫码操作**
   - 点击"开始扫码"按钮
   - 使用摄像头扫描二维码/条形码
   - 查看扫码结果和历史记录

3. **记录查看**
   - 查看个人扫码历史
   - 查看订单详细信息
   - 实时数据更新

### 管理端功能

访问 `/admin` 路径进入管理界面：

1. **数据筛选**
   - 按用户筛选
   - 按时间范围筛选
   - 按订单号筛选
   - 按状态筛选

2. **记录管理**
   - 查看所有扫码记录
   - 排序和分页
   - 删除记录（支持左滑删除）
   - 批量操作

3. **数据导出**
   - 支持数据筛选导出
   - 多种格式支持

## 🔧 API接口

### 主要路由

- `GET /` - 主页（用户端）
- `GET /admin` - 管理页面
- `POST /scan` - 扫码记录提交
- `GET /api/config` - 获取JSAPI配置
- `DELETE /api/records/:id` - 删除扫码记录
- `GET /api/user-records` - 获取用户扫码记录

### 企业微信集成

- OAuth2.0用户认证
- JSAPI扫码功能
- 用户信息获取
- 部门信息同步

## 📁 项目结构

```
nwww/
├── app.js              # 主应用文件
├── db.js               # 数据库配置和操作
├── package.json        # 项目依赖配置
├── README.md           # 项目说明文档
├── public/             # 静态资源
│   ├── js/
│   │   └── main.js     # 前端JavaScript
│   └── sounds/         # 音效文件
│       ├── success.mp3
│       └── error.mp3
└── views/              # EJS模板
    ├── index.ejs       # 用户主页
    ├── admin.ejs       # 管理页面
    └── error.ejs       # 错误页面
```

## 🔒 安全考虑

- 企业微信OAuth2.0认证
- Session会话管理
- SQL注入防护
- XSS攻击防护
- CSRF保护
- 数据库连接池

## 🐛 故障排除

### 常见问题

1. **扫码功能不工作**
   - 检查企业微信JSAPI配置
   - 确认域名白名单设置
   - 检查HTTPS证书

2. **数据库连接失败**
   - 检查数据库配置
   - 确认数据库服务状态
   - 检查网络连接

3. **用户认证失败**
   - 检查企业微信应用配置
   - 确认corpid和secret正确
   - 检查回调域名设置

### 日志查看

应用日志会输出到控制台，包含：
- 用户认证信息
- 扫码操作记录
- 数据库操作日志
- 错误信息详情

## 📈 性能优化

- 数据库连接池管理
- 静态资源CDN加速
- 响应式图片加载
- 前端资源压缩
- 缓存策略优化

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 📞 联系方式

如有问题或建议，请联系项目维护者。

---

**注意**: 使用前请确保已正确配置企业微信应用和数据库连接。

一个基于Express的企业微信集成应用，提供二维码扫描、用户信息展示和企业微信消息通知功能。

## 功能特性

- 企业微信OAuth登录
- 用户信息展示（头像、姓名、部门等）
- 二维码扫描与解析
- 扫描历史记录存储与展示
- 企业微信消息通知

## 技术栈

- 后端框架：Express
- 前端模板：EJS
- UI框架：Bootstrap 5
- 主要依赖：
  - axios - HTTP请求
  - canvas - 图像处理
  - jsqr - 二维码解析
  - multer - 文件上传

## 安装指南

1. 克隆项目：
```bash
git clone <项目地址>
```

2. 安装依赖：
```bash
npm install
```

3. 配置环境变量：
```bash
cp .env.example .env
# 编辑.env文件配置企业微信相关参数
```

4. 启动应用：
```bash
npm start
```

## 使用说明

1. 访问应用首页
2. 点击"登录"按钮进行企业微信OAuth登录
3. 登录后可查看个人信息
4. 使用"扫描二维码"功能进行扫描
5. 扫描结果会自动保存并显示在历史记录中

## 项目结构

```
├── .vscode/            # VSCode配置
├── app.js             # 主应用入口
├── node_modules/      # 依赖模块
├── package.json       # 项目配置
├── package-lock.json  # 依赖锁定文件
├── public/            # 静态资源
│   ├── js/            # JavaScript文件
│   └── uploads/       # 上传文件存储
├── routes/            # 路由文件（当前为空）
└── views/             # 视图模板
    ├── error.ejs      # 错误页面
    └── index.ejs      # 主页面
```

## 环境要求

- Node.js 14+
- npm 6+
- 企业微信开发者账号