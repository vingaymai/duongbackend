// duongbackend/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authorize } = require('../middleware/authorizeMiddleware'); // Import authorize

// Lưu ý: Router này đã được bảo vệ bằng `protect` ở `app.js`
// Giờ chỉ cần áp dụng `authorize` cho từng hành động cụ thể

router.get('/', authorize('view_app_ql_nguoidung'), userController.index);
router.get('/:id', authorize('view_app_ql_nguoidung'), userController.show);
router.post('/', authorize('create_app_ql_nguoidung'), userController.store);
router.put('/:id', authorize('edit_app_ql_nguoidung'), userController.update);
router.delete('/:id', authorize('delete_app_ql_nguoidung'), userController.destroy);

module.exports = router;