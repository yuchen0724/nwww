module.exports = {
  apps : [{
    name      : "zq-wx-scan",
    script    : "app.js",
    watch     : true, // 启用文件监控
    ignore_watch : ["node_modules", "logs"], // 指定不监控的目录或文件
  }]
};