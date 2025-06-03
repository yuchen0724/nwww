document.addEventListener('DOMContentLoaded', function() {
  const scanQrBtn = document.getElementById('scanQrBtn');
  const scanResult = document.getElementById('scanResult');
  const resultsTable = document.getElementById('resultsTable');
  const successSound = document.getElementById('successSound');
  const errorSound = document.getElementById('errorSound');
  
  // 初始化企业微信JSAPI
  function initWxConfig() {
    // 获取当前页面URL
    const currentUrl = window.location.href.split('#')[0];
    
    // 请求服务器获取配置
    fetch(`/get-jsapi-config?url=${encodeURIComponent(currentUrl)}`)
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          const config = data.config;
          
          // 配置企业微信JS-SDK
          wx.config({
            beta: true,
            debug: false,
            appId: config.corpid,
            timestamp: config.timestamp,
            nonceStr: config.nonceStr,
            signature: config.signature,
            jsApiList: config.jsApiList
          });
          
          wx.error(function(res) {
            console.error('微信JS-SDK配置失败:', res);
            showResult('微信扫码功能初始化失败', 'danger');
          });
        } else {
          console.error('获取JSAPI配置失败:', data.message);
          showResult('微信扫码功能初始化失败', 'danger');
        }
      })
      .catch(error => {
        console.error('请求JSAPI配置出错:', error);
        showResult('微信扫码功能初始化失败', 'danger');
      });
  }
  
  // 页面加载完成后初始化微信配置
  initWxConfig();
  
  // 扫描二维码按钮点击事件
  if (scanQrBtn) {
    scanQrBtn.addEventListener('click', function() {
      // 调用微信扫一扫接口
      wx.scanQRCode({
        needResult: 1, // 默认为0，扫描结果由微信处理，1则直接返回扫描结果
        scanType: ["qrCode", "barCode"], // 可以指定扫二维码还是一维码，默认二者都有
        success: function(res) {
          const result = res.resultStr; // 当needResult为1时，扫码返回的结果
          const codeType = res.codeType; // 获取扫描码类型：QR_CODE 或 BARCODE

          // 根据codeType字段判断扫描类型
          const isBarCode = codeType === 'barcode';
          const scanType = isBarCode ? 'barcode' : 'qrcode';
          
          // 显示扫描结果
          const scanTypeText = isBarCode ? '条形码' : '二维码';
          showResult(`${scanTypeText}内容: ${result}（已发送到企业微信机器人）`, 'success');
          
          // 将扫描结果发送到服务器保存
          fetch('/save-scan-result', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
              content: result,
              scanType: scanType
            })
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              // 重新从服务器获取最新的扫描记录数据
              refreshScanResults();
            } else {
              console.error('保存扫描结果失败:', data ? data.message : 'unknown error');
              // 如果是订单不存在或订单号不匹配的错误，显示特定的错误提示
              if (data && data.error_type) {
                const orderInfo = data.scanned_order ? `（扫描订单号：${data.scanned_order}）` : '';
                
                if (data.error_type === 'order_not_found') {
                  showResult(`订单不存在${orderInfo}`, 'danger');
                } else if (data.error_type === 'order_mismatch') {
                  showResult(`订单号不匹配${orderInfo}`, 'danger');
                } else {
                  showResult('保存扫描结果失败: ' + data.error_type, 'danger');
                }
              } else {
                showResult('保存扫描结果失败: ' + (data ? data.message || '未知错误' : '服务器响应异常'), 'danger');
              }
            }
          })
          .catch(error => {
            console.error('保存扫描结果出错:', error);
            showResult('保存扫描结果失败: 网络错误', 'danger');
          });
        },
        fail: function(res) {
          console.error('扫码失败:', res);
          showResult('扫码失败，请重试', 'danger');
        }
      });
    });
  }
  
  /**
   * 重新获取扫描记录数据并更新表格
   * 从服务器获取最新的扫描记录并刷新页面表格显示
   */
  function refreshScanResults() {
    console.log('开始刷新扫描记录...');
    
    fetch('/get-scan-results')
      .then(response => {
        console.log('获取扫描记录响应状态:', response.status);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('获取到的扫描记录数据:', data);
        
        if (data.success && data.results) {
          // 清空现有表格内容
          resultsTable.innerHTML = '';
          
          if (data.results.length > 0) {
            console.log(`正在添加 ${data.results.length} 条扫描记录到表格`);
            // 添加新的扫描记录
            data.results.forEach(result => {
              const newRow = document.createElement('tr');
              newRow.innerHTML = `
                <td>${result.timestamp}</td>
                <td>${result.content}</td>
                <td>
                  ${result.quantity && result.quantity > 0 ? result.quantity : '<span class="text-muted">-</span>'}
                </td>
              `;
              resultsTable.appendChild(newRow);
            });
            console.log('表格刷新完成');
          } else {
            // 显示暂无记录
            const noRecordRow = document.createElement('tr');
            noRecordRow.innerHTML = '<td colspan="3" class="text-center">暂无扫描记录</td>';
            resultsTable.appendChild(noRecordRow);
            console.log('显示暂无记录提示');
          }
        } else {
          console.error('服务器返回数据格式错误:', data);
        }
      })
      .catch(error => {
        console.error('获取扫描记录失败:', error);
        // 显示错误提示
        showResult('刷新扫描记录失败，请重试', 'warning');
      });
  }

  function showResult(message, type) {
    scanResult.textContent = message;
    scanResult.style.display = 'block';
    scanResult.className = `alert alert-${type} mt-3`;
    
    // 播放相应的声音提示
    if (type === 'success') {
      if (successSound) {
        successSound.currentTime = 0;
        successSound.play().catch(err => console.error('播放成功提示音失败:', err));
      }
    } else if (type === 'danger') {
      if (errorSound) {
        errorSound.currentTime = 0;
        errorSound.play().catch(err => console.error('播放错误提示音失败:', err));
      }
    }
  }
});