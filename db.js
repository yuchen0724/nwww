const { Pool } = require('pg');

// 数据库连接配置
const pool = new Pool({
  user: 'zhengqiang',      // 根据实际情况修改
  host: 'localhost',
  database: 'zhengqiang',  // 根据实际情况修改
  password: 'zhengqiang',          // 根据实际情况修改
  port: 5432,
  schema: 'wecom'
});

// 添加用户
async function addUser(user) {
  try {
    const { name, userid, department, position, mobile, email } = user;
    const result = await pool.query(
      'INSERT INTO wecom.user_records (name, userid, department, position, mobile, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, userid, department, position, mobile, email]
    );
    return result.rows[0];
  } catch (err) {
    console.error('添加用户失败', err);
    throw err;
  }
}

// 记录扫码
async function addScanRecord(record) {
  try {
    const { userid, scan_type, scan_result, status, position } = record;
    const result = await pool.query(
      'INSERT INTO wecom.scan_records (userid, scan_type, scan_result, status, position) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userid, scan_type, scan_result, status, position]
    );
    return result.rows[0];
  } catch (err) {
    console.error('添加扫码记录失败', err);
    throw err;
  }
}

// 添加企业微信用户到用户记录表
async function saveWecomUser(wecomUserInfo) {
  try {
    // 从企业微信API获取的用户信息转换为数据库格式
    const user = {
      name: wecomUserInfo.name,
      userid: wecomUserInfo.userid,
      department: Array.isArray(wecomUserInfo.department) ? wecomUserInfo.department.join(',') : wecomUserInfo.department,
      position: wecomUserInfo.position,
      mobile: wecomUserInfo.mobile,
      email: wecomUserInfo.email
    };
    
    // 保存到数据库
    const savedUser = await addUser(user);
    console.log('用户保存成功:', savedUser);
    return savedUser;
  } catch (err) {
    console.error('保存用户失败:', err);
    throw err;
  }
}

/**
 * 记录扫码信息
 * @param {string} userid - 用户ID
 * @param {string} qrContent - 二维码内容
 * @param {string} status - 扫描状态，默认为'成功'
 * @param {string} scanType - 扫描类型，默认为'qrcode'
 * @returns {Promise<Object>} 扫码记录
 */
async function recordScan(userid, qrContent, status = '成功', scanType = 'qrcode') {
  try {
    // 从user_op表获取用户的岗位信息(description字段)
    let userPosition = null;
    try {
      const userResult = await pool.query(
        'SELECT description FROM wecom.user_op WHERE user_id = $1 LIMIT 1',
        [userid]
      );
      if (userResult.rows.length > 0 && userResult.rows[0].description) {
        userPosition = userResult.rows[0].description;
      }
    } catch (positionError) {
      console.error('获取用户岗位信息失败:', positionError);
      // 获取岗位信息失败不影响扫码记录保存，继续处理
    }
    
    const scanRecord = {
      userid,
      scan_type: scanType,
      scan_result: qrContent,
      status: status,
      position: userPosition
    };
    
    const record = await addScanRecord(scanRecord);
    console.log('扫码记录保存成功:', record);
    return record;
  } catch (err) {
    console.error('保存扫码记录失败:', err);
    throw err;
  }
}

/**
 * 获取去重的用户ID和名称
 * @returns {Promise<Array>} 用户列表
 */
async function getDistinctUsers() {
  try {
    const result = await pool.query('SELECT user_id as userid, user_name as name FROM wecom.wework_users ORDER BY user_name COLLATE "zh-x-icu"');
    return result.rows;
  } catch (err) {
    console.error('获取去重用户失败', err);
    throw err;
  }
}

/**
 * 保存金蝶订单信息到专用表
 * @param {Object} orderData - 订单数据
 * @returns {Promise<Object>} 保存的订单记录
 */
async function saveKingdeeOrder(orderData) {
  try {
    console.log('开始保存金蝶订单数据:', JSON.stringify(orderData, null, 2));
    
    const {
      order_number,
      customer_name,
      customer_code,
      order_date,
      delivery_date,
      total_amount,
      currency,
      status,
      items,
      created_by
    } = orderData;
    
    // 验证必要字段
    if (!order_number) {
      throw new Error('订单号不能为空');
    }
    if (!created_by) {
      throw new Error('创建者不能为空');
    }
    
    // 处理items字段 - 确保是有效的JSON数据
    let itemsJson;
    if (typeof items === 'string') {
      try {
        // 验证是否为有效JSON
        itemsJson = JSON.parse(items);
      } catch (e) {
        console.warn('items字段不是有效JSON，将作为普通对象处理:', items);
        itemsJson = { raw_data: items };
      }
    } else if (Array.isArray(items)) {
      // 如果是数组，直接使用
      itemsJson = items;
      console.log('items是数组格式，包含', items.length, '条明细记录');
    } else {
      // 如果是对象或其他类型，确保是有效数据
      itemsJson = items || {};
    }
    
    console.log('准备执行SQL插入到kingdee_orders表，参数:', {
      order_number,
      customer_name,
      customer_code,
      order_date,
      delivery_date,
      total_amount,
      currency,
      status,
      items_type: typeof itemsJson,
      created_by
    });
    
    const result = await pool.query(
      `INSERT INTO wecom.kingdee_orders 
       (order_number, customer_name, customer_code, order_date, delivery_date, 
        total_amount, currency, status, items, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       ON CONFLICT (order_number) 
       DO UPDATE SET 
         customer_name = EXCLUDED.customer_name,
         customer_code = EXCLUDED.customer_code,
         order_date = EXCLUDED.order_date,
         delivery_date = EXCLUDED.delivery_date,
         total_amount = EXCLUDED.total_amount,
         currency = EXCLUDED.currency,
         status = EXCLUDED.status,
         items = EXCLUDED.items,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [order_number, customer_name, customer_code, order_date, delivery_date, 
       total_amount, currency, status, JSON.stringify(itemsJson), created_by]
    );
    
    console.log('金蝶订单保存成功:', result.rows[0]);
    return result.rows[0];
  } catch (err) {
    console.error('保存金蝶订单失败，详细错误信息:');
    console.error('错误消息:', err.message);
    console.error('错误代码:', err.code);
    console.error('错误详情:', err.detail);
    console.error('输入数据:', JSON.stringify(orderData, null, 2));
    throw err;
  }
}

module.exports = {
  pool,
  addUser,
  addScanRecord,
  saveWecomUser,
  recordScan,
  getDistinctUsers,
  saveKingdeeOrder
}