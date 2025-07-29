// duongbackend/routes/inventoryRoutes.js

const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');

// ✅ Quyền mới:
// - access_app_ql_tonkho
// - manage_stock_manual
// - transfer_stock
// - view_stock_reports

// Lấy tổng quan tồn kho (danh sách sản phẩm với tồn kho chi nhánh)
router.get('/', protect, authorize('access_app_ql_tonkho'), inventoryController.getInventorySummary);

// Lấy danh sách sản phẩm đơn giản (cho dropdown trong form)
router.get('/products-list', protect, authorize('access_app_ql_tonkho'), inventoryController.getSimpleProductsList);

// Lấy danh sách chi nhánh đơn giản (cho dropdown trong form)
router.get('/branches-list', protect, authorize('access_app_ql_tonkho'), inventoryController.getSimpleBranchesList);

// Điều chỉnh tồn kho thủ công (tăng/giảm)
router.post('/adjust', protect, authorize('manage_stock_manual'), inventoryController.adjustStock);

// Chuyển kho sản phẩm
router.post('/transfer', protect, authorize('transfer_stock'), inventoryController.transferStock);

// Lấy lịch sử giao dịch tồn kho
router.get('/transactions', protect, authorize('view_stock_reports'), inventoryController.getInventoryTransactions);

module.exports = router;
