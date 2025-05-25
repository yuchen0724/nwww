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

// 查询用户
async function getUsers() {
  try {
    const result = await pool.query('SELECT * FROM wecom.user_records');
    return result.rows;
  } catch (err) {
    console.error('获取用户失败', err);
    throw err;
  }
}

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
    const { userid, scan_type, scan_result, status } = record;
    const result = await pool.query(
      'INSERT INTO wecom.scan_records (userid, scan_type, scan_result, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [userid, scan_type, scan_result, status]
    );
    return result.rows[0];
  } catch (err) {
    console.error('添加扫码记录失败', err);
    throw err;
  }
}

// 获取配置
async function getConfig(key) {
  try {
    const result = await pool.query('SELECT * FROM wecom.configs WHERE config_key = $1', [key]);
    return result.rows[0];
  } catch (err) {
    console.error('获取配置失败', err);
    throw err;
  }
}

// 设置配置
async function setConfig(key, value, description = '') {
  try {
    const result = await pool.query(
      'INSERT INTO wecom.configs (config_key, config_value, description) VALUES ($1, $2, $3) ON CONFLICT (config_key) DO UPDATE SET config_value = $2, description = $3, updated_at = CURRENT_TIMESTAMP RETURNING *',
      [key, value, description]
    );
    return result.rows[0];
  } catch (err) {
    console.error('设置配置失败', err);
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

// 记录扫码结果
async function recordScan(userid, qrContent) {
  try {
    const scanRecord = {
      userid,
      scan_type: 'qrcode',
      scan_result: qrContent,
      status: 'success'
    };
    
    const record = await addScanRecord(scanRecord);
    console.log('扫码记录保存成功:', record);
    return record;
  } catch (err) {
    console.error('保存扫码记录失败:', err);
    throw err;
  }
}

module.exports = {
  pool,
  getUsers,
  addUser,
  addScanRecord,
  getConfig,
  setConfig,
  saveWecomUser,
  recordScan
};