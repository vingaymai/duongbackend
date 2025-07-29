// duongbackend/routes/permissionRoutes.js

const express = require('express');
const router = express.Router();
// SỬA ĐỔI: Import các hàm cụ thể từ permissionController
const { index } = require('../controllers/permissionController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');

// Route để lấy tất cả quyền hạn (chủ yếu dùng cho frontend hiển thị list)
router.get('/', protect, authorize('view permissions', 'manage roles'), index);

module.exports = router;
