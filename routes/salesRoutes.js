// duongbackend/routes/salesRoutes.js

const express = require('express');
const router = express.Router();
const salesController = require('../controllers/salesController');
const { protect } = require('../middleware/authMiddleware'); // Middleware xác thực người dùng
const { authorize } = require('../middleware/authorizeMiddleware'); // Middleware phân quyền

// ✅ Quyền mới cần có:
// - access_app_banhang: Quyền truy cập màn hình bán hàng
// - create_orders: Quyền tạo đơn hàng

// 👉 Lấy danh sách sản phẩm cho màn hình bán hàng (POS)
router.get(
  '/sales-products',
  protect,
  authorize('access_app_sales'), // Yêu cầu quyền truy cập ứng dụng bán hàng
  salesController.getSalesProducts
);

// 👉 Tạo đơn hàng mới
router.post(
  '/orders',
  protect,
  authorize('create_app_sales'), // Yêu cầu quyền tạo đơn hàng
  salesController.placeOrder
);

module.exports = router;
