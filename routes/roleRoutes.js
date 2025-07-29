// duongbackend/routes/roleRoutes.js

const express = require('express');
const router = express.Router();
// SỬA ĐỔI: Import các hàm cụ thể từ roleController
const { index, show, store, update, destroy, syncPermissions, allPermissions } = require('../controllers/roleController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');

// Áp dụng middleware bảo vệ và phân quyền cho các route vai trò
router.get('/', protect, authorize('view roles', 'manage roles'), index);
router.get('/:id', protect, authorize('view roles', 'manage roles'), show);
router.post('/', protect, authorize('create roles', 'manage roles'), store);
router.put('/:id', protect, authorize('edit roles', 'manage roles'), update);
router.delete('/:id', protect, authorize('delete roles', 'manage roles'), destroy);
router.put('/:id/sync-permissions', protect, authorize('manage roles'), syncPermissions);

module.exports = router;
