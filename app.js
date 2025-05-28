const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
const jsQR = require('jsqr');

// 引入数据库模块
const db = require('./db');
const { saveWecomUser, recordScan } = db;

const app = express();
const port = 27273;

// 企业微信配置
const config = {
  corpid: 'ww94fc58ff493578de',
  corpsecret: '8AQL--JfDHaVUsInPPVigiCYjXS63sLZ6Lz2uUwNh-U',
  agentid: '1000089',
  baseUrl: 'http://ustar-test.tiremart.cn:27273' // 例如 'https://example.com' 或 'http://123.456.789.10:27273'
};

// 配置会话
app.use(session({
  secret: 'wechat-work-app-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24小时
}));

// 设置视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 静态文件
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public/uploads'));
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// 确保上传目录存在
if (!fs.existsSync(path.join(__dirname, 'public/uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'public/uploads'), { recursive: true });
}

// 获取访问令牌
async function getAccessToken() {
  try {
    const response = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corpid}&corpsecret=${config.corpsecret}`
    );
    if (response.data.errcode === 0) {
      return response.data.access_token;
    } else {
      console.error('获取访问令牌失败:', response.data);
      return null;
    }
  } catch (error) {
    console.error('获取访问令牌出错:', error);
    return null;
  }
}

// 获取用户信息
async function getUserInfo(accessToken, code) {
  try {
    const response = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=${accessToken}&code=${code}`
    );
    if (response.data.errcode === 0) {
      return response.data;
    } else {
      console.error('获取用户信息失败:', response.data);
      return null;
    }
  } catch (error) {
    console.error('获取用户信息出错:', error);
    return null;
  }
}

// 获取用户详细信息
async function getUserDetail(accessToken, userId) {
  try {
    const response = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}&userid=${userId}`
    );
    if (response.data.errcode === 0) {
      console.error('获取用户详细信息成功:', response.data);
      return response.data;
    } else {
      console.error('获取用户详细信息失败:', response.data);
      return null;
    }
  } catch (error) {
    console.error('获取用户详细信息出错:', error);
    return null;
  }
}

// 主页路由
app.get('/', async (req, res) => {
  const { code } = req.query;
  
  // 如果已经登录，直接显示主页
  if (req.session.userInfo) {
    return res.render('index', { 
      userInfo: req.session.userInfo,
      qrResults: req.session.qrResults || []
    });
  }
  
  // 如果有code参数，进行OAuth认证
  if (code) {
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return res.render('error', { message: '获取访问令牌失败' });
    }
    
    const userInfo = await getUserInfo(accessToken, code);
    if (!userInfo || !userInfo.UserId) {
      return res.render('error', { message: '获取用户信息失败' });
    }
    
    const userDetail = await getUserDetail(accessToken, userInfo.UserId);
    if (!userDetail) {
      return res.render('error', { message: '获取用户详细信息失败' });
    }
    
    // 保存用户信息到数据库
    try {
      await saveWecomUser(userDetail);
      console.log('用户信息已保存到数据库');
    } catch (dbError) {
      console.error('保存用户信息到数据库失败:', dbError);
      // 数据库操作失败不影响用户体验，继续处理
    }
    
    // 保存用户信息到会话
    req.session.userInfo = userDetail;
    req.session.accessToken = accessToken;
    
    // 从数据库获取用户的扫码历史记录
    let dbScanRecords = [];
    try {
      const result = await db.pool.query(
        'SELECT * FROM wecom.scan_records WHERE userid = $1 ORDER BY scan_time DESC LIMIT 10',
        [userDetail.userid]
      );
      dbScanRecords = result.rows.map(record => ({
        content: record.scan_result,
        timestamp: record.scan_time.toLocaleString(),
        type: record.scan_type,
        status: record.status
      }));
    } catch (dbError) {
      console.error('获取扫码历史记录失败:', dbError);
      // 获取历史记录失败不影响页面渲染
    }
    
    // 合并会话中的记录和数据库中的记录
    const sessionRecords = req.session.qrResults || [];
    const allRecords = [...sessionRecords];
    
    // 添加数据库记录，避免重复
    dbScanRecords.forEach(dbRecord => {
      // 检查是否已存在于会话记录中
      const exists = allRecords.some(r => r.content === dbRecord.content);
      if (!exists) {
        allRecords.push(dbRecord);
      }
    });
    
    // 按时间排序并限制数量
    allRecords.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedRecords = allRecords.slice(0, 20);
    
    return res.render('index', { 
      userInfo: userDetail,
      qrResults: limitedRecords
    });
  }
  
  // 如果没有code，重定向到企业微信授权页面
  const redirectUrl = encodeURIComponent(`${config.baseUrl}/`); 
  const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${config.corpid}&redirect_uri=${redirectUrl}&response_type=code&scope=snsapi_privateinfo&agentid=${config.agentid}&state=STATE#wechat_redirect`;
  
  res.redirect(authUrl);
});

// 登出路由
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// 处理二维码扫描
app.post('/scan-qr', upload.single('qrImage'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: '没有上传图片' });
  }
  
  try {
    const imagePath = req.file.path;
    const image = await loadImage(imagePath);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    
    // 删除上传的图片
    fs.unlinkSync(imagePath);
    
    if (code) {
      // 保存扫描结果
      if (!req.session.qrResults) {
        req.session.qrResults = [];
      }
      req.session.qrResults.unshift({
        content: code.data,
        timestamp: new Date().toLocaleString()
      });
      
      // 只保留最近10条记录
      if (req.session.qrResults.length > 10) {
        req.session.qrResults = req.session.qrResults.slice(0, 10);
      }
      
      // 保存扫码记录到数据库
      if (req.session.userInfo && req.session.userInfo.userid) {
        try {
          await recordScan(req.session.userInfo.userid, code.data);
          console.log('扫码记录已保存到数据库');
        } catch (dbError) {
          console.error('保存扫码记录到数据库失败:', dbError);
          // 数据库操作失败不影响用户体验，继续处理
        }
      }
      
      return res.json({ success: true, content: code.data });
    } else {
      return res.status(400).json({ success: false, message: '未能识别二维码' });
    }
  } catch (error) {
    console.error('处理二维码出错:', error);
    return res.status(500).json({ success: false, message: '处理二维码出错' });
  }
});

// 获取JSAPI配置
app.get('/get-jsapi-config', async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url || req.headers.referer || ''); 
    const accessToken = await getAccessToken();
    if (!accessToken) {
      return res.json({ success: false, message: '获取access_token失败' });
    }
    
    // 获取jsapi_ticket
    const ticketResponse = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/get_jsapi_ticket?access_token=${accessToken}`
    );
    
    if (ticketResponse.data.errcode !== 0) {
      return res.json({ success: false, message: '获取jsapi_ticket失败' });
    }
    
    const jsapiTicket = ticketResponse.data.ticket;
    const nonceStr = Math.random().toString(36).substr(2, 15);
    const timestamp = parseInt(new Date().getTime() / 1000);
    
    // 按字典序排序参数并拼接成字符串
    const string1 = `jsapi_ticket=${jsapiTicket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
    
    // 使用crypto模块计算签名
    const crypto = require('crypto');
    const signature = crypto.createHash('sha1').update(string1).digest('hex');
    
    res.json({
      success: true,
      config: {
        corpid: config.corpid,
        agentid: config.agentid,
        nonceStr,
        timestamp,
        signature,
        jsApiList: ['scanQRCode']
      }
    });
  } catch (error) {
    console.error('获取JSAPI配置出错:', error);
    res.json({ success: false, message: '获取JSAPI配置出错' });
  }
});

// 发送消息到企业微信机器人
async function sendToWechatRobot(content) {
  try {
    const webhookUrl = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=87229630-c634-4f68-8169-2b8cb9c65494';
    const message = {
      msgtype: 'text',
      text: {
        content: `扫描结果: ${content}`
      }
    };
    
    const response = await axios.post(webhookUrl, message);
    console.log('发送消息到企业微信机器人结果:', response.data);
    return response.data;
  } catch (error) {
    console.error('发送消息到企业微信机器人失败:', error);
    return null;
  }
}

// 处理微信扫码结果
app.post('/save-scan-result', async (req, res) => {
  const { content } = req.body;
  
  if (!content) {
    return res.json({ success: false, message: '未提供扫描内容' });
  }
  
  // 保存扫描结果
  if (!req.session.qrResults) {
    req.session.qrResults = [];
  }
  
  req.session.qrResults.unshift({
    content: content,
    timestamp: new Date().toLocaleString()
  });
  
  // 只保留最近10条记录
  if (req.session.qrResults.length > 10) {
    req.session.qrResults = req.session.qrResults.slice(0, 10);
  }
  
  // 保存扫码记录到数据库
  if (req.session.userInfo && req.session.userInfo.userid) {
    try {
      await recordScan(req.session.userInfo.userid, content);
      console.log('微信扫码记录已保存到数据库');
    } catch (dbError) {
      console.error('保存微信扫码记录到数据库失败:', dbError);
      // 数据库操作失败不影响用户体验，继续处理
    }
  }
  
  // 发送消息到企业微信机器人
  try {
    await sendToWechatRobot(content);
  } catch (error) {
    console.error('发送消息到企业微信机器人时出错:', error);
    // 即使发送失败，也继续返回成功，不影响用户体验
  }
  
  return res.json({ success: true });
});

// 获取用户扫码历史记录
app.get('/scan-history', async (req, res) => {
  if (!req.session.userInfo || !req.session.userInfo.userid) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  
  try {
    // 查询数据库中的扫码记录
    const result = await db.pool.query(
      'SELECT * FROM wecom.scan_records WHERE userid = $1 ORDER BY scan_time DESC LIMIT 50',
      [req.session.userInfo.userid]
    );
    
    return res.json({ 
      success: true, 
      records: result.rows.map(record => ({
        content: record.scan_result,
        timestamp: record.scan_time.toLocaleString(),
        type: record.scan_type,
        status: record.status
      }))
    });
  } catch (error) {
    console.error('获取扫码历史记录失败:', error);
    return res.status(500).json({ success: false, message: '获取扫码历史记录失败' });
  }
});

// 后台管理页面路由
app.get('/admin', async (req, res) => {
  // 检查用户是否已登录
  if (!req.session.userInfo) {
    return res.redirect('/');
  }
  
  try {
    // 获取分页参数
    const page = parseInt(req.query.page) || 1;
    const pageSize = 20;
    const offset = (page - 1) * pageSize;
    
    // 获取筛选参数
    let userId = req.query.userId || '';
    // 确保只使用userId部分作为查询条件（如果包含括号，提取括号中的内容）
    // if (userId && userId.includes('(') && userId.includes(')')) {
    //   const match = userId.match(/\(([^)]+)\)/);
    //   if (match && match[1]) {
    //     userId = match[1].trim();
    //   }
    // }
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const scanType = req.query.scanType || '';
    
    // 构建查询条件
    let queryConditions = [];
    let queryParams = [];
    let paramIndex = 1;
    
    if (userId) {
      queryConditions.push(`userid = $${paramIndex++}`);
      queryParams.push(userId);
    }
    
    if (startDate) {
      queryConditions.push(`scan_time >= $${paramIndex++}`);
      queryParams.push(new Date(startDate));
    }
    
    if (endDate) {
      // 将结束日期设置为当天的23:59:59
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      queryConditions.push(`scan_time <= $${paramIndex++}`);
      queryParams.push(endDateTime);
    }
    
    if (scanType) {
      queryConditions.push(`scan_type = $${paramIndex++}`);
      queryParams.push(scanType);
    }
    
    // 构建WHERE子句
    const whereClause = queryConditions.length > 0 ? `WHERE ${queryConditions.join(' AND ')}` : '';
    // 查询总记录数
    const countQuery = `SELECT COUNT(*) FROM wecom.scan_records ${whereClause}`;
    const countResult = await db.pool.query(countQuery, queryParams);
    const totalRecords = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRecords / pageSize);
    
    // 查询记录
    const recordsQuery = `
      SELECT sr.*, u.name as user_name 
      FROM wecom.scan_records sr 
      LEFT JOIN (select distinct userid as user_id,name from wecom.user_records) u ON sr.userid = u.user_id 
      ${whereClause} 
      ORDER BY sr.scan_time DESC 
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    console.log(`输出信息${recordsQuery}`);
    const recordsParams = [...queryParams, pageSize, offset];
    const recordsResult = await db.pool.query(recordsQuery, recordsParams);
    
    // 处理记录，添加用户信息
    const records = recordsResult.rows.map(record => {
      return {
        ...record,
        user: {
          name: record.user_name
        }
      };
    });
    
    // 获取去重的用户列表，用于用户ID下拉框
    const usersList = await db.getDistinctUsers();
    
    // 构建分页查询字符串
    let paginationQuery = '';
    if (userId) paginationQuery += `&userId=${encodeURIComponent(userId)}`;
    if (startDate) paginationQuery += `&startDate=${encodeURIComponent(startDate)}`;
    if (endDate) paginationQuery += `&endDate=${encodeURIComponent(endDate)}`;
    if (scanType) paginationQuery += `&scanType=${encodeURIComponent(scanType)}`;
    
    // 渲染管理页面
    res.render('admin', {
      userInfo: req.session.userInfo,
      records: records,
      currentPage: page,
      totalPages: totalPages,
      paginationQuery: paginationQuery,
      filters: {
        userId: userId,
        startDate: startDate,
        endDate: endDate,
        scanType: scanType
      },
      usersList: usersList // 传递用户列表到模板
    });
  } catch (error) {
    console.error('获取扫码记录失败:', error);
    res.render('error', { message: '获取扫码记录失败' });
  }
});

// 添加管理页面入口链接到首页
app.get('/admin-link', (req, res) => {
  if (!req.session.userInfo) {
    return res.redirect('/');
  }
  res.redirect('/admin');
});

app.listen(port, () => {
  console.log(`应用运行在 http://localhost:${port}`);
});