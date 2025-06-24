#!/usr/bin/env node

/**
 * 测试版本的订单库存信息刷新脚本
 * 只刷新前3个订单用于测试
 */

const { findOrdersWithMissingStockInfo, refreshOrderStockInfo } = require('./refresh_stock_info.js');

async function testRefresh() {
  console.log('=== 测试订单库存信息刷新脚本 ===');
  console.log('执行时间:', new Date().toLocaleString());
  
  try {
    // 查找需要刷新的订单
    const ordersToRefresh = await findOrdersWithMissingStockInfo();
    
    if (ordersToRefresh.length === 0) {
      console.log('没有找到需要刷新库存信息的订单');
      return;
    }
    
    // 只测试前3个订单
    const testOrders = ordersToRefresh.slice(0, 50);
    console.log(`找到 ${ordersToRefresh.length} 个订单，测试刷新前 ${testOrders.length} 个订单`);
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < testOrders.length; i++) {
      const orderNumber = testOrders[i];
      console.log(`\n测试进度: ${i + 1}/${testOrders.length}`);
      
      const success = await refreshOrderStockInfo(orderNumber);
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
      
      // 每次请求间隔2秒
      if (i < testOrders.length - 1) {
        console.log('等待2秒后继续...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('\n=== 测试完成 ===');
    console.log(`测试订单数: ${testOrders.length}`);
    console.log(`成功刷新: ${successCount}`);
    console.log(`刷新失败: ${failCount}`);
    console.log('完成时间:', new Date().toLocaleString());
    
  } catch (error) {
    console.error('测试脚本执行失败:', error.message);
  }
}

// 运行测试
testRefresh().catch(console.error);