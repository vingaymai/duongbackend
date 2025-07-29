// duongbackend/routes/orderManagementRoutes.js

const express = require('express');
const router = express.Router();
const orderManagementController = require('../controllers/orderManagementController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');

// ✅ Danh sách quyền mới cho quản lý đơn hàng:
// - access_app_ql_donhang (truy cập app)
// - view_app_ql_donhang

// Export Excel đơn hàng
router.get('/export', protect, authorize('export_app_ql_donhang'), orderManagementController.exportOrders);

// Lấy danh sách đơn hàng
router.get('/', protect, authorize('access_app_ql_donhang'), orderManagementController.index);

// Lấy chi tiết đơn hàng
router.get('/:id', protect, authorize('view_app_ql_donhang'), orderManagementController.show);

// Cập nhật trạng thái đơn hàng
router.put('/:id/status', protect, authorize('edit_app_ql_donhang'), orderManagementController.updateStatus);

// Xử lý trả hàng (tạo một bản ghi trả hàng mới)
router.post('/returns', protect, authorize('edit_app_ql_donhang'), orderManagementController.createReturn);

module.exports = router;
