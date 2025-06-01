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
        scanType: ["qrCode", "barCode"], // 可以指定扫二维码还是条形码
        success: function(res) {
          const result = res.resultStr; // 当needResult为1时，扫码返回的结果
          
          // 显示扫描结果
          showResult(`二维码内容: ${result}（已发送到企业微信机器人）`, 'success');
          
          // 将扫描结果发送到服务器保存
          fetch('/save-scan-result', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content: result })
          })
          .then(response => response.json())
          .then(data => {
            if (data.success) {
              // 添加到表格
              const now = new Date().toLocaleString();
              const newRow = document.createElement('tr');
              newRow.innerHTML = `
                <td>${now}</td>
                <td>${result}</td>
              `;
              
              // 如果表格中有"暂无扫描记录"的行，则移除它
              const noRecordRow = resultsTable.querySelector('tr td[colspan="2"]');
              if (noRecordRow) {
                noRecordRow.parentElement.remove();
              }
              
              // 添加到表格顶部
              if (resultsTable.firstChild) {
                resultsTable.insertBefore(newRow, resultsTable.firstChild);
              } else {
                resultsTable.appendChild(newRow);
              }
            } else {
              console.error('保存扫描结果失败:', data.message);
              // 如果是订单不存在或订单号不匹配的错误，显示特定的错误提示
              const orderInfo = data.scanned_order ? `（扫描订单号：${data.scanned_order}）` : '';

              if (data.error_type === 'order_not_found') {
                showResult(`订单不存在${orderInfo}`, 'danger');
              } else if (data.error_type === 'order_mismatch') {
                showResult(`订单号不匹配${orderInfo}`, 'danger');
              } else {
                showResult('保存扫描结果失败: ' + data.error_type, 'danger');
              }
            }
          })
          .catch(error => {
            console.error('保存扫描结果出错:', error);
          });
        },
        fail: function(res) {
          console.error('扫码失败:', res);
          showResult('扫码失败，请重试', 'danger');
        }
      });
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