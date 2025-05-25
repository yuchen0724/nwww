# 企业微信应用

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