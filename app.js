const express = require('express');
const session = require('express-session');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

// 引入数据库模块
const db = require('./db');
const { saveWecomUser, recordScan, saveKingdeeOrder } = db;

const app = express();
const port = process.env.PORT || 27273;

// 企业微信配置
const config = {
  corpid: 'ww94fc58ff493578de',
  corpsecret: '8AQL--JfDHaVUsInPPVigiCYjXS63sLZ6Lz2uUwNh-U',
  agentid: '1000089',
  baseUrl: process.env.BASE_URL || 'http://ustar-test.tiremart.cn:27273', // 例如 'https://example.com' 或 'http://123.456.789.10:27273'
  robotKey: '87229630-c634-4f68-8169-2b8cb9c65494' // 企业微信机器人webhook key
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



// 配置axios默认设置，解决SSL协议问题
const https = require('https');
const axiosConfig = {
  httpsAgent: new https.Agent({
    rejectUnauthorized: false, // 忽略SSL证书验证
    secureProtocol: 'TLSv1_2_method' // 强制使用TLS 1.2
  }),
  timeout: 10000, // 10秒超时
  proxy: false // 禁用代理
};

// 获取访问令牌
async function getAccessToken() {
  try {
    const response = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corpid}&corpsecret=${config.corpsecret}`,
      axiosConfig
    );
    if (response.data.errcode === 0) {
      console.log('成功获取访问令牌');
      return response.data.access_token;
    } else {
      console.error('获取访问令牌失败:', response.data);
      return null;
    }
  } catch (error) {
    console.error('获取访问令牌出错:', error.message);
    // 如果是SSL错误，尝试使用HTTP（仅用于测试环境）
    if (error.code === 'EPROTO' || error.code === 'CERT_HAS_EXPIRED') {
      console.log('SSL错误，尝试其他解决方案...');
    }
    return null;
  }
}

// 获取用户信息
async function getUserInfo(accessToken, code) {
  try {
    const response = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/user/getuserinfo?access_token=${accessToken}&code=${code}`,
      axiosConfig
    );
    if (response.data.errcode === 0) {
      return response.data;
    } else {
      console.error('获取用户信息失败:', response.data);
      return null;
    }
  } catch (error) {
    console.error('获取用户信息出错:', error.message);
    return null;
  }
}

// 获取用户详细信息
async function getUserDetail(accessToken, userId) {
  try {
    const response = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/user/get?access_token=${accessToken}&userid=${userId}`,
      axiosConfig
    );
    if (response.data.errcode === 0) {
      console.log('获取用户详细信息成功:', response.data);
      return response.data;
    } else {
      console.error('获取用户详细信息失败:', response.data);
      return null;
    }
  } catch (error) {
    console.error('获取用户详细信息出错:', error.message);
    return null;
  }
}

// 主页路由
app.get('/', async (req, res) => {
  const { code } = req.query;
  
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
    
    // 从wecom.wework_users表获取用户的部门信息
    try {
      const userDbResult = await db.pool.query(
        'SELECT dept_id, dept_name FROM wecom.wework_users WHERE user_id = $1 LIMIT 1',
        [userDetail.userid]
      );
      if (userDbResult.rows.length > 0) {
        const deptInfo = userDbResult.rows[0];
        if (deptInfo.dept_name) {
          // 使用数据库中的部门名称信息
          userDetail.department = [deptInfo.dept_name];
          userDetail.dept_id = deptInfo.dept_id;
        }
      }
    } catch (dbError) {
      console.error('从wecom.wework_users获取用户部门信息失败:', dbError);
      // 获取部门信息失败不影响用户体验，继续使用企业微信返回的信息
    }

    // 保存用户信息到会话
    req.session.userInfo = userDetail;
    req.session.accessToken = accessToken;
    
    // 从数据库获取用户的最近10条扫码记录
    let userScanRecords = [];
    try {
      const recordsQuery = `
        SELECT sr.*, u.user_name,u.description, ko.items
        FROM wecom.scan_records sr 
        LEFT JOIN wecom.user_op u ON sr.userid = u.user_id 
        LEFT JOIN wecom.kingdee_orders ko ON sr.scan_result = ko.order_number
        WHERE sr.userid = $1 
        ORDER BY sr.scan_time DESC 
        LIMIT 10
      `;
      const recordsResult = await db.pool.query(recordsQuery, [userDetail.userid]);
      
      // 处理记录，添加用户信息、quantity信息并格式化为与原qrResults相同的结构
      userScanRecords = await Promise.all(recordsResult.rows.map(async record => {
        let totalQuantity = 0;
        
        // 从items字段中提取quantity信息
        if (record.items) {
          try {
            const items = typeof record.items === 'string' ? JSON.parse(record.items) : record.items;
            if (Array.isArray(items)) {
              // 计算所有明细项的数量总和
              totalQuantity = items.reduce((sum, item) => {
                const qty = parseFloat(item.FQty || item.quantity || 0);
                return sum + qty;
              }, 0);
            } else if (items.FQty || items.quantity) {
              // 单个订单项
              totalQuantity = parseFloat(items.FQty || items.quantity || 0);
            }
          } catch (error) {
            console.error('解析订单items失败:', error);
            totalQuantity = 0;
          }
        }
        
        // 计算同一订单同一用户的扫描次数和总次数
        let scanCount = 1;
        let totalScans = 1;
        if (record.scan_result && userDetail.userid) {
          try {
            // 获取当前记录的扫描顺序和总扫描次数
            const scanCountQuery = `
              WITH ranked_scans AS (
                SELECT id, ROW_NUMBER() OVER (ORDER BY scan_time ASC) as scan_order,
                       COUNT(*) OVER() as total_scans
                FROM wecom.scan_records 
                WHERE scan_result = $1 AND userid = $2
              )
              SELECT scan_order, total_scans
              FROM ranked_scans
              WHERE id = $3
            `;
            const scanCountResult = await db.pool.query(scanCountQuery, [record.scan_result, userDetail.userid, record.id]);
            if (scanCountResult.rows.length > 0) {
              scanCount = parseInt(scanCountResult.rows[0].scan_order) || 1;
              totalScans = parseInt(scanCountResult.rows[0].total_scans) || 1;
            }
          } catch (error) {
            console.error('计算扫描次数失败:', error);
            scanCount = 1;
            totalScans = 1;
          }
        }
        
        // 构建状态信息：岗位名+扫描状态
         const positionName = record.description || '岗位';
         let scanStatus;
         if (scanCount === 1) {
           scanStatus = '(开始)';
         } else if (scanCount === totalScans) {
           scanStatus = '(结束)';
         } else {
           scanStatus = `(${scanCount})`;
         }
         const statusInfo = `${positionName}${scanStatus}`;
        
        return {
          content: record.scan_result,
          timestamp: record.scan_time.toLocaleString('zh-CN'),
          type: record.scan_type,
          status: statusInfo,
          quantity: totalQuantity,
          user: {
            name: record.user_name
          }
        };
      }));
    } catch (dbError) {
      console.error('获取用户扫码记录失败:', dbError);
      // 获取记录失败不影响页面渲染，使用空数组
    }

    return res.render('index', { 
      userInfo: userDetail,
      qrResults: userScanRecords
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

// 获取扫描记录API
app.get('/get-scan-results', async (req, res) => {
  // 检查用户登录状态
  if (!req.session.userInfo || !req.session.userInfo.userid) {
    return res.status(401).json({ success: false, message: '未登录' });
  }

  try {
    const recordsQuery = `
      SELECT sr.*, u.user_name,u.description, ko.items
      FROM wecom.scan_records sr 
      LEFT JOIN wecom.user_op u ON sr.userid = u.user_id 
      LEFT JOIN wecom.kingdee_orders ko ON sr.scan_result = ko.order_number
      WHERE sr.userid = $1 
      ORDER BY sr.scan_time DESC 
      LIMIT 10
    `;
    const recordsResult = await db.pool.query(recordsQuery, [req.session.userInfo.userid]);
    
    // 处理记录，添加用户信息、quantity信息并格式化为与原qrResults相同的结构
    const userScanRecords = await Promise.all(recordsResult.rows.map(async record => {
      let totalQuantity = 0;
      
      // 从items字段中提取quantity信息
      if (record.items) {
        try {
          const items = typeof record.items === 'string' ? JSON.parse(record.items) : record.items;
          if (Array.isArray(items)) {
            // 计算所有明细项的数量总和
            totalQuantity = items.reduce((sum, item) => {
              const qty = parseFloat(item.FQty || item.quantity || 0);
              return sum + qty;
            }, 0);
          } else if (items.FQty || items.quantity) {
            // 单个订单项
            totalQuantity = parseFloat(items.FQty || items.quantity || 0);
          }
        } catch (error) {
          console.error('解析订单items失败:', error);
          totalQuantity = 0;
        }
      }
      
      // 计算同一订单同一用户的扫描次数和总次数
      let scanCount = 1;
      let totalScans = 1;
      if (record.scan_result && req.session.userInfo.userid) {
        try {
          // 获取当前记录的扫描顺序和总扫描次数
          const scanCountQuery = `
            WITH ranked_scans AS (
              SELECT id, ROW_NUMBER() OVER (ORDER BY scan_time ASC) as scan_order,
                     COUNT(*) OVER() as total_scans
              FROM wecom.scan_records 
              WHERE scan_result = $1 AND userid = $2
            )
            SELECT scan_order, total_scans
            FROM ranked_scans
            WHERE id = $3
          `;
          const scanCountResult = await db.pool.query(scanCountQuery, [record.scan_result, req.session.userInfo.userid, record.id]);
          if (scanCountResult.rows.length > 0) {
            scanCount = parseInt(scanCountResult.rows[0].scan_order) || 1;
            totalScans = parseInt(scanCountResult.rows[0].total_scans) || 1;
          }
        } catch (error) {
          console.error('计算扫描次数失败:', error);
          scanCount = 1;
          totalScans = 1;
        }
      }
      
      // 构建状态信息：岗位名+扫描状态
      const positionName = record.description || '岗位';
      let scanStatus;
      if (scanCount === 1) {
        scanStatus = '(开始)';
      } else if (scanCount === totalScans) {
        scanStatus = '(结束)';
      } else {
        scanStatus = `(${scanCount})`;
      }
      const statusInfo = `${positionName}${scanStatus}`;
      
      return {
        content: record.scan_result,
        timestamp: record.scan_time.toLocaleString('zh-CN'),
        type: record.scan_type,
        status: statusInfo,
        quantity: totalQuantity,
        user: {
          name: record.user_name
        }
      };
    }));

    res.json({ success: true, results: userScanRecords });
  } catch (error) {
    console.error('获取扫描记录失败:', error);
    res.status(500).json({ success: false, message: '获取扫描记录失败' });
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
      `https://qyapi.weixin.qq.com/cgi-bin/get_jsapi_ticket?access_token=${accessToken}`,
      axiosConfig
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

/**
 * 发送消息到企业微信机器人
 * @param {string} orderNumber - 订单号
 * @returns {Promise<Object|null>} 发送结果
 */
async function sendToWechatRobot(orderNumber) {
  try {
    const webhookUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${config.robotKey}`;
    
    // 从数据库查询订单信息
    const orderQuery = `
      SELECT order_number, customer_name, total_amount, currency, 
             order_date, delivery_date, status, items
      FROM wecom.kingdee_orders 
      WHERE order_number = $1
    `;
    
    const orderResult = await db.pool.query(orderQuery, [orderNumber]);
    
    // 查询流转岗位信息 - 通过订单号和扫码时间获取最新的岗位信息，包含扫描次数
    const positionQuery = `
      SELECT COALESCE(u.description, '岗位') as description, sr.userid, sr.scan_time, sr.id
      FROM wecom.scan_records sr 
      LEFT JOIN wecom.user_op u ON sr.userid = u.user_id 
      WHERE sr.scan_result = $1 
      ORDER BY sr.scan_time DESC 
      LIMIT 1
    `;
    
    const positionResult = await db.pool.query(positionQuery, [orderNumber]);
    let currentPositionWithCount = '';
    
    if (positionResult.rows.length > 0) {
      const latestRecord = positionResult.rows[0];
      const positionName = latestRecord.description;
      
      // 查询该用户对该订单的扫描次数和总扫描次数（与/get-scan-results API保持一致的计算逻辑）
      const scanCountQuery = `
        WITH ranked_scans AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY scan_time ASC) as scan_order,
                 COUNT(*) OVER() as total_scans
          FROM wecom.scan_records 
          WHERE scan_result = $1 AND userid = $2
        )
        SELECT scan_order, total_scans
        FROM ranked_scans
        WHERE id = $3
      `;
      
      const scanCountResult = await db.pool.query(scanCountQuery, [orderNumber, latestRecord.userid, latestRecord.id]);
      
      if (scanCountResult.rows.length > 0) {
        const scanCount = parseInt(scanCountResult.rows[0].scan_order) || 1;
        const totalScans = parseInt(scanCountResult.rows[0].total_scans) || 1;
        
        // 构建状态信息：岗位名+扫描状态
        let scanStatus;
        if (scanCount === 1) {
          scanStatus = '(开始)';
        } else if (scanCount === totalScans) {
          scanStatus = '(结束)';
        } else {
          scanStatus = `(${scanCount})`;
        }
        
        currentPositionWithCount = `${positionName}${scanStatus}`;
      } else {
        currentPositionWithCount = positionName;
      }
    }
    
    let messageContent;
    if (orderResult.rows.length > 0) {
      const order = orderResult.rows[0];
      
      // 解析商品信息和其他订单详情
      let brandName = '';
      let salesPerson = '';
      let deliveryMethod = '';
      
      try {
        const items = order.items;
        if (Array.isArray(items) && items.length > 0) {
          // 获取第一个商品的信息作为主要商品
          const firstItem = items[0];
          
          // 根据实际数据库字段提取信息
          brandName = firstItem['F_BRANDID'] || '';
          
          // 提取销售员信息，包含部门名称
          const salesPersonName = firstItem['FSalerId.FName'] || '';
          const salesDeptName = firstItem['FSaleDeptId.FName'] || '';
          
          // 如果有部门信息，则在销售员名字前添加部门名称
          if (salesDeptName && salesPersonName) {
            salesPerson = `${salesDeptName}-${salesPersonName}`;
          } else {
            salesPerson = salesPersonName;
          }
          
          deliveryMethod = firstItem['FHeadDeliveryWay.FDataValue'] || '';
        }
      } catch (e) {
        console.error('解析订单明细失败:', e);
      }
      
      // 格式化消息内容为markdown样式，固定内容黑色，动态内容彩色，增加流转岗位字段
      messageContent = `您有新的订单流转，请相关同事关注\n\n订单编号: <font color="#FF8C00">${order.order_number}</font>\n\n商户名称: <font color="#32CD32">${order.customer_name || ''}</font>\n\n配送方式: <font color="#32CD32">${deliveryMethod}</font>\n\n品牌: <font color="#32CD32">${brandName}</font>\n\n销售员: <font color="#32CD32">${salesPerson}</font>\n\n流转岗位: <font color="#32CD32">${currentPositionWithCount}</font>`;
    } else {
      // 如果数据库中没有找到订单信息，返回基本格式但不包含硬编码数据
      messageContent = `您有新的订单流转，请相关同事关注\n\n订单编号: <font color="#FF8C00">${orderNumber}</font>\n\n商户名称: \n\n配送方式: \n\n品牌: \n\n销售员: \n\n流转岗位: <font color="#32CD32">${currentPositionWithCount}</font>`;
    }
    
    const message = {
      msgtype: 'markdown',
      markdown: {
        content: messageContent
      }
    };
    
    const response = await axios.post(webhookUrl, message, axiosConfig);
    console.log('发送消息到企业微信机器人结果:', response.data);
    return response.data;
  } catch (error) {
    console.error('发送消息到企业微信机器人失败:', error);
    return null;
  }
}

/**
 * 从金蝶接口获取订单信息
 * @param {string} orderNumber - 订单号
 * @returns {Promise<Object|null>} 订单数据或null
 */
async function fetchOrderFromKingdee(orderNumber) {
  try {
    console.log('调用金蝶接口获取订单信息:', orderNumber);
    
    const response = await axios.get(`http://localhost:8000/kingdee/order/list?number=${orderNumber}`, {
      timeout: 15000, // 15秒超时
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    console.log('金蝶接口响应状态:', response.status);
    console.log('金蝶接口响应头:', response.headers);
    console.log('金蝶接口返回数据类型:', typeof response.data);
    console.log('金蝶接口返回数据长度:', response.data ? response.data.length : 0);
    
    // 检查响应是否为HTML（错误页面）
    if (typeof response.data === 'string' && response.data.includes('<html>')) {
      console.error('金蝶接口返回HTML页面，可能是错误页面或接口不可用');
      console.log('HTML内容前100字符:', response.data.substring(0, 100));
      return null;
    }
    
    // 检查是否为有效的JSON数据
    if (response.status === 200 && response.data) {
      // 如果返回的是字符串，尝试解析为JSON
      let parsedData = response.data;
      if (typeof response.data === 'string') {
        try {
          parsedData = JSON.parse(response.data);
        } catch (parseError) {
          console.error('解析JSON失败:', parseError.message);
          console.log('原始数据:', response.data.substring(0, 200));
          return null;
        }
      }
      
      console.log('成功获取订单数据:', JSON.stringify(parsedData, null, 2));
      return parsedData;
    } else {
      console.log('金蝶接口返回失败，状态码:', response.status);
      return null;
    }
  } catch (error) {
    console.error('调用金蝶接口失败:', error.message);
    if (error.response) {
      console.error('错误响应状态:', error.response.status);
      console.error('错误响应数据:', error.response.data);
    }
    return null;
  }
}

/**
 * 处理订单数据并保存到数据库
 * @param {Array|Object} orderData - 从金蝶接口获取的订单数据（可能是数组或单个对象）
 * @param {string} userid - 用户ID
 * @returns {Promise<Array|Object|null>} 保存的订单记录或null
 */
/**
 * 处理并保存金蝶订单数据
 * @param {Array|Object} orderData - 金蝶接口返回的订单数据
 * @param {string} userid - 用户ID
 * @returns {Object|null} 保存的订单数据
 */
/**
 * 处理并保存订单数据
 * @param {Object|Array} orderData - 从金蝶接口获取的订单数据
 * @param {string} userid - 用户ID
 * @param {string} scannedOrderNumber - 扫描得到的订单号，用于校验
 * @returns {Object|null} 保存的订单数据或null
 */
async function processAndSaveOrder(orderData, userid, scannedOrderNumber = null) {
  try {
    // 检查返回的数据格式
    if (!orderData) {
      console.log('订单数据为空');
      return null;
    }

    // 校验扫描的订单号是否在接口返回的数据中存在
    if (scannedOrderNumber) {
      let orderNumberFound = false;
      
      if (Array.isArray(orderData)) {
        // 如果是数组，检查第一条记录的订单号
        if (orderData.length > 0) {
          const firstItem = orderData[0];
          const apiOrderNumber = firstItem.FBillNo || firstItem.order_number;
          orderNumberFound = apiOrderNumber === scannedOrderNumber;
        }
      } else {
        // 如果是单个对象，检查订单号
        const apiOrderNumber = orderData.FBillNo || orderData.order_number;
        orderNumberFound = apiOrderNumber === scannedOrderNumber;
      }
      
      if (!orderNumberFound) {
        console.log('扫描的订单号与接口返回的订单号不匹配:', scannedOrderNumber);
        throw new Error('订单号不匹配：扫描的订单号在接口数据中不存在');
      }
    }

    // 如果返回的是数组，将所有项作为一个订单的明细项处理
    if (Array.isArray(orderData)) {
      console.log('处理数组格式的订单数据，共', orderData.length, '条明细记录');
      
      if (orderData.length === 0) {
        console.log('订单明细数组为空');
        return null;
      }
      
      // 使用第一条记录的订单头信息
      const firstItem = orderData[0];
      
      // 计算订单总金额（所有明细项金额之和）
      const totalAmount = orderData.reduce((sum, item) => {
        return sum + parseFloat(item.FAmount || item.total_amount || 0);
      }, 0);
      
      // 根据金蝶接口实际返回的字段进行映射
      const salesOrderData = {
        order_number: firstItem.FBillNo || 'N/A',
        customer_name: firstItem['FCustId.FName'] || firstItem['FCustId.FShortName'] || firstItem.FCustName || 'N/A',
        customer_code: firstItem['FCustId.FNumber'] || firstItem.FCustCode || 'N/A',
        order_date: firstItem.FDate ? firstItem.FDate.split('T')[0] : new Date().toISOString().split('T')[0],
        delivery_date: firstItem.FDeliveryDate ? firstItem.FDeliveryDate.split('T')[0] : null,
        total_amount: totalAmount,
        currency: firstItem.FCurrency || 'CNY',
        status: firstItem.FDocumentStatus || firstItem.FStatus || 'pending',
        items: orderData, // 将完整的明细项数组作为items保存
        created_by: userid
      };
      
      console.log('准备保存订单，订单号:', salesOrderData.order_number, '明细项数量:', orderData.length);
      const savedOrder = await saveKingdeeOrder(salesOrderData);
      console.log('金蝶订单已保存，包含', orderData.length, '条明细项');
      return savedOrder;
      
    } else {
      // 处理单个订单对象
      const salesOrderData = {
        order_number: orderData.FBillNo || 'N/A',
        customer_name: orderData['FCustId.FName'] || orderData['FCustId.FShortName'] || orderData.FCustName || 'N/A',
        customer_code: orderData['FCustId.FNumber'] || orderData.FCustCode || 'N/A',
        order_date: orderData.FDate ? orderData.FDate.split('T')[0] : new Date().toISOString().split('T')[0],
        delivery_date: orderData.FDeliveryDate ? orderData.FDeliveryDate.split('T')[0] : null,
        total_amount: parseFloat(orderData.FAmount || orderData.total_amount || 0),
        currency: orderData.FCurrency || 'CNY',
        status: orderData.FDocumentStatus || orderData.FStatus || 'pending',
        items: [orderData], // 将单个对象包装成数组作为items保存
        created_by: userid
      };
      
      const savedOrder = await saveKingdeeOrder(salesOrderData);
      console.log('金蝶订单信息已保存到数据库:', savedOrder);
      return savedOrder;
    }
  } catch (error) {
    if (error.message && error.message.includes('订单号不匹配')) {
      // 订单号不匹配是正常的业务逻辑，只记录信息级别的日志
      console.log('订单号不匹配:', error.message);
    } else {
      // 其他错误才记录为错误级别
      console.error('处理并保存订单数据失败:', error);
      console.error('原始数据:', orderData);
    }
    // 重新抛出错误，让调用方能够正确处理
    throw error;
  }
}

// 处理微信扫码结果
app.post('/save-scan-result', async (req, res) => {
  const { content, scanType } = req.body;
  
  if (!content) {
    return res.json({ success: false, message: '未提供扫描内容' });
  }
  
  // 注释：扫描结果将在数据库保存成功后通过重新查询获取，不再使用session存储
  
  // 检查用户登录状态
  if (!req.session.userInfo || !req.session.userInfo.userid) {
    return res.status(401).json({ success: false, message: '未登录' });
  }
  
  // 根据订单号调用金蝶接口获取订单信息
  const orderData = await fetchOrderFromKingdee(content);
  let scanStatus = '失败'; // 默认为失败状态
  let responseData = { success: false };
  
  if (!orderData) {
    console.log('未能从金蝶接口获取到订单信息');
    scanStatus = '失败';
    responseData = { 
      success: false, 
      message: '扫描错误：订单不存在',
      error_type: 'order_not_found',
      scanned_order: content
    };
  } else {
    // 处理订单数据
    try {
      const savedOrder = await processAndSaveOrder(orderData, req.session.userInfo.userid, content);
      if (!savedOrder) {
        scanStatus = '失败';
        responseData = { 
          success: false, 
          message: '订单处理失败',
          error_type: 'processing_error'
        };
      } else {
        console.log('订单信息获取并保存成功');
        scanStatus = '成功'; // 订单匹配成功
        responseData = { success: true };
        
        // 只有在订单处理完全成功时才发送消息到企业微信机器人
        try {
          await sendToWechatRobot(content);
        } catch (error) {
          console.error('发送消息到企业微信机器人时出错:', error);
          // 即使发送失败，也继续返回成功，不影响用户体验
        }
      }
    } catch (orderError) {
      scanStatus = '失败';
      if (orderError.message.includes('订单号不匹配')) {
        // 订单号不匹配是正常的业务逻辑，只记录信息级别的日志
        console.log('订单号不匹配:', orderError.message);
        responseData = { 
          success: false, 
          message: '扫描错误：订单号不匹配',
          error_type: 'order_mismatch',
          scanned_order: content
        };
      } else {
        // 其他错误才记录为错误级别
        console.error('处理订单数据失败:', orderError.message);
        responseData = { 
          success: false, 
          message: '处理订单数据失败: ' + orderError.message,
          error_type: 'processing_error'
        };
      }
    }
  }
  
  // 保存扫码记录到数据库，根据订单匹配情况设置状态
  try {
    const finalScanType = scanType || 'qrcode'; // 如果前端没有传递scanType，默认为qrcode
    await recordScan(req.session.userInfo.userid, content, scanStatus, finalScanType);
    console.log(`微信扫码记录已保存到数据库，状态：${scanStatus}，类型：${finalScanType}`);
  } catch (dbError) {
    console.error('保存微信扫码记录到数据库失败:', dbError);
    // 数据库操作失败不影响用户体验，继续处理
  }
  
  return res.json(responseData);
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
        timestamp: record.scan_time.toLocaleString('zh-CN'),
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
    const userId = req.query.userId || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const orderNumber = req.query.orderNumber || '';
    
    // 检查是否有任何筛选参数，如果没有则使用默认值，否则保持用户选择
    const hasAnyFilter = req.query.userId || req.query.startDate || req.query.endDate || req.query.orderNumber || req.query.status !== undefined || req.query.isValid !== undefined;
    
    // 只有在首次访问（没有任何筛选参数）时才使用默认值
    const status = hasAnyFilter ? (req.query.status || '') : 'success';
    const isValid = hasAnyFilter ? (req.query.isValid || '') : 'valid';
    
    // 构建查询条件
    let queryConditions = [];
    let queryParams = [];
    let paramIndex = 1;
    
    if (userId) {
      // 支持按用户ID或用户名进行模糊查找
      queryConditions.push(`(
        sr.userid ILIKE $${paramIndex++} 
        OR EXISTS (
          SELECT 1 FROM wecom.user_op u3 
          WHERE u3.user_id = sr.userid 
          AND u3.user_name ILIKE $${paramIndex++}
        )
      )`);
      queryParams.push(`%${userId}%`);
      queryParams.push(`%${userId}%`);
    }
    
    if (startDate) {
      queryConditions.push(`sr.scan_time >= $${paramIndex++}`);
      queryParams.push(new Date(startDate));
    }
    
    if (endDate) {
      // 将结束日期设置为当天的23:59:59
      const endDateTime = new Date(endDate);
      endDateTime.setHours(23, 59, 59, 999);
      queryConditions.push(`sr.scan_time <= $${paramIndex++}`);
      queryParams.push(endDateTime);
    }
    
    if (orderNumber) {
      queryConditions.push(`sr.scan_result ILIKE $${paramIndex++}`);
      queryParams.push(`%${orderNumber}%`);
    }
    
    if (status) {
      // 支持中文和英文状态值
      if (status === 'success') {
        queryConditions.push(`(sr.status = $${paramIndex++} OR sr.status = $${paramIndex++})`);
        queryParams.push('成功');
        queryParams.push('success');
      } else if (status === 'failed') {
        queryConditions.push(`(sr.status = $${paramIndex++} OR sr.status = $${paramIndex++})`);
        queryParams.push('失败');
        queryParams.push('failed');
      }
    }
    
    // 处理是否有效筛选
    if (isValid) {
      if (isValid === 'valid') {
        // 有效：扫描次数为'开始'或'结束'的数据，且用户岗位不为空
        // 需要通过子查询来判断是否为第一次或最后一次扫描，并且用户有岗位信息
        queryConditions.push(`(
          (
            sr.id IN (
              SELECT DISTINCT first_scan.id
              FROM (
                SELECT id, scan_result, userid,
                       ROW_NUMBER() OVER (PARTITION BY scan_result, userid ORDER BY scan_time ASC) as first_rank
                FROM wecom.scan_records
              ) first_scan
              WHERE first_scan.first_rank = 1
            )
            OR
            sr.id IN (
              SELECT DISTINCT last_scan.id
              FROM (
                SELECT id, scan_result, userid,
                       ROW_NUMBER() OVER (PARTITION BY scan_result, userid ORDER BY scan_time DESC) as last_rank
                FROM wecom.scan_records
              ) last_scan
              WHERE last_scan.last_rank = 1
            )
          )
          AND EXISTS (
            SELECT 1 FROM wecom.user_op u2 
            WHERE u2.user_id = sr.userid
          )
        )`);
      } else if (isValid === 'invalid') {
        // 无效：不是第一次也不是最后一次扫描的数据，或者用户岗位为空
        queryConditions.push(`(
          (
            sr.id NOT IN (
              SELECT DISTINCT first_scan.id
              FROM (
                SELECT id, scan_result, userid,
                       ROW_NUMBER() OVER (PARTITION BY scan_result, userid ORDER BY scan_time ASC) as first_rank
                FROM wecom.scan_records
              ) first_scan
              WHERE first_scan.first_rank = 1
            )
            AND
            sr.id NOT IN (
              SELECT DISTINCT last_scan.id
              FROM (
                SELECT id, scan_result, userid,
                       ROW_NUMBER() OVER (PARTITION BY scan_result, userid ORDER BY scan_time DESC) as last_rank
                FROM wecom.scan_records
              ) last_scan
              WHERE last_scan.last_rank = 1
            )
          )
          OR NOT EXISTS (
            SELECT 1 FROM wecom.user_op u2 
            WHERE u2.user_id = sr.userid
          )
        )`);
      }
    }
    
    // 构建WHERE子句
    const whereClause = queryConditions.length > 0 ? `WHERE ${queryConditions.join(' AND ')}` : '';
    // 查询总记录数
    const countQuery = `SELECT COUNT(*) FROM wecom.scan_records sr ${whereClause}`;
    const countResult = await db.pool.query(countQuery, queryParams);
    const totalRecords = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRecords / pageSize);
    
    // 查询记录，关联kingdee_orders表获取quantity信息
    const recordsQuery = `
      SELECT sr.*, u.user_name,u.description, ko.items
      FROM wecom.scan_records sr 
      LEFT JOIN wecom.user_op u ON sr.userid = u.user_id 
      LEFT JOIN wecom.kingdee_orders ko ON sr.scan_result = ko.order_number
      ${whereClause} 
      ORDER BY sr.scan_time DESC 
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const recordsParams = [...queryParams, pageSize, offset];
    const recordsResult = await db.pool.query(recordsQuery, recordsParams);
    
    // 处理记录，添加用户信息和quantity信息
    const records = await Promise.all(recordsResult.rows.map(async record => {
      let totalQuantity = 0;
      
      // 从items字段中提取quantity信息
      if (record.items) {
        try {
          const items = typeof record.items === 'string' ? JSON.parse(record.items) : record.items;
          if (Array.isArray(items)) {
            // 计算所有明细项的数量总和
            totalQuantity = items.reduce((sum, item) => {
              const qty = parseFloat(item.FQty || item.quantity || 0);
              return sum + qty;
            }, 0);
          } else if (items.FQty || items.quantity) {
            // 单个订单项
            totalQuantity = parseFloat(items.FQty || items.quantity || 0);
          }
        } catch (error) {
          console.error('解析订单items失败:', error);
          totalQuantity = 0;
        }
      }
      
      // 计算同一订单同一用户的扫描次数和总次数
      let scanCount = 1;
      let totalScans = 1;
      if (record.scan_result && record.userid) {
        try {
          // 获取当前记录的扫描顺序和总扫描次数
          const scanCountQuery = `
            WITH ranked_scans AS (
              SELECT id, ROW_NUMBER() OVER (ORDER BY scan_time ASC) as scan_order,
                     COUNT(*) OVER() as total_scans
              FROM wecom.scan_records 
              WHERE scan_result = $1 AND userid = $2
            )
            SELECT scan_order, total_scans
            FROM ranked_scans
            WHERE id = $3
          `;
          const scanCountResult = await db.pool.query(scanCountQuery, [record.scan_result, record.userid, record.id]);
          if (scanCountResult.rows.length > 0) {
            scanCount = parseInt(scanCountResult.rows[0].scan_order) || 1;
            totalScans = parseInt(scanCountResult.rows[0].total_scans) || 1;
          }
        } catch (error) {
          console.error('计算扫描次数失败:', error);
          scanCount = 1;
          totalScans = 1;
        }
      }
      
      // 构建扫描状态显示
      let scanStatus;
      if (scanCount === 1) {
        scanStatus = '开始';
      } else if (scanCount === totalScans) {
        scanStatus = '结束';
      } else {
        scanStatus = scanCount.toString();
      }
      
      return {
        ...record,
        user: {
          name: record.user_name,
          description: record.description,
          positionWithCount: record.description ? `${record.description}(${scanStatus})` : `岗位(${scanStatus})`
        },
        quantity: totalQuantity,
        scanCount: scanCount,
        scanStatus: scanStatus
      };
    }));
    
    // 获取去重的用户列表，用于用户ID下拉框
    const usersList = await db.getDistinctUsers();
    
    // 获取去重的订单号列表，用于订单号下拉框
    const ordersListQuery = `
      SELECT DISTINCT scan_result as order_number 
      FROM wecom.scan_records 
      WHERE scan_result IS NOT NULL AND scan_result != '' 
      ORDER BY scan_result
    `;
    const ordersListResult = await db.pool.query(ordersListQuery);
    const ordersList = ordersListResult.rows;
    
    // 构建分页查询字符串
    let paginationQuery = '';
    if (userId) paginationQuery += `&userId=${encodeURIComponent(userId)}`;
    if (startDate) paginationQuery += `&startDate=${encodeURIComponent(startDate)}`;
    if (endDate) paginationQuery += `&endDate=${encodeURIComponent(endDate)}`;
    if (orderNumber) paginationQuery += `&orderNumber=${encodeURIComponent(orderNumber)}`;
    if (status) paginationQuery += `&status=${encodeURIComponent(status)}`;
    if (isValid) paginationQuery += `&isValid=${encodeURIComponent(isValid)}`;
    
    // 计算分页显示范围
    const maxPagesToShow = 5; // 最多显示5个页码
    let startPage = Math.max(1, page - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    
    // 如果结束页码不足，调整开始页码
    if (endPage - startPage + 1 < maxPagesToShow) {
      startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    // 渲染管理页面
    res.render('admin', {
      userInfo: req.session.userInfo,
      records: records,
      currentPage: page,
      totalPages: totalPages,
      totalRecords: totalRecords,
      queryParams: paginationQuery,
      startPage: startPage,
      endPage: endPage,
      filters: {
        userId: userId,
        startDate: startDate,
        endDate: endDate,
        orderNumber: orderNumber,
        status: status,
        isValid: isValid
      },
      usersList: usersList, // 传递用户列表到模板
      ordersList: ordersList // 传递订单列表到模板
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

/**
 * 检查用户是否有删除权限
 * @param {string} userId - 用户ID
 * @returns {Promise<boolean>} 是否有删除权限
 */
async function checkDeletePermission(userId) {
  try {
    // 获取删除权限配置
    const configResult = await db.pool.query(
      'SELECT config_value FROM wecom.configs WHERE config_key = $1',
      ['delete']
    );
    
    if (configResult.rows.length === 0) {
      console.log('未找到删除权限配置');
      return false;
    }
    
    const permissionRegex = configResult.rows[0].config_value;
    console.log('删除权限正则表达式:', permissionRegex);
    
    // 获取用户信息
    const userResult = await db.pool.query(
      'SELECT user_name FROM wecom.wework_users WHERE user_id = $1',
      [userId]
    );
    
    if (userResult.rows.length === 0) {
      console.log('未找到用户信息:', userId);
      return false;
    }
    
    const userName = userResult.rows[0].user_name;
    console.log('检查用户权限:', userId, userName);
    
    // 获取用户岗位信息
    const positionResult = await db.pool.query(
      'SELECT description FROM wecom.user_op WHERE user_id = $1',
      [userId]
    );
    
    const userPosition = positionResult.rows.length > 0 ? positionResult.rows[0].description : '';
    console.log('用户岗位:', userPosition);
    
    // 创建正则表达式对象
    const regex = new RegExp(permissionRegex);
    
    // 检查用户ID、用户名或岗位是否匹配权限正则
    const hasPermission = regex.test(userId) || regex.test(userName) || (userPosition && regex.test(userPosition));
    
    console.log('权限检查结果:', hasPermission);
    return hasPermission;
    
  } catch (error) {
    console.error('检查删除权限失败:', error);
    return false;
  }
}

// 删除扫码记录接口
app.post('/admin/delete-record', async (req, res) => {
  try {
    // 检查用户登录状态
    if (!req.session.userInfo || !req.session.userInfo.userid) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    // 检查删除权限
    const hasDeletePermission = await checkDeletePermission(req.session.userInfo.userid);
    if (!hasDeletePermission) {
      return res.status(403).json({ success: false, message: '您没有删除权限' });
    }

    const { recordId, userId, scanTime } = req.body;
    
    if (!recordId && (!userId || !scanTime)) {
      return res.json({ success: false, message: '缺少必要的删除参数' });
    }

    // 构建删除条件
    let deleteQuery;
    let deleteParams;
    
    if (recordId) {
      // 如果有recordId，直接根据ID删除
      deleteQuery = 'DELETE FROM wecom.scan_records WHERE id = $1';
      deleteParams = [recordId];
    } else {
      // 否则根据用户ID和扫码时间删除
      deleteQuery = 'DELETE FROM wecom.scan_records WHERE user_id = $1 AND scan_time = $2';
      deleteParams = [userId, scanTime];
    }

    const result = await db.pool.query(deleteQuery, deleteParams);
    
    if (result.rowCount > 0) {
      console.log(`删除扫码记录成功，删除了 ${result.rowCount} 条记录`);
      res.json({ success: true, message: '记录删除成功' });
    } else {
      res.json({ success: false, message: '未找到要删除的记录' });
    }
    
  } catch (error) {
    console.error('删除扫码记录失败:', error);
    res.status(500).json({ success: false, message: '删除失败，请重试' });
  }
});

// 检查删除权限接口
app.get('/admin/check-delete-permission', async (req, res) => {
  try {
    // 检查用户登录状态
    if (!req.session.userInfo || !req.session.userInfo.userid) {
      return res.status(401).json({ success: false, message: '未登录' });
    }

    // 检查删除权限
    const hasDeletePermission = await checkDeletePermission(req.session.userInfo.userid);
    
    res.json({ 
      success: true, 
      hasPermission: hasDeletePermission,
      userId: req.session.userInfo.userid
    });
    
  } catch (error) {
    console.error('检查删除权限失败:', error);
    res.status(500).json({ success: false, message: '检查权限失败' });
  }
});

app.listen(port, () => {
  console.log(`应用运行在 http://localhost:${port}`);
});