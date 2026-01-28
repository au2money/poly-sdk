/**
 * Auto Copy Trading Test - 自动跟单聪明钱
 *
 * 简化版跟单：一行代码启动自动跟单
 * - 跟踪排行榜前10名
 * - 聪明钱一旦有交易立即跟单
 * - 支持 dry run 模式测试
 *
 * 运行：pnpm exec tsx scripts/smart-money/04-auto-copy-trading.ts
 */

import 'dotenv/config';
import '../_ws-proxy-patch.mjs';
import {
  SmartMoneyService,
  WalletService,
  RealtimeServiceV2,
  TradingService,
  DataApiClient,
  SubgraphClient,
  RateLimiter,
  createUnifiedCache,
} from '../../src/index.js';

// Configuration
const DRY_RUN = true; // Set to false to execute real trades
const TOP_N = 50; // Follow top 50 traders (more chances to catch trades)
const SIZE_SCALE = 0.1; // Copy 10% of their trade size
const MAX_SIZE_PER_TRADE = 3; // Max $10 per trade
const MAX_SLIPPAGE = 0.03; // 3% slippage
const TARGET_ADDRESSES: string[] = [];

async function main() {
  console.log('='.repeat(60));
  console.log('🤖 Auto Copy Trading - 自动跟单聪明钱');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? '🧪 DRY RUN (不执行真实交易)' : '💰 LIVE TRADING'}`);
  console.log(`Following: Top ${TOP_N} traders`);
  console.log(`Size Scale: ${SIZE_SCALE * 100}%`);
  console.log(`Max per trade: $${MAX_SIZE_PER_TRADE}`);
  console.log(`Running: Continuous (until manually stopped)`);
  console.log('='.repeat(60));

  // Check for private key
  const privateKey = process.env.PRIVATE_KEY || process.env.POLY_PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY or POLY_PRIVATE_KEY not found in .env');
    process.exit(1);
  }

  // Initialize services
  console.log('\n[Init] 初始化服务...');
  const cache = createUnifiedCache();
  const rateLimiter = new RateLimiter();
  const dataApi = new DataApiClient(rateLimiter, cache);
  const subgraph = new SubgraphClient(rateLimiter, cache);
  const walletService = new WalletService(dataApi, subgraph, cache);
  const realtimeService = new RealtimeServiceV2();
  const tradingService = new TradingService(rateLimiter, cache, {
    privateKey,
    chainId: 137,
    proxyAddress: process.env.PROXY_ADDRESS, // Optional: Force specific proxy address
  });

  const smartMoneyService = new SmartMoneyService(
    walletService,
    realtimeService,
    tradingService
  );

  const ourAddress = tradingService.getAddress().toLowerCase();
  console.log(`  我们的钱包: ${ourAddress.slice(0, 10)}...${ourAddress.slice(-6)}`);

  try {
    // Connect WebSocket
    console.log('\n[WebSocket] 连接中...');
    realtimeService.connect();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
      realtimeService.once('connected', () => {
        clearTimeout(timeout);
        console.log('  ✅ WebSocket connected');
        resolve();
      });
    });

    // Start auto copy trading - 一行代码启动自动跟单！
    console.log('\n[Auto Copy Trading] 启动自动跟单...');

    const subscription = await smartMoneyService.startAutoCopyTrading({
      // 跟踪排行榜前N名
      topN: TOP_N,

      targetAddresses: TARGET_ADDRESSES,
      // 跟单配置
      sizeScale: SIZE_SCALE,
      maxSizePerTrade: MAX_SIZE_PER_TRADE,
      maxSlippage: MAX_SLIPPAGE,
      orderType: 'FOK',

      // 过滤
      minTradeSize: 5, // Only copy trades > $5

      // Dry run mode
      dryRun: DRY_RUN,

      // Callbacks
      onTrade: (trade, result) => {
        console.log('\n📈 跟单执行:');
        console.log(`  Trader: ${trade.traderName || trade.traderAddress.slice(0, 10)}`);
        console.log(`  Market: ${trade.marketSlug}`);
        console.log(`  ${trade.side} ${trade.outcome} @ $${trade.price.toFixed(4)}`);
        console.log(`  Result: ${result.success ? '✅ 成功' : '❌ 失败'}`);
        if (result.orderId) console.log(`  OrderId: ${result.orderId}`);
        if (result.errorMsg) console.log(`  Error: ${result.errorMsg}`);
      },
      onError: (error) => {
        console.error('\n❌ 跟单错误:', error.message);
      },
    });

    console.log(`\n✅ 自动跟单已启动!`);
    console.log(`   跟踪 ${subscription.targetAddresses.length} 个钱包`);
    console.log(`   目标地址:`);
    subscription.targetAddresses.slice(0, 5).forEach((addr, i) => {
      console.log(`     ${i + 1}. ${addr.slice(0, 10)}...${addr.slice(-6)}`);
    });
    if (subscription.targetAddresses.length > 5) {
      console.log(`     ... 还有 ${subscription.targetAddresses.length - 5} 个`);
    }

     console.log('\n⏳ 监听交易中... (按 Ctrl+C 或 PM2 停止)\n');

    // Run continuously and log stats periodically
    const statsInterval = setInterval(() => {
      const stats = subscription.getStats();
      const elapsed = Math.floor((Date.now() - stats.startTime) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      const timeStr = hours > 0
        ? `${hours}h ${minutes}m ${seconds}s`
        : minutes > 0
          ? `${minutes}m ${seconds}s`
          : `${seconds}s`;
      console.log(`  [${timeStr}] 检测: ${stats.tradesDetected}, 执行: ${stats.tradesExecuted}, 跳过: ${stats.tradesSkipped}, 失败: ${stats.tradesFailed}`);
    }, 30000); // Log stats every 30 seconds

    // Handle graceful shutdown
    const shutdown = () => {
      console.log('\n\n收到停止信号，正在清理...');
      clearInterval(statsInterval);

      // Final stats
      const finalStats = subscription.getStats();
      console.log('\n' + '='.repeat(60));
      console.log('📊 运行统计');
      console.log('='.repeat(60));
      const elapsed = Math.floor((Date.now() - finalStats.startTime) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      console.log(`  运行时间: ${hours}h ${minutes}m ${seconds}s`);
      console.log(`  检测交易: ${finalStats.tradesDetected}`);
      console.log(`  执行跟单: ${finalStats.tradesExecuted}`);
      console.log(`  跳过交易: ${finalStats.tradesSkipped}`);
      console.log(`  失败交易: ${finalStats.tradesFailed}`);
      console.log(`  总花费: $${finalStats.totalUsdcSpent.toFixed(2)}`);

      // Cleanup
      subscription.stop();
      smartMoneyService.disconnect();
      realtimeService.disconnect();

      console.log('\n✅ 已停止');
      process.exit(0);
    };

    // Register signal handlers for graceful shutdown
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep process running
    await new Promise(() => {}); // Never resolves, runs until signal

  } catch (error: any) {
    console.error('\n❌ 错误:', error.message);
    smartMoneyService.disconnect();
    realtimeService.disconnect();
    process.exit(1);
  }
}

main().catch(console.error);
