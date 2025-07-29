// duongbackend/routes/statisticsRoutes.js

const express = require('express');
const router = express.Router();
const statisticsController = require('../controllers/statisticsController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');

// ✅ Danh sách quyền mới cho Thống kê:
// - access_app_thongke (truy cập module thống kê)
// - view_overall_stats_app_thongke
// - view_branch_stats_app_thongke
// - view_product_stats_app_thongke
// - view_customer_stats_app_thongke
// - view_stock_stats_app_thongke
// - view_return_stats_app_thongke
// - view_time_stats_app_thongke
// - view_weight_stats_app_thongke

// Thống kê tổng quan
router.get('/overall', protect, authorize('access_app_baocaothongke', 'view_app_baocaothongke'), statisticsController.getOverallStatistics);

// Thống kê theo chi nhánh
router.get('/by-branch', protect, authorize('access_app_baocaothongke', 'view_app_baocaothongke'), statisticsController.getBranchStatistics);

// Thống kê sản phẩm bán chạy
router.get('/top-selling-products', protect, authorize('access_app_baocaothongke', 'view_app_baocaothongke'), statisticsController.getTopSellingProducts);

// Thống kê theo khách hàng
router.get('/by-customer', protect, authorize('access_app_baocaothongke', 'view_app_baocaothongke'), statisticsController.getCustomerStatistics);

// Thống kê tồn kho
router.get('/stock-overview', protect, authorize('access_app_baocaothongke', 'view_app_baocaothongke'), statisticsController.getStockStatistics);

// Thống kê trả hàng
router.get('/returns-overview', protect, authorize('access_app_baocaothongke', 'view_app_baocaothongke'), statisticsController.getReturnStatistics);

// Thống kê theo thời gian
router.get('/time-based-sales', protect, authorize('access_app_baocaothongke', 'view_app_baocaothongke'), statisticsController.getTimeBasedStatistics);

// Thống kê sản phẩm bán theo trọng lượng
router.get('/weight-based-products', protect, authorize('access_app_baocaothongke', 'view_app_baocaothongke'), statisticsController.getWeightBasedProductStatistics);

module.exports = router;
