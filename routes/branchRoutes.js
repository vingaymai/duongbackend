const express = require('express');
const router = express.Router();
const branchController = require('../controllers/branchController');
const { protect } = require('../middleware/authMiddleware');
const { authorize } = require('../middleware/authorizeMiddleware');
const checkBranchAccess = require('../middleware/checkBranchAccess');

// Lấy tất cả chi nhánh (Admin) - quyền xem
router.get(
    '/',
    protect,
    authorize('view_app_ql_chinhanh'),
    branchController.index
);

// Lấy chi nhánh theo quyền user - quyền xem
router.get(
    '/my',
    protect,
    authorize('view_app_ql_chinhanh'),
    branchController.indexUserBranches
);

// Lấy chi nhánh theo id - quyền xem
router.get(
    '/:id',
    protect,
    authorize('view_app_ql_chinhanh'),
    checkBranchAccess,
    branchController.show
);

// Tạo chi nhánh mới - quyền tạo
router.post(
    '/',
    protect,
    authorize('create_app_ql_chinhanh'),
    branchController.store
);

// Cập nhật chi nhánh theo id - quyền sửa
router.put(
    '/:id',
    protect,
    authorize('edit_app_ql_chinhanh'),
    checkBranchAccess,
    branchController.update
);

// Xóa chi nhánh theo id - quyền xóa
router.delete(
    '/:id',
    protect,
    authorize('delete_app_ql_chinhanh'),
    checkBranchAccess,
    branchController.destroy
);

module.exports = router;

