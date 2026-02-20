// 测试脚本：检查图标加载问题
// 在 Electron 主进程中运行此脚本

const { app } = require('electron');
const path = require('path');

async function testIconLoading() {
  console.log('\n=== Testing Icon Loading ===\n');

  // 测试常见的系统文件图标
  const testPaths = [
    'C:\\Windows\\System32\\control.exe',
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Windows\\explorer.exe',
  ];

  for (const testPath of testPaths) {
    try {
      console.log(`Testing: ${testPath}`);
      const icon = await app.getFileIcon(testPath, { size: 'small' });
      if (icon && !icon.isEmpty()) {
        const dataUrl = icon.toDataURL();
        console.log(`✓ Success: ${testPath} (${dataUrl.length} bytes)`);
      } else {
        console.log(`✗ Empty icon: ${testPath}`);
      }
    } catch (error) {
      console.log(`✗ Error: ${testPath} - ${error.message}`);
    }
  }

  console.log('\n=== Test Complete ===\n');
}

// 导出供主进程调用
module.exports = { testIconLoading };
