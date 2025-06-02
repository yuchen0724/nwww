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
  baseUrl: process.env.BASE_URL || 'http://ustar-test.tiremart.cn:27273' // 例如 'https://example.com' 或 'http://123.456.789.10:27273'
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
        SELECT sr.*, u.user_name, ko.items
        FROM wecom.scan_records sr 
        LEFT JOIN (select distinct user_id,user_name from wecom.wework_users) u ON sr.userid = u.user_id 
        LEFT JOIN wecom.kingdee_orders ko ON sr.scan_result = ko.order_number
        WHERE sr.userid = $1 
        ORDER BY sr.scan_time DESC 
        LIMIT 10
      `;
      const recordsResult = await db.pool.query(recordsQuery, [userDetail.userid]);
      
      // 处理记录，添加用户信息、quantity信息并格式化为与原qrResults相同的结构
      userScanRecords = recordsResult.rows.map(record => {
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
        
        return {
          content: record.scan_result,
          timestamp: record.scan_time.toLocaleString('zh-CN'),
          type: record.scan_type,
          status: record.status,
          quantity: totalQuantity,
          user: {
            name: record.user_name
          }
        };
      });
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
    console.error('处理并保存订单数据失败:', error);
    console.error('原始数据:', orderData);
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
  
  // 保存扫描结果
  if (!req.session.qrResults) {
    req.session.qrResults = [];
  }
  
  req.session.qrResults.unshift({
    content: content,
    timestamp: new Date().toLocaleString('zh-CN')
  });
  
  // 只保留最近10条记录
  if (req.session.qrResults.length > 10) {
    req.session.qrResults = req.session.qrResults.slice(0, 10);
  }
  
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
      console.error('处理订单数据失败:', orderError.message);
      scanStatus = '失败';
      if (orderError.message.includes('订单号不匹配')) {
        responseData = { 
          success: false, 
          message: '扫描错误：订单号不匹配',
          error_type: 'order_mismatch',
          scanned_order: content
        };
      } else {
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
    // 默认筛选成功记录，除非明确指定其他状态或全部状态
    const status = req.query.status !== undefined ? req.query.status : '成功';
    
    // 构建查询条件
    let queryConditions = [];
    let queryParams = [];
    let paramIndex = 1;
    
    if (userId) {
      queryConditions.push(`sr.userid = $${paramIndex++}`);
      queryParams.push(userId);
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
    
    // 构建WHERE子句
    const whereClause = queryConditions.length > 0 ? `WHERE ${queryConditions.join(' AND ')}` : '';
    // 查询总记录数
    const countQuery = `SELECT COUNT(*) FROM wecom.scan_records sr ${whereClause}`;
    const countResult = await db.pool.query(countQuery, queryParams);
    const totalRecords = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRecords / pageSize);
    
    // 查询记录，关联kingdee_orders表获取quantity信息
    const recordsQuery = `
      SELECT sr.*, u.user_name, ko.items
      FROM wecom.scan_records sr 
      LEFT JOIN (select distinct user_id,user_name from wecom.wework_users) u ON sr.userid = u.user_id 
      LEFT JOIN wecom.kingdee_orders ko ON sr.scan_result = ko.order_number
      ${whereClause} 
      ORDER BY sr.scan_time DESC 
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;
    const recordsParams = [...queryParams, pageSize, offset];
    const recordsResult = await db.pool.query(recordsQuery, recordsParams);
    
    // 处理记录，添加用户信息和quantity信息
    const records = recordsResult.rows.map(record => {
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
      
      return {
        ...record,
        user: {
          name: record.user_name
        },
        quantity: totalQuantity
      };
    });
    
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
        status: status
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

app.listen(port, () => {
  console.log(`应用运行在 http://localhost:${port}`);
});