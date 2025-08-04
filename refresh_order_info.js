#!/usr/bin/env node

/**
 * 自动刷新订单信息脚本
 * 功能：查找缺少的OTC订单信息，重新从金蝶系统获取完整信息并更新
 * 作者：系统自动生成
 * 创建时间：2024年
 */

const axios = require('axios');
const { Pool } = require('pg');

// 数据库连接配置
const pool = new Pool({
  user: 'zhengqiang',
  host: 'localhost',
  database: 'zhengqiang',
  password: 'zhengqiang',
  port: 5432,
  schema: 'wecom'
});

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
    
    // 检查响应是否为HTML（错误页面）
    if (typeof response.data === 'string' && response.data.includes('<html>')) {
      console.error('金蝶接口返回HTML页面，可能是错误页面或接口不可用');
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
          return null;
        }
      }
      
      console.log('成功获取订单数据，包含', Array.isArray(parsedData) ? parsedData.length : 1, '条记录');
      return parsedData;
    } else {
      console.log('金蝶接口返回失败，状态码:', response.status);
      return null;
    }
  } catch (error) {
    console.error('调用金蝶接口失败:', error.message);
    if (error.response) {
      console.error('错误响应状态:', error.response.status);
    }
    return null;
  }
}

/**
 * 保存金蝶订单信息到专用表
 * @param {Object} orderData - 订单数据
 * @returns {Promise<Object>} 保存的订单记录
 */
async function saveKingdeeOrder(orderData) {
  try {
    console.log('开始保存金蝶订单数据:', orderData.order_number);
    
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
        itemsJson = JSON.parse(items);
      } catch (e) {
        console.warn('items字段不是有效JSON，将作为普通对象处理');
        itemsJson = { raw_data: items };
      }
    } else if (Array.isArray(items)) {
      itemsJson = items;
      console.log('items是数组格式，包含', items.length, '条明细记录');
    } else {
      itemsJson = items || {};
    }
    
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
    
    console.log('金蝶订单保存成功:', result.rows[0].order_number);
    return result.rows[0];
  } catch (err) {
    console.error('保存金蝶订单失败:', err.message);
    throw err;
  }
}

/**
 * 更新扫描记录状态为成功
 * @param {string} orderNumber - 订单号
 * @returns {Promise<boolean>} 是否更新成功
 */
async function updateScanRecordStatus(orderNumber) {
  try {
    const result = await pool.query(
      `UPDATE wecom.scan_records SET status = '成功' WHERE scan_result = $1`,
      [orderNumber]
    );
    
    if (result.rowCount > 0) {
      console.log(`已更新订单 ${orderNumber} 的扫描记录状态为成功，影响行数: ${result.rowCount}`);
      return true;
    } else {
      console.log(`订单 ${orderNumber} 在扫描记录中未找到对应记录`);
      return false;
    }
  } catch (error) {
    console.error(`更新订单 ${orderNumber} 扫描记录状态失败:`, error.message);
    return false;
  }
}

/**
 * 处理并保存订单数据
 * @param {Object|Array} orderData - 从金蝶接口获取的订单数据
 * @param {string} userid - 用户ID
 * @returns {Object|null} 保存的订单数据或null
 */
async function processAndSaveOrder(orderData, userid) {
  try {
    if (!orderData) {
      console.log('订单数据为空');
      return null;
    }

    let savedOrder = null;
    let orderNumber = null;

    if (Array.isArray(orderData)) {
      // 处理数组格式的订单数据
      const salesOrderData = {
        order_number: orderData[0].FBillNo || 'N/A',
        customer_name: orderData[0]['FCustId.FName'] || orderData[0]['FCustId.FShortName'] || orderData[0].FCustName || 'N/A',
        customer_code: orderData[0]['FCustId.FNumber'] || orderData[0].FCustCode || 'N/A',
        order_date: orderData[0].FDate ? orderData[0].FDate.split('T')[0] : new Date().toISOString().split('T')[0],
        delivery_date: orderData[0].FDeliveryDate ? orderData[0].FDeliveryDate.split('T')[0] : null,
        total_amount: parseFloat(orderData[0].FAmount || orderData[0].total_amount || 0),
        currency: orderData[0].FCurrency || 'CNY',
        status: orderData[0].FDocumentStatus || orderData[0].FStatus || 'pending',
        items: orderData,
        created_by: userid
      };
      
      orderNumber = salesOrderData.order_number;
      console.log('准备保存订单，订单号:', orderNumber, '明细项数量:', orderData.length);
      savedOrder = await saveKingdeeOrder(salesOrderData);
      console.log('金蝶订单已保存，包含', orderData.length, '条明细项');
      
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
        items: [orderData],
        created_by: userid
      };
      
      orderNumber = salesOrderData.order_number;
      savedOrder = await saveKingdeeOrder(salesOrderData);
      console.log('金蝶订单信息已保存到数据库:', orderNumber);
    }
    
    // 如果订单保存成功，更新扫描记录状态
    if (savedOrder && orderNumber && orderNumber !== 'N/A') {
      await updateScanRecordStatus(orderNumber);
    }
    
    return savedOrder;
  } catch (error) {
    console.error('处理订单数据失败:', error.message);
    return null;
  }
}

/**
 * 查找缺少的OTC订单
 * @returns {Promise<Array>} 缺少库存信息的订单号列表
 */
async function findOrdersWithMissingStockInfo() {
  try {
    console.log('查找缺少的OTC订单...');
    
    const result = await pool.query(`
      select distinct scan_result order_number
        from wecom.scan_records 
        left join wecom.kingdee_orders on scan_result=order_number
       where order_number is null and upper(scan_result) like 'OCT%' and DATE_TRUNC('day',scan_time)=current_date
       order by scan_result
    `);
    
    console.log(`找到 ${result.rows.length} 个缺少信息的订单`);
    return result.rows.map(row => row.order_number);
  } catch (error) {
    console.error('查询缺少信息的订单失败:', error.message);
    return [];
  }
}

/**
 * 刷新单个订单的库存信息
 * @param {string} orderNumber - 订单号
 * @returns {Promise<boolean>} 是否刷新成功
 */
async function refreshOrderStockInfo(orderNumber) {
  try {
    console.log(`\n开始刷新订单 ${orderNumber} 的库存信息...`);
    
    // 从金蝶系统获取最新订单信息
    const orderData = await fetchOrderFromKingdee(orderNumber);
    
    if (!orderData) {
      console.log(`订单 ${orderNumber} 无法从金蝶系统获取数据`);
      return false;
    }
    
    // 保存更新的订单信息
    const savedOrder = await processAndSaveOrder(orderData, 'system_refresh');
    
    if (savedOrder) {
      console.log(`订单 ${orderNumber} 订单信息刷新成功`);
      return true;
    } else {
      console.log(`订单 ${orderNumber} 订单信息刷新失败`);
      return false;
    }
  } catch (error) {
    console.error(`刷新订单 ${orderNumber} 失败:`, error.message);
    return false;
  }
}

/**
 * 主函数：批量刷新所有缺少库存信息的订单
 */
async function main() {
  console.log('=== 开始执行订单信息自动刷新脚本 ===');
  console.log('执行时间:', new Date().toLocaleString());
  
  try {
    // 查找需要刷新的订单
    const ordersToRefresh = await findOrdersWithMissingStockInfo();
    
    if (ordersToRefresh.length === 0) {
      console.log('没有找到需要刷新库存信息的订单');
      return;
    }
    
    console.log(`准备刷新 ${ordersToRefresh.length} 个订单的库存信息`);
    
    let successCount = 0;
    let failCount = 0;
    
    // 逐个刷新订单（避免并发过多导致接口压力）
    for (let i = 0; i < ordersToRefresh.length; i++) {
      const orderNumber = ordersToRefresh[i];
      console.log(`\n进度: ${i + 1}/${ordersToRefresh.length}`);
      
      const success = await refreshOrderStockInfo(orderNumber);
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
      
      // 每次请求间隔1秒，避免对金蝶接口造成压力
      if (i < ordersToRefresh.length - 1) {
        console.log('等待1秒后继续...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log('\n=== 刷新完成 ===');
    console.log(`总订单数: ${ordersToRefresh.length}`);
    console.log(`成功刷新: ${successCount}`);
    console.log(`刷新失败: ${failCount}`);
    console.log('完成时间:', new Date().toLocaleString());
    
  } catch (error) {
    console.error('脚本执行失败:', error.message);
  } finally {
    // 关闭数据库连接
    await pool.end();
    console.log('数据库连接已关闭');
  }
}

// 如果直接运行此脚本，则执行主函数
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  findOrdersWithMissingStockInfo,
  refreshOrderStockInfo,
  main
};